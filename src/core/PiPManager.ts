import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { DOMUtils } from '../utils/DOMUtils';
import { StyleUtils } from '../utils/StyleUtils';
import { AsyncLock } from '../utils/AsyncLock';
import { MiniPlayerController } from '../ui/MiniPlayerController';
import { PlayerManager } from './PlayerManager';
import { YtdAppProvider } from './YtdAppProvider';
import { PipWindowProvider } from './PipWindowProvider';
import { DEFAULT_DIMENSIONS, TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable, PiPCleanupCallback } from '../types/app';
import { PiPError } from '../errors/PiPError';
import { PiPCriticalError } from '../errors/PiPCriticalError';
import { PiPWindowHandlers } from './PiPWindowHandlers';
import { inject, injectable } from '../di';

/**
 * Manages Picture-in-Picture window lifecycle
 */
@injectable()
export class PiPManager {
  private readonly logger: Logger;
  private miniPlayerContainer: Nullable<Element> = null;
  private placeholder: Nullable<Comment> = null;
  private wasMiniPlayerActiveBeforePiP: boolean = false;

  private onBeforeReturn: Nullable<PiPCleanupCallback> = null;

  private readonly asyncLock = new AsyncLock();

  private close = async (): Promise<void> => {
    return this.asyncLock
      .withLock(() => this.returnPlayerToMain())
      .catch((e) => {
        this.logger.error('Unhandled error in returnPlayerToMain:', e);
      });
  };

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(MiniPlayerController) private readonly miniPlayerController: MiniPlayerController,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(PiPWindowHandlers) private readonly pipWindowHandlers: PiPWindowHandlers
  ) {
    this.logger = loggerFactory.create('PiPManager');
  }

  /**
   * Check if PiP window is open
   */
  public isOpen(): boolean {
    return this.pipWindowProvider.getWindow() !== null;
  }

  /**
   * Get PiP window instance
   */
  public getWindow(): Nullable<Window> {
    return this.pipWindowProvider.getWindow();
  }

  /**
   * Open Picture-in-Picture window
   * Critical section: concurrent calls are serialized to prevent race conditions
   */
  public open(): Promise<void> {
    return this.asyncLock.withLock(async () => {
      if (this.isOpen()) {
        this.logger.warn('PiP window already open');
        return;
      }

      this.logger.log('Opening PiP window');

      try {
        await this.movePlayerToPIP();

        const pipWindow = this.pipWindowProvider.getWindow();
        if (pipWindow) {
          const result = await this.pipWindowHandlers.initialize(
            this.miniPlayerController.getMiniplayer()
          );
          if (typeof result === 'function') {
            this.onBeforeReturn = result;
          }
        }
      } catch (error) {
        if (error instanceof PiPCriticalError) {
          throw error;
        }
        throw new PiPError('Error opening PiP', error);
      }
    });
  }

  /**
   * Move player to PiP window
   */
  private async movePlayerToPIP(): Promise<void> {
    const miniplayer = this.miniPlayerController.getMiniplayer();

    // Save mini player state
    this.wasMiniPlayerActiveBeforePiP = this.miniPlayerController.isVisible();

    if (!this.wasMiniPlayerActiveBeforePiP) {
      this.miniPlayerController.toggleMiniPlayer();

      // Wait for mini player container
      await DOMUtils.waitForElementSelector(SELECTORS.MINIPLAYER_CONTAINER);
      this.logger.debug('Mini player container ready');
    }

    // Get dimensions
    const width = miniplayer.offsetWidth || DEFAULT_DIMENSIONS.PIP_WIDTH;
    const height = miniplayer.offsetHeight || DEFAULT_DIMENSIONS.PIP_HEIGHT;

    this.logger.debug(`Requesting PiP window: ${width}x${height}`);

    // Request PiP window
    const dpp = window.documentPictureInPicture;
    if (!dpp) {
      throw new PiPError('Document Picture-in-Picture API not available');
    }

    const ytdApp = this.ytdAppProvider.getApp();

    this.miniPlayerContainer = document.querySelector(SELECTORS.MINIPLAYER_CONTAINER);
    if (!this.miniPlayerContainer) {
      throw new PiPError('miniplayer-container element not found');
    }

    const pipWindow = await dpp.requestWindow({ width, height });
    this.pipWindowProvider.setWindow(pipWindow);

    setTimeout(() => {
      void this.asyncLock.withLock(async () => {
        const win = this.pipWindowProvider.getWindow();
        if (win?.closed) {
          this.logger.warn('phantom window detected, closing');
          this.pipWindowProvider.setWindow(null);
          void this.close();
          return;
        }
      });
    }, TIMEOUTS.PHANTOM_WINDOW_CHECK);
    pipWindow.addEventListener('pagehide', this.close);
    this.logger.log('PiP window opened');

    const pipDoc = pipWindow.document;

    // Copy attributes and styles
    DOMUtils.copyAttributes(document.documentElement, pipDoc.documentElement);
    DOMUtils.copyAttributes(document.body, pipDoc.body);
    StyleUtils.copyStyles(document, pipDoc);
    StyleUtils.injectCSSFixes(pipDoc);

    // Set window title only if PiP was not opened from mini player mode
    // When opened from mini player, title is already set and should not be overwritten
    if (!this.wasMiniPlayerActiveBeforePiP) {
      const title = window.navigator.mediaSession?.metadata?.title || '';
      this.setWindowsTitle(title);
    }

    // Create ytd-app in PiP window
    const pipApp = pipDoc.createElement(SELECTORS.YTD_APP);
    DOMUtils.copyAttributes(ytdApp, pipApp);
    pipDoc.body.appendChild(pipApp);

    // Move mini player to PiP
    this.placeholder = DOMUtils.createPlaceholder('mini_player_placeholder');
    DOMUtils.insertPlaceholderBefore(miniplayer, this.placeholder);

    pipApp.appendChild(miniplayer);

    // Move container to draggable
    const ytDraggable = pipDoc.querySelector(SELECTORS.YT_DRAGGABLE);
    if (!ytDraggable) {
      throw new PiPCriticalError('yt-draggable element not found');
    }
    ytDraggable.prepend(this.miniPlayerContainer);

    DOMUtils.unwrap(ytDraggable);
  }

  /**
   * Return player to main window
   */
  private async returnPlayerToMain(): Promise<void> {
    this.logger.log('Returning player to main window');

    if (!this.placeholder || !this.miniPlayerContainer) {
      this.logger.warn('Placeholder or miniPlayerContainer not found', {
        placeholder: this.placeholder,
        miniPlayerContainer: this.miniPlayerContainer,
      });
      return;
    }

    // Run before-return cleanup (e.g. move context menu back)
    if (this.onBeforeReturn) {
      try {
        await this.onBeforeReturn();
      } catch (e) {
        this.logger.error('Error in onBeforeReturn:', e);
      }
      this.onBeforeReturn = null;
    }

    try {
      await this.movePlayerToMain();
    } catch (error) {
      this.logger.error('Error returning player to main window:', error);
    }

    this.pipWindowProvider.setWindow(null);
  }

  /**
   * Move player back to main window
   */
  private async movePlayerToMain(): Promise<void> {
    const miniplayer = this.miniPlayerController.getMiniplayer();
    if (!this.placeholder || !this.miniPlayerContainer) {
      return;
    }

    // Get player and save state
    const player = this.playerManager.getPlayer();
    this.playerManager.savePlayingState(player);

    // Move mini player back
    DOMUtils.restoreElementFromPlaceholder(miniplayer, this.placeholder);
    this.placeholder = null;

    // Move container back
    const ytDraggable = document.querySelector(SELECTORS.YT_DRAGGABLE);
    if (!ytDraggable) {
      throw new PiPCriticalError('yt-draggable element not found');
    }
    ytDraggable.prepend(this.miniPlayerContainer);

    if (!this.wasMiniPlayerActiveBeforePiP) {
      this.miniPlayerController.toggleMiniPlayer();

      // Wait for main player
      await this.playerManager.waitForMainPlayer();
    }

    // Remove mini player container
    const miniplayerContainer = document.querySelector(SELECTORS.MINIPLAYER_CONTAINER);
    if (miniplayerContainer) {
      miniplayerContainer.remove();
    }

    // Restore playback state
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        this.playerManager.restorePlayingState(player);
        if (this.wasMiniPlayerActiveBeforePiP) {
          this.miniPlayerController.activateMiniPlayer();
          await this.playerManager.waitForMiniPlayer().catch(() => {});
        }
        resolve();
      });
    });
  }

  /**
   * Set window titles
   */
  private setWindowsTitle(title: string): void {
    const pipWindow = this.pipWindowProvider.getWindow();
    if (pipWindow) {
      const notifyRenderer = this.ytdAppProvider.getNotifyRenderer();
      let countNotif = '';
      if (notifyRenderer?.showNotificationCount) {
        countNotif = `(${notifyRenderer.showNotificationCount}) `;
      }

      const newTitle = `${countNotif}${title} - YouTube`;
      document.title = newTitle;
      pipWindow.document.title = newTitle;
      this.logger.debug(`Title synced from MediaSession: ${title}`);
    }
  }

  /**
   * Update window title from media session
   * Skips update if PiP was opened from mini player mode
   */
  public updateTitle(title: string): void {
    // Don't sync title if PiP was opened from mini player mode
    if (!this.wasMiniPlayerActiveBeforePiP) {
      this.setWindowsTitle(title);
    }
  }
}
