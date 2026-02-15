import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { PlayerManager } from '../core/PlayerManager';
import { SELECTORS } from '../selectors';
import type { YouTubePlayer } from '../types/youtube';
import { inject, injectable } from '../di';

/**
 * Syncs PiP window title when the player's video element src or the notify renderer DOM changes.
 * Observes the video element (src) and the notify renderer element (childList) and updates title from getVideoData().
 * Does not depend on PiPManager to avoid circular dependencies.
 */
@injectable()
export class TitleSyncHandler {
  private readonly logger: Logger;
  private mutationObserver: MutationObserver | null = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(PlayerManager) private readonly playerManager: PlayerManager
  ) {
    this.logger = loggerFactory.create('TitleSyncHandler');
  }

  /**
   * Start observing the player's video element (src) and the notify renderer element (DOM changes) and sync title.
   * Call when PiP window is open. Skips sync when PiP was opened from mini player (from PlayerManager).
   */
  public initialize(): void {
    if (this.playerManager.getWasMiniPlayerActiveBeforePiP()) {
      this.logger.debug('Title sync skipped (e.g. PiP opened from mini player)');
      return;
    }

    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) {
      this.logger.debug('PiP not open, skipping title sync init');
      return;
    }

    const player = this.playerManager.getPlayer() as YouTubePlayer;
    const video = player.querySelector(SELECTORS.PLAYER_VIDEO);
    if (!video) {
      this.logger.warn('Video element not found inside player');
      return;
    }

    const syncTitle = (): void => {
      const data = player.getVideoData?.();
      if (data?.title) {
        this.setWindowsTitle(data.title);
      }
    };

    syncTitle();

    this.mutationObserver = new MutationObserver(() => {
      syncTitle();
    });
    this.mutationObserver.observe(video, {
      attributes: true,
      attributeFilter: ['src'],
    });
    const notifyRenderer = this.ytdAppProvider.getNotifyRenderer();
    if (notifyRenderer) {
      this.mutationObserver.observe(notifyRenderer, {
        childList: true,
        subtree: true,
      });
    }
    this.logger.debug('Title sync observing video src and notify renderer subtree');
  }

  private setWindowsTitle(title: string): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) return;
    const notify = this.ytdAppProvider.getNotifyRenderer();
    const countNotif = notify?.showNotificationCount ? `(${notify.showNotificationCount}) ` : '';
    const newTitle = `${countNotif}${title} - YouTube`;
    document.title = newTitle;
    pipWindow.document.title = newTitle;
    this.logger.debug(`Title synced: ${title}`);
  }

  /**
   * Stop observing. Call when PiP window is closing.
   */
  public cleanup(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
      this.logger.debug('Title sync observer disconnected');
    }
  }
}
