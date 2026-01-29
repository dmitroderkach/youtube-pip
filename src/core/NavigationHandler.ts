import { Logger } from '../logger';
import { NavigationState } from '../types/youtube';
import { WEB_PAGE_TYPES, ROOT_VE, YT_EVENTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('NavigationHandler');

/**
 * Handles SPA navigation in PiP window
 */
export class NavigationHandler {
  private pipWindow: Nullable<Window> = null;

  /**
   * Initialize navigation handler for PiP window
   */
  public initialize(pipWindow: Window): void {
    this.pipWindow = pipWindow;
    this.setupClickHandler();
    logger.debug('Navigation handler initialized');
  }

  /**
   * Setup click handler for navigation in PiP window
   */
  private setupClickHandler(): void {
    if (!this.pipWindow) {
      logger.error('PiP window not available for navigation handler');
      return;
    }

    this.pipWindow.document.addEventListener(
      'click',
      (event: MouseEvent) => {
        // Focus video player
        const player = this.pipWindow!.document.querySelector<HTMLElement>(
          SELECTORS.HTML5_VIDEO_PLAYER
        );
        if (player && typeof player.focus === 'function') {
          player.focus();
        }

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
          return;
        }

        logger.log('Navigation click detected');

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

          logger.log(`SPA navigation via ${YT_EVENTS.NAVIGATE}: ${href}`);

          // Trigger navigation (no pushState — YouTube does not update URL in mini player)
          window.dispatchEvent(new PopStateEvent('popstate', { state }));
        } catch (e) {
          logger.error('Error handling navigation:', e);
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
    logger.debug('Navigation handler cleaned up');
  }
}
