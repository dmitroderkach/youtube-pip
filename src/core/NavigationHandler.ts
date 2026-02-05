import { NavigationState } from '../types/youtube';
import { WEB_PAGE_TYPES, ROOT_VE, YT_EVENTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from './PipWindowProvider';
import { inject, injectable } from '../di';

/**
 * Handles SPA navigation in PiP window
 */
@injectable()
export class NavigationHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('NavigationHandler');
  }

  /**
   * Initialize navigation handler for PiP window
   */
  public initialize(): void {
    this.pipWindow = this.pipWindowProvider.getWindow();
    this.setupClickHandler();
    this.logger.debug('Navigation handler initialized');
  }

  /**
   * Setup click handler for navigation in PiP window
   */
  private setupClickHandler(): void {
    if (!this.pipWindow) {
      this.logger.error('PiP window not available for navigation handler');
      return;
    }

    this.pipWindow.document.addEventListener(
      'click',
      (event: MouseEvent) => {
        const endpoint = (event.target as Element)?.closest<HTMLAnchorElement>(
          SELECTORS.SIMPLE_ENDPOINT
        );
        const button = (event.target as Element)?.closest<HTMLButtonElement>(SELECTORS.BUTTON);

        // Skip button clicks (handled by LikeButtonHandler)
        if (button || !endpoint) {
          return;
        }

        const href = endpoint.href;
        if (!href) {
          this.logger.warn('Navigation endpoint has no href');
          return;
        }

        this.logger.log('Navigation click detected');

        try {
          const url = new URL(href);
          const params = Object.fromEntries(url.searchParams);

          // Prevent default navigation
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          // Build navigation state
          const state: NavigationState = {
            endpoint: {
              commandMetadata: {
                webCommandMetadata: {
                  url: href,
                  webPageType: WEB_PAGE_TYPES.WATCH,
                  rootVe: ROOT_VE,
                },
              },
              watchEndpoint: {
                videoId: params.v,
                playlistId: params.list || null,
                index: params.index ? parseInt(params.index) - 1 : 0,
                params: 'OAE%3D',
                playerParams: params.pp,
              },
            },
            entryTime: performance.now(),
          };

          this.logger.log(`SPA navigation via ${YT_EVENTS.NAVIGATE}: ${href}`);

          // Trigger navigation (no pushState — YouTube does not update URL in mini player)
          window.dispatchEvent(new PopStateEvent('popstate', { state }));
        } catch (e) {
          this.logger.error('Error handling navigation:', e);
        }
      },
      true
    ); // Use capture phase
  }

  /**
   * Cleanup navigation handler
   */
  public cleanup(): void {
    this.pipWindow = null;
    this.logger.debug('Navigation handler cleaned up');
  }
}
