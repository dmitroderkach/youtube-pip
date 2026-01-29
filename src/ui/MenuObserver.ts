import { Logger } from '../logger';
import { DEFAULT_DIMENSIONS, TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import { DOMUtils } from '../utils/DOMUtils';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('MenuObserver');

/**
 * Observes menu button state and adjusts PiP window.
 * Re-waits for the button when it is removed from DOM (e.g. navigate to video without playlist).
 */
export class MenuObserver {
  private observer: Nullable<MutationObserver> = null;
  private removalObserver: Nullable<MutationObserver> = null;

  /**
   * Start observing menu button in PiP window
   */
  public async start(pipWindow: Window): Promise<void> {
    await this.runObservation(pipWindow);
  }

  /**
   * Wait for button, observe it; when removed from DOM, re-wait and re-observe.
   */
  private async runObservation(pipWindow: Window): Promise<void> {
    if (pipWindow.closed) {
      logger.debug('PiP window already closed, skipping menu observation');
      return;
    }

    let button: Element;
    try {
      button = await DOMUtils.waitForElementSelector(
        SELECTORS.MENU_BUTTON,
        pipWindow.document,
        TIMEOUTS.ELEMENT_WAIT_INFINITE,
        pipWindow
      );
    } catch (e) {
      logger.warn('Wait for menu button aborted', e);
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

    this.removalObserver = new MutationObserver(() => {
      if (!button.isConnected) {
        this.observer?.disconnect();
        this.removalObserver?.disconnect();
        this.observer = null;
        this.removalObserver = null;
        logger.debug('Menu button removed from DOM, re-waiting');
        void this.runObservation(pipWindow);
      }
    });

    this.removalObserver.observe(pipWindow.document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop observing menu button
   */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.removalObserver) {
      this.removalObserver.disconnect();
      this.removalObserver = null;
    }
    logger.debug('Menu observation stopped');
  }
}
