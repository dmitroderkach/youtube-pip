import { Logger } from '../logger';

const logger = Logger.getInstance('AsyncLock');

/**
 * Async mutex for critical sections.
 * Ensures only one async block runs at a time; concurrent callers wait in queue.
 */
export class AsyncLock {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  /**
   * Execute fn while holding the lock. Waits if another execution is in progress.
   * Lock is always released in finally, even if fn throws.
   */
  public async withLock<T>(fn: () => Promise<T>): Promise<T> {
    logger.debug('withLock: waiting for lock');
    await this.acquire();
    logger.debug('withLock: lock acquired, running fn');
    try {
      return await fn();
    } finally {
      this.release();
      logger.debug('withLock: lock released');
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      logger.debug('acquire: lock taken immediately');
      return Promise.resolve();
    }
    logger.debug('acquire: lock busy, joining queue', { queueSize: this.queue.length });
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        logger.debug('acquire: woke from queue');
        resolve();
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      logger.debug('release: passing lock to next in queue', { remaining: this.queue.length });
      next();
    } else {
      this.locked = false;
      logger.debug('release: lock freed');
    }
  }
}
