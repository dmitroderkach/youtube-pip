import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { PlayerManager } from '../core/PlayerManager';
import { SELECTORS } from '../selectors';
import type { YouTubePlayer } from '../types/youtube';
import { inject, injectable } from '../di';
import { Nullable } from '../types/app';
import { YtdShortsProvider } from '../core/YtdShortsProvider';

/**
 * Syncs PiP window title when the player's video element src or the notify renderer DOM changes.
 * Observes the video element (src) and the notify renderer element (childList) and updates title from getVideoData().
 * While PiP is open the page itself is not the watch page (the player went through the mini player), so YouTube
 * sets its own page title ("(1) YouTube") after navigations / data updates; the main document's <title> is
 * watched too and our title put back.
 * Does not depend on PiPManager to avoid circular dependencies.
 */
/** At most this many title restores per window; more means something fights back. */
const TITLE_RESTORE_MAX_PER_WINDOW = 5;
const TITLE_RESTORE_WINDOW_MS = 1000;

@injectable()
export class TitleSyncHandler {
  private readonly logger: Logger;
  private mutationObserver: MutationObserver | null = null;
  private titleObserver: MutationObserver | null = null;
  /** Title we set on the page; YouTube overwriting it is undone. */
  private expectedTitle: string | null = null;
  /** Restores in the current window (guard against a ping-pong with code that keeps setting its own title). */
  private restoreWindowStart = 0;
  private restoresInWindow = 0;
  private shortsMode: boolean = false;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdShortsProvider) private readonly ytdShortsProvider: YtdShortsProvider
  ) {
    this.logger = loggerFactory.create('TitleSyncHandler');
  }

  /**
   * Start observing the player's video element (src) and the notify renderer element (DOM changes) and sync title.
   * Call when PiP window is open. Skips sync when PiP was opened from mini player (from PlayerManager).
   */
  public initialize(shortsMode: boolean = false): void {
    this.shortsMode = shortsMode;
    if (this.playerManager.getWasMiniPlayerActiveBeforePiP()) {
      this.logger.debug('Title sync skipped (e.g. PiP opened from mini player)');
      return;
    }

    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) {
      this.logger.debug('PiP not open, skipping title sync init');
      return;
    }

    const player = this.getPlayer() as YouTubePlayer;
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
    this.observePageTitle();
    this.logger.debug('Title sync observing video src and notify renderer subtree');
  }

  /** Put our title back when YouTube changes the page title (text or the <title> element itself). */
  private observePageTitle(): void {
    if (!document.head) return;
    this.titleObserver = new MutationObserver(() => {
      if (!this.expectedTitle || document.title === this.expectedTitle) return;
      const now = Date.now();
      if (now - this.restoreWindowStart > TITLE_RESTORE_WINDOW_MS) {
        this.restoreWindowStart = now;
        this.restoresInWindow = 0;
      }
      if (++this.restoresInWindow > TITLE_RESTORE_MAX_PER_WINDOW) {
        // Something keeps setting its own title right back: do not fight it (would loop and freeze the tab)
        if (this.restoresInWindow === TITLE_RESTORE_MAX_PER_WINDOW + 1) {
          this.logger.warn(
            `Page title keeps changing to "${document.title}"; not restoring for now`
          );
        }
        return;
      }
      this.logger.debug(`Page title changed by YouTube to "${document.title}"; restoring`);
      document.title = this.expectedTitle;
    });
    this.titleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private getPlayer(): Nullable<YouTubePlayer> {
    return this.shortsMode ? this.ytdShortsProvider.getPlayer() : this.playerManager.getPlayer();
  }

  private setWindowsTitle(title: string): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (!pipWindow) return;
    const notify = this.ytdAppProvider.getNotifyRenderer();
    const countNotif = notify?.showNotificationCount ? `(${notify.showNotificationCount}) ` : '';
    const newTitle = `${countNotif}${title} - YouTube`;
    this.expectedTitle = newTitle;
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
    this.titleObserver?.disconnect();
    this.titleObserver = null;
    this.expectedTitle = null;
  }
}
