import type { Nullable } from '../types/app';

import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { inject, injectable } from '../di';

/**
 * Tracks element resize events and updates player
 */
@injectable()
export class ResizeTracker {
  private readonly logger: Logger;
  private observer: Nullable<ResizeObserver> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager
  ) {
    this.logger = loggerFactory.create('ResizeTracker');
  }

  /**
   * Start tracking resize events for element in PiP window
   */
  public start(targetElement: Element): void {
    if (typeof ResizeObserver === 'undefined') {
      this.logger.error('ResizeObserver not available');
      return;
    }

    this.logger.debug('Starting resize tracking');

    this.observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        this.logger.debug(`New size: ${width}px`);

        const player = this.playerManager.getPlayer();
        // Check if resize methods are available
        const hasResizeMethods =
          typeof player.setInternalSize === 'function' || typeof player.setSize === 'function';

        if (!hasResizeMethods) {
          this.logger.warn('Player resize methods (setInternalSize, setSize) not found');
        }

        // Call resize methods if available
        player.setInternalSize?.();
        player.setSize?.();

        player.dispatchEvent(new Event('resize', { bubbles: true }));
        this.logger.debug('Player size updated');
      }
    });

    this.observer.observe(targetElement);
  }

  /**
   * Stop tracking resize events
   */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      this.logger.debug('Resize tracking stopped');
    }
  }
}
