/** Unit tests of the fast lane's pure parts: `node --test scripts/dev-worker/*.test.mjs`. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createTools, safeName, safePath } from './assistant-tools.mjs';
import {
  CALLBACK_PREFIX,
  checkChildEnv,
  checkToolList,
  childEnv,
  handOverMessage,
  prefixCallbacks,
  runtimeLoop,
  stripCallbackPrefix,
  taskTitle,
  tooBigToResume,
} from './fast-lane-core.mjs';
import { localToUtc, newScheduledTask, validTaskId } from './scheduled-tasks.mjs';

const PLACEHOLDER = 'sk-ant-oat01-proxy-abc';
const REAL = 'sk-ant-oat01-the-real-subscription-token';

test('childEnv: only the allowed names, the placeholder token, no inherited variable', () => {
  const environment = childEnv({
    home: '/tmp/fl',
    proxyUrl: 'http://127.0.0.1:1',
    placeholder: PLACEHOLDER,
  });
  assert.deepEqual(checkChildEnv(environment, { placeholder: PLACEHOLDER, secrets: [REAL] }), []);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(environment.CLAUDE_CONFIG_DIR, '/tmp/fl/.claude');
});

test('checkChildEnv: an extra variable, the real token or a leaked secret fail the self-check', () => {
  const base = childEnv({
    home: '/tmp/fl',
    proxyUrl: 'http://127.0.0.1:1',
    placeholder: PLACEHOLDER,
  });
  assert.match(
    checkChildEnv({ ...base, AWS_SESSION_TOKEN: 'x' }, { placeholder: PLACEHOLDER }).join(),
    /unexpected variable AWS_SESSION_TOKEN/
  );
  assert.match(
    checkChildEnv(
      { ...base, CLAUDE_CODE_OAUTH_TOKEN: REAL },
      { placeholder: PLACEHOLDER, secrets: [REAL] }
    ).join(),
    /not the proxy placeholder/
  );
  assert.match(
    checkChildEnv(
      { ...base, HOME: `/tmp/${REAL}` },
      { placeholder: PLACEHOLDER, secrets: [REAL] }
    ).join(),
    /a secret value/
  );
});

test('checkToolList: exactly the expected tools', () => {
  const expected = ['AskUserQuestion', 'mcp__fast_lane__chat_log'];
  assert.deepEqual(checkToolList(expected, expected), { unexpected: [], missing: [] });
  assert.deepEqual(checkToolList([...expected, 'Bash'], expected), {
    unexpected: ['Bash'],
    missing: [],
  });
  assert.deepEqual(checkToolList(['AskUserQuestion'], expected), {
    unexpected: [],
    missing: ['mcp__fast_lane__chat_log'],
  });
});

test('callbacks: the fast lane prefix on every button, stripped back; too long data refused', () => {
  const markup = {
    inline_keyboard: [
      [
        { text: 'A', callback_data: 'q:1:0.0' },
        { text: 'Link', url: 'https://x' },
      ],
    ],
  };
  const prefixed = prefixCallbacks(markup);
  assert.equal(prefixed.inline_keyboard[0][0].callback_data, `${CALLBACK_PREFIX}q:1:0.0`);
  assert.equal(prefixed.inline_keyboard[0][1].url, 'https://x');
  assert.equal(stripCallbackPrefix(prefixed.inline_keyboard[0][0].callback_data), 'q:1:0.0');
  assert.equal(stripCallbackPrefix('q:1:0.0'), null);
  assert.equal(prefixCallbacks(undefined), undefined);
  assert.throws(() =>
    prefixCallbacks({ inline_keyboard: [[{ text: 'x', callback_data: 'a'.repeat(63) }]] })
  );
});

test('handOverMessage: the worker queue shape, dated now, marked as a hand-over', () => {
  const now = new Date('2026-11-16T18:00:00Z');
  const { body, date } = handOverMessage({ task: 'Fix the flaky test', context: 'CI run 1', now });
  assert.equal(date, Math.floor(now.getTime() / 1000));
  assert.equal(body.date, date);
  assert.equal(body.handover, true);
  assert.deepEqual(body.attachments, []);
  assert.match(body.text, /Handed over by the fast lane/);
  assert.match(body.text, /Task: Fix the flaky test/);
  assert.match(body.text, /Context: CI run 1/);
  assert.equal(taskTitle('a'.repeat(100)).length, 60);
  assert.equal(taskTitle('first line\nsecond'), 'first line');
});

test('tooBigToResume', () => {
  assert.equal(tooBigToResume(10), false);
  assert.equal(tooBigToResume(3 * 1024 * 1024), true);
});

test('runtimeLoop: one invocation answered through the Runtime API, an error reported', async () => {
  const posted = [];
  let next = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.url.endsWith('/next')) {
        next++;
        res.writeHead(200, {
          'lambda-runtime-aws-request-id': `r${next}`,
          'lambda-runtime-deadline-ms': String(Date.now() + 60_000),
        });
        res.end(JSON.stringify({ wake: true, n: next }));
        return;
      }
      posted.push({ url: req.url, body });
      res.end('{}');
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const api = `127.0.0.1:${server.address().port}`;
  await runtimeLoop(async (event) => ({ got: event.n }), { api, once: true });
  await runtimeLoop(
    async () => {
      throw new Error('boom');
    },
    { api, once: true }
  );
  server.close();
  assert.equal(posted[0].url, '/2018-06-01/runtime/invocation/r1/response');
  assert.deepEqual(JSON.parse(posted[0].body), { got: 1 });
  assert.equal(posted[1].url, '/2018-06-01/runtime/invocation/r2/error');
  assert.match(posted[1].body, /boom/);
});

/** A fake state bucket and GitHub for the tools. */
function fakes() {
  const objects = new Map([
    ['state/chat-log.jsonl', '{"role":"owner","text":"a"}\n{"role":"worker","text":"b"}\n'],
    ['state/progress.json', '{"request":"fix"}'],
    ['state/meta.json', '{"timeZone":"Europe/Warsaw"}'],
    ['memory/p/MEMORY.md', '- [A](a.md) — a'],
    ['memory/p/a.md', 'memory a'],
    ['plans/x.md', '# Plan X'],
  ]);
  const s3 = {
    get: async (key) => objects.get(key) ?? null,
    list: async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix)),
    put: async (key, text) => objects.set(key, text),
    delete: async (key) => objects.delete(key),
  };
  const calls = [];
  const github = async (path) => {
    calls.push(path);
    if (path.startsWith('repos/o/r/pulls/')) {
      return {
        number: 5,
        title: 'T',
        state: 'open',
        html_url: 'u',
        head: { ref: 'b', sha: 'abcdef1234' },
        base: { ref: 'main' },
        body: 'desc',
      };
    }
    if (path.includes('/check-runs'))
      return { check_runs: [{ name: 'lint', status: 'completed', conclusion: 'success' }] };
    if (path.startsWith('repos/o/r/pulls?'))
      return [{ number: 5, title: 'T', state: 'open', head: { ref: 'b' }, html_url: 'u' }];
    if (path.startsWith('repos/o/r/contents/'))
      return { encoding: 'base64', content: Buffer.from('hello').toString('base64') };
    return {};
  };
  return { objects, calls, tools: createTools({ s3, github, repo: 'o/r', project: 'p' }) };
}

test('tools: reads from the state bucket', async () => {
  const { tools } = fakes();
  assert.match(await tools.chatLog({ lines: 1 }), /"worker"/);
  assert.doesNotMatch(await tools.chatLog({ lines: 1 }), /"owner"/);
  assert.match(await tools.progress(), /fix/);
  assert.match(await tools.memoryIndex(), /a\.md/);
  assert.equal(await tools.memoryRead({ name: 'a.md' }), 'memory a');
  assert.equal(await tools.memoryRead({ name: '../state/meta.json' }), 'Invalid memory file name.');
  assert.equal(await tools.plansList(), 'x.md');
  assert.equal(await tools.planRead({ name: 'x.md' }), '# Plan X');
});

test('tools: GitHub reads, paths refused outside the repository', async () => {
  const { tools, calls } = fakes();
  assert.match(await tools.pullRequests({}), /#5 T/);
  assert.match(await tools.pullRequest({ number: 5 }), /checks: lint: completed\/success/);
  assert.equal(await tools.readFile({ path: 'src/a.ts' }), 'hello');
  assert.equal(await tools.readFile({ path: '../etc/passwd' }), 'Invalid path.');
  assert.equal(await tools.readFile({ path: '/etc/passwd' }), 'Invalid path.');
  assert.ok(calls.every((path) => path.startsWith('repos/o/r/')));
  assert.equal(safeName('a/b'), null);
  assert.equal(safePath('a/../b'), null);
});

test('tools: scheduled tasks in the owner time zone, listed and cancelled', async () => {
  const { tools, objects } = fakes();
  const added = await tools.scheduleAdd({ when: '2099-12-21 10:00', text: 'Remind me' });
  assert.match(added, /^Scheduled \d{8}T\d{6}-\d+/);
  const key = [...objects.keys()].find((k) => k.startsWith('state/scheduled/'));
  const task = JSON.parse(objects.get(key));
  assert.equal(task.dueAt, '2099-12-21T09:00:00Z');
  assert.equal(task.timeZone, 'Europe/Warsaw');
  assert.match(await tools.scheduleList(), /Remind me/);
  assert.match(await tools.scheduleCancel({ id: task.id }), /Cancelled/);
  assert.equal(await tools.scheduleList(), 'No scheduled tasks.');
  assert.equal(await tools.scheduleCancel({ id: '../meta' }), 'Invalid task id.');
  assert.match(
    await tools.scheduleAdd({ when: '2000-01-01 10:00', text: 'x' }),
    /not in the future/
  );
});

test('scheduled tasks: local time to UTC across daylight saving time', () => {
  assert.equal(
    localToUtc('2026-12-21 10:00', 'Europe/Warsaw').toISOString(),
    '2026-12-21T09:00:00.000Z'
  );
  assert.equal(
    localToUtc('2026-07-01 10:00', 'Europe/Warsaw').toISOString(),
    '2026-07-01T08:00:00.000Z'
  );
  assert.equal(
    localToUtc('2026-07-01 10:00', 'Europe/Kyiv').toISOString(),
    '2026-07-01T07:00:00.000Z'
  );
  assert.equal(localToUtc('nonsense', 'Europe/Warsaw'), null);
  assert.equal(localToUtc('2026-07-01 10:00', 'Mars/Base'), null);
  const { task } = newScheduledTask(
    { when: '2026-12-21 10:00', text: ' x ' },
    { now: new Date('2026-11-16T10:00:00Z'), random: () => 0.5 }
  );
  assert.equal(task.id, '20261116T100000-16384');
  assert.equal(task.text, 'x');
  assert.equal(validTaskId(task.id), task.id);
  assert.equal(validTaskId('x/../y'), null);
  assert.match(newScheduledTask({ when: '2026-12-21 10:00', text: '' }).error, /empty/);
});
