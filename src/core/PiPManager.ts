import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { DOMUtils } from '../utils/DOMUtils';
import { StyleUtils } from '../utils/StyleUtils';
import { AsyncLock } from '../utils/AsyncLock';
import { YouTubeScheduler } from '../utils/YouTubeScheduler';
import { MiniPlayerController } from '../ui/MiniPlayerController';
import { PlayerManager } from './PlayerManager';
import { YtdAppProvider } from './YtdAppProvider';
import { YtdShortsProvider } from './YtdShortsProvider';
import { PipWindowProvider } from './PipWindowProvider';
import { DEFAULT_DIMENSIONS, TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable, PiPCleanupCallback } from '../types/app';
import type { YouTubeShortsElement, YtdPlayerElement } from '../types/youtube';
import { PiPError } from '../errors/PiPError';
import { PiPCriticalError } from '../errors/PiPCriticalError';
import { PiPWindowHandlers } from './PiPWindowHandlers';
import { PipShortsWindowHandlers } from './PipShortsWindowHandlers';
import { inject, injectable } from '../di';

/**
 * Manages Picture-in-Picture window lifecycle
 */
@injectable()
export class PiPManager {
  private readonly logger: Logger;
  private miniPlayerContainer: Nullable<Element> = null;
  private placeholder: Nullable<Comment> = null;

  private onBeforeReturn: Nullable<PiPCleanupCallback> = null;

  private isShortsMode = false;

  private readonly asyncLock = new AsyncLock();

  private close = async (): Promise<void> => {
    const returnMethod = this.isShortsMode
      ? () => this.returnShortsPlayerToMain()
      : () => this.returnPlayerToMain();
    return this.asyncLock.withLock(returnMethod).catch((e) => {
      this.logger.error('Unhandled error in return to main:', e);
    });
  };

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(MiniPlayerController) private readonly miniPlayerController: MiniPlayerController,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(YtdShortsProvider) private readonly ytdShortsProvider: YtdShortsProvider,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(PiPWindowHandlers) private readonly pipWindowHandlers: PiPWindowHandlers,
    @inject(PipShortsWindowHandlers)
    private readonly pipShortsWindowHandlers: PipShortsWindowHandlers
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

      this.isShortsMode = (() => {
        if (!this.ytdShortsProvider.isShortsVisible()) return false;
        const mainPlayer = this.playerManager.getPlayer();
        const mainPlaying = this.playerManager.isPlaying(mainPlayer);
        const shortsPlaying = this.ytdShortsProvider.isShortsPlayerPlaying();
        if (shortsPlaying && !mainPlaying) return true;
        if (mainPlaying) return false;
        return true;
      })();

      try {
        if (this.isShortsMode) {
          this.logger.debug('Opening PiP window for Shorts');
          await this.moveShortsPlayerToPip();
        } else {
          this.logger.debug('Opening PiP window for Player');
          await this.movePlayerToPIP();
        }

        const pipWindow = this.pipWindowProvider.getWindow();
        if (pipWindow) {
          const result = this.isShortsMode
            ? await this.pipShortsWindowHandlers.initialize()
            : await this.pipWindowHandlers.initialize(this.miniPlayerController.getMiniplayer());
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
   * Move player to PiP window (miniplayer flow)
   */
  private async movePlayerToPIP(): Promise<void> {
    const miniplayer = this.miniPlayerController.getMiniplayer();

    // Save mini player state
    this.playerManager.setWasMiniPlayerActiveBeforePiP(this.miniPlayerController.isVisible());

    if (!this.playerManager.getWasMiniPlayerActiveBeforePiP()) {
      this.playerManager.saveMainPlayerTimeBeforeOpenPiP();
      // Let YouTube run pending low-priority jobs first: with kevlar_watch_while_v2 a delayed watch-while job
      // built from the stale "player visible" entry would deactivate the mini player we activate now.
      await YouTubeScheduler.waitForLowPriorityJobs();
      this.miniPlayerController.toggleMiniPlayer();

      // Wait for mini player container and for YouTube to move the player into it: the container can
      // appear first (CoW player), and moving an empty container leaves PiP black.
      const container = await DOMUtils.waitForElementSelector(SELECTORS.MINIPLAYER_CONTAINER);
      await DOMUtils.waitForElementSelector(SELECTORS.MOVIE_PLAYER, container);
      this.playerManager.restoreMainPlayerIfShortsStolePlayback();
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

    // Create ytd-app in PiP window
    const pipApp = pipDoc.createElement(SELECTORS.YTD_APP);
    DOMUtils.copyAttributes(ytdApp, pipApp);
    pipDoc.body.appendChild(pipApp);

    // Park the player in PiP first with YouTube's own move, so CoW player components survive
    const parked = await this.parkYtdPlayer(this.miniPlayerContainer, pipDoc);

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

    await this.unparkYtdPlayer(parked);
  }

  /**
   * Move Shorts player to PiP window
   */
  private async moveShortsPlayerToPip(): Promise<void> {
    this.playerManager.setWasMiniPlayerActiveBeforePiP(false);
    const dpp = window.documentPictureInPicture;
    if (!dpp) {
      throw new PiPError('Document Picture-in-Picture API not available');
    }

    const ytdApp = this.ytdAppProvider.getApp();
    const shorts = document.querySelector<YouTubeShortsElement>(SELECTORS.YTD_SHORTS);
    if (!shorts) {
      throw new PiPError('ytd-shorts element not found');
    }
    this.ytdShortsProvider.setShorts(shorts);
    this.ytdShortsProvider.hideAllEngagementPanelSections();
    const aspectRatio = Number(shorts.getAspectRatio?.().split(': ')?.[1]);
    let width = DEFAULT_DIMENSIONS.PIP_SHORTS_WIDTH;
    if (!isNaN(aspectRatio)) {
      width = aspectRatio * DEFAULT_DIMENSIONS.PIP_SHORTS_HEIGHT;
      this.logger.debug(`Setting width to ${width} based on aspect ratio ${aspectRatio}`);
    }

    const pipWindow = await dpp.requestWindow({
      width,
      height: DEFAULT_DIMENSIONS.PIP_SHORTS_HEIGHT,
    });
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

    DOMUtils.copyAttributes(document.documentElement, pipDoc.documentElement);
    DOMUtils.copyAttributes(document.body, pipDoc.body);
    StyleUtils.copyStyles(document, pipDoc);
    StyleUtils.injectCSSFixes(pipDoc);

    const pipApp = pipDoc.createElement(SELECTORS.YTD_APP);
    DOMUtils.copyAttributes(ytdApp, pipApp);
    pipDoc.body.appendChild(pipApp);

    this.placeholder = DOMUtils.createPlaceholder('shorts_placeholder');
    DOMUtils.insertPlaceholderBefore(shorts, this.placeholder);

    // Park the Shorts player first with YouTube's own move, so CoW player components survive
    const parked = await this.parkYtdPlayer(shorts, pipDoc, SELECTORS.SHORTS_PLAYER);
    this.ytdShortsProvider.lockLoadVideo();
    pipApp.appendChild(shorts);
    await this.unparkYtdPlayer(parked);
    if (!shorts.dispatch) {
      this.logger.warn('shorts.dispatch not found');
      return;
    }
    shorts.dispatch({ payload: { shortsLayout: 0 }, type: 'SET_SHORTS_LAYOUT' });
  }

  /**
   * Return player to main window (miniplayer flow)
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
   * Return Shorts player to main window
   */
  private async returnShortsPlayerToMain(): Promise<void> {
    this.logger.log('Returning Shorts player to main window');

    if (!this.placeholder) {
      this.logger.warn('Placeholder not found for Shorts return');
      this.pipWindowProvider.setWindow(null);
      return;
    }

    if (this.onBeforeReturn) {
      try {
        await this.onBeforeReturn();
      } catch (e) {
        this.logger.error('Error in onBeforeReturn:', e);
      }
      this.onBeforeReturn = null;
    }

    const shorts = this.ytdShortsProvider.getShorts();

    if (shorts) {
      const parked = await this.parkYtdPlayer(shorts, document, SELECTORS.SHORTS_PLAYER);
      this.ytdShortsProvider.lockLoadVideo();
      DOMUtils.restoreElementFromPlaceholder(shorts, this.placeholder);
      await this.unparkYtdPlayer(parked);
      shorts.player?.setSize?.();
      shorts.player?.setInternalSize?.();
    } else {
      throw new PiPCriticalError('Shorts element not found in PiP window');
    }
    this.placeholder = null;
    this.ytdShortsProvider.setShorts(null);

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

    // Park the player in the main document first with YouTube's own move (CoW-safe)
    const parked = await this.parkYtdPlayer(this.miniPlayerContainer, document);

    // Move mini player back
    DOMUtils.restoreElementFromPlaceholder(miniplayer, this.placeholder);
    this.placeholder = null;

    // Move container back
    const ytDraggable = document.querySelector(SELECTORS.YT_DRAGGABLE);
    if (!ytDraggable) {
      throw new PiPCriticalError('yt-draggable element not found');
    }
    ytDraggable.prepend(this.miniPlayerContainer);

    // Put the player back into its slot before YouTube (toggle to full player) looks for it there
    await this.unparkYtdPlayer(parked);

    if (!this.playerManager.getWasMiniPlayerActiveBeforePiP()) {
      this.miniPlayerController.toggleMiniPlayer();

      // Wait for main player
      await this.playerManager.waitForMainPlayer();
    }

    // Restore playback state
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        this.playerManager.restorePlayingState(player);
        if (this.playerManager.getWasMiniPlayerActiveBeforePiP()) {
          this.miniPlayerController.activateMiniPlayer();
          await this.playerManager.waitForMiniPlayer().catch(() => {});
          // The mini player (a CoW component) re-rendered after the move and has its own fresh player
          // container; the player belongs there, not in our old one.
          await this.moveIntoLiveMiniplayerContainer(miniplayer);
        }
        resolve();
      });
    });

    this.removeOldContainerIfEmpty();
  }

  /**
   * After returning to the mini player, YouTube renders a fresh ytd-miniplayer-player-container next to
   * our old one. Move ytd-player into the fresh one (unless YouTube already did) so there is a single,
   * YouTube-managed container; otherwise both stay visible and the layout breaks.
   */
  private async moveIntoLiveMiniplayerContainer(miniplayer: Element): Promise<void> {
    const old = this.miniPlayerContainer;
    const ytdPlayer = old?.querySelector<YtdPlayerElement>(SELECTORS.YTD_PLAYER);
    if (!old || !ytdPlayer) {
      return;
    }
    const live = Array.from(miniplayer.querySelectorAll(SELECTORS.MINIPLAYER_CONTAINER)).find(
      (c) => c !== old
    );
    const slot = live?.querySelector(SELECTORS.MINIPLAYER_PLAYER_SLOT);
    if (!slot) {
      this.logger.debug('No fresh mini player container; keeping the player in ours');
      return;
    }
    await this.moveYtdPlayer(ytdPlayer, slot);
  }

  /** Drop our old mini player container once the player has left it; never while the player is inside. */
  private removeOldContainerIfEmpty(): void {
    const old = this.miniPlayerContainer;
    if (!old?.isConnected) {
      return;
    }
    if (old.querySelector(SELECTORS.MOVIE_PLAYER)) {
      this.logger.debug('Player is still inside our mini player container; keeping it');
      return;
    }
    old.remove();
  }

  /**
   * Move ytd-player out of the mini player container into a temporary holder in `targetDoc`.
   * The mini player and (with kevlar_player_cow_player_component_*) the player are YouTube "CoW"
   * components: a plain DOM move disconnects them, they dispose and drop #movie_player, and a fresh
   * empty player is rendered instead (video and position lost). ytd-player.appendTo() is YouTube's own
   * move that marks it as a reparent, so the player survives. Returns what unparkYtdPlayer needs.
   */
  private async parkYtdPlayer(
    root: Element,
    targetDoc: Document,
    playerSelector: string = SELECTORS.MOVIE_PLAYER
  ): Promise<Nullable<{ ytdPlayer: YtdPlayerElement; slot: Element; holder: HTMLElement }>> {
    const ytdPlayer =
      root.querySelector(playerSelector)?.closest<YtdPlayerElement>(SELECTORS.YTD_PLAYER) ?? null;
    const slot = ytdPlayer?.parentElement;
    if (!ytdPlayer || !slot || !root.contains(ytdPlayer)) {
      this.logger.debug('ytd-player not found; moving element as is');
      return null;
    }
    const holder = targetDoc.createElement('div');
    targetDoc.body.appendChild(holder);
    await this.moveYtdPlayer(ytdPlayer, holder);
    return { ytdPlayer, slot, holder };
  }

  /** Move the parked ytd-player back into its slot (now in its new document) and drop the holder. */
  private async unparkYtdPlayer(
    parked: Nullable<{ ytdPlayer: YtdPlayerElement; slot: Element; holder: HTMLElement }>
  ): Promise<void> {
    if (!parked) {
      return;
    }
    await this.moveYtdPlayer(parked.ytdPlayer, parked.slot);
    parked.holder.remove();
  }

  private async moveYtdPlayer(ytdPlayer: YtdPlayerElement, target: Element): Promise<void> {
    if (typeof ytdPlayer.appendTo === 'function') {
      try {
        await ytdPlayer.appendTo(target);
        if (ytdPlayer.parentElement === target) {
          return;
        }
        this.logger.warn(
          'ytd-player.appendTo did not move the player; falling back to appendChild'
        );
      } catch (e) {
        this.logger.warn('ytd-player.appendTo failed; falling back to appendChild', e);
      }
    }
    target.appendChild(ytdPlayer);
  }
}
