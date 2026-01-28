import { Logger } from '../logger';
import { SELECTORS } from '../selectors';
import { KEYBOARD } from '../constants';
import type { YouTubeAppElement } from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('MiniPlayerController');

/**
 * Controls mini player visibility and state using YouTube native actions
 */
export class MiniPlayerController {
  /**
   * Check if mini player is currently visible
   */
  public isVisible(): boolean {
    const isVisible = !!document.querySelector(SELECTORS.MINIPLAYER_HOST);
    logger.debug(`Mini player visible: ${isVisible}`);
    return isVisible;
  }

  /**
   * Activate mini player using YouTube native action
   */
  public activateMiniPlayer(): void {
    logger.debug('Activating mini player via native action');

    const ytdApp = document.querySelector(SELECTORS.YTD_APP) as Nullable<YouTubeAppElement>;
    if (!ytdApp) {
      logger.error('ytd-app not found');
      return;
    }

    try {
      ytdApp.fire('yt-action', {
        actionName: 'yt-activate-miniplayer',
        args: [false],
      });
      logger.debug('Mini player activation event dispatched');
    } catch (e) {
      logger.error('Error activating mini player:', e);
    }
  }

  /**
   * Toggle mini player mode using keyboard simulation
   * Simulates pressing "i" key to toggle between mini player and main player
   * @param forceShow Force show mini player even if already visible
   */
  public toggleMiniPlayerViaKeyboard(forceShow: boolean = false): void {
    const isVisible = this.isVisible();

    if (forceShow && isVisible) {
      logger.debug('Mini player already visible, skipping toggle');
      return;
    }

    logger.debug(`Toggling mini player via keyboard (forceShow: ${forceShow})`);

    const eventParams = {
      key: KEYBOARD.MINIPLAYER_KEY,
      code: `Key${KEYBOARD.MINIPLAYER_KEY.toUpperCase()}`,
      keyCode: KEYBOARD.KEY_CODE,
      which: KEYBOARD.WHICH,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    const target = document.querySelector(SELECTORS.MOVIE_PLAYER) || document;

    try {
      target.dispatchEvent(new KeyboardEvent('keydown', eventParams));
      target.dispatchEvent(new KeyboardEvent('keyup', eventParams));
      logger.debug('Mini player toggle events dispatched');
    } catch (e) {
      logger.error('Error toggling mini player:', e);
    }
  }
}
