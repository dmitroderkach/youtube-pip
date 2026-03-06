import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { inject, injectable } from '../di';
import { YtdAppProvider } from '../core/YtdAppProvider';

/**
 * Miniplayer: listens to click on body and keyup on document; returns focus to player when it moves outside, unless context menu is open.
 * Shorts: listens to keydown/keyup on document and dispatches synthetic events to #shorts-container and ytd-app so keyboard (e.g. arrows) works.
 */
@injectable()
export class DocumentFocusHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;
  private isContextMenuOpen = false;
  private unsubscribeContextMenu: (() => void) | null = null;

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!e.isTrusted) return;
    if (e.key === 'Tab' || e.key === 'Escape') return;
    if (this.isContextMenuOpen) return;
    const ytdApp = this.ytdAppProvider.getApp();
    const opts: KeyboardEventInit = {
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      which: e.which,
      bubbles: true,
      cancelable: true,
      view: e.view,
    };
    ytdApp.dispatchEvent(new KeyboardEvent(e.type, opts));
    this.logger.debug('Dispatched synthetic keyboard event', { type: e.type, key: e.key });
    e.preventDefault();
    e.stopPropagation();
  };

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(ContextMenuHandler) private readonly contextMenuHandler: ContextMenuHandler,
    @inject(YtdAppProvider) private readonly ytdAppProvider: YtdAppProvider
  ) {
    this.logger = loggerFactory.create('DocumentFocusHandler');
  }

  /**
   * Initialize focus observer for PiP window
   */
  public initialize(): void {
    this.pipWindow = this.pipWindowProvider.getWindow();
    if (!this.pipWindow) {
      this.logger.error('PiP window not available for document focus handler');
      return;
    }

    this.pipWindow.document.addEventListener('keydown', this.onKey, true);
    this.pipWindow.document.addEventListener('keyup', this.onKey, true);
    this.unsubscribeContextMenu = this.contextMenuHandler.subscribeContextMenu((visible) => {
      this.isContextMenuOpen = visible;
    });

    this.logger.debug('Document focus handler initialized');
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.unsubscribeContextMenu?.();
    this.unsubscribeContextMenu = null;
    const doc = this.pipWindow?.document;
    if (doc) {
      doc.removeEventListener('keydown', this.onKey, true);
      doc.removeEventListener('keyup', this.onKey, true);
    }
    this.pipWindow = null;
    this.isContextMenuOpen = false;
    this.logger.debug('Document focus handler cleaned up');
  }
}
