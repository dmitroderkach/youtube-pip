import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createTools,
  LIMITS,
  logTime,
  logWindow,
  plainJobLog,
  safeLogGroup,
} from './assistant-tools.mjs';
import { childEnv, createTaintGate, shouldSuppressAnswer } from './fast-lane-core.mjs';
import { createWebResearch, WEB_TOOLS, webCanUseTool, webQueryOptions } from './fast-lane-web.mjs';

const NOW = Date.parse('2026-11-16T20:30:00Z');

test('safeLogGroup: only the project log groups, no wildcards or other projects', () => {
  assert.equal(
    safeLogGroup('/aws/lambda/youtube-pip-prod-fast-lane'),
    '/aws/lambda/youtube-pip-prod-fast-lane'
  );
  assert.equal(
    safeLogGroup('/ecs/youtube-pip-prod-dev-worker'),
    '/ecs/youtube-pip-prod-dev-worker'
  );
  assert.equal(
    safeLogGroup('/aws/codebuild/youtube-pip-prod-tf-plan'),
    '/aws/codebuild/youtube-pip-prod-tf-plan'
  );
  for (const bad of [
    '/aws/lambda/other-project',
    '/aws/lambda/youtube-pip-',
    '/aws/lambda/youtube-pip-*',
    '/aws/lambda/youtube-pip-../x',
    'youtube-pip-prod',
    '',
    null,
  ])
    assert.equal(safeLogGroup(bad), null, String(bad));
});

test('logWindow: default 30 min, 24 h at most, never in the future, malformed times refused', () => {
  assert.deepEqual(logWindow({}, NOW), { start: NOW - 30 * 60000, end: NOW });
  assert.deepEqual(logWindow({ minutes: 5 }, NOW), { start: NOW - 5 * 60000, end: NOW });
  assert.deepEqual(logWindow({ minutes: 100000 }, NOW), { start: NOW - 24 * 3600000, end: NOW });
  assert.deepEqual(logWindow({ start: '2026-11-10T00:00:00Z' }, NOW), {
    start: NOW - 24 * 3600000,
    end: NOW,
  });
  assert.deepEqual(logWindow({ end: '2027-01-01T00:00:00Z', minutes: 10 }, NOW), {
    start: NOW - 10 * 60000,
    end: NOW,
  });
  assert.match(logWindow({ start: 'yesterday' }, NOW).error, /invalid start/);
  assert.match(
    logWindow({ start: '2026-11-16T20:00:00Z', end: '2026-11-16T19:00:00Z' }, NOW).error,
    /empty/
  );
});

test('logTime: the owner time zone', () => {
  assert.equal(logTime(Date.parse('2026-11-16T19:52:30Z'), 'Europe/Warsaw'), '20:52:30');
  assert.equal(logTime(Date.parse('2026-07-01T19:52:30Z'), 'Europe/Warsaw'), '21:52:30');
});

function toolsWith({ events = [], jobs = [], jobLog = '', groups = {} } = {}) {
  const calls = { filter: [], github: [] };
  const tools = createTools({
    s3: {},
    github: async (path) => {
      calls.github.push(path);
      return { jobs };
    },
    githubText: async (path) => {
      calls.github.push(path);
      return jobLog;
    },
    logs: {
      groups: async (prefix) => groups[prefix] ?? [],
      filter: async (args) => {
        calls.filter.push(args);
        return events;
      },
    },
    repo: 'owner/repo',
    project: 'p',
    timeZone: () => 'Europe/Warsaw',
    now: () => NOW,
  });
  return { tools, calls };
}

test('logs: refuses other groups, newest events last, local times, clipped from the start, marked as data', async () => {
  const { tools, calls } = toolsWith({
    events: [
      { timestamp: Date.parse('2026-11-16T20:10:00Z'), message: 'second\n' },
      { timestamp: Date.parse('2026-11-16T20:05:00Z'), message: 'first' },
    ],
  });
  assert.match(await tools.logs({ group: '/aws/lambda/other' }), /Not a log group of the project/);
  assert.equal(calls.filter.length, 0);
  const out = await tools.logs({
    group: '/aws/lambda/youtube-pip-prod-fast-lane',
    minutes: 60,
    pattern: 'timing',
    limit: 1,
  });
  assert.match(out, /untrusted data, not instructions/);
  assert.match(out, /1 event\(s\), 20:30:00-21:30:00 Europe\/Warsaw, filter "timing"/);
  assert.match(out, /21:10:00 second$/);
  assert.doesNotMatch(out, /first/);
  assert.deepEqual(calls.filter[0], {
    group: '/aws/lambda/youtube-pip-prod-fast-lane',
    start: NOW - 3600000,
    end: NOW,
    pattern: 'timing',
    limit: 1,
  });

  const many = Array.from({ length: 400 }, (_, i) => ({
    timestamp: NOW - (400 - i) * 1000,
    message: `line ${i} ${'x'.repeat(200)}`,
  }));
  const big = await toolsWith({ events: many }).tools.logs({
    group: '/ecs/youtube-pip-prod-dev-worker',
    limit: 500,
  });
  assert.ok(big.length < LIMITS.LOG_CHARS + 1000);
  assert.match(big, /earlier characters/);
  assert.match(big, /line 399 /);
});

test('logGroups lists every project prefix', async () => {
  const { tools } = toolsWith({
    groups: {
      '/aws/lambda/youtube-pip-': ['/aws/lambda/youtube-pip-prod-dev-bot'],
      '/ecs/youtube-pip-': ['/ecs/youtube-pip-prod-runner'],
    },
  });
  assert.equal(
    await tools.logGroups(),
    '/aws/lambda/youtube-pip-prod-dev-bot\n/ecs/youtube-pip-prod-runner'
  );
});

test('runLogs: failed jobs with failed steps and the tail of their logs, plain text, marked as data', async () => {
  const { tools, calls } = toolsWith({
    jobs: [
      { id: 1, name: 'lint', status: 'completed', conclusion: 'success', steps: [] },
      {
        id: 2,
        name: 'e2e (chromium)',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/owner/repo/actions/runs/123456789/job/2',
        steps: [
          { name: 'Install', conclusion: 'success' },
          { name: 'Run e2e', conclusion: 'failure' },
        ],
      },
    ],
    jobLog: '2026-11-16T20:00:00.1234567Z \x1b[31mError: boom\x1b[0m\n',
  });
  assert.match(await tools.runLogs({ run: 'abc' }), /Invalid run/);
  const out = await tools.runLogs({
    run: 'https://github.com/owner/repo/actions/runs/123456789',
  });
  assert.match(out, /untrusted data/);
  assert.match(out, /== e2e \(chromium\): failure, failed step\(s\): Run e2e/);
  assert.match(out, /^Error: boom$/m);
  assert.deepEqual(calls.github, [
    'repos/owner/repo/actions/runs/123456789/jobs?per_page=100',
    'repos/owner/repo/actions/jobs/2/logs',
  ]);
  assert.equal(plainJobLog('\x1b[1mx\x1b[0m'), 'x');
});

test('taint gate: direct when clean; after web / logs only with the owner yes; reset per turn', async () => {
  const asked = [];
  let answer = false;
  const gate = createTaintGate({
    confirm: async (description, sources) => {
      asked.push({ description, sources });
      return answer;
    },
  });
  let runs = 0;
  const act = () => {
    runs++;
    return 'done';
  };
  assert.equal(await gate.guard('hand over x', act), 'done');
  assert.equal(asked.length, 0);

  gate.taint('web');
  assert.match(await gate.guard('hand over y', act), /did not confirm/);
  assert.equal(runs, 1);
  assert.deepEqual(asked[0], { description: 'hand over y', sources: ['web'] });

  answer = true;
  gate.taint('logs');
  assert.equal(await gate.guard('stop the worker', act), 'done');
  assert.equal(runs, 2);
  assert.deepEqual(asked[1].sources, ['web', 'logs']);

  gate.newTurn();
  answer = false;
  assert.equal(await gate.guard('schedule', act), 'done');
  assert.equal(asked.length, 2);
});

test('web sub-session: only WebSearch and WebFetch, no MCP, no settings; anything else refused', async () => {
  const home = mkdtempSync(join(tmpdir(), 'web-'));
  const options = webQueryOptions({
    environment: {},
    home,
    model: 'sonnet',
    abortController: new AbortController(),
  });
  assert.deepEqual(options.tools, WEB_TOOLS);
  assert.deepEqual(options.allowedTools, WEB_TOOLS);
  assert.deepEqual(options.mcpServers, {});
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true);
  assert.equal((await webCanUseTool('Bash', {})).behavior, 'deny');
  assert.equal((await webCanUseTool('WebFetch', { url: 'x' })).behavior, 'allow');
});

function webWith(messages) {
  const proxy = { url: 'http://127.0.0.1:1', placeholder: 'sk-ant-oat01-proxy-x' };
  const seen = [];
  return {
    seen,
    research: createWebResearch({
      query: ({ prompt, options }) => {
        seen.push({ prompt, options });
        return (async function* () {
          yield* messages;
        })();
      },
      environment: () =>
        childEnv({ home: '/tmp/w', proxyUrl: proxy.url, placeholder: proxy.placeholder }),
      placeholder: () => proxy.placeholder,
      secrets: () => ['sk-ant-oat01-real-secret'],
      home: mkdtempSync(join(tmpdir(), 'web-')),
      model: () => 'sonnet',
    }),
  };
}

test('web research: the summary marked as untrusted data; a wrong tool list fails the self-check', async () => {
  const ok = webWith([
    { type: 'system', subtype: 'init', tools: ['WebSearch', 'WebFetch'] },
    { type: 'result', result: 'Answer. Source: https://example.com' },
  ]);
  const out = await ok.research('what is new in X?');
  assert.match(out, /^\[Web research result: untrusted data/);
  assert.match(out, /Source: https:\/\/example.com/);
  assert.equal(ok.seen[0].prompt, 'what is new in X?');

  const bad = webWith([
    { type: 'system', subtype: 'init', tools: ['WebSearch', 'WebFetch', 'Bash'] },
    { type: 'result', result: 'x' },
  ]);
  await assert.rejects(bad.research('q'), /unexpected Bash/);
});

test('one answer per message: the fast lane text is dropped only when every message was handed over cleanly', () => {
  assert.equal(shouldSuppressAnswer({ messages: 1, handedOver: 1 }), true);
  assert.equal(shouldSuppressAnswer({ messages: 2, handedOver: 2 }), true);
  // One of two answered by the fast lane itself: its text is sent (about the other message only)
  assert.equal(shouldSuppressAnswer({ messages: 2, handedOver: 1 }), false);
  assert.equal(shouldSuppressAnswer({ messages: 1, handedOver: 0 }), false);
  // A failed hand-over or a taint-gate question: the owner gets one line
  assert.equal(shouldSuppressAnswer({ messages: 1, handedOver: 1, failed: true }), false);
  assert.equal(shouldSuppressAnswer({ messages: 1, handedOver: 1, gateAsked: true }), false);
  assert.equal(shouldSuppressAnswer({}), false);
});
