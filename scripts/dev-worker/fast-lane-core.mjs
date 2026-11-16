/**
 * Pure pieces of the fast lane (fast-lane.mjs, docs/DEV_WORKER.md "Fast lane"), kept apart so they are tested without
 * AWS, Telegram or Claude: the Lambda Runtime API loop, the isolation self-check, the child environment, the
 * hand-over message and the callback prefix of the fast lane's buttons.
 */

/** callback_data of the fast lane's buttons starts with this; dev-bot routes such presses to the fast lane. */
export const CALLBACK_PREFIX = 'f|';
/** Telegram's limit for callback_data (bytes). */
const CALLBACK_DATA_MAX = 64;

/** A reply_markup with every callback_data prefixed (buttons the fast lane sends); unchanged when there is none. */
export function prefixCallbacks(replyMarkup) {
  if (!replyMarkup?.inline_keyboard) return replyMarkup;
  return {
    ...replyMarkup,
    inline_keyboard: replyMarkup.inline_keyboard.map((row) =>
      row.map((button) => {
        if (typeof button.callback_data !== 'string') return button;
        const data = `${CALLBACK_PREFIX}${button.callback_data}`;
        if (Buffer.byteLength(data) > CALLBACK_DATA_MAX) {
          throw new Error(`callback data too long with the fast lane prefix: ${data}`);
        }
        return { ...button, callback_data: data };
      })
    ),
  };
}

/** The callback_data without the fast lane prefix (null when it is not the fast lane's). */
export function stripCallbackPrefix(data) {
  const value = String(data ?? '');
  return value.startsWith(CALLBACK_PREFIX) ? value.slice(CALLBACK_PREFIX.length) : null;
}

/** The only environment variables Claude Code gets in the fast lane (everything else is never passed). */
export const CHILD_ENV_NAMES = [
  'PATH',
  'HOME',
  'CLAUDE_CONFIG_DIR',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CODE_TRANSCRIPT_LOCAL_GC',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

/** The environment of the Claude Code process, built from scratch: the proxy's URL and placeholder, nothing else. */
export function childEnv({ home, proxyUrl, placeholder, path = '/usr/local/bin:/usr/bin:/bin' }) {
  return {
    PATH: path,
    HOME: home,
    CLAUDE_CONFIG_DIR: `${home}/.claude`,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_TRANSCRIPT_LOCAL_GC: '1',
    // No telemetry, error reporting or update checks: nothing but the API (through the proxy) on the session start,
    // which took 28-101 s in the Lambda against ~1 s on the worker (2026-11-16)
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ANTHROPIC_BASE_URL: proxyUrl,
    CLAUDE_CODE_OAUTH_TOKEN: placeholder,
  };
}

/**
 * The isolation self-check before Claude starts (fail closed): the child environment has only the allowed names, its
 * token is the proxy's placeholder, and no secret value appears in it. Returns a list of problems (empty = ok).
 */
export function checkChildEnv(environment, { placeholder, secrets = [] }) {
  const problems = [];
  for (const name of Object.keys(environment)) {
    if (!CHILD_ENV_NAMES.includes(name)) problems.push(`unexpected variable ${name}`);
  }
  if (environment.CLAUDE_CODE_OAUTH_TOKEN !== placeholder) {
    problems.push('the Claude token is not the proxy placeholder');
  }
  const values = Object.values(environment).join('\n');
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && values.includes(secret))
      problems.push('a secret value in the environment');
  }
  return problems;
}

/**
 * The tool list Claude Code reports at start (system init) must be exactly the expected one: the in-process tools of
 * the fast lane and AskUserQuestion. Returns the unexpected and the missing names.
 */
export function checkToolList(tools, expected) {
  const got = new Set(tools ?? []);
  const want = new Set(expected);
  return {
    unexpected: [...got].filter((name) => !want.has(name)),
    missing: [...want].filter((name) => !got.has(name)),
  };
}

/**
 * The worker queue message of a hand-over: the same shape dev-bot puts there for an owner's message, with
 * `handover: true` and `date` = now (the worker skips messages older than its start; dev-bot starts it with
 * UP_AT = min(now, since)).
 */
export function handOverMessage({ task, context, now = new Date() }) {
  const date = Math.floor(now.getTime() / 1000);
  const parts = [
    '[Handed over by the fast lane (the owner talked to it while the worker slept or was busy). The task below is ' +
      "the owner's request as the fast lane understood it; the conversation is in state/chat-log.jsonl.]",
    `Task: ${String(task ?? '').trim()}`,
  ];
  if (context && String(context).trim()) parts.push(`Context: ${String(context).trim()}`);
  return {
    body: { text: parts.join('\n\n'), attachments: [], date, message_id: null, handover: true },
    date,
  };
}

/** A short title of a task for dev-bot's "піднімаю робочий воркер… (<reason>)" line. */
export function taskTitle(task, max = 60) {
  const line = String(task ?? '')
    .trim()
    .split('\n')[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The Lambda Runtime API loop (no runtime library): GET the next invocation, run `handler(event, context)`, POST its
 * result or error. `fetchImpl` and `once` are for tests.
 */
export async function runtimeLoop(
  handler,
  { api, fetchImpl = fetch, log = () => {}, once = false } = {}
) {
  const base = `http://${api}/2018-06-01/runtime/invocation`;
  do {
    const next = await fetchImpl(`${base}/next`);
    const requestId = next.headers.get('lambda-runtime-aws-request-id');
    const deadline = Number(next.headers.get('lambda-runtime-deadline-ms')) || Date.now() + 900_000;
    let event = {};
    try {
      event = await next.json();
    } catch {
      event = {};
    }
    try {
      const result = await handler(event, { requestId, deadline });
      await fetchImpl(`${base}/${requestId}/response`, {
        method: 'POST',
        body: JSON.stringify(result ?? null),
      });
    } catch (error) {
      log('invocation failed', error);
      await fetchImpl(`${base}/${requestId}/error`, {
        method: 'POST',
        headers: { 'Lambda-Runtime-Function-Error-Type': 'Unhandled' },
        body: JSON.stringify({
          errorMessage: String(error?.message ?? error).slice(0, 1000),
          errorType: error?.name ?? 'Error',
        }),
      });
    }
  } while (!once);
}

/** True when a saved session transcript is too big to resume (a fresh session then; the chat log keeps continuity). */
export const tooBigToResume = (bytes, max = 2 * 1024 * 1024) => Number(bytes) > max;

/**
 * The busy marker (fast-lane/busy.json, docs/DEV_WORKER.md "Fast lane"): while the fast lane handles the owner's
 * messages, dev-bot sends later ones here too, so a message it hands over reaches the worker before the owner's next
 * one. dev-bot counts the marker only while its updatedAt is fresh (120 s), so it is refreshed every BUSY_REFRESH_MS.
 */
export const BUSY_KEY = 'fast-lane/busy.json';
export const BUSY_REFRESH_MS = 30_000;

/** What to do with the marker: 'put' (mark or refresh), 'delete' (clear) or null (nothing). */
export function busyMarkerAction({
  busy,
  markedAt,
  now = Date.now(),
  refreshMs = BUSY_REFRESH_MS,
}) {
  if (busy) return markedAt === null || now - markedAt >= refreshMs ? 'put' : null;
  return markedAt === null ? null : 'delete';
}

/**
 * Claude Code processes left in this sandbox by earlier invocations (Lambda freezes a sandbox with whatever still
 * runs and thaws it with the next invocation, where those processes compete for the CPU: Claude Code's start took
 * 2-101 s in warm sandboxes against 0.5 s in the worker). `proc`: { list() -> names in /proc, cmdline(pid) -> the
 * NUL-separated command line or null }. Never our own process or its parent.
 */
export function leftoverClaudePids(proc, { self = process.pid, parent = process.ppid } = {}) {
  const pids = [];
  for (const name of proc.list()) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === self || pid === parent) continue;
    const argv = String(proc.cmdline(pid) ?? '')
      .split('\0')
      .filter(Boolean);
    if (!argv.length) continue;
    const program = argv[0].split('/').pop();
    if (program === 'claude' || argv.slice(0, 2).some((arg) => arg.includes('claude-agent-sdk')))
      pids.push(pid);
  }
  return pids;
}

/**
 * The taint gate (plan "Web search and web pages in the fast lane"): once a turn took in untrusted text (a web page
 * summary, log text), the action tools of that turn (hand_over, stop_worker, schedule_add) run only after the owner's
 * button, so a page or a log line cannot start work, stop the worker or plant a scheduled task. Enforced here, in the
 * handler, not by the prompt. `confirm(description)` -> true only when the owner said yes. `newTurn()` at the start of
 * each owner turn.
 */
export function createTaintGate({ confirm }) {
  let sources = [];
  return {
    newTurn() {
      sources = [];
    },
    taint(source) {
      if (!sources.includes(source)) sources.push(source);
    },
    tainted: () => sources.length > 0,
    sources: () => [...sources],
    /** Runs `run()` directly when the turn is clean; otherwise only after the owner's yes. */
    async guard(description, run) {
      if (!sources.length) return run();
      const yes = await confirm(description, [...sources]);
      if (!yes)
        return 'Not done: this turn read untrusted text (web / logs), and the owner did not confirm the action. Tell the owner.';
      return run();
    },
  };
}

/**
 * One answer per message: when the fast lane handed every owner message of a turn over to the worker (or stopped
 * the worker's turn for it), the worker answers, so the fast lane's own "handed over" text is not sent. It is sent
 * when a hand-over failed (the owner must know) or when the taint gate asked the owner first (the owner pressed a
 * button and expects the outcome). `turn`: { messages, handedOver, failed, gateAsked }.
 */
export function shouldSuppressAnswer({
  messages = 0,
  handedOver = 0,
  failed = false,
  gateAsked = false,
} = {}) {
  return messages > 0 && handedOver >= messages && !failed && !gateAsked;
}
