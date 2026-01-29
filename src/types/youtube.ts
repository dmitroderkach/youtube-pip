import type { Nullable } from './app';

/**
 * TypeScript interfaces for YouTube internal types
 */

/**
 * YouTube player interface
 */
export interface YouTubePlayer {
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
  getCurrentTime(): number;
  setInternalSize?(): void;
  setSize?(): void;
  getVideoData?(): VideoData;
  addEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
  focus?(): void;
}

/**
 * Video data returned by player
 */
export interface VideoData {
  video_id: string;
  author?: string;
  title?: string;
}

/**
 * Watch endpoint parameters
 */
export interface WatchEndpoint {
  videoId: string;
  playlistId?: Nullable<string>;
  index?: number;
  params?: string;
  playerParams?: string;
}

/**
 * Web command metadata
 */
export interface WebCommandMetadata {
  url: string;
  webPageType: string;
  rootVe: number;
}

/**
 * Command metadata
 */
export interface CommandMetadata {
  webCommandMetadata: WebCommandMetadata;
}

/**
 * Navigation endpoint
 */
export interface NavigationEndpoint {
  commandMetadata: CommandMetadata;
  watchEndpoint: WatchEndpoint;
}

/**
 * Navigation state for YouTube SPA
 */
export interface NavigationState {
  endpoint: NavigationEndpoint;
  entryTime: number;
}

/**
 * Media session metadata
 */
export interface MediaSessionMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: MediaImage[];
}

/**
 * Media image for artwork
 */
export interface MediaImage {
  src: string;
  sizes?: string;
  type?: string;
}

/** Like endpoint target (videoId) */
export interface LikeEndpointTarget {
  videoId: string;
}

/**
 * Like endpoint command
 */
export interface LikeEndpoint {
  status: 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
  target: LikeEndpointTarget;
}

/** Map from action key to LikeEndpoint status */
export type LikeActionStatusMap = Record<string, LikeEndpoint['status']>;

/**
 * YouTube command for like/dislike actions
 */
export interface YouTubeCommand {
  likeEndpoint: LikeEndpoint;
}

/** Mini player element (ytd-miniplayer). Type alias for future YouTube-specific props. */
export type MiniPlayerElement = HTMLElement;

/**
 * YouTube app element interface
 */
export interface YouTubeAppElement extends HTMLElement {
  resolveCommand?(command: YouTubeCommand): void;
  fire(eventName: string, detail?: unknown): void;

  miniplayerIsActive: boolean;
}
