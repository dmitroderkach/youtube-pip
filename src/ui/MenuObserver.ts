import { DEFAULT_DIMENSIONS, TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import { DOMUtils } from '../utils/DOMUtils';
import type { Nullable } from '../types/app';

import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { inject, injectable } from '../di';

/**
 * Observes menu button state and adjusts PiP window.
 * Re-waits for the button when it is removed from DOM (e.g. navigate to video without playlist).
 */
@injectable()
export class MenuObserver {
  private readonly logger: Logger;
  private observer: Nullable<MutationObserver> = null;
  private removalObserver: Nullable<MutationObserver> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('MenuObserver');
  }

  /**
   * Start observing menu button in PiP window
   */
  public async start(): Promise<void> {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (pipWindow) {
      await this.runObservation(pipWindow);
    }
  }

  /**
   * Wait for button, observe it; when removed from DOM, re-wait and re-observe.
   */
  private async runObservation(pipWindow: Window): Promise<void> {
    if (pipWindow.closed) {
      this.logger.debug('PiP window already closed, skipping menu observation');
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
      this.logger.warn('Wait for menu button aborted', e);
      return;
    }

    this.logger.debug('Starting menu observation');

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'aria-expanded') {
          const isExpanded = button.getAttribute('aria-expanded') === 'true';
          const playListContainer = pipWindow.document.querySelector<HTMLElement>(
            SELECTORS.PLAYLIST_PANEL
          );
          const currentHeight = pipWindow.outerHeight;

          this.logger.debug(`Menu state changed: expanded = ${isExpanded}`);

          if (isExpanded) {
            // Expand window if needed
            if (currentHeight < DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT) {
              pipWindow.resizeTo(pipWindow.outerWidth, DEFAULT_DIMENSIONS.PIP_EXPANDED_HEIGHT);
              this.logger.debug('PiP window expanded');
            }

            // Show playlist panel
            if (playListContainer) {
              playListContainer.style.display = 'block';
            }
          } else {
            // Hide playlist panel
            if (playListContainer) {
              playListContainer.style.display = 'none';
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
        this.logger.debug('Menu button removed from DOM, re-waiting');
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
    this.logger.debug('Menu observation stopped');
  }
}
