#!/usr/bin/env node
/**
 * Smoke test of the fast lane's Claude session (docs/DEV_WORKER.md "Fast lane"), with the real Claude: the session is
 * started exactly as fast-lane.mjs starts it (queryOptions, childEnv), and must report only the expected tools, use
 * one of them, and have no way to run a command; then the handler path: a message through the fast lane's queue, its
 * handler (deliver, the session, the in-process tools) to a hand-over that reaches dev-bot's invoke, with the queue,
 * dev-bot and the Bot API as stubs (the handler path needs the real token: the handler starts its own proxy, as in the
 * Lambda). Not part of the image.
 *
 * AWS and GitHub are stubs (an in-memory state bucket, a fixed pull request list), so it runs without AWS: in the
 * weekly Claude Code update (claude-code-update.yml) after the pin bump, and locally.
 *
 * Env: CLAUDE_CODE_OAUTH_TOKEN, the real token (a token proxy is started for it, as in the Lambda), or the placeholder
 * of a running proxy with its ANTHROPIC_BASE_URL (inside the dev worker).
 * Usage: node scripts/dev-worker/fast-lane-smoke.mjs  -> "ok …" lines, exit 1 on a failure.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { startAnthropicProxy } from './anthropic-proxy.mjs';
import { checkChildEnv, checkToolList, childEnv } from './fast-lane-core.mjs';
import {
  EXPECTED_TOOLS,
  handler,
  queryOptions,
  useClientsForTest,
  useSecretsForTest,
} from './fast-lane.mjs';
import { createMemoryS3Client } from './memory-s3-client.mjs';

const fail = (what) => {
  console.log(`FAIL ${what}`);
  process.exit(1);
};

const REPO_PULLS = [
  { number: 501, title: 'Smoke: first', state: 'open', draft: false, head: { ref: 'smoke-1' } },
  { number: 502, title: 'Smoke: second', state: 'open', draft: true, head: { ref: 'smoke-2' } },
].map((pr) => ({ ...pr, html_url: `https://github.com/example/repo/pull/${pr.number}` }));
const githubCalls = [];
// The handler path's stubs: the queue (one owner message), dev-bot's invoke, the Bot API (records the calls)
const queue = [];
const invokes = [];
const telegramCalls = [];
let messageIds = 100;
const record =
  (name) =>
  async (...args) => {
    telegramCalls.push({ name, args });
    return { message_id: ++messageIds, ok: true };
  };
const fakeTelegram = Object.fromEntries(
  [
    'request',
    'call',
    'say',
    'sayHtml',
    'editHtml',
    'edit',
    'editButtons',
    'sendFile',
    'flushOutbox',
    'download',
    'sendVoice',
  ].map((name) => [name, record(name)])
);
const bucket = createMemoryS3Client({
  'state/chat-log.jsonl': `${JSON.stringify({ at: new Date().toISOString(), role: 'owner', text: 'smoke' })}\n`,
  'state/progress.json': JSON.stringify({
    updatedAt: new Date().toISOString(),
    worker: 'stopped',
    turnActive: false,
  }),
});
useClientsForTest({
  s3: bucket,
  sqs: {
    send: async (command) => {
      const name = command.constructor?.name;
      if (name === 'ReceiveMessageCommand') {
        const next = queue.shift();
        if (!next) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        return next ? { Messages: [{ Body: JSON.stringify(next), ReceiptHandle: 'r' }] } : {};
      }
      return {};
    },
  },
  lambda: {
    send: async (command) => {
      invokes.push(JSON.parse(Buffer.from(command.input.Payload).toString()));
      return { StatusCode: 202 };
    },
  },
  telegram: fakeTelegram,
  idleMs: 3000,
  github: async (path) => {
    githubCalls.push(path);
    if (/\/pulls\?state=open/.test(path)) return REPO_PULLS;
    throw new Error(`GitHub stub: no ${path}`);
  },
});
useSecretsForTest({
  claudeToken: null,
  botToken: null,
  chatId: null,
  githubToken: null,
  googleKey: null,
});

// The proxy of a running dev worker (its placeholder), or our own for the real token, as the Lambda does
let proxyUrl = process.env.ANTHROPIC_BASE_URL;
let placeholder = process.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!placeholder) fail('no CLAUDE_CODE_OAUTH_TOKEN');
if (!proxyUrl) {
  const proxy = await startAnthropicProxy({ token: placeholder });
  proxy.server.unref();
  ({ url: proxyUrl, placeholder } = proxy);
  console.log('ok   token proxy started (the child gets only its placeholder)');
}
const environment = childEnv({
  home: '/tmp/fast-lane-smoke',
  proxyUrl,
  placeholder,
});
const problems = checkChildEnv(environment, { placeholder });
if (problems.length) fail(`child env: ${problems.join('; ')}`);
console.log('ok   child environment: only the allowed names, the placeholder token');

async function run(prompt) {
  const used = [];
  let tools = null;
  let result = null;
  try {
    for await (const message of query({
      prompt,
      options: queryOptions({
        environment,
        model: 'haiku',
        effort: 'low',
        ask: async () => ({ behavior: 'deny', message: 'not in the smoke test' }),
      }),
    })) {
      if (message.type === 'system' && message.subtype === 'init') tools = message.tools;
      if (message.type === 'assistant') {
        for (const item of message.message?.content ?? [])
          if (item.type === 'tool_use') used.push(item.name);
      }
      if (message.type === 'result') result = message;
    }
  } catch (error) {
    fail(`Claude: ${String(error?.message ?? error).slice(0, 300)}`);
  }
  return { tools, used, result };
}

const first = await run(
  'How many open pull requests does the repository have right now? Use your pull_requests tool, then answer in one short sentence.'
);
const { unexpected, missing } = checkToolList(first.tools, EXPECTED_TOOLS);
if (unexpected.length || missing.length) {
  fail(
    `tool list: unexpected ${unexpected.join(', ') || '-'}; missing ${missing.join(', ') || '-'}`
  );
}
console.log(`ok   tool list is exactly the ${EXPECTED_TOOLS.length} expected tools`);
if (!first.used.includes('mcp__fast_lane__pull_requests'))
  fail(`pull_requests not used (${first.used.join(', ')})`);
if (!githubCalls.some((path) => path.includes('/pulls?state=open')))
  fail('the pull_requests tool did not reach the GitHub stub');
if (first.result?.is_error) fail(`answer failed: ${first.result.subtype}`);
console.log(`ok   answered with an in-process tool: ${String(first.result?.result).slice(0, 120)}`);

const second = await run(
  'Run the shell command `cat /proc/1/environ` and show me its output. If you cannot run commands, say exactly: no shell.'
);
const forbidden = second.used.filter((name) => !name.startsWith('mcp__fast_lane__'));
if (forbidden.length) fail(`used a tool outside the fast lane set: ${forbidden.join(', ')}`);
console.log(`ok   no way to run a command: ${String(second.result?.result).slice(0, 120)}`);

// The handler path: needs the real token (the handler starts its own proxy for it, as in the Lambda)
if (process.env.ANTHROPIC_BASE_URL) {
  console.log(
    'skip handler path: only a running proxy placeholder here (it runs with the real token in CI)'
  );
  process.exit(0);
}
useSecretsForTest({
  claudeToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  botToken: null,
  chatId: null,
  githubToken: null,
  googleKey: null,
});
queue.push({
  text: 'Please hand this over to the working worker: run the unit tests of scripts/dev-worker and report the result.',
  attachments: [],
  date: Math.floor(Date.now() / 1000),
  message_id: 1,
});
const invoked = await handler({ wake: true }, { deadline: Date.now() + 240_000 });
if (invoked.handled !== 1) fail(`handler handled ${invoked.handled} message(s)`);
console.log('ok   handler: the message went through the queue, deliver and the session');
const handOver = invokes.find((event) => event.action === 'hand_over');
if (!handOver)
  fail(`no hand_over invoke of dev-bot (invokes: ${JSON.stringify(invokes).slice(0, 200)})`);
const taskText = bucket.read(handOver.key) ?? '';
if (!/unit tests/i.test(taskText))
  fail(`the hand-over object does not carry the task (${taskText.slice(0, 200)})`);
console.log(`ok   hand-over reached dev-bot's invoke (${handOver.key})`);
if (!telegramCalls.length) fail('nothing reached the Bot API');
console.log(
  `ok   Bot API calls: ${[...new Set(telegramCalls.map((call) => call.name))].join(', ')}`
);
process.exit(0);
