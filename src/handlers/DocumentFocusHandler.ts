import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { ContextMenuHandler } from '../ui/ContextMenuHandler';
import { TIMEOUTS } from '../constants';
import { inject, injectable } from '../di';

/**
 * Polls document.activeElement and returns focus to player when it changes
 * to an element outside the player, but only when context menu is closed.
 */
@injectable()
export class DocumentFocusHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;
  private isContextMenuOpen = false;
  private lastActiveElement: Nullable<Element> = null;
  private pollId: ReturnType<typeof setInterval> | null = null;
  private unsubscribeContextMenu: (() => void) | null = null;

  private readonly pollActiveElement = (): void => {
    if (!this.pipWindow || this.isContextMenuOpen) return;

    const active = this.pipWindow.document.activeElement;
    if (active === this.lastActiveElement) return;
    this.lastActiveElement = active;

    const player = this.playerManager.getPlayer();
    if (!active || active === player || player.contains(active)) {
      return;
    }
    if (typeof player.focus === 'function') {
      this.logger.debug('Returning focus to player');
      player.focus();
    }
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
        this.pollActiveElement();
      }
    });

    this.pollId = setInterval(this.pollActiveElement, TIMEOUTS.ACTIVE_ELEMENT_POLL);
    this.logger.debug('Document focus handler initialized');
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.unsubscribeContextMenu?.();
    this.unsubscribeContextMenu = null;
    if (this.pollId !== null) {
      clearInterval(this.pollId);
      this.pollId = null;
    }
    this.pipWindow = null;
    this.lastActiveElement = null;
    this.isContextMenuOpen = false;
    this.logger.debug('Document focus handler cleaned up');
  }
}
