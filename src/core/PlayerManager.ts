import { YouTubePlayer, VideoData, PlayerState, PlayerSize } from '../types/youtube';
import { PLAYER_STATES, isPlayingState } from '../constants';
import { DOMUtils } from '../utils/DOMUtils';
import { TIMEOUTS } from '../constants';
import { SELECTORS } from '../selectors';
import type { Nullable } from '../types/app';
import type { Logger } from '../logger';
import { AppInitializationError } from '../errors/AppInitializationError';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';
import { YtdShortsProvider } from './YtdShortsProvider';

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
  private wasMiniPlayerActiveBeforePiP: boolean = false;
  /** Playback time (seconds) saved before opening mini player; used if Shorts steals playback on return. */
  private savedMainPlayerTimeBeforePiP: number | null = null;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(YtdShortsProvider) private readonly ytdShortsProvider: YtdShortsProvider
  ) {
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
    return isPlayingState(this.getPlayerState(player));
  }

  /**
   * Save current playing state
   */
  public savePlayingState(player: YouTubePlayer): void {
    this.wasPlaying = this.isPlaying(player);
    this.logger.debug(`Player state saved: wasPlaying = ${this.wasPlaying}`);
  }

  /**
   * Set whether mini player was active when PiP was opened. Used by TitleSyncHandler to skip initial title sync.
   */
  public setWasMiniPlayerActiveBeforePiP(value: boolean): void {
    this.wasMiniPlayerActiveBeforePiP = value;
  }

  /**
   * Whether mini player was visible when PiP was opened.
   */
  public getWasMiniPlayerActiveBeforePiP(): boolean {
    return this.wasMiniPlayerActiveBeforePiP;
  }

  /**
   * Save main player current time before opening mini player.
   * Call before toggleMiniPlayer when opening PiP from main player; time can reset to 0 when page navigates to Shorts.
   */
  public saveMainPlayerTimeBeforeOpenPiP(): void {
    this.savedMainPlayerTimeBeforePiP = this.getCurrentTime(false);
    this.logger.debug('Main player time saved before PiP open', {
      savedTime: this.savedMainPlayerTimeBeforePiP,
    });
  }

  /**
   * If Shorts player stole playback after opening the mini player, stop Shorts and restore the main player at the
   * saved position. Call when moving the main player to PiP, after the mini player became visible (e.g. after
   * toggleMiniPlayer). Stops the Shorts player, then if a time was saved via saveMainPlayerTimeBeforeOpenPiP,
   * restores the main player with loadVideoById(videoId, savedTime) so it plays from that position before being
   * moved to the PiP window.
   */
  public restoreMainPlayerIfShortsStolePlayback(): void {
    const mainPlayer = this.player;
    if (!mainPlayer) return;

    const shortsPlayer = this.ytdShortsProvider.getShortsPlayerFromDocument();
    if (!shortsPlayer || typeof shortsPlayer.getPlayerState !== 'function') return;
    if (!this.ytdShortsProvider.isShortsVisible()) return;

    const shortsState = shortsPlayer.getPlayerState();
    if (!isPlayingState(shortsState) && shortsState !== PLAYER_STATES.CUED) return;

    this.logger.debug('Shorts stole playback; stopping Shorts and restoring main player');
    try {
      if (typeof shortsPlayer.stopVideo === 'function') {
        shortsPlayer.stopVideo();
      }
      const savedTime = this.savedMainPlayerTimeBeforePiP;
      if (savedTime != null) {
        const videoData = this.getVideoDataFromPlayer(mainPlayer);
        const videoId = videoData?.video_id;
        if (videoId && typeof mainPlayer.loadVideoById === 'function') {
          mainPlayer.loadVideoById(videoId, savedTime);
          this.logger.debug('Main player restored via loadVideoById', { time: savedTime });
        }
      }
    } catch (e) {
      this.logger.error('Error restoring main player after Shorts stole playback:', e);
    } finally {
      this.savedMainPlayerTimeBeforePiP = null;
    }
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
   * @param round - If true (default), return floored integer; if false, return raw value.
   */
  public getCurrentTime(round = true): number {
    const player = this.getPlayer();
    if (typeof player.getCurrentTime !== 'function') {
      return 0;
    }
    const t = player.getCurrentTime();
    if (typeof t !== 'number' || Number.isNaN(t)) {
      return 0;
    }
    return round ? Math.floor(t) : t;
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
    this.savedMainPlayerTimeBeforePiP = null;
    this.logger.debug('Player state reset');
  }
}
