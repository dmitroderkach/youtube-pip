import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeScheduler } from '../YouTubeScheduler';
import { TIMEOUTS, YT_SCHEDULER } from '../../constants';

vi.mock('../../logger', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn() }) },
}));

type AddJob = (job: () => void, priority: number, delayMs?: number) => number;

function setScheduler(addJob: AddJob | undefined): void {
  window.yt = addJob ? { scheduler: { instance: { addJob } } } : undefined;
}

describe('YouTubeScheduler.waitForLowPriorityJobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.yt = undefined;
  });

  it('resolves at once when the YouTube scheduler is not available', async () => {
    setScheduler(undefined);
    await expect(YouTubeScheduler.waitForLowPriorityJobs()).resolves.toBeUndefined();
  });

  it('queues a low-priority job with the watch-while job delay and resolves when it runs', async () => {
    let queued: (() => void) | undefined;
    const addJob = vi.fn<AddJob>((job) => {
      queued = job;
      return 1;
    });
    setScheduler(addJob);

    let resolved = false;
    const wait = YouTubeScheduler.waitForLowPriorityJobs().then(() => {
      resolved = true;
    });

    expect(addJob).toHaveBeenCalledWith(
      expect.any(Function),
      YT_SCHEDULER.LOW_PRIORITY,
      YT_SCHEDULER.WATCH_WHILE_JOB_DELAY_MS
    );
    await Promise.resolve();
    expect(resolved).toBe(false);

    queued!();
    await wait;
    expect(resolved).toBe(true);
  });

  it('resolves after the timeout when YouTube holds the job back', async () => {
    setScheduler(vi.fn<AddJob>(() => 1));

    let resolved = false;
    const wait = YouTubeScheduler.waitForLowPriorityJobs().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(TIMEOUTS.YOUTUBE_LOW_PRIORITY_JOBS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(resolved).toBe(true);
  });

  it('resolves at once when addJob throws', async () => {
    setScheduler(
      vi.fn<AddJob>(() => {
        throw new Error('scheduler disposed');
      })
    );
    await expect(YouTubeScheduler.waitForLowPriorityJobs()).resolves.toBeUndefined();
  });
});
