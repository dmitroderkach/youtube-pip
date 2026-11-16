/**
 * `/compact` [instructions] for both parts (docs/DEV_WORKER.md, "Commands and statuses"): the same lane switch as
 * `/model`, `/effort`, `/mode` (settings-commands.mjs), in the fast lane and in the worker. The command asks whose
 * context to compact with a button per part (`⚡ Лямбда` / `🛠 Робочий воркер`); the press runs the host's
 * `compactLane(lane, instructions)`. The instructions stay with the question (a short token in the button, the text
 * in this process), so a press compacts with them; a question whose instructions are gone (another sandbox, a
 * restart) is refused rather than compacting without them.
 *
 * createCompactCommand({ telegram, compactLane, log }):
 *   telegram: { say, sayHtml, editButtons };
 *   compactLane(lane, instructions): lane 'f' (the fast lane) or 'w' (the worker), instructions '' or the text.
 */
import { randomBytes } from 'node:crypto';
import { callbackData, escapeHtml, LANES } from './telegram-format.mjs';

/** Callback data kind of the lane switch: `cmp:<lane>[:<token>]`. */
export const COMPACT_KIND = 'cmp';
/** Questions whose instructions are kept (the oldest are dropped). */
const PENDING_MAX = 20;
const INSTRUCTIONS_SHOWN = 300;
const GONE = 'ℹ️ Це питання вже неактуальне: надішли /compact ще раз';

/** The two buttons of the lane switch. */
export function compactKeyboard(token = null) {
  const button = (lane, label) => ({
    text: `${LANES[lane].emoji} ${label}`,
    callback_data: callbackData(COMPACT_KIND, lane, ...(token ? [token] : [])),
  });
  return { inline_keyboard: [[button('f', 'Лямбда'), button('w', 'Робочий воркер')]] };
}

/** A short random token that stands for kept instructions in a button. */
export const instructionsToken = () => randomBytes(6).toString('hex');

/** Keep `value` under a new token (the oldest dropped past PENDING_MAX); returns the token. */
export function keepPending(map, value) {
  const token = instructionsToken();
  map.set(token, value);
  while (map.size > PENDING_MAX) map.delete(map.keys().next().value);
  return token;
}

export function createCompactCommand({ telegram, compactLane, log = () => {} }) {
  /** token -> instructions of the questions sent by this process. */
  const pending = new Map();

  /** `/compact [instructions]`: the question with the lane switch. */
  async function handleCommand(argument) {
    const instructions = String(argument ?? '').trim();
    const token = instructions ? keepPending(pending, instructions) : null;
    const lines = ['🗜 Чий контекст стиснути?'];
    if (instructions) {
      const shown =
        instructions.length > INSTRUCTIONS_SHOWN
          ? `${instructions.slice(0, INSTRUCTIONS_SHOWN - 1)}…`
          : instructions;
      lines.push(`<i>Що зберегти: ${escapeHtml(shown)}</i>`);
    }
    await telegram.sayHtml(lines.join('\n'), compactKeyboard(token));
  }

  /** A press of the lane switch (callback data parsed); false for any other button. */
  async function handleCallback(messageId, { kind, id, value }) {
    if (kind !== COMPACT_KIND) return false;
    await telegram.editButtons(messageId);
    if (id !== 'f' && id !== 'w') {
      await telegram.say(GONE);
      return true;
    }
    let instructions = '';
    if (value) {
      if (!pending.has(value)) {
        log(`compact: instructions of ${value} are gone`);
        await telegram.say(GONE);
        return true;
      }
      instructions = pending.get(value);
      pending.delete(value);
    }
    await compactLane(id, instructions);
    return true;
  }

  return { handleCommand, handleCallback };
}

/** The one-line result of a compaction: `🗜 Контекст стиснуто: 61% (120k) → 9% (18k)` (worker and fast lane). */
export function compactResultText(result, before, after, prefix = '') {
  const usage = (c) =>
    c ? `${Math.round(c.percentage)}% (${Math.round(c.totalTokens / 1000)}k)` : '?';
  if (result?.subtype !== 'success' || result?.is_error) {
    return `⚠️ ${prefix}/compact не вдався: ${(result?.errors ?? []).join(' ') || result?.result || result?.subtype}`;
  }
  return `🗜 ${prefix}Контекст стиснуто: ${usage(before)} → ${usage(after)}`;
}
