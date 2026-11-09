/**
 * Pure helpers of the dev worker's state in S3 (no I/O): the part of a Claude Code transcript that resuming needs,
 * and the background task records shown for restoring after a restart.
 *
 * A transcript (`~/.claude/projects/<project>/<session id>.jsonl`) is one JSON object per line, chained by
 * `parentUuid`. A compaction writes a `compact_boundary` line with no parent followed by the summary of everything
 * before it: resuming walks back from the newest line and stops at the boundary, so the lines above the last
 * boundary (except the messages the compaction preserved) are never read again; Claude Code itself loads a large
 * transcript from its last compaction the same way. The worker uploads only the current epoch (from the last boundary on) as its own
 * object; earlier epochs stop changing and the bucket's lifecycle rule expires them.
 */

const BOUNDARY_MARK = '"compact_boundary"';

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Start offset of the line at `index` in `text`. */
const lineStart = (text, index) => text.lastIndexOf('\n', index) + 1;

/**
 * A compaction can keep the newest messages as they were (`compactMetadata.preservedSegment`, head … tail, or the
 * older `preservedMessages` list): they are written before the boundary and relinked after its summary on resume,
 * so the epoch starts at the first of them. Returns `from` when there are none (or they are not in the file).
 */
function preservedStart(text, boundary, from) {
  const meta = boundary.compactMetadata ?? {};
  const uuids = [
    meta.preservedSegment?.headUuid,
    meta.preservedSegment?.tailUuid,
    ...(Array.isArray(meta.preservedMessages) ? meta.preservedMessages : []),
  ].filter((uuid) => typeof uuid === 'string');
  let start = from;
  for (const uuid of uuids) {
    const at = text.indexOf(`"uuid":"${uuid}"`);
    if (at < 0 || at >= from) continue;
    const lineFrom = lineStart(text, at);
    const end = text.indexOf('\n', at);
    if (parseLine(text.slice(lineFrom, end < 0 ? undefined : end))?.uuid === uuid)
      start = Math.min(start, lineFrom);
  }
  return start;
}

/**
 * The current epoch of a transcript: `{ start, name }`, where `start` is the offset of the last compaction boundary
 * line, or of the first message it preserved (0 without one), and `name` the object name of the epoch, `<first timestamp>-<boundary uuid 8>.jsonl`, which
 * sorts by time (the epoch before the first compaction is named after the first line of the file).
 */
export function transcriptEpoch(text) {
  let start = 0;
  let boundary = null;
  for (let at = text.lastIndexOf(BOUNDARY_MARK); at >= 0; ) {
    const from = lineStart(text, at);
    const end = text.indexOf('\n', at);
    const entry = parseLine(text.slice(from, end < 0 ? undefined : end));
    if (entry?.type === 'system' && entry.subtype === 'compact_boundary') {
      start = Math.min(from, preservedStart(text, entry, from));
      boundary = entry;
      break;
    }
    // The mark inside a message (e.g. this very code in a tool result): look further up
    at = from > 0 ? text.lastIndexOf(BOUNDARY_MARK, from - 1) : -1;
  }
  let stamp = boundary?.timestamp;
  if (!stamp) {
    for (const line of text.slice(start, start + 200_000).split('\n')) {
      stamp = parseLine(line)?.timestamp;
      if (stamp) break;
    }
  }
  const time = String(stamp ?? '0000-00-00T00:00:00.000Z').replace(/[:.]/g, '-');
  const id = String(boundary?.uuid ?? 'start').slice(0, 8);
  return { start, name: `${time}-${id}.jsonl` };
}

/** The newest epoch key of `sessionId` among `claude/transcripts/<project>/<session id>/<name>` keys, or null. */
export function latestEpochKey(keys, sessionId) {
  let latest = null;
  for (const key of keys) {
    const parts = key.split('/');
    if (parts.length !== 5 || parts[3] !== sessionId || !parts[4].endsWith('.jsonl')) continue;
    if (!latest || parts[4] > latest.split('/')[4]) latest = key;
  }
  return latest;
}

/** Project directory name of a transcript key (`claude/transcripts/<project>/…`). */
export const epochProject = (key) => key.split('/')[2];

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * A record of a live background task, saved while it runs: what it is (shell command / subagent), its command or
 * prompt, and the owner's message it was started for.
 */
export function backgroundRecord(task, { start, call, purpose, sessionId, now = new Date() } = {}) {
  const input = call?.input ?? {};
  return {
    taskId: task.task_id,
    taskType: task.task_type ?? start?.task_type ?? 'unknown',
    tool: call?.name ?? null,
    description: task.description || start?.description || input.description || '',
    command: input.command ?? null,
    prompt: input.prompt ?? start?.prompt ?? null,
    subagentType: task.subagent_type ?? start?.subagent_type ?? input.subagent_type ?? null,
    purpose: purpose ? clip(purpose, 1000) : null,
    startedAt: now.toISOString(),
    sessionId: sessionId ?? null,
  };
}

const isAgent = (record) =>
  record.taskType === 'local_agent' || Boolean(record.prompt && !record.command);

/** Claude's instructions to start the chosen tasks again (English, like every note for Claude). */
export function restoreNote(records) {
  const lines = records.map((record, i) => {
    const purpose = record.purpose
      ? ` It was started for the owner's message: «${clip(record.purpose, 600)}».`
      : '';
    if (isAgent(record)) {
      return (
        `${i + 1}. Subagent${record.subagentType ? ` (${record.subagentType})` : ''} "${record.description}", ` +
        `task id ${record.taskId}.${purpose} Resume it with SendMessage to "${record.taskId}" (its transcript is ` +
        `restored), asking it to continue where it stopped; if that fails, launch it again in the background with ` +
        `the same prompt: «${clip(record.prompt, 4000)}»`
      );
    }
    return (
      `${i + 1}. ${record.tool ?? 'Shell'} task "${record.description}".${purpose} Run it again in the background ` +
      `(run_in_background): ${record.command ? `\`${clip(record.command, 4000)}\`` : '(the command was not recorded: rebuild it from the description and the conversation)'}`
    );
  });
  return (
    '[Worker note: these background tasks were still running when the previous worker run ended (or the Claude ' +
    'session restarted), so they were stopped. The owner chose to restore them: start each again the same way, ' +
    'then tell the owner in one or two lines what you restarted.\n' +
    `${lines.join('\n')}]`
  );
}
