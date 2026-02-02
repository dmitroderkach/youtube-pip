import { PlayerManager } from './PlayerManager';
import { YtdAppProvider } from './YtdAppProvider';
import { PipWindowProvider } from './PipWindowProvider';
import { YouTubeCommand, LikeActionType } from '../types/youtube';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Sends YouTube like/dislike/remove commands to main window ytd-app.
 * Used by LikeButtonHandler when user clicks like/dislike in PiP.
 */
@injectable()
export class YtActionSender {
  private readonly logger: Logger;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('YtActionSender');
  }

  /**
   * Send like/dislike action (LIKE / DISLIKE / REMOVE) for the current PiP video.
   * Resolves video ID from PiP player and invokes main window resolveCommand.
   */
  public sendLikeAction(actionType: LikeActionType): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) {
      return;
    }

    const videoId = this.playerManager.getVideoId();

    if (!videoId) {
      this.logger.error('Video ID not found, cannot send like action');
      return;
    }

    const mainApp = this.ytdAppProvider.getApp();
    if (typeof mainApp.resolveCommand !== 'function') {
      this.logger.error('Failed to find resolveCommand in main window');
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
      this.logger.log(`Sent ${actionType} for video ${videoId}`);
    } catch (e) {
      this.logger.error('Error sending YouTube action:', e);
    }
  }
}
