import { YT_LIKE_ACTIONS } from '../constants';
import { SELECTORS } from '../selectors';
import { YtActionSender } from '../core/YtActionSender';
import { PipWindowProvider } from '../core/PipWindowProvider';
import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Handles like/dislike button clicks in PiP window
 */
@injectable()
export class LikeButtonHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(YtActionSender) private readonly ytActionSender: YtActionSender
  ) {
    this.logger = loggerFactory.create('LikeButtonHandler');
  }

  /**
   * Initialize like button handler for PiP window
   */
  public initialize(): void {
    this.pipWindow = this.pipWindowProvider.getWindow();
    this.setupClickHandler();
    this.logger.debug('Like button handler initialized');
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
        const toggleButton = (event.target as Element)?.closest<HTMLButtonElement>(
          SELECTORS.LIKE_BUTTON
        );
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

        const button = (event.target as Element)?.closest<HTMLButtonElement>(
          SELECTORS.BUTTON_SHAPE
        );
        if (!button) {
          return;
        }

        const isPressed = button.getAttribute('aria-pressed') === 'true';
        const actionType = isPressed
          ? YT_LIKE_ACTIONS.REMOVE
          : isLikeButton
            ? YT_LIKE_ACTIONS.LIKE
            : YT_LIKE_ACTIONS.DISLIKE;

        this.logger.log(`${actionType} button clicked (currently pressed: ${isPressed})`);

        this.ytActionSender.sendLikeAction(actionType);
      },
      true
    ); // Capture phase
  }

  /**
   * Cleanup like button handler
   */
  public cleanup(): void {
    this.pipWindow = null;
    this.logger.debug('Like button handler cleaned up');
  }
}
