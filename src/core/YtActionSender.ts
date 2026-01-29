import { Logger } from '../logger';
import { SELECTORS } from '../selectors';
import { PlayerManager } from './PlayerManager';
import { YouTubeCommand, YouTubeAppElement, LikeActionType } from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('YtActionSender');

/**
 * Sends YouTube like/dislike/remove commands to main window ytd-app.
 * Used by LikeButtonHandler when user clicks like/dislike in PiP.
 */
export class YtActionSender {
  private readonly pipWindow: Nullable<Window>;
  private readonly playerManager: PlayerManager;

  constructor(pipWindow: Nullable<Window>, playerManager: PlayerManager) {
    this.pipWindow = pipWindow;
    this.playerManager = playerManager;
  }

  /**
   * Send like/dislike action (LIKE / DISLIKE / REMOVE) for the current PiP video.
   * Resolves video ID from PiP player and invokes main window resolveCommand.
   */
  public sendLikeAction(actionType: LikeActionType): void {
    if (!this.pipWindow) {
      return;
    }

    const videoId = this.playerManager.getVideoId(this.pipWindow.document);

    if (!videoId) {
      return;
    }

    const mainApp = document.querySelector<YouTubeAppElement>(SELECTORS.YTD_APP);
    if (!mainApp || typeof mainApp.resolveCommand !== 'function') {
      logger.error('Failed to find resolveCommand in main window');
      return;
    }

    const command: YouTubeCommand = {
      likeEndpoint: {
        status: actionType,
        target: { videoId },
      },
    };

    try {
      mainApp.resolveCommand(command);
      logger.log(`Sent ${actionType} for video ${videoId}`);
    } catch (e) {
      logger.error('Error sending YouTube action:', e);
    }
  }
}
