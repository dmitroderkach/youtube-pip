import { Logger } from '../logger';
import { DEFAULT_DIMENSIONS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('MenuObserver');

/**
 * Observes menu button state and adjusts PiP window
 */
export class MenuObserver {
  private observer: Nullable<MutationObserver> = null;
  private pipWindow: Nullable<Window> = null;

  /**
   * Start observing menu button in PiP window
   */
  public start(pipWindow: Window): void {
    this.pipWindow = pipWindow;

    const button = pipWindow.document.querySelector(SELECTORS.MENU_BUTTON);
    if (!button) {
      logger.warn('Menu button not found for observation');
      return;
    }

    logger.debug('Starting menu observation');

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'aria-expanded') {
          const isExpanded = button.getAttribute('aria-expanded') === 'true';
          const playListContainer = pipWindow.document.querySelector(SELECTORS.PLAYLIST_PANEL);
          const currentHeight = pipWindow.outerHeight;

          logger.debug(`Menu state changed: expanded = ${isExpanded}`);

          if (isExpanded) {
            // Expand window if needed
            if (currentHeight < DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT) {
              pipWindow.resizeTo(pipWindow.outerWidth, DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT);
              logger.debug('PiP window expanded');
            }

            // Show playlist panel
            if (playListContainer) {
              (playListContainer as HTMLElement).style.display = 'block';
            }
          } else {
            // Hide playlist panel
            if (playListContainer) {
              (playListContainer as HTMLElement).style.display = 'none';
            }
          }
        }
      }
    });

    // Observe only aria-expanded attribute
    this.observer.observe(button, {
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });

    // Cleanup on window close
    pipWindow.addEventListener(
      'pagehide',
      () => {
        this.stop();
      },
      { once: true }
    );
  }

  /**
   * Stop observing menu button
   */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      logger.debug('Menu observation stopped');
    }
  }
}
