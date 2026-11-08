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
import { YouTubeScheduler } from '../utils/YouTubeScheduler';

/**
 * Syncs PiP window title when the player's video element src or the notify renderer DOM changes.
 * Observes the video element (src) and the notify renderer element (childList) and updates title from getVideoData().
 * While PiP is open the page itself is not the watch page (the player went through the mini player), so YouTube
 * sets its own page title ("(1) YouTube") after navigations / data updates; the main document's <title> is
 * kept. YouTube writes it with `document.title = …` (ytd-app setPageTitle on yt-update-title); Chrome passes every
 * write to the tab right away, so putting our title back afterwards still flickers for a few milliseconds. While the
 * title is held, YouTube's writes are therefore not applied at all (own `title` property on the document); the
 * <title> observer stays as a fallback for other ways of changing it. Opening PiP from the watch page activates the
 * mini player first, and YouTube switches the title to "YouTube" right away: holdPageTitle() starts the hold before
 * that step. Closing PiP goes back through the mini player too: the PiP window handlers only stop syncing
 * (stopSync()), and PiPManager releases the hold once the player is back on the watch page and YouTube has run its
 * pending jobs (releasePageTitleWhenIdle()).
 * Does not depend on PiPManager to avoid circular dependencies.
 */
/** At most this many title restores per window; more means something fights back. */
const TITLE_RESTORE_MAX_PER_WINDOW = 5;
const TITLE_RESTORE_WINDOW_MS = 1000;
/** Path of the watch page, where our title (the video's) is the right one after PiP closes. */
const WATCH_PATH = '/watch';

@injectable()
export class TitleSyncHandler {
  private readonly logger: Logger;
  private mutationObserver: MutationObserver | null = null;
  private titleObserver: MutationObserver | null = null;
  /** Title we set on the page; YouTube overwriting it is undone. */
  private expectedTitle: string | null = null;
  /** Last title YouTube tried to set while it was held off: applied on release, so the page ends up with it. */
  private blockedTitle: string | null = null;
  /** Document.prototype `title` accessor: our own writes go through it while YouTube's are held off. */
  private readonly nativeTitle = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  /** Restores in the current window (guard against a ping-pong with code that keeps setting its own title). */
  private restoreWindowStart = 0;
  /** Incremented for every new hold, so a delayed release never ends the hold of a PiP opened in the meantime. */
  private holdGeneration = 0;
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
    // A new PiP session (Shorts holds the title only from here): a pending release must not end it
    this.holdGeneration++;

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

  /**
   * Keep the current page title while PiP is being opened (call before activating the mini player; released by
   * cleanup()). initialize() then switches to the synced title.
   */
  public holdPageTitle(): void {
    if (!document.title) return;
    this.holdGeneration++;
    this.expectedTitle = document.title;
    this.blockPageTitleWrites();
    this.observePageTitle();
  }

  /** Make `document.title = …` (YouTube) a no-op until cleanup(); reading it is unchanged. */
  private blockPageTitleWrites(): void {
    const native = this.nativeTitle;
    if (!native?.get || !native.set || Object.getOwnPropertyDescriptor(document, 'title')) return;
    this.blockedTitle = null;
    Object.defineProperty(document, 'title', {
      configurable: true,
      get: () => native.get!.call(document),
      set: (value: string) => {
        this.blockedTitle = value;
        if (value !== this.expectedTitle) {
          this.logger.debug(`Page title "${value}" set by YouTube not applied while PiP is open`);
        }
      },
    });
  }

  private unblockPageTitleWrites(): void {
    if (Object.getOwnPropertyDescriptor(document, 'title')) {
      delete (document as { title?: string }).title;
    }
  }

  /** Write the page title past the block. */
  private applyPageTitle(title: string): void {
    if (this.nativeTitle?.set) this.nativeTitle.set.call(document, title);
    else document.title = title;
  }

  /** Put our title back when YouTube changes the page title (text or the <title> element itself). */
  private observePageTitle(): void {
    if (!document.head || this.titleObserver) return;
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
      this.applyPageTitle(this.expectedTitle);
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
    this.blockPageTitleWrites();
    this.applyPageTitle(newTitle);
    pipWindow.document.title = newTitle;
    this.logger.debug(`Title synced: ${title}`);
  }

  /**
   * Stop syncing the title from the player (PiP window closing); the page title stays held until
   * releasePageTitleWhenIdle() / cleanup().
   */
  public stopSync(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
      this.logger.debug('Title sync observer disconnected');
    }
  }

  /**
   * Release the page title to YouTube once its pending low-priority jobs have run (call when the player is back on
   * the watch page): the watch page's own title updates are then done, so nothing flickers.
   */
  public releasePageTitleWhenIdle(): void {
    const generation = this.holdGeneration;
    void YouTubeScheduler.waitForLowPriorityJobs().then(() => {
      if (generation !== this.holdGeneration) return;
      this.cleanup();
      this.logger.debug('Page title released to YouTube');
    });
  }

  /**
   * Stop syncing and release the page title to YouTube at once.
   */
  public cleanup(): void {
    this.stopSync();
    this.titleObserver?.disconnect();
    this.titleObserver = null;
    const wasBlocked = Object.getOwnPropertyDescriptor(document, 'title') !== undefined;
    this.unblockPageTitleWrites();
    // Back on the watch page our title is the video's (YouTube's write when PiP opened was "YouTube" for the page
    // under the mini player). Anywhere else (e.g. the watch page did not come back, mini player on the home page)
    // apply what YouTube set meanwhile: one write at the end.
    const onWatchPage = window.location.pathname === WATCH_PATH;
    if (
      wasBlocked &&
      !onWatchPage &&
      this.blockedTitle !== null &&
      this.blockedTitle !== document.title
    ) {
      this.logger.debug(`Applying the page title YouTube set while held: "${this.blockedTitle}"`);
      document.title = this.blockedTitle;
    }
    this.blockedTitle = null;
    this.expectedTitle = null;
  }
}
