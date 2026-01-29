import { Logger } from '../logger';
import { SELECTORS } from '../selectors';
import { YouTubePlayer } from '../types/youtube';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('SeekHandler');

/**
 * Handles manual seeking on progress bar
 */
export class SeekHandler {
  private pipWindow: Nullable<Window> = null;

  /**
   * Initialize seek handler for PiP window
   */
  public initialize(pipWindow: Window): void {
    this.pipWindow = pipWindow;
    this.setupSeekHandler();
    logger.debug('Seek handler initialized');
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

        const player = pipDoc.querySelector<YouTubePlayer>(SELECTORS.MOVIE_PLAYER);
        if (!player) {
          logger.error('player not found');
          return;
        }
        if (typeof player.getDuration !== 'function') {
          logger.error('player.getDuration method not found');
          return;
        }
        if (typeof player.seekTo !== 'function') {
          logger.error('player.seekTo method not found');
          return;
        }

        logger.debug('Progress bar clicked, initiating seek');

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
            logger.debug(`Seeking to ${seekTime.toFixed(2)}s (${(percent * 100).toFixed(1)}%)`);
          }
        };

        performSeek(e);

        const onMouseMove = (moveEvent: MouseEvent) => performSeek(moveEvent);
        const onMouseUp = () => {
          pipDoc.removeEventListener('mousemove', onMouseMove);
          pipDoc.removeEventListener('mouseup', onMouseUp);
          logger.debug('Seek drag ended');
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
    logger.debug('Seek handler cleaned up');
  }
}
