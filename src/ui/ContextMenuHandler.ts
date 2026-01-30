import { Logger } from '../logger';
import { TIMEOUTS, MOUSE_BUTTONS, COPY_MENU_INDICES } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { SELECTORS } from '../selectors';
import { PlayerManager } from '../core/PlayerManager';
import { CopyType, type Nullable } from '../types/app';

const logger = Logger.getInstance('ContextMenuHandler');

/**
 * Handles context menu movement between windows and copy commands in PiP.
 * YouTube uses a hidden textarea in the main window for copy; when the menu
 * is moved to the PiP popup that link breaks. We intercept copy menu clicks
 * and copy via a temporary textarea in the PiP document.
 */
export class ContextMenuHandler {
  private visibilityObserver: Nullable<MutationObserver> = null;
  private pipWindow: Nullable<Window> = null;
  private contextMenu: Nullable<HTMLElement> = null;
  private contextMenuPlaceholder: Nullable<Comment> = null;
  private readonly playerManager: PlayerManager;

  constructor(playerManager: PlayerManager) {
    this.playerManager = playerManager;
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
    const item = (e.target as Element)?.closest('.ytp-menuitem');
    if (!item?.parentElement) {
      logger.debug('Copy click: not a menu item or no parent', { item });
      return;
    }

    const items = doc.querySelectorAll(SELECTORS.PANEL_MENU_ITEMS);
    const index = Array.prototype.indexOf.call(items, item);
    if (index === -1) {
      logger.warn('Copy click: menu item index not found');
      return;
    }

    const copyType = this.getCopyTypeForIndex(index);
    if (!copyType) {
      logger.debug('Copy click: not a copy action', { index });
      return;
    }

    let text: string;
    switch (copyType) {
      case CopyType.DEBUG_INFO: {
        text = this.playerManager.getDebugInfoFromDocument(doc) ?? '';
        if (!text) {
          logger.warn('Debug info not available, cannot copy');
          return;
        }
        break;
      }
      default: {
        const videoData = this.playerManager.getVideoDataFromDocument(doc);
        const videoId = videoData?.video_id;
        if (!videoId) {
          logger.warn('Video ID not found, cannot copy');
          return;
        }
        const playlistId = videoData?.list ?? null;
        const currentTime = this.playerManager.getCurrentTimeFromDocument(doc);
        const title = videoData?.title ?? '';
        const embedSize =
          copyType === CopyType.EMBED ? this.playerManager.getPlayerSizeFromDocument(doc) : null;
        text = this.getCopyPayload({
          videoId,
          playlistId,
          currentTime,
          title,
          copyType,
          embedSize,
        });
        if (!text) {
          logger.warn('Copy click: empty payload', { copyType });
          return;
        }
        break;
      }
    }

    const ok = DOMUtils.copyViaTextarea(doc, text);
    if (ok) {
      logger.debug(`Copied ${copyType} to clipboard`);
    }
  };

  /**
   * Initialize context menu handler
   */
  public async initialize(pipWindow: Window): Promise<void> {
    this.pipWindow = pipWindow;
    this.contextMenuPlaceholder = DOMUtils.createPlaceholder('context_menu_placeholder');

    // Wait for context menu to appear
    try {
      this.contextMenu = await DOMUtils.waitForElementSelector<HTMLElement>(
        SELECTORS.CONTEXT_MENU,
        document,
        TIMEOUTS.ELEMENT_WAIT_INFINITE,
        pipWindow
      );

      logger.log('Context menu element found, starting visibility monitoring');

      this.startMonitoring();
      this.setupDismissalHandler();
      this.setupCopyHandler();
    } catch (e) {
      logger.warn('Error initializing context menu handler:', e);
    }
  }

  /**
   * Start monitoring context menu visibility
   */
  private startMonitoring(): void {
    if (!this.contextMenu || !this.pipWindow) {
      return;
    }

    this.visibilityObserver = new MutationObserver(() => {
      if (!this.contextMenu || !this.pipWindow) {
        return;
      }

      const isVisible = this.contextMenu.style.display !== 'none';
      const isInMainWindow = this.contextMenu.parentNode !== this.pipWindow.document.body;

      if (isVisible && isInMainWindow) {
        logger.log('Context menu opened in main window. Intercepting...');

        if (this.contextMenuPlaceholder) {
          DOMUtils.insertPlaceholderBefore(this.contextMenu, this.contextMenuPlaceholder);
        }
        this.pipWindow.document.body.appendChild(this.contextMenu);
      } else if (!isVisible && this.contextMenu.parentNode === this.pipWindow.document.body) {
        if (this.contextMenuPlaceholder?.parentNode) {
          logger.log('Context menu closed in PiP window. Returning to main...');
          DOMUtils.restoreElementFromPlaceholder(this.contextMenu, this.contextMenuPlaceholder);
          this.simulateMainContextMenu();
        }
      }
    });

    // Observe style attribute changes
    this.visibilityObserver.observe(this.contextMenu, {
      attributes: true,
      attributeFilter: ['style'],
    });

    // Move menu immediately if already visible
    if (this.contextMenu.style.display !== 'none') {
      if (this.contextMenuPlaceholder) {
        DOMUtils.insertPlaceholderBefore(this.contextMenu, this.contextMenuPlaceholder);
      }
      this.pipWindow.document.body.appendChild(this.contextMenu);
    }

    // Cleanup is done via PiPManager.onBeforeReturn
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
        logger.debug('Context menu dismissed');
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

  private getCopyPayload(params: {
    videoId: string;
    playlistId: Nullable<string>;
    currentTime: number;
    title: string;
    copyType: CopyType;
    embedSize?: Nullable<{ width: number; height: number }>;
  }): string {
    const { videoId, playlistId, currentTime, title, copyType, embedSize } = params;
    const base = `https://youtu.be/${videoId}`;
    const listPart = playlistId ? `?list=${playlistId}` : '';
    const tPart = currentTime > 0 ? (listPart ? `&t=${currentTime}s` : `?t=${currentTime}s`) : '';

    switch (copyType) {
      case CopyType.VIDEO_URL:
        return listPart ? `${base}${listPart}` : base;
      case CopyType.URL_AT_TIME:
        return `${base}${listPart}${tPart}`;
      case CopyType.EMBED: {
        const w = embedSize?.width ?? 400;
        const h = embedSize?.height ?? 225;
        const src = `https://www.youtube.com/embed/${videoId}${playlistId ? `?list=${playlistId}` : ''}`;
        const safeTitle = title.replace(/"/g, '&quot;');
        return `<iframe width="${w}" height="${h}" src="${src}" title="${safeTitle}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
      }
      default:
        return '';
    }
  }

  /**
   * Simulate context menu event in main window
   */
  private simulateMainContextMenu(): void {
    const mainApp = document.querySelector(SELECTORS.YTD_APP);
    if (!mainApp) {
      return;
    }

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: 0,
      clientY: 0,
      button: MOUSE_BUTTONS.SECONDARY,
    });

    mainApp.dispatchEvent(event);
    logger.debug('Synthetic contextmenu event sent to main window');
  }

  /**
   * Stop monitoring and cleanup
   */
  public stop(): void {
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }

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
      logger.log('Returning context menu to main window');
      DOMUtils.restoreElementFromPlaceholder(this.contextMenu, this.contextMenuPlaceholder);
      this.simulateMainContextMenu();
    }

    this.pipWindow = null;
    logger.debug('Context menu handler stopped');
  }
}
