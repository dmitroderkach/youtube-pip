/**
 * Read-only tools of the fast lane (assistant.mjs; plan "Fast lane for the dev chat"). They run in the Lambda handler,
 * not in the agent: the GitHub token and the AWS credentials stay in the handler, the agent only sees the results.
 * Every tool reads; the only "action" is hand_over, which the handler turns into a task for the worker.
 *
 * The one write besides hand_over: the owner's scheduled tasks (state/scheduled/, scheduled-tasks.mjs), so a reminder
 * never needs the worker.
 *
 * Built around injected clients so they can be tested without AWS or GitHub:
 *   s3: { get(key) -> string | null, list(prefix) -> string[], put(key, text), delete(key) }
 *   github: (path) -> parsed JSON (GET https://api.github.com/<path>)
 */

import {
  SCHEDULED_PREFIX,
  describeTask,
  newScheduledTask,
  validTaskId,
} from './scheduled-tasks.mjs';
import { resolveSettings } from './settings.mjs';

/** Size limits of what a tool returns to the model (characters). */
export const LIMITS = {
  CHAT_LINES: 40,
  CHAT_LINES_MAX: 200,
  FILE_CHARS: 30000,
  MEMORY_CHARS: 8000,
  PLAN_CHARS: 20000,
  LIST_ITEMS: 30,
};

export const STATE_KEYS = {
  META: 'state/meta.json',
  SETTINGS: 'state/settings.json',
  CHAT_LOG: 'state/chat-log.jsonl',
  PROGRESS: 'state/progress.json',
  MEMORY_PREFIX: 'memory/',
  PLANS_PREFIX: 'plans/',
};

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max
    ? `${value.slice(0, max)}\n… (${value.length - max} more characters)`
    : value;
};

/** A plain name for S3 keys built from the model's input: no paths, no "..". */
export function safeName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.includes('/') || value.includes('\\') || value.startsWith('.')) return null;
  return /^[A-Za-z0-9._ -]+$/.test(value) ? value : null;
}

/** A repository path from the model's input: relative, no "..", no leading slash. */
export function safePath(path) {
  const value = String(path ?? '').trim();
  if (
    !value ||
    value.startsWith('/') ||
    value.split('/').some((part) => part === '..' || part === '')
  )
    return null;
  return /^[A-Za-z0-9._/@+ -]+$/.test(value) ? value : null;
}

/** Size limit of a memory file or a plan the fast lane writes (characters). */
export const WRITE_MAX_CHARS = 40000;

/** MEMORY.md with `line` for `file`: replaces the line that links to the file, or appends it. */
export function withIndexLine(index, file, line) {
  const lines = String(index ?? '')
    .split('\n')
    .filter((item, i, all) => item !== '' || i < all.length - 1);
  const at = lines.findIndex((item) => item.includes(`](${file})`));
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  return `${lines.filter(Boolean).join('\n')}\n`;
}

/**
 * `workerAsleep()`: true only when the worker certainly does not run: its progress record says stopped, or a running /
 * starting record went stale (session-state.mjs workerAsleepNow); `toWorker(task)`: a change handed over to the worker as a message (memory_write / plan_write
 * while it runs or starts: it is then the only writer of its memory and plans, plan "Synchronisation" rule 2).
 */
export function createTools({
  s3,
  github,
  repo,
  project,
  workerAsleep = async () => false,
  toWorker,
}) {
  const memoryPrefix = `${STATE_KEYS.MEMORY_PREFIX}${project}/`;

  /**
   * One of the worker's own files (memory, plans) written by the fast lane: directly while the worker sleeps
   * (conditional writes), otherwise handed over; and handed over too when the worker started while it was written,
   * so a starting worker that restored the old copy still gets the change (its next save would undo it otherwise).
   */
  async function writeWorkerFile(what, writes, description) {
    if (!(await workerAsleep())) {
      if (!toWorker)
        return 'The worker is running: tell the owner to ask the worker for this change.';
      const result = await toWorker(description);
      return `The worker is running or starting: it is the only writer of its ${what} now, so the change was handed over to it. ${result}`;
    }
    for (const [key, change] of writes) await s3.updateObject(key, change);
    if (!(await workerAsleep()) && toWorker) {
      await toWorker(description);
      return `Written to S3; the worker started meanwhile, so the change was also handed over to it.`;
    }
    return `Written (the worker reads it at its next start).`;
  }

  return {
    /** The last N lines of the conversation both lanes write (state/chat-log.jsonl). */
    async chatLog({ lines } = {}) {
      const count = Math.min(
        Math.max(Number(lines) || LIMITS.CHAT_LINES, 1),
        LIMITS.CHAT_LINES_MAX
      );
      const text = (await s3.get(STATE_KEYS.CHAT_LOG)) ?? '';
      const tail = text.trim().split('\n').filter(Boolean).slice(-count);
      return tail.length ? tail.join('\n') : '(the chat log is empty)';
    },

    /** What the long-running worker is doing now (state/progress.json), or that it has no record. */
    async progress() {
      const text = await s3.get(STATE_KEYS.PROGRESS);
      return text
        ? clip(text, LIMITS.FILE_CHARS)
        : '(no progress record: the worker has not written one)';
    },

    /** The memory index (MEMORY.md): one line per memory. */
    async memoryIndex() {
      return (await s3.get(`${memoryPrefix}MEMORY.md`)) ?? '(no memory index)';
    },

    async memoryRead({ name }) {
      const file = safeName(name);
      if (!file) return 'Invalid memory file name.';
      const text = await s3.get(`${memoryPrefix}${file}`);
      return text ? clip(text, LIMITS.MEMORY_CHARS) : `No memory file ${file}.`;
    },

    /** A memory file and its MEMORY.md line, while the worker sleeps (otherwise handed over to the worker). */
    async memoryWrite({ name, content, index_line: indexLine }) {
      const file = safeName(name);
      if (!file || !file.endsWith('.md') || file === 'MEMORY.md')
        return 'Invalid memory file name (a .md file other than MEMORY.md).';
      const body = String(content ?? '');
      if (!body.trim() || body.length > WRITE_MAX_CHARS) return 'Empty or too long content.';
      const line = String(indexLine ?? '').trim();
      if (!line.startsWith('- [') || !line.includes(`](${file})`) || line.includes('\n'))
        return `Invalid index line: one line "- [Title](${file}) — hook".`;
      return writeWorkerFile(
        'memory',
        [
          [`${memoryPrefix}${file}`, () => (body.endsWith('\n') ? body : `${body}\n`)],
          [`${memoryPrefix}MEMORY.md`, (index) => withIndexLine(index, file, line)],
        ],
        `Write the memory file ${file} with this content and put this line into MEMORY.md (asked by the owner in the fast lane):\n${line}\n\n${body}`
      );
    },

    /** A saved plan (plans/<name>), while the worker sleeps (otherwise handed over to the worker). */
    async planWrite({ name, content }) {
      const file = safeName(name);
      if (!file || !file.endsWith('.md')) return 'Invalid plan name (a .md file name).';
      const body = String(content ?? '');
      if (!body.trim() || body.length > WRITE_MAX_CHARS) return 'Empty or too long content.';
      return writeWorkerFile(
        'plans',
        [[`${STATE_KEYS.PLANS_PREFIX}${file}`, () => (body.endsWith('\n') ? body : `${body}\n`)]],
        `Write the saved plan ${file} (plans/, ~/plans) with this content (asked by the owner in the fast lane):\n\n${body}`
      );
    },

    async plansList() {
      const keys = await s3.list(STATE_KEYS.PLANS_PREFIX);
      const names = keys.map((key) => key.slice(STATE_KEYS.PLANS_PREFIX.length)).filter(Boolean);
      return names.length ? names.join('\n') : '(no saved plans)';
    },

    async planRead({ name }) {
      const file = safeName(name);
      if (!file) return 'Invalid plan name.';
      const text = await s3.get(`${STATE_KEYS.PLANS_PREFIX}${file}`);
      return text ? clip(text, LIMITS.PLAN_CHARS) : `No plan ${file}.`;
    },

    /** Open (or recently closed) pull requests with their state. */
    async pullRequests({ state } = {}) {
      const which = ['open', 'closed', 'all'].includes(state) ? state : 'open';
      const pulls = await github(
        `repos/${repo}/pulls?state=${which}&per_page=${LIMITS.LIST_ITEMS}`
      );
      if (!pulls.length) return `No ${which} pull requests.`;
      return pulls
        .map(
          (pr) =>
            `#${pr.number} ${pr.title} [${pr.draft ? 'draft' : pr.state}${pr.merged_at ? ', merged' : ''}] ${pr.head?.ref} ${pr.html_url}`
        )
        .join('\n');
    },

    /** One pull request: its description, mergeability and the check runs of its head. */
    async pullRequest({ number }) {
      const id = Number(number);
      if (!Number.isInteger(id) || id <= 0) return 'Invalid pull request number.';
      const pr = await github(`repos/${repo}/pulls/${id}`);
      const checks = await github(`repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=50`);
      const runs = (checks.check_runs ?? [])
        .map((run) => `${run.name}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}`)
        .join(', ');
      return clip(
        [
          `#${pr.number} ${pr.title} (${pr.state}${pr.merged ? ', merged' : ''}${pr.draft ? ', draft' : ''})`,
          `${pr.html_url}`,
          `head ${pr.head.ref} @ ${pr.head.sha.slice(0, 7)}, base ${pr.base.ref}, mergeable_state ${pr.mergeable_state ?? '?'}`,
          `checks: ${runs || 'none yet'}`,
          '',
          pr.body ?? '',
        ].join('\n'),
        LIMITS.FILE_CHARS
      );
    },

    /** Recent workflow runs (all workflows or one by file name). */
    async workflowRuns({ workflow } = {}) {
      const file = workflow ? safeName(workflow) : null;
      if (workflow && !file) return 'Invalid workflow file name.';
      const path = file
        ? `repos/${repo}/actions/workflows/${file}/runs?per_page=10`
        : `repos/${repo}/actions/runs?per_page=10`;
      const { workflow_runs: runs = [] } = await github(path);
      if (!runs.length) return 'No runs.';
      return runs
        .map(
          (run) =>
            `${run.name} #${run.run_number} ${run.event} ${run.head_branch}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} ${run.created_at} ${run.html_url}`
        )
        .join('\n');
    },

    /** A file of the repository (main or another ref). */
    async readFile({ path, ref }) {
      const file = safePath(path);
      if (!file) return 'Invalid path.';
      const at = ref ? safePath(ref) : 'main';
      if (!at) return 'Invalid ref.';
      const data = await github(
        `repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(at)}`
      );
      if (Array.isArray(data)) return data.map((entry) => `${entry.type} ${entry.path}`).join('\n');
      if (data.encoding !== 'base64') return `Not a file: ${file}`;
      return clip(Buffer.from(data.content, 'base64').toString('utf8'), LIMITS.FILE_CHARS);
    },

    /** A one-off scheduled task: "YYYY-MM-DD HH:MM" in the owner's working time zone (or the given zone). */
    async scheduleAdd({ when, text, zone }) {
      // The owner's working time zone (state/settings.json shared.timeZone; the old meta.json as a fallback)
      let ownerZone = null;
      try {
        const [own, meta] = await Promise.all([
          s3.get(STATE_KEYS.SETTINGS),
          s3.get(STATE_KEYS.META),
        ]);
        ownerZone = resolveSettings(JSON.parse(own ?? 'null'), JSON.parse(meta ?? 'null')).shared
          .timeZone;
      } catch {
        ownerZone = null;
      }
      const { task, error } = newScheduledTask({ when, text, zone: zone || ownerZone });
      if (error) return `Not scheduled: ${error}.`;
      await s3.put(`${SCHEDULED_PREFIX}${task.id}.json`, JSON.stringify(task));
      return `Scheduled ${task.id}: ${describeTask(task)}`;
    },

    async scheduleList() {
      const keys = (await s3.list(SCHEDULED_PREFIX)).filter((key) => key.endsWith('.json'));
      if (!keys.length) return 'No scheduled tasks.';
      const lines = [];
      for (const key of keys.slice(0, LIMITS.LIST_ITEMS)) {
        try {
          lines.push(describeTask(JSON.parse((await s3.get(key)) ?? '{}')));
        } catch {
          lines.push(`${key}: unreadable`);
        }
      }
      return lines.join('\n');
    },

    async scheduleCancel({ id }) {
      const task = validTaskId(id);
      if (!task) return 'Invalid task id.';
      if (!(await s3.get(`${SCHEDULED_PREFIX}${task}.json`))) return `No scheduled task ${task}.`;
      await s3.delete(`${SCHEDULED_PREFIX}${task}.json`);
      return `Cancelled ${task}.`;
    },

    /** Code search in the repository (GitHub code search: needs a token). */
    async searchCode({ query }) {
      const text = String(query ?? '').trim();
      if (!text || text.length > 200) return 'Invalid query.';
      const { items = [] } = await github(
        `search/code?q=${encodeURIComponent(`${text} repo:${repo}`)}&per_page=${LIMITS.LIST_ITEMS}`
      );
      return items.length ? items.map((item) => item.path).join('\n') : 'Nothing found.';
    },
  };
}
