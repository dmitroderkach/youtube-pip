import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { PlayerManager } from '../core/PlayerManager';
import { PipWindowProvider } from '../core/PipWindowProvider';
import { inject, injectable } from '../di';

/**
 * Handles manual seeking on progress bar
 */
@injectable()
export class SeekHandler {
  private readonly logger: Logger;
  private pipWindow: Nullable<Window> = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager,
    @inject(PipWindowProvider) private readonly pipWindowProvider: PipWindowProvider
  ) {
    this.logger = loggerFactory.create('SeekHandler');
  }

  /**
   * Initialize seek handler for PiP window
   */
  public initialize(): void {
    this.pipWindow = this.pipWindowProvider.getWindow();
    this.setupSeekHandler();
    this.logger.debug('Seek handler initialized');
  }

  /**
   * Setup mouse handlers for progress bar seeking
   */
  private setupSeekHandler(): void {
    if (!this.pipWindow) {
      return;
    }

    const pipDoc = this.pipWindow.document;
    pipDoc.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        const progressBar = (e.target as Element)?.closest(SELECTORS.PROGRESS_BAR);
        if (!progressBar) return;

        const player = this.playerManager.getPlayer();
        if (typeof player.getDuration !== 'function') {
          this.logger.error('player.getDuration method not found');
          return;
        }
        if (typeof player.seekTo !== 'function') {
          this.logger.error('player.seekTo method not found');
          return;
        }

        this.logger.debug('Progress bar clicked, initiating seek');

        e.preventDefault();
        e.stopPropagation();

        const performSeek = (event: MouseEvent) => {
          const rect = progressBar.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const percent = Math.max(0, Math.min(1, x / rect.width));
          const duration = player.getDuration?.();
          if (duration) {
            const seekTime = percent * duration;
            player.seekTo?.(seekTime, true);
            this.logger.debug(
              `Seeking to ${seekTime.toFixed(2)}s (${(percent * 100).toFixed(1)}%)`
            );
          }
        };

        performSeek(e);

        const onMouseMove = (moveEvent: MouseEvent) => performSeek(moveEvent);
        const onMouseUp = () => {
          pipDoc.removeEventListener('mousemove', onMouseMove);
          pipDoc.removeEventListener('mouseup', onMouseUp);
          this.logger.debug('Seek drag ended');
        };

        pipDoc.addEventListener('mousemove', onMouseMove);
        pipDoc.addEventListener('mouseup', onMouseUp);
      },
      true
    );
  }

  /**
   * Cleanup seek handler
   */
  public cleanup(): void {
    this.pipWindow = null;
    this.logger.debug('Seek handler cleaned up');
  }
}
