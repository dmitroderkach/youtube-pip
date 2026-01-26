import { Logger } from '../logger';
import { SELECTORS } from '../selectors';
import { YouTubePlayer } from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('ResizeTracker');

/**
 * Tracks element resize events and updates player
 */
export class ResizeTracker {
  private observer: Nullable<ResizeObserver> = null;
  private pipWindow: Nullable<Window> = null;

  /**
   * Start tracking resize events for element in PiP window
   */
  public start(targetElement: Element, pipWindow: Window): void {
    this.pipWindow = pipWindow;

    if (typeof ResizeObserver === 'undefined') {
      logger.error('ResizeObserver not available');
      return;
    }

    logger.debug('Starting resize tracking');

    const pipDoc = pipWindow.document;
    this.observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        logger.debug(`New size: ${width}px`);

        const player = pipDoc.querySelector(SELECTORS.MOVIE_PLAYER) as Nullable<YouTubePlayer>;
        if (player) {
          if (typeof player.setInternalSize === 'function') {
            player.setInternalSize();
            player.setSize?.();
          }
          player.dispatchEvent(new Event('resize', { bubbles: true }));
          logger.debug('Player size updated');
        }
      }
    });

    this.observer.observe(targetElement);

    pipWindow.addEventListener('pagehide', () => this.stop(), { once: true });
  }

  /**
   * Stop tracking resize events
   */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      logger.debug('Resize tracking stopped');
    }
    this.pipWindow = null;
  }
}
