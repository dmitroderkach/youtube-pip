import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsyncLock } from '../AsyncLock';

vi.mock('../../logger', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn() }) },
}));

/** Delay used inside lock to simulate slow work (fake timers) */
const LOCK_DELAY_MS = 10;

describe('AsyncLock', () => {
  let lock: AsyncLock;

  beforeEach(() => {
    lock = new AsyncLock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('withLock runs fn and returns result', async () => {
    const result = await lock.withLock(async () => 42);
    expect(result).toBe(42);
  });

  it('withLock runs concurrent callers sequentially', async () => {
    vi.useFakeTimers();
    const order: number[] = [];
    const slow = () =>
      lock.withLock(async () => {
        order.push(1);
        await vi.advanceTimersByTimeAsync(LOCK_DELAY_MS);
        order.push(2);
      });
    const fast = () =>
      lock.withLock(async () => {
        order.push(3);
      });
    await Promise.all([slow(), fast()]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases lock when fn throws', async () => {
    await expect(
      lock.withLock(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    const result = await lock.withLock(async () => 'ok');
    expect(result).toBe('ok');
  });
});
