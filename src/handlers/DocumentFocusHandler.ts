import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { inject, injectable } from '../di';

/**
 * Listens to capture click on body and keyup on document (any key except Tab).
 * Returns focus to player when it moves outside the player, but only when context
 * menu is closed. Uses setTimeout(0) so focus runs after other handlers.
 */
@injectable()
export class DocumentFocusHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;
  private isContextMenuOpen = false;
  private unsubscribeContextMenu: (() => void) | null = null;

  private returnFocusToPlayerIfNeeded(): void {
    if (!this.pipWindow || this.isContextMenuOpen) return;

    const active = this.pipWindow.document.activeElement;
    const player = this.playerManager.getPlayer();
    if (!active || active === player || player.contains(active)) return;

    if (typeof player.focus === 'function') {
      this.logger.debug('Returning focus to player');
      setTimeout(() => player.focus(), 0);
    }
  }

  private readonly onBodyClick = (): void => this.returnFocusToPlayerIfNeeded();

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') return;
    this.returnFocusToPlayerIfNeeded();
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
        this.returnFocusToPlayerIfNeeded();
      }
    });

    this.pipWindow.document.body.addEventListener('click', this.onBodyClick, true);
    this.pipWindow.document.addEventListener('keyup', this.onKeyUp, true);
    this.logger.debug('Document focus handler initialized');
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.unsubscribeContextMenu?.();
    this.unsubscribeContextMenu = null;
    if (this.pipWindow?.document?.body) {
      this.pipWindow.document.body.removeEventListener('click', this.onBodyClick, true);
      this.pipWindow.document.removeEventListener('keyup', this.onKeyUp, true);
    }
    this.pipWindow = null;
    this.isContextMenuOpen = false;
    this.logger.debug('Document focus handler cleaned up');
  }
}
