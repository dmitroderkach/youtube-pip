/**
 * The pinned status of the chat (shared by the worker and the fast lane, docs/DEV_WORKER.md "Pinned status", "Code
 * layout"): a message pinned at the top of the chat with the session's settings and limits, edited in place
 * (silently) when they change; its id is kept by the host (`statusMessageId`). A lost or unpinned one is replaced.
 *
 * createPinnedStatus({ log, telegram, chatId, getMeta, setMeta, persistMeta, body, isStopping, formatTime }):
 * - body({ sleeping }) -> the status text (the host decides what it shows);
 * - getMeta() / setMeta(meta): the host's state holding `statusMessageId`; persistMeta(): save it at once;
 * - isStopping(): no more scheduled updates; formatTime(date): the "updated" time.
 */
export function createPinnedStatus({
  log,
  telegram,
  chatId,
  getMeta,
  setMeta,
  persistMeta,
  body: statusBody,
  isStopping = () => false,
  formatTime,
}) {
  let statusTimer = null;
  let lastStatusBody = null;
  let statusUpdating = Promise.resolve();

  function scheduleStatusUpdate() {
    if (statusTimer || isStopping()) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      void updateStatus();
    }, 3000);
    statusTimer.unref?.();
  }

  /**
   * Edit the pinned status (or send and pin a new one). `sleeping`: the host is stopping; `fresh` (`/status`): a new
   * message at the bottom of the chat, pinned instead of the old one.
   */
  function updateStatus({ sleeping = false, fresh = false } = {}) {
    statusUpdating = statusUpdating.then(async () => {
      try {
        const body = await statusBody({ sleeping });
        if (fresh && getMeta()?.statusMessageId) {
          await telegram.call('unpinChatMessage', { message_id: getMeta().statusMessageId });
          setMeta({ ...getMeta(), statusMessageId: null });
        }
        if (body === lastStatusBody && getMeta()?.statusMessageId) return;
        const text = `${body}\n\nоновлено ${formatTime(new Date())}`;
        if (getMeta()?.statusMessageId) {
          const edited = await telegram.request(
            'editMessageText',
            () =>
              JSON.stringify({
                chat_id: chatId,
                message_id: getMeta().statusMessageId,
                text,
              }),
            { 'Content-Type': 'application/json' }
          );
          if (edited.ok || /not modified/i.test(edited.description ?? '')) {
            lastStatusBody = body;
            return;
          }
        }
        const sent = await telegram.call('sendMessage', { text, disable_notification: true });
        if (!sent?.message_id) return;
        await telegram.call('pinChatMessage', {
          message_id: sent.message_id,
          disable_notification: true,
        });
        lastStatusBody = body;
        setMeta({ ...(getMeta() ?? {}), statusMessageId: sent.message_id });
        await persistMeta();
      } catch (error) {
        log('status update failed', error);
      }
    });
    return statusUpdating;
  }

  /** Drop a scheduled update (the host is stopping and updates the status itself). */
  function cancelScheduled() {
    if (statusTimer) clearTimeout(statusTimer);
  }

  return { scheduleStatusUpdate, updateStatus, cancelScheduled };
}

// ---------------------------------------------------------------------------------------------- both lanes

/**
 * The figures behind the pinned status, shared by both lanes (`state/status.json`, conditional writes): the pinned
 * message's id, a section per lane (`worker`, `fastLane`: what each knows of itself) and `shared` (Claude's plan
 * windows, voice, time zone, scheduled tasks; whoever saw them last). Each lane writes its own section and the shared
 * figures it has, then renders the whole message from the record, so the other lane's last known figures stay.
 */
export const STATUS_KEY = 'state/status.json';

/** Plan windows of a `rate_limit_event` (`unifiedWindows`, or one window from older CLIs): name → { utilization 0-1, resetsAt }. */
export function rateWindows(info = {}) {
  const windows = info.unifiedWindows ?? (info.rateLimitType ? { [info.rateLimitType]: info } : {});
  const out = {};
  for (const [name, window] of Object.entries(windows)) {
    if (typeof window?.utilization === 'number')
      out[name] = { utilization: window.utilization, resetsAt: window.resetsAt ?? null };
  }
  return out;
}

/**
 * The record with one lane's section replaced (`lane`: `worker` | `fastLane`) and the shared figures given merged in
 * (undefined ones keep the last known value; plan windows merge per window).
 */
export function mergeStatus(current, { lane, figures, shared = {}, now = new Date() }) {
  const record = { ...(current ?? {}) };
  if (lane) record[lane] = { ...figures, updatedAt: now.toISOString() };
  const merged = { ...(record.shared ?? {}) };
  for (const [name, value] of Object.entries(shared)) {
    if (value === undefined) continue;
    merged[name] = name === 'windows' ? { ...(merged.windows ?? {}), ...value } : value;
  }
  record.shared = merged;
  return record;
}

const pct = (value) => (typeof value === 'number' ? `${Math.round(value * 100)}%` : '?');

/**
 * The pinned status text of both lanes. Telegram's pinned bar shows only the start of the first line (~60 characters
 * on a phone), so the first line is a dense summary (worker state, mode and model, the fast lane's model, Claude's
 * windows, speech spend); the lanes and the shared lines follow. `modes`: telegram-format.mjs MODES.
 */
export function renderStatus(
  record,
  { timeZone = 'Europe/Warsaw', modes = {}, voiceModels = {} } = {}
) {
  const time = (iso, withDay = false) =>
    iso
      ? new Date(iso).toLocaleString('uk-UA', {
          timeZone,
          ...(withDay ? { weekday: 'short' } : {}),
          hour: '2-digit',
          minute: '2-digit',
        })
      : '?';
  const worker = record?.worker ?? {};
  const fast = record?.fastLane ?? {};
  const shared = record?.shared ?? {};
  const windows = shared.windows ?? {};
  const reset = (name, withDay) =>
    windows[name]?.resetsAt
      ? time(new Date(windows[name].resetsAt * 1000).toISOString(), withDay)
      : '?';
  const stateEmoji = { busy: '🔵', running: '🟢', stopped: '💤' }[worker.state] ?? '❔';
  const mode = modes[worker.mode];
  const ctx = (value) => (typeof value === 'number' ? ` · ctx ${Math.round(value)}%` : '');
  const summary =
    `${stateEmoji}${mode?.emoji ?? ''} ${worker.model ?? '?'}${ctx(worker.ctx)} · ⚡${fast.model ?? '?'} · ` +
    `5г ${pct(windows.five_hour?.utilization)} · тж ${pct(windows.seven_day?.utilization)}` +
    `${shared.speech ? ` · 🔊${shared.speech}` : ''}`;
  const workerState =
    {
      busy: '🔵 працює над задачею',
      running: '🟢 запущений, вільний',
      stopped: `💤 спить з ${time(worker.since ?? worker.updatedAt)}`,
    }[worker.state] ?? '❔ стан невідомий';
  const voice = shared.voice;
  return [
    summary,
    '',
    `🛠 Воркер: ${workerState} · режим ${worker.mode ?? '?'} · ${worker.model ?? '?'} · effort ${worker.effort ?? 'default'}${ctx(worker.ctx)}`,
    `⚡ Лямбда: ${fast.model ?? '?'} · effort ${fast.effort ?? 'default'}${ctx(fast.ctx)}${fast.lastAnswerAt ? ` · відповідь ${time(fast.lastAnswerAt)}` : ''}`,
    `📊 5 год ↻${reset('five_hour', false)} · тиждень ↻${reset('seven_day', true)}`,
    ...(voice
      ? [
          `🔊 ${voice.mode ?? 'auto'} · ${voiceModels[voice.model]?.label ?? voice.model ?? '?'} · ${voice.name ?? '?'}`,
        ]
      : []),
    `🕐 ${shared.timeZone ?? timeZone}${shared.scheduled ? ` · ⏰ ${shared.scheduled}` : ''}`,
  ].join('\n');
}
