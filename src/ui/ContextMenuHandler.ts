import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { MOUSE_BUTTONS, COPY_MENU_INDICES } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { SELECTORS } from '../selectors';
import { PlayerManager } from '../core/PlayerManager';
import { YtdAppProvider } from '../core/YtdAppProvider';
import { YtdShortsProvider } from '../core/YtdShortsProvider';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { CopyType, type Nullable } from '../types/app';
import type { VideoData, PlayerSize, YouTubePlayer } from '../types/youtube';
import { buildCopyPayload } from '../utils/copyPayload';
import { inject, injectable } from '../di';

/**
 * Handles context menu movement between windows and copy commands in PiP.
 * YouTube uses a hidden textarea in the main window for copy; when the menu
 * is moved to the PiP popup that link breaks. We intercept copy menu clicks
 * and copy via a temporary textarea in the PiP document.
 */
export type ContextMenuVisibilityCallback = (visible: boolean) => void;

@injectable()
export class ContextMenuHandler {
  private readonly logger: Logger;
  private visibilityObserver: Nullable<MutationObserver> = null;
  private menuObserver: Nullable<MutationObserver> = null;
  private pipWindow: Nullable<Window> = null;
  private contextMenu: Nullable<HTMLElement> = null;
  private contextMenuPlaceholder: Nullable<Comment> = null;
  private shortsMode = false;
  private readonly visibilitySubscribers = new Set<ContextMenuVisibilityCallback>();

  /**
   * Subscribe to context menu visibility changes.
   * @returns Unsubscribe function
   */
  public subscribeContextMenu(callback: ContextMenuVisibilityCallback): () => void {
    this.visibilitySubscribers.add(callback);
    return () => {
      this.visibilitySubscribers.delete(callback);
    };
  }

  private notifyVisibility(visible: boolean): void {
    this.visibilitySubscribers.forEach((cb) => cb(visible));
  }

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider,
    @inject(YtdShortsProvider) private readonly ytdShortsProvider: YtdShortsProvider,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('ContextMenuHandler');
  }

  /**
   * Capture-phase click handler for copy menu items.
   * Defined as arrow function to preserve `this` binding.
   */
  private handleCopyClick = (e: MouseEvent): void => {
    if (!this.pipWindow) {
      return;
    }

    const doc = this.pipWindow.document;
    const item = (e.target as Element)?.closest(SELECTORS.MENU_ITEM);
    if (!item?.parentElement) {
      this.logger.debug('Copy click: not a menu item or no parent', { item });
      return;
    }

    const items = doc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    const index = Array.prototype.indexOf.call(items, item);
    if (index === -1) {
      this.logger.warn('Copy click: menu item index not found');
      return;
    }

    const copyType = this.getCopyTypeForIndex(this.shortsMode ? index + 1 : index);
    if (!copyType) {
      this.logger.debug('Copy click: not a copy action', { index });
      return;
    }

    if (this.shortsMode && !this.getPlayer()) {
      this.logger.warn('Shorts player not available, cannot copy');
      return;
    }

    let text: string;
    switch (copyType) {
      case CopyType.DEBUG_INFO: {
        text = this.getDebugInfo() ?? '';
        if (!text) {
          this.logger.warn('Debug info not available, cannot copy');
          return;
        }
        break;
      }
      default: {
        const videoData = this.getVideoData();
        const videoId = videoData?.video_id;
        if (!videoId) {
          this.logger.warn('Video ID not found, cannot copy');
          return;
        }
        const playlistId = videoData?.list ?? null;
        const currentTime = this.getCurrentTime();
        const title = videoData?.title ?? '';
        const embedSize = copyType === CopyType.EMBED ? this.getPlayerSize() : null;
        text = this.getCopyPayload({
          videoId,
          playlistId,
          currentTime,
          title,
          copyType,
          embedSize,
          shorts: this.shortsMode,
        });
        if (!text) {
          this.logger.warn('Copy click: empty payload', { copyType });
          return;
        }
        break;
      }
    }

    const ok = DOMUtils.copyViaTextarea(doc, text);
    if (ok) {
      this.logger.debug(`Copied ${copyType} to clipboard`);
    }
  };

  /**
   * Initialize context menu handler.
   * Observes body for style changes on any context menu; when any becomes visible in main window, moves it to PiP.
   * @param shortsMode When true, copy URLs use Shorts format (youtube.com/shorts/ID?feature=share) and data from Shorts player.
   */
  public initialize(shortsMode = false): void {
    this.shortsMode = shortsMode;
    this.pipWindow = this.pipWindowProvider.getWindow();
    if (!this.pipWindow) {
      this.logger.warn('Context menu handler: PiP window not available');
      return;
    }
    this.contextMenuPlaceholder = DOMUtils.createPlaceholder('context_menu_placeholder');
    this.startMonitoring();
    this.setupDismissalHandler();
    this.setupCopyHandler();
    this.logger.log(
      'Context menu handler initialized (observing body for any context menu display changes)'
    );
  }

  /**
   * Observe body; when any context menu's display changes, run move/restore logic.
   */
  private startMonitoring(): void {
    if (!this.pipWindow) {
      return;
    }

    this.visibilityObserver = new MutationObserver(() => {
      if (!this.pipWindow) return;
      this.processContextMenusVisibility();
    });

    this.visibilityObserver.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style'],
    });

    this.processContextMenusVisibility();
  }

  /**
   * Scan all context menus in main document and in PiP; move visible-in-main to PiP, restore hidden-in-PiP to main.
   */
  private processContextMenusVisibility(): void {
    if (!this.pipWindow) return;

    const pipBody = this.pipWindow.document.body;

    if (
      this.contextMenu &&
      this.contextMenu.parentNode === pipBody &&
      this.contextMenu.style.display === 'none'
    ) {
      this.notifyVisibility(false);
      if (this.contextMenuPlaceholder?.parentNode) {
        this.logger.log('Context menu closed in PiP window. Returning to main...');
        DOMUtils.restoreElementFromPlaceholder(this.contextMenu, this.contextMenuPlaceholder);
        this.simulateMainContextMenu();
      }
      this.stopObservingMenu();
      this.contextMenu = null;
      return;
    }

    const menusInMain = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.CONTEXT_MENU));
    for (const menu of menusInMain) {
      if (menu.style.display === 'none') continue;
      this.logger.log('Context menu opened in main window. Intercepting...');
      if (this.contextMenuPlaceholder) {
        DOMUtils.insertPlaceholderBefore(menu, this.contextMenuPlaceholder);
      }
      pipBody.appendChild(menu);
      this.contextMenu = menu;
      this.observeMenu(menu);
      this.notifyVisibility(true);
      return;
    }
  }

  /**
   * Observe the moved menu for style changes (e.g. display:none when closed).
   */
  private observeMenu(menu: HTMLElement): void {
    this.menuObserver?.disconnect();
    this.menuObserver = new MutationObserver(() => {
      if (!this.pipWindow) return;
      this.processContextMenusVisibility();
    });
    this.menuObserver.observe(menu, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  private stopObservingMenu(): void {
    this.menuObserver?.disconnect();
    this.menuObserver = null;
  }

  /**
   * Setup handler to dismiss context menu on click outside
   */
  private setupDismissalHandler(): void {
    if (!this.pipWindow) {
      return;
    }

    const handleEvent = (e: MouseEvent) => {
      const menuInPip = this.pipWindow!.document.querySelector<HTMLElement>(SELECTORS.CONTEXT_MENU);

      if (
        menuInPip &&
        menuInPip.style.display !== 'none' &&
        !(e.target as Element)?.closest(SELECTORS.CONTEXT_MENU_CONTAINER)
      ) {
        e.stopPropagation();
        menuInPip.style.display = 'none';
        this.notifyVisibility(false);
        this.logger.debug('Context menu dismissed');
      }
    };

    this.pipWindow.document.addEventListener('click', handleEvent, true);
    this.pipWindow.document.addEventListener('contextmenu', handleEvent, true);
  }

  /**
   * Setup capture-phase click handler for copy menu items in PiP.
   * Copies via temporary textarea since main-window textarea is disconnected.
   */
  private setupCopyHandler(): void {
    if (!this.pipWindow) {
      return;
    }

    this.pipWindow.document.addEventListener('click', this.handleCopyClick, true);
  }

  private getCopyTypeForIndex(index: number): CopyType | null {
    if (index === COPY_MENU_INDICES.VIDEO_URL) return CopyType.VIDEO_URL;
    if (index === COPY_MENU_INDICES.URL_AT_TIME) return CopyType.URL_AT_TIME;
    if (index === COPY_MENU_INDICES.EMBED) return CopyType.EMBED;
    if (index === COPY_MENU_INDICES.DEBUG_INFO) return CopyType.DEBUG_INFO;
    return null;
  }

  /** Resolve player from Shorts or main window depending on shortsMode. */
  private getPlayer(): Nullable<YouTubePlayer> {
    if (this.shortsMode) {
      return this.ytdShortsProvider.getPlayer();
    }
    return this.playerManager.getPlayer();
  }

  /** Video data from current player source (Shorts or main). */
  private getVideoData(): Nullable<VideoData> {
    if (this.shortsMode) {
      const player = this.ytdShortsProvider.getPlayer();
      return typeof player?.getVideoData === 'function' ? (player.getVideoData() ?? null) : null;
    }
    return this.playerManager.getVideoData();
  }

  /** Current time in seconds from current player source. */
  private getCurrentTime(): number {
    if (this.shortsMode) {
      const player = this.ytdShortsProvider.getPlayer();
      return typeof player?.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
    }
    return this.playerManager.getCurrentTime();
  }

  /** Player dimensions for embed; null if not available. */
  private getPlayerSize(): Nullable<PlayerSize> {
    if (this.shortsMode) {
      const player = this.ytdShortsProvider.getPlayer();
      return typeof player?.getPlayerSize === 'function' ? (player.getPlayerSize() ?? null) : null;
    }
    return this.playerManager.getPlayerSize();
  }

  /** Debug info from current player source. */
  private getDebugInfo(): Nullable<string> {
    if (this.shortsMode) {
      const player = this.ytdShortsProvider.getPlayer();
      return typeof player?.getDebugText === 'function'
        ? (player.getDebugText(true) ?? null)
        : null;
    }
    return this.playerManager.getDebugInfo();
  }

  private getCopyPayload(params: {
    videoId: string;
    playlistId: Nullable<string>;
    currentTime: number;
    title: string;
    copyType: CopyType;
    embedSize?: Nullable<{ width: number; height: number }>;
    shorts?: boolean;
  }): string {
    return buildCopyPayload(params);
  }

  /**
   * Simulate context menu event in main window
   */
  private simulateMainContextMenu(): void {
    const mainApp = this.ytdAppProvider.getApp();

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
      button: MOUSE_BUTTONS.SECONDARY,
    });

    mainApp.dispatchEvent(event);
    this.logger.debug('Synthetic contextmenu event sent to main window');
  }

  /**
   * Stop monitoring and cleanup
   */
  public stop(): void {
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
    this.stopObservingMenu();

    if (this.pipWindow) {
      this.pipWindow.document.removeEventListener('click', this.handleCopyClick, true);
    }

    // Return menu to main window if still in PiP
    if (
      this.contextMenu &&
      this.pipWindow &&
      this.contextMenu.parentNode === this.pipWindow.document.body &&
      this.contextMenuPlaceholder?.parentNode
    ) {
      this.logger.log('Returning context menu to main window');
      DOMUtils.restoreElementFromPlaceholder(this.contextMenu, this.contextMenuPlaceholder);
      this.simulateMainContextMenu();
    }

    this.contextMenu = null;
    this.pipWindow = null;
    this.logger.debug('Context menu handler stopped');
  }
}
