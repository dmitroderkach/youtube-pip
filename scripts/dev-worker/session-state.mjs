/**
 * Pure helpers of the dev worker's state in S3 (no I/O): the background task records shown for restoring after a
 * restart, and reading the transcript layout of #175 / #176 once to migrate from it.
 *
 * Transcripts themselves need no helper: Claude Code trims its own transcript file after a compaction
 * (`CLAUDE_CODE_TRANSCRIPT_LOCAL_GC=1`, set by the worker), so the worker uploads the file as it is.
 */

/**
 * Migration from the epoch layout (#175): the newest epoch key of `sessionId` among
 * `claude/transcripts/<project>/<session id>/<name>` keys, or null.
 */
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
