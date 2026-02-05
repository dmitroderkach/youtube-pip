import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { inject, injectable } from '../di';

/**
 * Observes focus changes in PiP window — returns focus to player when it leaves.
 * Pauses when context menu is open; returns focus when menu closes.
 */
@injectable()
export class DocumentFocusHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;
  private isContextMenuOpen = false;
  private unsubscribeContextMenu: (() => void) | null = null;

  private readonly handleFocusIn = (e: FocusEvent): void => {
    if (!this.pipWindow || this.isContextMenuOpen) return;

    const player = this.playerManager.getPlayer();
    const target = e.target as Node | null;
    if (!target || player.contains(target) || target === player) {
      return;
    }
    this.returnFocusToPlayer();
  };

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider,
    @inject(ContextMenuHandler) private readonly contextMenuHandler: ContextMenuHandler
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

    this.unsubscribeContextMenu = this.contextMenuHandler.subscribeContextMenu((visible) => {
      this.isContextMenuOpen = visible;
      if (!visible) {
        this.returnFocusToPlayer();
      }
    });

    this.pipWindow.document.addEventListener('focusin', this.handleFocusIn, true);
    this.logger.debug('Document focus handler initialized');
  }

  private returnFocusToPlayer(): void {
    const player = this.playerManager.getPlayer();
    if (typeof player.focus === 'function') {
      player.focus();
    }
  }

  /**
   * Cleanup focus observer
   */
  public cleanup(): void {
    this.unsubscribeContextMenu?.();
    this.unsubscribeContextMenu = null;
    if (this.pipWindow) {
      this.pipWindow.document.removeEventListener('focusin', this.handleFocusIn, true);
    }
    this.pipWindow = null;
    this.isContextMenuOpen = false;
    this.logger.debug('Document focus handler cleaned up');
  }
}
