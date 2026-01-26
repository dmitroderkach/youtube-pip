import { Logger } from '../logger';
import { DOMUtils } from '../utils/DOMUtils';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('ContextMenuHandler');

/**
 * Handles context menu movement between windows
 */
export class ContextMenuHandler {
  private visibilityObserver: Nullable<MutationObserver> = null;
  private pipWindow: Nullable<Window> = null;
  private contextMenu: Nullable<Element> = null;
  private contextMenuPlaceholder: Nullable<Comment> = null;

  /**
   * Initialize context menu handler
   */
  public async initialize(pipWindow: Window): Promise<void> {
    this.pipWindow = pipWindow;
    this.contextMenuPlaceholder = DOMUtils.createPlaceholder('context_menu_placeholder');

    // Wait for context menu to appear
    try {
      this.contextMenu = await DOMUtils.waitForElementSelector(
        SELECTORS.CONTEXT_MENU,
        document,
        0,
        pipWindow
      );

      logger.log('Context menu element found, starting visibility monitoring');

      this.startMonitoring();
      this.setupDismissalHandler();
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

      const isVisible = (this.contextMenu as HTMLElement).style.display !== 'none';
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
    if ((this.contextMenu as HTMLElement).style.display !== 'none') {
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
      const menuInPip = this.pipWindow!.document.querySelector(SELECTORS.CONTEXT_MENU);

      if (
        menuInPip &&
        (menuInPip as HTMLElement).style.display !== 'none' &&
        !(e.target as Element)?.closest(SELECTORS.CONTEXT_MENU_CONTAINER)
      ) {
        e.stopPropagation();
        (menuInPip as HTMLElement).style.display = 'none';
        logger.debug('Context menu dismissed');
      }
    };

    this.pipWindow.document.addEventListener('click', handleEvent, true);
    this.pipWindow.document.addEventListener('contextmenu', handleEvent, true);
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
      button: 2, // Right mouse button
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
