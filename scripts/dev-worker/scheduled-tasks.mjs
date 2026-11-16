/**
 * Scheduled tasks of the owner (docs/DEV_WORKER.md, "Scheduled tasks"), shared by the worker's `schedule` command
 * (schedule-cli.mjs) and the fast lane's tools: one record per task in the state bucket, `state/scheduled/<id>.json`
 * = { id, dueAt (UTC ISO), timeZone, text, createdAt }. The dev-bot Lambda checks them every minute and sends a due
 * task as the owner's message.
 */

export const SCHEDULED_PREFIX = 'state/scheduled/';
export const DEFAULT_TIME_ZONE = 'Europe/Warsaw';

/** Offset of `zone` from UTC (minutes, east positive) at the instant `date`. */
function zoneOffsetMinutes(zone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * The UTC instant of a local wall-clock time "YYYY-MM-DD HH:MM" in `zone` (daylight saving time included), or null
 * for a malformed time or zone.
 */
export function localToUtc(when, zone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(when ?? '').trim());
  if (!match) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    return null;
  }
  const [, y, mo, d, h, mi] = match.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes: the offset at the guessed instant can differ around a DST switch
  let utc = naive - zoneOffsetMinutes(zone, new Date(naive)) * 60000;
  utc = naive - zoneOffsetMinutes(zone, new Date(utc)) * 60000;
  return new Date(utc);
}

/**
 * A new task record, or { error } (malformed time / zone, not in the future, empty text). `random` and `now` are
 * injectable for tests.
 */
export function newScheduledTask(
  { when, text, zone },
  { now = new Date(), random = Math.random } = {}
) {
  const timeZone = zone || DEFAULT_TIME_ZONE;
  const body = String(text ?? '').trim();
  if (!body) return { error: 'empty task text' };
  const due = localToUtc(when, timeZone);
  if (!due)
    return {
      error: `invalid time "${when}" or time zone "${timeZone}" (expected YYYY-MM-DD HH:MM)`,
    };
  if (due.getTime() <= now.getTime())
    return { error: `${when} (${timeZone}) is not in the future` };
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  const id = `${stamp}-${Math.floor(random() * 32768)}`;
  return {
    task: {
      id,
      dueAt: due.toISOString().replace(/\.\d+Z$/, 'Z'),
      timeZone,
      text: body,
      createdAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    },
  };
}

/** A task id from the model or a command line: the shape newScheduledTask makes, nothing else. */
export function validTaskId(id) {
  return /^\d{8}T\d{6}-\d{1,5}$/.test(String(id ?? '')) ? String(id) : null;
}

/** One line per task for the chat / the CLI: id, due time in UTC and local, text. */
export function describeTask(task) {
  const local = new Date(task.dueAt).toLocaleString('uk-UA', { timeZone: task.timeZone });
  return `${task.id}\t${task.dueAt}\t${local} ${task.timeZone}\t${String(task.text).replace(/\n/g, ' ').slice(0, 200)}`;
}
