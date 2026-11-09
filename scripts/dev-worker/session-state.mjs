/**
 * Pure helpers of the dev worker's state in S3 (no I/O): the part of a Claude Code transcript that resuming needs,
 * and the background task records shown for restoring after a restart.
 *
 * A transcript (`~/.claude/projects/<project>/<session id>.jsonl`) is one JSON object per line. A compaction writes a
 * `compact_boundary` line followed by the summary of everything before it, so the conversation above the last
 * boundary is never sent to the model again. The worker uploads only the current epoch (the last boundary on, plus
 * what Claude Code still needs from above it) as its own object; earlier epochs stop changing and the bucket's
 * lifecycle rule expires them.
 *
 * `transcriptEpoch` is a port of Claude Code 2.1.319's own transcript compaction (the plan it builds before
 * rewriting a transcript file after a compaction; the version bundled with the worker's Agent SDK): which rows of
 * each type survive, the preserved messages and the rows tied to them, the parents of rows after the boundary, and
 * the order the kept metadata rows are written in. Update it with the SDK.
 */

/** Claude Code's row types: how a compaction treats a row above the last boundary (unknown types: accumulate). */
const ROW_KINDS = {
  user: 'transcript',
  assistant: 'transcript',
  system: 'transcript',
  attachment: 'transcript',
  progress: 'boundary-cleared',
  'file-history-snapshot': 'boundary-cleared',
  'file-history-delta': 'boundary-cleared',
  'last-prompt': 'boundary-cleared',
  'continued-in': 'boundary-cleared',
  'resume-head-vouch': 'boundary-cleared',
  'content-replacement': 'accumulate',
  'api-request-shape': 'boundary-cleared',
  'api-request-blob': 'boundary-cleared',
  'api-request': 'boundary-cleared',
  'fork-context-ref': 'accumulate',
  'frame-link': 'accumulate',
  summary: 'last-wins',
  'custom-title': 'last-wins',
  'ended-by-model': 'last-wins',
  'ai-title': 'last-wins',
  tag: 'last-wins',
  relocated: 'last-wins',
  'agent-name': 'last-wins',
  'agent-color': 'last-wins',
  'agent-setting': 'last-wins',
  'pr-link': 'last-wins',
  'artifact-comment-monitor': 'accumulate',
  'artifact-autoreact-ledger': 'last-wins',
  'bridge-session': 'last-wins',
  'history-suppression': 'last-wins',
  'attribution-snapshot': 'last-wins',
  mode: 'last-wins',
  'permission-mode': 'last-wins',
  'isolation-latch': 'last-wins',
  'session-owner': 'last-wins',
  'dev-mods': 'last-wins',
  'memory-mode': 'accumulate',
  'atis-latch': 'last-wins',
  'tools-used': 'last-wins',
  'worktree-state': 'last-wins',
  'cost-state': 'last-wins',
  'queue-operation': 'last-wins',
  'observer-ref': 'last-wins',
};

/** Last-wins types whose older rows are dropped even below the boundary. */
const SUPERSEDED_TYPES = new Set(['attribution-snapshot', 'artifact-autoreact-ledger']);
const LEDGER = 'artifact-autoreact-ledger';

const rowKind = (type) => (type === 'repl-mode' ? 'last-wins' : (ROW_KINDS[type] ?? 'accumulate'));

/** A line without its leading NUL bytes (left by a torn write). */
const withoutNul = (line) => line.replace(/^\0+/, '');

function parseRow(line) {
  if (!line) return undefined;
  try {
    return JSON.parse(withoutNul(line));
  } catch {
    return undefined;
  }
}

/** Last-wins rows are one per type and session (summaries: per leaf). */
const lastWinsKey = (row) =>
  `${row.type}:${(row.type === 'summary' ? row.leafUuid : row.sessionId) ?? ''}`;

const COST_LIMIT = 1e15;
const COST_FIELDS = [
  'totalAPIDuration',
  'totalAPIDurationWithoutRetries',
  'totalToolDuration',
  'totalLinesAdded',
  'totalLinesRemoved',
  'totalDuration',
  'startTime',
];
const USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'webSearchRequests',
  'costUSD',
];
const USAGE_OPTIONAL = [
  'thinkingTokens',
  'cacheCreationEphemeral5mInputTokens',
  'cacheCreationEphemeral1hInputTokens',
];
const USAGE_SUMMED = [
  'inputTokens',
  'outputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
];

const amount = (value, max = COST_LIMIT) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

/** Claude Code's cost-state schema: a row that fails it is kept like an accumulate row. */
function validCostState(row) {
  if (typeof row.sessionId !== 'string' || !amount(row.totalCostUSD, 1e9)) return false;
  if (!COST_FIELDS.every((field) => amount(row[field]))) return false;
  if (row.hasUnknownModelCost !== undefined && typeof row.hasUnknownModelCost !== 'boolean')
    return false;
  const usage = row.modelUsage;
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return false;
  const models = Object.entries(usage);
  for (const [model, entry] of models) {
    if (!/^[^\p{Cc}\p{Cf}]+$/u.test(model)) return false;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    if (!USAGE_FIELDS.every((field) => amount(entry[field]))) return false;
    if (!USAGE_OPTIONAL.every((field) => entry[field] === undefined || amount(entry[field])))
      return false;
  }
  return USAGE_SUMMED.every(
    (field) => models.reduce((sum, [, entry]) => sum + entry[field], 0) <= COST_LIMIT
  );
}

/**
 * The plan of Claude Code's transcript compaction for `lines`: `{ kind: 'plan', plan }`, `{ kind: 'skip' }` (no
 * boundary) or `{ kind: 'abort', reason }` (Claude Code would leave the file as it is).
 */
function compactionPlan(lines) {
  let boundaryIdx = -1;
  let boundaryMeta;
  let lastNonPreservedBoundaryIdx = -1;
  const byUuid = new Map();
  const snapshots = new Map();
  const deltas = new Map();
  const keep = new Set();
  const lastMeta = new Map();
  const superseded = new Set();
  for (const [idx, line] of lines.entries()) {
    const row = parseRow(line);
    if (!row) {
      // Not JSON (a torn write): kept as it is
      if (line) {
        if (withoutNul(line).startsWith(`{"type":"${LEDGER}"`))
          return { kind: 'abort', reason: 'ledger' };
        keep.add(idx);
      }
      continue;
    }
    if (row.type === 'file-history-snapshot') snapshots.set(row.messageId, idx);
    else if (row.type === 'file-history-delta') {
      const list = deltas.get(row.messageId);
      if (list) list.push(idx);
      else deltas.set(row.messageId, [idx]);
    }
    const kind = rowKind(row.type);
    if (kind === 'transcript') {
      byUuid.set(row.uuid, { parent: row.parentUuid, idx });
      if (row.type === 'system' && row.subtype === 'compact_boundary') {
        boundaryIdx = idx;
        boundaryMeta = row.compactMetadata;
        if (!row.compactMetadata?.preservedSegment && !row.compactMetadata?.preservedMessages)
          lastNonPreservedBoundaryIdx = idx;
      }
    } else if (kind === 'accumulate') keep.add(idx);
    else if (kind === 'last-wins') {
      if (row.type === 'cost-state' && !validCostState(row)) keep.add(idx);
      else {
        // The worker never writes artifact ledgers (Claude Code merges them): keep such a transcript whole
        if (row.type === LEDGER) return { kind: 'abort', reason: 'ledger' };
        const key = lastWinsKey(row);
        const previous = lastMeta.get(key);
        if (previous && SUPERSEDED_TYPES.has(row.type)) superseded.add(previous.idx);
        lastMeta.set(key, { idx, line, type: row.type });
      }
    }
  }
  if (boundaryIdx < 0) return { kind: 'skip' };
  const keepWith = (uuid, idx) => {
    keep.add(idx);
    const snapshot = snapshots.get(uuid);
    if (snapshot !== undefined) keep.add(snapshot);
    for (const delta of deltas.get(uuid) ?? []) keep.add(delta);
  };
  if (boundaryMeta?.preservedMessages) {
    for (const uuid of boundaryMeta.preservedMessages.uuids) {
      const row = byUuid.get(uuid);
      if (!row) return { kind: 'abort', reason: 'preserved_uuid_missing' };
      keepWith(uuid, row.idx);
    }
  } else if (boundaryMeta?.preservedSegment) {
    const segment = boundaryMeta.preservedSegment;
    const seen = new Set();
    let uuid = segment.tailUuid;
    while (uuid && !seen.has(uuid)) {
      seen.add(uuid);
      const row = byUuid.get(uuid);
      if (row) {
        keepWith(uuid, row.idx);
        if (uuid === segment.headUuid) break;
      }
      uuid = row?.parent;
    }
    if (uuid !== segment.headUuid) return { kind: 'abort', reason: 'preserved_walk_broken' };
  }
  // Rows after the boundary keep their parent from above it (Claude Code relinks them)
  const parents = new Set();
  for (const { parent, idx } of byUuid.values()) {
    if (!parent || idx < boundaryIdx) continue;
    const row = byUuid.get(parent);
    if (row && row.idx < boundaryIdx && !keep.has(row.idx)) parents.add(row.idx);
  }
  for (const idx of parents) keep.add(idx);
  return {
    kind: 'plan',
    plan: { boundaryIdx, lastNonPreservedBoundaryIdx, keep, superseded, lastMeta },
  };
}

/** The rows Claude Code's compaction writes, in its order: kept rows, then after the boundary the last-wins rows from above it. */
function compactedLines(lines, plan) {
  const kept = (idx) =>
    (idx >= plan.boundaryIdx || plan.keep.has(idx)) && !plan.superseded.has(idx);
  const movedBelow = ({ idx, type }) =>
    idx < plan.boundaryIdx &&
    (type !== 'attribution-snapshot' || idx > plan.lastNonPreservedBoundaryIdx);
  const out = [];
  for (const [idx, line] of lines.entries()) {
    if (kept(idx)) out.push(withoutNul(line));
    if (idx === plan.boundaryIdx) {
      for (const meta of plan.lastMeta.values())
        if (movedBelow(meta)) out.push(withoutNul(meta.line));
    }
  }
  return out;
}

/**
 * Why an epoch would not resume like the whole file, or null: the boundary must be in it, every message the
 * compaction preserved, every row from the boundary on, and the parent of every message below the boundary
 * (Claude Code's own invariants after compacting a file). A port that misses one falls back to the whole file.
 */
function epochProblem(lines, plan, epochText) {
  const out = epochText.split('\n').filter(Boolean);
  const kept = new Set(out);
  const uuids = new Set();
  for (const line of out) {
    const row = parseRow(line);
    if (row?.uuid) uuids.add(row.uuid);
  }
  const boundary = parseRow(lines[plan.boundaryIdx]);
  if (!uuids.has(boundary?.uuid)) return 'boundary_missing';
  const meta = boundary.compactMetadata ?? {};
  const preserved = meta.preservedMessages?.uuids ?? [];
  if (preserved.some((uuid) => !uuids.has(uuid))) return 'preserved_missing';
  for (let idx = plan.boundaryIdx; idx < lines.length; idx++) {
    if (plan.superseded.has(idx) || !lines[idx]) continue;
    if (!kept.has(lines[idx].replace(/^\0+/, ''))) return 'row_missing';
    const row = parseRow(lines[idx]);
    if (rowKind(row?.type) === 'transcript' && row.parentUuid && !uuids.has(row.parentUuid))
      return 'parent_missing';
  }
  return null;
}

/**
 * The current epoch of a transcript: `{ text, name, kind, reason }`. `text` is what Claude Code's own compaction
 * would leave of the file's complete lines (a line still being written is left for the next save, as Claude Code
 * does); the whole file when there is no boundary yet, when Claude Code would not compact it, or when the result
 * fails the resume check (`epochProblem`). `name` is `<boundary timestamp>-<boundary uuid 8>.jsonl` (sorts by time;
 * before the first compaction: the first row's time and `start`).
 */
export function transcriptEpoch(text) {
  const complete = text.slice(0, text.lastIndexOf('\n') + 1);
  const lines = complete.split('\n');
  lines.pop();
  const result = compactionPlan(lines);
  let boundary = null;
  let epochText = complete;
  let kind = result.kind;
  let reason = result.reason;
  if (result.kind === 'plan') {
    boundary = parseRow(lines[result.plan.boundaryIdx]);
    const out = compactedLines(lines, result.plan);
    const compacted = out.length ? `${out.join('\n')}\n` : '';
    const problem = epochProblem(lines, result.plan, compacted);
    if (problem) {
      kind = 'abort';
      reason = `check_${problem}`;
    } else epochText = compacted;
  }
  let stamp = boundary?.timestamp;
  if (!stamp) {
    for (const line of lines) {
      stamp = parseRow(line)?.timestamp;
      if (stamp) break;
    }
  }
  const time = String(stamp ?? '0000-00-00T00:00:00.000Z').replace(/[:.]/g, '-');
  const id = String(boundary?.uuid ?? 'start').slice(0, 8);
  return {
    text: epochText,
    name: `${time}-${id}.jsonl`,
    kind,
    ...(reason ? { reason } : {}),
  };
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
