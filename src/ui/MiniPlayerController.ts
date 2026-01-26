import { Logger } from '../logger';
import { KEYBOARD } from '../constants';
import { SELECTORS } from '../selectors';

const logger = Logger.getInstance('MiniPlayerController');

/**
 * Controls mini player visibility and state
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
   * Toggle mini player mode
   * @param forceShow Force show mini player even if already visible
   */
  public toggle(forceShow: boolean = false): void {
    const isVisible = this.isVisible();

    if (forceShow && isVisible) {
      logger.debug('Mini player already visible, skipping toggle');
      return;
    }

    logger.debug(`Toggling mini player (forceShow: ${forceShow})`);

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

  /**
   * Show mini player
   */
  public show(): void {
    if (!this.isVisible()) {
      this.toggle(true);
    }
  }

  /**
   * Hide mini player (toggle if visible)
   */
  public hide(): void {
    if (this.isVisible()) {
      this.toggle(false);
    }
  }
}
