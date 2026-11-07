import { Logger } from '../logger';
import { TIMEOUTS, YT_SCHEDULER } from '../constants';

const logger = Logger.getInstance('YouTubeScheduler');

/**
 * Access to YouTube's job scheduler (window.yt.scheduler.instance, scheduler.js).
 */
export class YouTubeScheduler {
  /**
   * Resolve once YouTube has run the low-priority jobs queued so far.
   *
   * Queues a low-priority job with the same delay as the watch-while IntersectionObserver job; jobs of one
   * priority run in FIFO order, so ours runs after any already pending one. Needed before activating the mini
   * player from the watch page: with kevlar_watch_while_v2 a pending job built from the stale "player visible"
   * entry deactivates a mini player activated in the meantime (YouTube delays these jobs for ~2 s on a busy
   * page). Resolves after `timeoutMs` anyway, or at once when the scheduler is not available.
   */
  public static waitForLowPriorityJobs(
    timeoutMs: number = TIMEOUTS.YOUTUBE_LOW_PRIORITY_JOBS
  ): Promise<void> {
    const addJob = window.yt?.scheduler?.instance?.addJob;
    if (typeof addJob !== 'function') {
      logger.debug('YouTube scheduler not available, not waiting');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const started = performance.now();
      const timeoutId = window.setTimeout(() => {
        logger.debug(`YouTube low-priority jobs still pending after ${timeoutMs}ms, continuing`);
        resolve();
      }, timeoutMs);
      try {
        addJob(
          () => {
            window.clearTimeout(timeoutId);
            logger.debug(
              `YouTube low-priority jobs done in ${Math.round(performance.now() - started)}ms`
            );
            resolve();
          },
          YT_SCHEDULER.LOW_PRIORITY,
          YT_SCHEDULER.WATCH_WHILE_JOB_DELAY_MS
        );
      } catch (error) {
        window.clearTimeout(timeoutId);
        logger.debug('YouTube scheduler addJob failed, not waiting', error);
        resolve();
      }
    });
  }
}
