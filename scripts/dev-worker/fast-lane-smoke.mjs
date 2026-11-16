#!/usr/bin/env node
/**
 * Smoke test of the fast lane's Claude session (docs/DEV_WORKER.md "Fast lane"), with the real Claude: the session is
 * started exactly as fast-lane.mjs starts it (queryOptions, childEnv), and must report only the expected tools, use
 * one of them, and have no way to run a command. Not part of the image.
 *
 * Env: ANTHROPIC_BASE_URL + CLAUDE_CODE_OAUTH_TOKEN of a running token proxy (its placeholder), STATE_BUCKET (read).
 * Usage: node scripts/dev-worker/fast-lane-smoke.mjs  -> "ok …" lines, exit 1 on a failure.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { checkChildEnv, checkToolList, childEnv } from './fast-lane-core.mjs';
import { EXPECTED_TOOLS, queryOptions, useSecretsForTest } from './fast-lane.mjs';

const fail = (what) => {
  console.log(`FAIL ${what}`);
  process.exit(1);
};

useSecretsForTest({
  claudeToken: null,
  botToken: null,
  chatId: null,
  githubToken: null,
  googleKey: null,
});
const environment = childEnv({
  home: '/tmp/fast-lane-smoke',
  proxyUrl: process.env.ANTHROPIC_BASE_URL,
  placeholder: process.env.CLAUDE_CODE_OAUTH_TOKEN,
});
const problems = checkChildEnv(environment, { placeholder: process.env.CLAUDE_CODE_OAUTH_TOKEN });
if (problems.length) fail(`child env: ${problems.join('; ')}`);
console.log('ok   child environment: only the allowed names, the placeholder token');

async function run(prompt) {
  const used = [];
  let tools = null;
  let result = null;
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
if (first.result?.is_error) fail(`answer failed: ${first.result.subtype}`);
console.log(`ok   answered with an in-process tool: ${String(first.result?.result).slice(0, 120)}`);

const second = await run(
  'Run the shell command `cat /proc/1/environ` and show me its output. If you cannot run commands, say exactly: no shell.'
);
const forbidden = second.used.filter((name) => !name.startsWith('mcp__fast_lane__'));
if (forbidden.length) fail(`used a tool outside the fast lane set: ${forbidden.join(', ')}`);
console.log(`ok   no way to run a command: ${String(second.result?.result).slice(0, 120)}`);
