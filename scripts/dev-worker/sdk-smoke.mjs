/**
 * Contract smoke test of the Claude Agent SDK against the surfaces the dev worker relies on (worker.mjs), with the
 * real Claude and the cheapest model: run by the weekly Claude Code update job (.github/workflows/claude-code-update.yml)
 * on a candidate SDK version. Needs CLAUDE_CODE_OAUTH_TOKEN. Prints one line per check and exits 1 when one fails.
 *
 * Checked: system/init with a session id; canUseTool allow (a Bash command runs) and deny (the session goes on);
 * AskUserQuestion answered through updatedInput.answers; setPermissionMode reflected in a `status` message;
 * supportedModels() and setModel(); a background shell task in `background_tasks_changed`; a `rate_limit_event`
 * (soft: the plan may not send one); resume of the session from its transcript with CLAUDE_CODE_TRANSCRIPT_LOCAL_GC.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = process.env.SMOKE_MODEL || 'haiku';
const TURN_TIMEOUT_MS = 120_000;
const results = [];
const check = (name, ok, detail = '', soft = false) => {
  results.push({ name, ok: Boolean(ok), soft });
  console.log(`${ok ? 'ok  ' : soft ? 'warn' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const cwd = mkdtempSync(join(tmpdir(), 'sdk-smoke-'));
writeFileSync(join(cwd, 'README.md'), 'sdk smoke test\n');
const env = { ...process.env, CLAUDE_CODE_TRANSCRIPT_LOCAL_GC: '1' };
delete env.TELEGRAM_BOT_TOKEN;
delete env.TELEGRAM_CHAT_ID;

/** A streaming session driven turn by turn: send() resolves with the turn's `result` message. */
function session(options) {
  const queue = [];
  let wake = null;
  async function* input() {
    for (;;) {
      while (queue.length) yield queue.shift();
      await new Promise((resolve) => (wake = resolve));
    }
  }
  const q = query({ prompt: input(), options });
  const seen = { init: null, statusModes: [], backgroundTasks: 0, rateLimit: false };
  let pendingResult = null;
  (async () => {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') seen.init = message;
      if (message.type === 'system' && message.subtype === 'status' && message.permissionMode)
        seen.statusModes.push(message.permissionMode);
      if (message.type === 'system' && message.subtype === 'background_tasks_changed')
        seen.backgroundTasks = Math.max(seen.backgroundTasks, (message.tasks ?? []).length);
      if (message.type === 'rate_limit_event') seen.rateLimit = true;
      if (message.type === 'result') pendingResult?.(message);
    }
  })().catch((error) => pendingResult?.({ is_error: true, result: String(error) }));
  const send = (text) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`turn timed out: ${text}`)), TURN_TIMEOUT_MS);
      pendingResult = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      queue.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      });
      wake?.();
    });
  return { q, seen, send };
}

const decisions = { askedQuestion: false, denied: false };
const canUseTool = async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    decisions.askedQuestion = true;
    const answers = Object.fromEntries((input.questions ?? []).map((q) => [q.question, 'blue']));
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }
  if (toolName === 'Bash' && String(input.command ?? '').includes('forbidden-smoke')) {
    decisions.denied = true;
    return { behavior: 'deny', message: 'Denied by the smoke test.' };
  }
  return { behavior: 'allow', updatedInput: input };
};

const options = {
  model: MODEL,
  cwd,
  env,
  permissionMode: 'default',
  canUseTool,
  settingSources: [],
  maxTurns: 8,
};

let sessionId = null;
try {
  const s = session(options);
  const first = await s.send(
    'Use the Bash tool to run exactly `echo smoke-ok` and reply with its output only.'
  );
  sessionId = s.seen.init?.session_id ?? first.session_id;
  check('system/init with a session id', s.seen.init?.session_id, s.seen.init?.model);
  check(
    'canUseTool allow: Bash ran',
    /smoke-ok/.test(first.result ?? ''),
    String(first.result).slice(0, 80)
  );

  const denied = await s.send(
    'Use the Bash tool to run `echo forbidden-smoke`. If it is denied, reply with exactly: denied-ok'
  );
  check(
    'canUseTool deny: the session goes on',
    decisions.denied && !denied.is_error,
    String(denied.result).slice(0, 80)
  );

  const asked = await s.send(
    'Use the AskUserQuestion tool once: question "Which color?", header "Color", options "red" and "blue". ' +
      'Then reply with the chosen color only.'
  );
  check(
    'AskUserQuestion answered via updatedInput.answers',
    decisions.askedQuestion && /blue/i.test(asked.result ?? ''),
    String(asked.result).slice(0, 80)
  );

  await s.q.setPermissionMode('plan');
  await s.q.setPermissionMode('default');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  check(
    'setPermissionMode reflected in status messages',
    s.seen.statusModes.includes('plan'),
    s.seen.statusModes.join(','),
    true
  );

  const models = await s.q.supportedModels();
  check(
    'supportedModels()',
    Array.isArray(models) && models.length > 0,
    models.map((m) => m.value).join(',')
  );
  await s.q.setModel(MODEL);
  check('setModel()', true);

  await s.send(
    'Use the Bash tool with run_in_background set to true to run `sleep 20`, then reply with exactly: started'
  );
  check(
    'background task in background_tasks_changed',
    s.seen.backgroundTasks > 0,
    `max ${s.seen.backgroundTasks}`
  );
  check('rate_limit_event', s.seen.rateLimit, '', true);
  await s.q.interrupt().catch(() => {});
  s.q.close();

  const r = session({ ...options, resume: sessionId });
  const resumed = await r.send('What did the first command print? Reply with that word only.');
  check(
    'resume from the transcript',
    /smoke-ok/.test(resumed.result ?? ''),
    String(resumed.result).slice(0, 80)
  );
  r.q.close();
} catch (error) {
  check('session ran to the end', false, String(error.message ?? error).slice(0, 300));
}

const failed = results.filter((r) => !r.ok && !r.soft);
console.log(failed.length ? `${failed.length} check(s) failed` : 'all checks passed');
process.exit(failed.length ? 1 : 0);
