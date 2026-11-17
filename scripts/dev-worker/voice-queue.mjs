/**
 * Voice replies of both lanes (the worker and the fast lane), the same way: made in the background after the text
 * answer, sent in the order of the answers, each as a reply to its own text answer, and kept as pending work so the
 * process (the worker's idle timer, the fast lane's invocation) does not stop before they are sent.
 */

/**
 * Work that still leads to something in the chat after a turn ended (the voice reply: synthesis and sendVoice): the
 * invocation does not count as idle while any of it runs, and waits for it (up to a limit) before it ends, so the
 * sandbox is not frozen half-way and the voice does not arrive only with the owner's next message.
 */
export function createPendingWork() {
  const pending = new Set();
  return {
    /** Run `work` (a function returning a promise) as pending work; its errors are the caller's to handle. */
    track(work) {
      const promise = Promise.resolve()
        .then(work)
        .finally(() => pending.delete(promise));
      pending.add(promise);
      return promise;
    },
    busy: () => pending.size > 0,
    /** Wait until everything pending settled or `ms` passed; true when nothing is left. */
    async settle(ms) {
      if (!pending.size) return true;
      let timer;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, Math.max(0, ms));
        }),
      ]);
      clearTimeout(timer);
      return pending.size === 0;
    },
  };
}

/**
 * Voice replies in the background: `enqueue(speech, replyTo)` returns at once (the next message and its text answer
 * never wait for a voice); synthesis starts at once, sending keeps the order of the answers, each voice is a reply to
 * its own text answer. Every job runs as `pending` work (createPendingWork) so the invocation stays up until it is sent.
 */
export function createVoiceQueue({ synthesize, send, pending, onError = () => {} }) {
  let last = Promise.resolve();
  return {
    enqueue(speech, replyTo) {
      if (!String(speech ?? '').trim()) return Promise.resolve();
      const previous = last;
      const job = pending.track(async () => {
        try {
          const audio = await synthesize(speech);
          await previous;
          await send(audio, { replyTo, speech });
        } catch (error) {
          await Promise.resolve(onError(error)).catch(() => {});
        }
      });
      last = job;
      return job;
    },
  };
}

/** The chat line when a voice reply could not be made or sent (both lanes). */
export const voiceFailureText = (error) =>
  `⚠️ Голосову відповідь не вдалося озвучити: ${String(error?.message ?? error).slice(0, 300)}`;
