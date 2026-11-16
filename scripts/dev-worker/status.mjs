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
