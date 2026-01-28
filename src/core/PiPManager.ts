import { Logger } from '../logger';
import { DOMUtils } from '../utils/DOMUtils';
import { StyleUtils } from '../utils/StyleUtils';
import { MiniPlayerController } from '../ui/MiniPlayerController';
import { PlayerManager } from './PlayerManager';
import { NavigationHandler } from './NavigationHandler';
import { DEFAULT_DIMENSIONS, TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import { MiniPlayerElement, YouTubePlayer } from '../types/youtube';
import type { Nullable, PiPCleanupCallback, PiPWindowReadyCallback } from '../types/app';

const logger = Logger.getInstance('PiPManager');

/**
 * Manages Picture-in-Picture window lifecycle
 */
export class PiPManager {
  private pipWindow: Nullable<Window> = null;
  private miniplayer: Nullable<MiniPlayerElement> = null;
  private miniPlayerContainer: Nullable<Element> = null;
  private placeholder: Nullable<Comment> = null;
  private wasMiniPlayerActiveBeforePiP: boolean = false;

  private miniPlayerController: MiniPlayerController;
  private playerManager: PlayerManager;
  private navigationHandler: NavigationHandler;

  private onWindowReady: PiPWindowReadyCallback;
  private onBeforeReturn: Nullable<PiPCleanupCallback> = null;

  constructor(
    miniPlayerController: MiniPlayerController,
    playerManager: PlayerManager,
    navigationHandler: NavigationHandler,
    onWindowReady: PiPWindowReadyCallback
  ) {
    this.miniPlayerController = miniPlayerController;
    this.playerManager = playerManager;
    this.navigationHandler = navigationHandler;
    this.onWindowReady = onWindowReady;
  }

  /**
   * Check if PiP window is open
   */
  public isOpen(): boolean {
    return this.pipWindow !== null && !this.pipWindow.closed;
  }

  /**
   * Get PiP window instance
   */
  public getWindow(): Nullable<Window> {
    return this.pipWindow;
  }

  /**
   * Open Picture-in-Picture window
   */
  public async open(): Promise<void> {
    if (this.isOpen()) {
      logger.warn('PiP window already open');
      return;
    }

    logger.log('Opening PiP window');

    try {
      await this.movePlayerToPIP();

      if (this.pipWindow && this.miniplayer) {
        this.pipWindow.addEventListener('pagehide', () => this.returnPlayerToMain());
        this.navigationHandler.initialize(this.pipWindow);

        const result = await this.onWindowReady(this.pipWindow, this.miniplayer);
        if (typeof result === 'function') {
          this.onBeforeReturn = result;
        }
      }
    } catch (error) {
      logger.error('Error opening PiP:', error);
      throw error;
    }
  }

  /**
   * Move player to PiP window
   */
  private async movePlayerToPIP(): Promise<void> {
    // Find mini player element
    this.miniplayer = document.querySelector(SELECTORS.MINIPLAYER) as MiniPlayerElement;
    if (!this.miniplayer) {
      throw new Error('Mini player element not found');
    }

    // Save mini player state
    this.wasMiniPlayerActiveBeforePiP = this.miniPlayerController.isVisible();

    // Show mini player using keyboard toggle (force show even if visible)
    this.miniPlayerController.toggleMiniPlayerViaKeyboard(true);

    // Wait for mini player container
    await DOMUtils.waitForElementSelector(SELECTORS.MINIPLAYER_CONTAINER);
    logger.debug('Mini player container ready');

    // Get dimensions
    const width = this.miniplayer.offsetWidth || DEFAULT_DIMENSIONS.PIP_WIDTH;
    const height = this.miniplayer.offsetHeight || DEFAULT_DIMENSIONS.PIP_HEIGHT;

    logger.debug(`Requesting PiP window: ${width}x${height}`);

    // Request PiP window
    const dpp = window.documentPictureInPicture;
    if (!dpp) {
      throw new Error('Document Picture-in-Picture API not available');
    }

    this.pipWindow = await dpp.requestWindow({ width, height });
    logger.log('PiP window opened');

    const pipDoc = this.pipWindow.document;

    // Copy attributes and styles
    DOMUtils.copyAttributes(document.documentElement, pipDoc.documentElement);
    DOMUtils.copyAttributes(document.body, pipDoc.body);
    StyleUtils.copyStyles(document, pipDoc);
    StyleUtils.injectCSSFixes(pipDoc);

    // Set window title
    const title = window.navigator.mediaSession?.metadata?.title || '';
    this.setWindowsTitle(title);

    // Create ytd-app in PiP window
    const ytdApp = document.querySelector(SELECTORS.YTD_APP);
    if (ytdApp && this.pipWindow) {
      const newApp = pipDoc.createElement('ytd-app');
      DOMUtils.copyAttributes(ytdApp, newApp);
      pipDoc.body.appendChild(newApp);
    }

    // Move mini player to PiP
    this.miniPlayerContainer = document.querySelector(SELECTORS.MINIPLAYER_CONTAINER);
    this.placeholder = DOMUtils.createPlaceholder('mini_player_placeholder');
    DOMUtils.insertPlaceholderBefore(this.miniplayer, this.placeholder);

    const pipApp = this.pipWindow.document.querySelector(SELECTORS.YTD_APP);
    if (pipApp && this.miniplayer) {
      pipApp.appendChild(this.miniplayer);
    }

    // Move container to draggable
    const ytDraggable = pipDoc.querySelector(SELECTORS.YT_DRAGGABLE);
    if (ytDraggable && this.miniPlayerContainer) {
      ytDraggable.prepend(this.miniPlayerContainer);
    }

    DOMUtils.unwrap(ytDraggable);

    // Focus video player
    const videoPlayer = pipDoc.querySelector(SELECTORS.HTML5_VIDEO_PLAYER);
    if (
      videoPlayer &&
      'focus' in videoPlayer &&
      typeof (videoPlayer as HTMLElement).focus === 'function'
    ) {
      (videoPlayer as HTMLElement).focus();
    }
  }

  /**
   * Return player to main window
   */
  private async returnPlayerToMain(): Promise<void> {
    logger.log('Returning player to main window');

    if (!this.placeholder || !this.miniplayer) {
      logger.warn('Placeholder or miniplayer not found');
      return;
    }

    // Run before-return cleanup (e.g. move context menu back)
    if (this.onBeforeReturn) {
      try {
        await this.onBeforeReturn();
      } catch (e) {
        logger.error('Error in onBeforeReturn:', e);
      }
      this.onBeforeReturn = null;
    }

    await this.movePlayerToMain();

    this.pipWindow = null;
    this.navigationHandler.cleanup();
  }

  /**
   * Move player back to main window
   */
  private async movePlayerToMain(): Promise<void> {
    if (!this.placeholder || !this.miniplayer) {
      return;
    }

    // Get player and save state
    const player = this.miniplayer.querySelector(SELECTORS.MOVIE_PLAYER) as Nullable<YouTubePlayer>;
    this.playerManager.savePlayingState(player);

    // Move mini player back
    DOMUtils.restoreElementFromPlaceholder(this.miniplayer, this.placeholder);
    this.placeholder = null;

    // Move container back
    const ytDraggable = document.querySelector(SELECTORS.YT_DRAGGABLE);
    if (ytDraggable && this.miniPlayerContainer) {
      ytDraggable.prepend(this.miniPlayerContainer);
    }

    if (!this.wasMiniPlayerActiveBeforePiP) {
      // Show mini player using keyboard toggle (force show even if visible)
      this.miniPlayerController.toggleMiniPlayerViaKeyboard(true);

      // Wait for main player
      await this.playerManager.waitForMainPlayer();
    }

    // Remove mini player container
    const miniplayerContainer = document.querySelector(SELECTORS.MINIPLAYER_CONTAINER);
    if (miniplayerContainer) {
      miniplayerContainer.remove();
    }

    // Restore playback state
    setTimeout(async () => {
      await this.playerManager.restorePlayingState(player);

      // Restore mini player if it was active before
      if (this.wasMiniPlayerActiveBeforePiP) {
        let countTries = 0;
        while (countTries < 5) {
          logger.debug(`Attempting to switch to miniplayer mode, attempt ${countTries + 1}`);
          this.miniPlayerController.activateMiniPlayer();

          const miniplayerContainer = await DOMUtils.waitForElementSelector(
            SELECTORS.MINIPLAYER_HOST,
            document,
            TIMEOUTS.MENU_RETRY_DELAY
          ).catch(() => null);

          if (miniplayerContainer) {
            logger.debug('Miniplayer mode restored');
            break;
          }

          countTries++;
          if (countTries === 5) {
            logger.error('Failed to switch to miniplayer mode after all attempts');
          }
        }
      }
    });
  }

  /**
   * Set window titles
   */
  private setWindowsTitle(title: string): void {
    const newTitle = `${title} - YouTube`;
    if (this.pipWindow) {
      document.title = newTitle;
      this.pipWindow.document.title = newTitle;
      logger.debug(`Title synced from MediaSession: ${title}`);
    }
  }

  /**
   * Update window title from media session
   */
  public updateTitle(title: string): void {
    this.setWindowsTitle(title);
  }
}
