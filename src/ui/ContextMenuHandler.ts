import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { MOUSE_BUTTONS, COPY_MENU_INDICES, KEYS } from '../constants';
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
    if (!ok) {
      // Let YouTube's own handler run: it falls back to showing the text in a sub-panel.
      return;
    }
    this.logger.debug(`Copied ${copyType} to clipboard`);
    // Stop YouTube's copy handler. It copies via execCommand in the main document, which fails
    // while the user interacts with the PiP window; on failure YouTube keeps the menu open, shows
    // the text in a sub-panel and permanently switches the items to "Get …". Close the menu ourselves.
    e.stopPropagation();
    const menu = item.closest<HTMLElement>(SELECTORS.CONTEXT_MENU_CONTAINER);
    if (menu) {
      this.dismissMenu(menu);
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
        this.simulateContextMenu(this.ytdAppProvider.getApp());
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
      this.fitMenuIntoPip(menu);
      this.contextMenu = menu;
      this.observeMenu(menu);
      this.notifyVisibility(true);
      return;
    }
  }

  /**
   * YouTube sizes and clamps the menu for the window it believes it is in. Without web_watch_pip /
   * web_shorts_pip that is the main window, so once moved into PiP the menu sits at the cursor with its
   * main-window size and can overflow the PiP window (scrollbars). Shrink it to the PiP window and shift it
   * left/up to fit, the same way YouTube sizes and places the menu when it opens inside PiP.
   */
  private fitMenuIntoPip(menu: HTMLElement): void {
    if (!this.pipWindow) {
      return;
    }
    const { innerWidth: viewportWidth, innerHeight: viewportHeight } = this.pipWindow;
    const rect = menu.getBoundingClientRect();
    if (!viewportWidth || !viewportHeight || !rect.width || !rect.height) {
      return;
    }
    const width = Math.min(rect.width, viewportWidth);
    const height = Math.min(rect.height, viewportHeight);
    if (width < rect.width) {
      this.setMenuSize(menu, 'width', width);
    }
    if (height < rect.height) {
      this.setMenuSize(menu, 'height', height);
    }
    const left = Math.max(0, Math.min(rect.left, viewportWidth - width));
    const top = Math.max(0, Math.min(rect.top, viewportHeight - height));
    if (left !== rect.left) {
      menu.style.left = `${left}px`;
    }
    if (top !== rect.top) {
      menu.style.top = `${top}px`;
    }
  }

  /** YouTube sets the size inline on the popup, its panels and (height only) the panel menu; update them together. */
  private setMenuSize(menu: HTMLElement, dimension: 'width' | 'height', px: number): void {
    const selector =
      dimension === 'width' ? SELECTORS.PANEL : `${SELECTORS.PANEL}, ${SELECTORS.PANEL_MENU}`;
    const targets = [menu, ...Array.from(menu.querySelectorAll<HTMLElement>(selector))];
    for (const el of targets) {
      el.style[dimension] = `${px}px`;
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
   * Setup handlers to dismiss the context menu in PiP: click / right-click outside it, and Escape.
   */
  private setupDismissalHandler(): void {
    if (!this.pipWindow) {
      return;
    }

    const handlePointer = (e: MouseEvent) => {
      const menuInPip = this.getVisibleMenuInPip();
      if (menuInPip && !(e.target as Element)?.closest(SELECTORS.CONTEXT_MENU_CONTAINER)) {
        e.stopPropagation();
        this.dismissMenu(menuInPip);
      }
    };

    // YouTube closes its popups on Escape only via a keydown listener on the menu element itself,
    // so it does nothing when focus stayed on the player/body (common in PiP, and focus is lost when
    // the menu is moved between documents). Bubble phase: if YouTube handled it, it prevented default.
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== KEYS.ESCAPE || e.defaultPrevented) {
        return;
      }
      const menuInPip = this.getVisibleMenuInPip();
      if (menuInPip) {
        e.preventDefault();
        this.dismissMenu(menuInPip);
      }
    };

    this.pipWindow.document.addEventListener('click', handlePointer, true);
    this.pipWindow.document.addEventListener('contextmenu', handlePointer, true);
    this.pipWindow.document.addEventListener('keydown', handleKeydown);
  }

  /** First context menu in the PiP document that is currently shown (Shorts + watch can each have one). */
  private getVisibleMenuInPip(): Nullable<HTMLElement> {
    if (!this.pipWindow) {
      return null;
    }
    const menus = this.pipWindow.document.querySelectorAll<HTMLElement>(SELECTORS.CONTEXT_MENU);
    return Array.from(menus).find((menu) => menu.style.display !== 'none') ?? null;
  }

  /**
   * Hide the context menu in PiP and reset YouTube's "menu open" state.
   * We hide the menu directly, so the player still thinks it is open. With web_watch_pip /
   * web_shorts_pip the menu and its "outside contextmenu" close listener live in the PiP
   * document; without the reset the next right-click shows the browser's native menu.
   */
  private dismissMenu(menu: HTMLElement): void {
    if (!this.pipWindow) {
      return;
    }
    menu.style.display = 'none';
    this.notifyVisibility(false);
    this.simulateContextMenu(this.pipWindow.document.body);
    this.logger.debug('Context menu dismissed');
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
   * Dispatch a synthetic contextmenu outside the YouTube menu. The player's context menu listens
   * for contextmenu on its document while open and closes itself (resetting its "open" state)
   * when one lands outside the menu. Used on the main ytd-app (menu returned to main) and on the
   * PiP body (menu dismissed in PiP).
   */
  private simulateContextMenu(target: EventTarget): void {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
      button: MOUSE_BUTTONS.SECONDARY,
    });

    target.dispatchEvent(event);
    this.logger.debug('Synthetic contextmenu event sent to reset YouTube context menu state');
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
      this.simulateContextMenu(this.ytdAppProvider.getApp());
    }

    this.contextMenu = null;
    this.pipWindow = null;
    this.logger.debug('Context menu handler stopped');
  }
}
