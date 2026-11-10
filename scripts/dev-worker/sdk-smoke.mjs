/**
 * Contract smoke test of the Claude Agent SDK against the surfaces the dev worker relies on (worker.mjs), with the
 * real Claude and the cheapest model: run by the weekly Claude Code update job (.github/workflows/claude-code-update.yml)
 * on a candidate SDK version. Needs CLAUDE_CODE_OAUTH_TOKEN. Prints one line per check and exits 1 when one fails.
 *
 * Checked: system/init with a session id; canUseTool allow (a Write is asked for and runs) and deny (nothing is
 * written, the session goes on);
 * AskUserQuestion answered through updatedInput.answers; setPermissionMode reflected in a `status` message;
 * supportedModels() and setModel(); a background shell task in `background_tasks_changed`; a `rate_limit_event`
 * (soft: the plan may not send one); resume of the session from its transcript with CLAUDE_CODE_TRANSCRIPT_LOCAL_GC;
 * what the worker's /agents uses: a subagent's text streamed with agent_id (forwardSubagentText), getSubagentMessages(),
 * and the end of a foreground subagent with the Agent tool's result.
 */
import { getSubagentMessages, query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = process.env.SMOKE_MODEL || 'haiku';
/** A turn's outcome for the log: its text, or its error subtype and errors. */
const describe = (result) =>
  `${result?.is_error ? `error ${result.subtype ?? ''} ${(result.errors ?? []).join('; ')} ` : ''}${String(result?.result ?? '')}`
    .trim()
    .slice(0, 200);
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
  const seen = {
    init: null,
    statusModes: [],
    backgroundTasks: 0,
    rateLimit: false,
    taskStarts: [],
  };
  let pendingResult = null;
  (async () => {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') seen.init = message;
      if (message.type === 'system' && message.subtype === 'status' && message.permissionMode)
        seen.statusModes.push(message.permissionMode);
      if (message.type === 'system' && message.subtype === 'background_tasks_changed')
        seen.backgroundTasks = Math.max(seen.backgroundTasks, (message.tasks ?? []).length);
      if (message.type === 'rate_limit_event') seen.rateLimit = true;
      if (message.type === 'system' && message.subtype === 'task_started')
        seen.taskStarts.push(message);
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

const decisions = { askedQuestion: false, allowed: false, denied: false };
const canUseTool = async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    decisions.askedQuestion = true;
    const answers = Object.fromEntries((input.questions ?? []).map((q) => [q.question, 'blue']));
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }
  // Write needs a permission in the default mode (a harmless Bash command like `echo` may run without one)
  if (toolName === 'Write' && String(input.file_path ?? '').includes('forbidden-smoke')) {
    decisions.denied = true;
    return { behavior: 'deny', message: 'Denied by the smoke test.' };
  }
  if (toolName === 'Write') decisions.allowed = true;
  return { behavior: 'allow', updatedInput: input };
};

const options = {
  model: MODEL,
  cwd,
  env,
  permissionMode: 'default',
  canUseTool,
  settingSources: [],
  forwardSubagentText: true,
  maxTurns: 8,
};

let sessionId = null;
try {
  const s = session(options);
  const first = await s.send(
    'Use the Write tool to create the file allowed-smoke.txt containing exactly smoke-ok, then reply with: written'
  );
  sessionId = s.seen.init?.session_id ?? first.session_id;
  check('system/init with a session id', s.seen.init?.session_id, s.seen.init?.model);
  check(
    'canUseTool allow: Write asked and ran',
    decisions.allowed && existsSync(join(cwd, 'allowed-smoke.txt')),
    describe(first)
  );

  const denied = await s.send(
    'Use the Write tool to create forbidden-smoke.txt containing x. If it is denied, reply with exactly: denied-ok'
  );
  check(
    'canUseTool deny: not written, the session goes on',
    decisions.denied && !existsSync(join(cwd, 'forbidden-smoke.txt')) && !denied.is_error,
    describe(denied)
  );

  const asked = await s.send(
    'Use the AskUserQuestion tool once: question "Which color?", header "Color", options "red" and "blue". ' +
      'Then reply with the chosen color only.'
  );
  check(
    'AskUserQuestion answered via updatedInput.answers',
    decisions.askedQuestion && /blue/i.test(asked.result ?? ''),
    describe(asked)
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

  // Resume: the first session ends cleanly, a new Claude Code process continues it from its transcript
  s.q.close();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const r = session({ ...options, resume: sessionId });
  const resumed = await r.send(
    'What text did you write into allowed-smoke.txt? Reply with that text only.'
  );
  check('resume from the transcript', /smoke-ok/.test(resumed.result ?? ''), describe(resumed));

  await r.send(
    'Use the Bash tool with run_in_background set to true to run `sleep 20`, then reply with exactly: started'
  );
  check(
    'background task in background_tasks_changed',
    r.seen.backgroundTasks > 0,
    `max ${r.seen.backgroundTasks}`
  );
  check('rate_limit_event', s.seen.rateLimit || r.seen.rateLimit, '', true);

  // /agents of the worker: a subagent's text streams in with agent_id = its task id (forwardSubagentText), its
  // earlier messages come from getSubagentMessages(), and a foreground one ends with the Agent tool's result
  const sub = await r.send(
    'Use the Agent tool once, in the foreground (not in the background), with a general-purpose subagent and the ' +
      'prompt "Reply with exactly: sub-ok". Then reply with exactly what it answered.'
  );
  const started = r.seen.taskStarts.find((t) => t.task_type === 'local_agent' || t.subagent_type);
  check(
    'subagent task_started (task id, tool_use id)',
    started?.task_id && started?.tool_use_id,
    describe(sub)
  );
  const streamed = r.seen.subagentTexts.filter((m) => m.agentId === started?.task_id);
  check(
    'subagent text streamed with agent_id (forwardSubagentText)',
    streamed.some((m) => /sub-ok/.test(m.text)),
    streamed
      .map((m) => m.text)
      .join(' | ')
      .slice(0, 120)
  );
  const history = started
    ? await getSubagentMessages(r.seen.init?.session_id ?? sessionId, started.task_id).catch(
        () => []
      )
    : [];
  check(
    'getSubagentMessages() returns its messages',
    JSON.stringify(history.map((m) => m.message)).includes('sub-ok'),
    `${history.length} message(s)`
  );
  check(
    'foreground subagent ends with the Agent tool result',
    r.seen.toolResults.includes(started?.tool_use_id),
    ''
  );
  await r.q.interrupt().catch(() => {});
  r.q.close();
} catch (error) {
  check('session ran to the end', false, String(error.message ?? error).slice(0, 300));
}

const failed = results.filter((r) => !r.ok && !r.soft);
console.log(failed.length ? `${failed.length} check(s) failed` : 'all checks passed');
process.exit(failed.length ? 1 : 0);
