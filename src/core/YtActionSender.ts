import { Logger } from '../logger';
import { YT_ACTIONS } from '../constants';
import { SELECTORS } from '../selectors';
import {
  YouTubeCommand,
  YouTubeAppElement,
  YouTubePlayer,
  LikeActionStatusMap,
} from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('YtActionSender');

/**
 * Sends YouTube like/dislike/remove commands to main window ytd-app.
 * Used by LikeButtonHandler when user clicks like/dislike in PiP.
 */
export class YtActionSender {
  private readonly pipWindow: Nullable<Window>;

  constructor(pipWindow: Nullable<Window>) {
    this.pipWindow = pipWindow;
  }

  /**
   * Send YouTube action (LIKE / DISLIKE / REMOVE) for the current PiP video.
   * Resolves video ID from PiP player and invokes main window resolveCommand.
   */
  public send(actionType: string): void {
    if (!this.pipWindow) {
      return;
    }

    const player = this.pipWindow.document.querySelector(
      SELECTORS.MOVIE_PLAYER
    ) as Nullable<YouTubePlayer>;
    if (!player || typeof player.getVideoData !== 'function') {
      logger.warn('Player or getVideoData not available');
      return;
    }

    const videoData = player.getVideoData();
    const videoId = videoData?.video_id;

    if (!videoId) {
      logger.warn('Video ID not found');
      return;
    }

    const mainApp = document.querySelector(SELECTORS.YTD_APP) as Nullable<YouTubeAppElement>;
    if (!mainApp || typeof mainApp.resolveCommand !== 'function') {
      logger.error('Failed to find resolveCommand in main window');
      return;
    }

    const actionMap: LikeActionStatusMap = {
      [YT_ACTIONS.LIKE]: 'LIKE',
      [YT_ACTIONS.DISLIKE]: 'DISLIKE',
      [YT_ACTIONS.REMOVE]: 'INDIFFERENT',
    };

    const command: YouTubeCommand = {
      likeEndpoint: {
        status: actionMap[actionType],
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
