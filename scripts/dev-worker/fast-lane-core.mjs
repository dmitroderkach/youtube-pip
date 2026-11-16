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
