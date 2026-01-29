import { Logger } from '../logger';
import { YT_LIKE_ACTIONS } from '../constants';
import { SELECTORS } from '../selectors';
import { YtActionSender } from '../core/YtActionSender';
import { PlayerManager } from '../core/PlayerManager';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('LikeButtonHandler');

/**
 * Handles like/dislike button clicks in PiP window
 */
export class LikeButtonHandler {
  private pipWindow: Nullable<Window> = null;
  private ytActionSender: Nullable<YtActionSender> = null;
  private playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  /**
   * Initialize like button handler for PiP window
   */
  public initialize(pipWindow: Window): void {
    this.pipWindow = pipWindow;
    this.ytActionSender = new YtActionSender(pipWindow, this.playerManager);
    this.setupClickHandler();
    logger.debug('Like button handler initialized');
  }

  /**
   * Setup click handler for like/dislike buttons
   */
  private setupClickHandler(): void {
    if (!this.pipWindow) {
      return;
    }

    this.pipWindow.document.addEventListener(
      'click',
      (event: MouseEvent) => {
        const toggleButton = (event.target as Element)?.closest(SELECTORS.LIKE_BUTTON);
        if (!toggleButton) {
          return;
        }

        const buttonContainer = toggleButton.parentElement;
        if (!buttonContainer) {
          return;
        }

        const isLikeButton = buttonContainer.childNodes[0] === toggleButton;
        const isDislikeButton = buttonContainer.childNodes[1] === toggleButton;

        if (!isLikeButton && !isDislikeButton) {
          return;
        }

        const button = (event.target as Element)?.closest(SELECTORS.BUTTON_SHAPE);
        if (!button) {
          return;
        }

        const isPressed = button.getAttribute('aria-pressed') === 'true';
        const actionType = isPressed
          ? YT_LIKE_ACTIONS.REMOVE
          : isLikeButton
            ? YT_LIKE_ACTIONS.LIKE
            : YT_LIKE_ACTIONS.DISLIKE;

        logger.log(`${actionType} button clicked (currently pressed: ${isPressed})`);

        this.ytActionSender?.sendLikeAction(actionType);
      },
      true
    ); // Capture phase
  }

  /**
   * Cleanup like button handler
   */
  public cleanup(): void {
    this.pipWindow = null;
    this.ytActionSender = null;
    logger.debug('Like button handler cleaned up');
  }
}
