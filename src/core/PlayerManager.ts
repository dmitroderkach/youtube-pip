import { Logger } from '../logger';
import { YouTubePlayer, VideoData } from '../types/youtube';
import { PLAYER_STATES } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';

const logger = Logger.getInstance('PlayerManager');

/**
 * Manages player state and operations
 */
export class PlayerManager {
  private wasPlaying: boolean = false;

  /**
   * Get player state (playing/paused)
   */
  public getPlayerState(player: Nullable<YouTubePlayer>): number {
    if (!player) {
      return PLAYER_STATES.UNSTARTED;
    }
    return player.getPlayerState();
  }

  /**
   * Check if player is currently playing
   */
  public isPlaying(player: Nullable<YouTubePlayer>): boolean {
    return this.getPlayerState(player) === PLAYER_STATES.PLAYING;
  }

  /**
   * Save current playing state
   */
  public savePlayingState(player: Nullable<YouTubePlayer>): void {
    this.wasPlaying = this.isPlaying(player);
    logger.debug(`Player state saved: wasPlaying = ${this.wasPlaying}`);
  }

  /**
   * Restore playing state if it was playing before
   */
  public restorePlayingState(player: Nullable<YouTubePlayer>): void {
    if (!this.wasPlaying || !player) {
      logger.debug('No need to restore playing state');
      return;
    }

    try {
      if (typeof player.playVideo === 'function') {
        player.playVideo();
        logger.log('Playback restored after return to main window');
      }
    } catch (e) {
      logger.error('Error restoring playback:', e);
    }
  }

  /**
   * Get video data from player
   */
  public getVideoData(player: Nullable<YouTubePlayer>): Nullable<VideoData> {
    if (!player || typeof player.getVideoData !== 'function') {
      return null;
    }
    return player.getVideoData() || null;
  }

  /**
   * Wait for main player to be ready
   */
  public async waitForMainPlayer(): Promise<Nullable<Element>> {
    try {
      const player = await DOMUtils.waitForElementSelector(
        SELECTORS.MOVIE_PLAYER,
        document,
        TIMEOUTS.ELEMENT_WAIT
      );
      logger.debug('Main player is ready');
      return player;
    } catch (e) {
      logger.error('Error waiting for main player:', e);
      return null;
    }
  }

  /**
   * Reset saved state
   */
  public resetState(): void {
    this.wasPlaying = false;
    logger.debug('Player state reset');
  }
}
