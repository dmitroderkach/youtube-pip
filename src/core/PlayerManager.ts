import { Logger } from '../logger';
import { YouTubePlayer, VideoData, PlayerState } from '../types/youtube';
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
   * Returns one of PLAYER_STATES values
   */
  public getPlayerState(player: Nullable<YouTubePlayer>): PlayerState {
    if (!player) {
      logger.error('Player not found');
      return PLAYER_STATES.UNSTARTED;
    }
    if (typeof player.getPlayerState !== 'function') {
      logger.error('getPlayerState method not found');
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
      } else {
        logger.error('player.playVideo method not found, cannot restore playback');
      }
    } catch (e) {
      logger.error('Error restoring playback:', e);
    }
  }

  /**
   * Get video data from player
   */
  private getVideoData(player: Nullable<YouTubePlayer>): Nullable<VideoData> {
    if (!player || typeof player.getVideoData !== 'function') {
      return null;
    }
    return player.getVideoData() || null;
  }

  /**
   * Get video ID from player element in DOM
   * Logs warning if video ID is not found
   * @returns Video ID or null if not found
   */
  public getVideoId(document: Document): Nullable<string> {
    const player = document.querySelector<YouTubePlayer>(SELECTORS.MOVIE_PLAYER);
    const videoData = this.getVideoData(player);
    const videoId = videoData?.video_id;

    if (!videoId) {
      logger.error('Video ID not found, cannot navigate', {
        player,
      });
      return null;
    }

    return videoId;
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
   * Wait for miniplayer to be ready
   */
  public async waitForMiniPlayer(): Promise<Nullable<Element>> {
    try {
      const miniplayer = await DOMUtils.waitForElementSelector(
        SELECTORS.MINIPLAYER_HOST,
        document,
        TIMEOUTS.ELEMENT_WAIT
      );
      logger.debug('Miniplayer is ready');
      return miniplayer;
    } catch (e) {
      logger.error('Error waiting for miniplayer:', e);
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
