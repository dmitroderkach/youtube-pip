import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';
import { YT_EVENTS, YT_PLAYER_EVENTS } from '../constants';
import type { Nullable } from '../types/app';
import type { NavigationState, PlayVideoEvent, WatchNavigateDetail } from '../types/youtube';
import { PlayerManager } from './PlayerManager';

/**
 * The video YouTube's mini player holds while our PiP is open, followed the way the mini player itself follows it,
 * so the return to the watch page navigates to that video.
 *
 * YouTube's router hands a watch navigation to the active mini player, which expands only for the video it holds and
 * loads any other into itself. The player cannot tell that video: with an ad loaded (and not showing) getVideoData()
 * and the player response give the ad's id, and navigating to it put the ad into the mini player (e2e flake "player
 * stays in the mini player after PiP", 2026-11). The mini player takes its video from:
 * - the watch page it was activated on (`start`);
 * - a watch navigation while it is active: YouTube's `yt-navigate` and the popstate our NavigationHandler sends for a
 *   link clicked in PiP;
 * - the player's `onPlayVideo` (autoplay of the next video).
 * Ads raise none of these.
 */
@injectable()
export class PiPVideoTracker {
  private readonly logger: Logger;
  private videoId: Nullable<string> = null;
  private tracking = false;

  constructor(
    @inject(LoggerFactory) loggerFactory: LoggerFactory,
    @inject(PlayerManager) private readonly playerManager: PlayerManager
  ) {
    this.logger = loggerFactory.create('PiPVideoTracker');
  }

  /** Start following, from the video of the watch page the mini player is activated on. */
  public start(videoId: Nullable<string>): void {
    this.stop();
    this.videoId = videoId;
    this.tracking = true;
    window.addEventListener(YT_EVENTS.NAVIGATE, this.onNavigate, true);
    window.addEventListener('popstate', this.onPopState, true);
    this.playerManager.addPlayerListener(YT_PLAYER_EVENTS.PLAY_VIDEO, this.onPlayVideo);
    this.logger.debug(`Following the mini player video from ${videoId ?? 'none'}`);
  }

  /** Stop following; returns the video the mini player holds (null when unknown). */
  public stop(): Nullable<string> {
    if (this.tracking) {
      window.removeEventListener(YT_EVENTS.NAVIGATE, this.onNavigate, true);
      window.removeEventListener('popstate', this.onPopState, true);
      this.playerManager.removePlayerListener(YT_PLAYER_EVENTS.PLAY_VIDEO, this.onPlayVideo);
      this.tracking = false;
    }
    const videoId = this.videoId;
    this.videoId = null;
    return videoId;
  }

  /** The video the mini player holds, while following. */
  public getVideoId(): Nullable<string> {
    return this.videoId;
  }

  private set(videoId: string | undefined, source: string): void {
    if (!videoId || videoId === this.videoId) return;
    this.logger.debug(`Mini player video ${videoId} (${source})`);
    this.videoId = videoId;
  }

  private readonly onNavigate = (event: Event): void => {
    const detail = (event as CustomEvent<WatchNavigateDetail>).detail;
    this.set(detail?.endpoint?.watchEndpoint?.videoId, YT_EVENTS.NAVIGATE);
  };

  private readonly onPopState = (event: PopStateEvent): void => {
    const state = event.state as Nullable<Partial<NavigationState>>;
    this.set(state?.endpoint?.watchEndpoint?.videoId, 'popstate');
  };

  private readonly onPlayVideo = (event: PlayVideoEvent): void => {
    this.set(
      event?.videoId ?? event?.watchEndpoint?.watchEndpoint?.videoId,
      YT_PLAYER_EVENTS.PLAY_VIDEO
    );
  };
}
