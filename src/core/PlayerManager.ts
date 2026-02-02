import { YouTubePlayer, VideoData, PlayerState, PlayerSize } from '../types/youtube';
import { PLAYER_STATES } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { AppInitializationError } from '../errors/AppInitializationError';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';

/**
 * Manages player state and operations.
 * Holds a reference to the player DOM element, initialized at app startup.
 * The reference persists when the player moves between main window and PiP.
 */
@injectable()
export class PlayerManager {
  private readonly logger: Logger;
  private player: Nullable<YouTubePlayer> = null;
  private wasPlaying: boolean = false;

  constructor(@inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create('PlayerManager');
  }

  /**
   * Initialize player reference from main document. Call at app startup.
   * Waits for movie_player to appear (e.g. on watch page).
   * @throws Error if movie_player element not found
   */
  public async initialize(): Promise<void> {
    try {
      const element = await DOMUtils.waitForElementSelector<YouTubePlayer>(
        SELECTORS.MOVIE_PLAYER,
        document,
        TIMEOUTS.ELEMENT_WAIT
      );
      this.player = element;
      this.logger.debug('Player initialized');
    } catch (cause) {
      throw new AppInitializationError(`${SELECTORS.MOVIE_PLAYER} element not found`, cause);
    }
  }

  /**
   * Get the player element. Always defined after initialize().
   */
  public getPlayer(): YouTubePlayer {
    return this.player!;
  }

  /**
   * Get player state (playing/paused)
   */
  public getPlayerState(player: YouTubePlayer): PlayerState {
    if (typeof player.getPlayerState !== 'function') {
      this.logger.error('getPlayerState method not found');
      return PLAYER_STATES.UNSTARTED;
    }
    return player.getPlayerState();
  }

  /**
   * Check if player is currently playing
   */
  public isPlaying(player: YouTubePlayer): boolean {
    return this.getPlayerState(player) === PLAYER_STATES.PLAYING;
  }

  /**
   * Save current playing state
   */
  public savePlayingState(player: YouTubePlayer): void {
    this.wasPlaying = this.isPlaying(player);
    this.logger.debug(`Player state saved: wasPlaying = ${this.wasPlaying}`);
  }

  /**
   * Restore playing state if it was playing before
   */
  public restorePlayingState(player: YouTubePlayer): void {
    if (!this.wasPlaying) {
      this.logger.debug('No need to restore playing state');
      return;
    }

    try {
      if (typeof player.playVideo === 'function') {
        player.playVideo();
        this.logger.log('Playback restored after return to main window');
      } else {
        this.logger.error('player.playVideo method not found, cannot restore playback');
      }
    } catch (e) {
      this.logger.error('Error restoring playback:', e);
    }
  }

  private getVideoDataFromPlayer(player: YouTubePlayer): Nullable<VideoData> {
    if (typeof player.getVideoData !== 'function') {
      return null;
    }
    return player.getVideoData() || null;
  }

  /**
   * Get video ID from player
   */
  public getVideoId(): Nullable<string> {
    const videoData = this.getVideoDataFromPlayer(this.getPlayer());
    const videoId = videoData?.video_id;

    if (!videoId) {
      this.logger.error('Video ID not found, cannot navigate', { player: this.getPlayer() });
      return null;
    }

    return videoId;
  }

  /**
   * Get video data (video_id, title, list) from player.
   */
  public getVideoData(): Nullable<VideoData> {
    return this.getVideoDataFromPlayer(this.getPlayer());
  }

  /**
   * Get current playback time in seconds.
   */
  public getCurrentTime(): number {
    const player = this.getPlayer();
    if (typeof player.getCurrentTime !== 'function') {
      return 0;
    }
    const t = player.getCurrentTime();
    if (typeof t === 'number' && !Number.isNaN(t)) {
      return Math.floor(t);
    }
    return 0;
  }

  /**
   * Get player size (width, height).
   */
  public getPlayerSize(): Nullable<PlayerSize> {
    const player = this.getPlayer();
    if (typeof player.getPlayerSize !== 'function') {
      return null;
    }
    return player.getPlayerSize();
  }

  /**
   * Get debug information string from player.
   */
  public getDebugInfo(): Nullable<string> {
    const player = this.getPlayer();
    if (typeof player.getDebugText !== 'function') {
      return null;
    }
    const text = player.getDebugText(true);
    return typeof text === 'string' && text.length > 0 ? text : null;
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
      this.player = player as YouTubePlayer;
      this.logger.debug('Main player is ready');
      return player;
    } catch (e) {
      this.logger.error('Error waiting for main player:', e);
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
      this.logger.debug('Miniplayer is ready');
      return miniplayer;
    } catch (e) {
      this.logger.error('Error waiting for miniplayer:', e);
      return null;
    }
  }

  /**
   * Reset saved state
   */
  public resetState(): void {
    this.wasPlaying = false;
    this.logger.debug('Player state reset');
  }
}
