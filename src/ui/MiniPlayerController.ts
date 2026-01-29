import { Logger } from '../logger';
import { SELECTORS } from '../selectors';
import { PlayerManager } from '../core/PlayerManager';
import type { YouTubeAppElement } from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('MiniPlayerController');

/**
 * Controls mini player visibility and state using YouTube native actions
 */
export class MiniPlayerController {
  private playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }
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
   * Uses yt-action with yt-activate-miniplayer-from-watch-action
   */
  public activateMiniPlayer(): void {
    logger.debug('Activating mini player via YouTube API');

    const ytdApp = document.querySelector(SELECTORS.YTD_APP) as Nullable<YouTubeAppElement>;
    if (!ytdApp) {
      logger.error('ytd-app not found');
      return;
    }

    try {
      ytdApp.fire('yt-action', {
        actionName: 'yt-activate-miniplayer',
        args: [false],
        optionalAction: false,
        returnValue: [undefined],
      });
      logger.debug('Mini player activation event dispatched');
    } catch (e) {
      logger.error('Error activating mini player:', e);
    }
  }

  /**
   * Toggle mini player mode using YouTube native API
   *
   * If mini player is active, navigates back to full player using yt-navigate.
   * Otherwise, activates mini player using yt-action with yt-activate-miniplayer-from-watch-action.
   *
   * @returns void
   */
  public toggleMiniPlayer(): void {
    const ytdApp = document.querySelector(SELECTORS.YTD_APP) as Nullable<YouTubeAppElement>;
    if (!ytdApp) {
      logger.error('ytd-app not found');
      return;
    }

    try {
      if (ytdApp.miniplayerIsActive) {
        // Return to full player: use yt-navigate with watchEndpoint
        logger.debug('Returning to full player via YouTube API');

        // Get video ID from player using PlayerManager
        const videoId = this.playerManager.getVideoId(document);
        if (!videoId) {
          return;
        }

        ytdApp.fire('yt-navigate', {
          endpoint: {
            watchEndpoint: { videoId },
          },
        });
        logger.debug(`Navigation to full player dispatched for video ${videoId}`);
      } else {
        // Activate miniplayer: use yt-action with yt-activate-miniplayer-from-watch-action
        logger.debug('Activating miniplayer via YouTube API');
        ytdApp.fire('yt-action', {
          actionName: 'yt-activate-miniplayer-from-watch-action',
          args: null,
          optionalAction: false,
          returnValue: [undefined],
        });
        logger.debug('Miniplayer activation event dispatched');
      }
    } catch (e) {
      logger.error('Error toggling mini player:', e);
    }
  }
}
