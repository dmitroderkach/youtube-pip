import type { Nullable } from './app';
import type {
  PLAYER_STATES,
  YT_ACTIONS,
  YT_LIKE_ACTIONS,
  WEB_PAGE_TYPES,
  YT_EVENTS,
} from '../constants';

/**
 * TypeScript interfaces for YouTube internal types
 */

/**
 * YouTube player state values from PLAYER_STATES constant
 * Possible values:
 * - UNSTARTED: -1
 * - ENDED: 0
 * - PLAYING: 1
 * - PAUSED: 2
 * - BUFFERING: 3
 * - CUED: 5
 */
export type PlayerState = (typeof PLAYER_STATES)[keyof typeof PLAYER_STATES];

export interface PlayerSize {
  width: number;
  height: number;
}

/**
 * YouTube player interface
 */
export interface YouTubePlayer extends HTMLElement {
  getPlayerState?(): PlayerState;
  playVideo?(): void;
  pauseVideo?(): void;
  seekTo?(seconds: number, allowSeekAhead: boolean): void;
  getDuration?(): number;
  getCurrentTime?(): number;
  setInternalSize?(): void;
  setSize?(): void;
  getVideoData?(): VideoData;
  getDebugText?(fullDebugInfo?: boolean): string;
  getPlayerSize?(): PlayerSize;
}

/**
 * Video data returned by player
 */
export interface VideoData {
  video_id: string;
  author?: string;
  title?: string;
  list?: string;
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
 * Web page type from WEB_PAGE_TYPES constant
 * Possible values:
 * - WATCH: 'WEB_PAGE_TYPE_WATCH'
 */
export type WebPageType = (typeof WEB_PAGE_TYPES)[keyof typeof WEB_PAGE_TYPES];

/**
 * Web command metadata
 * webPageType values from WEB_PAGE_TYPES constant
 */
export interface WebCommandMetadata {
  url: string;
  webPageType: WebPageType;
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
 * YouTube action type from YT_ACTIONS constant
 * General-purpose type for all YouTube actions, extensible for future action types
 * Possible values:
 * - LIKE: 'LIKE'
 * - DISLIKE: 'DISLIKE'
 * - REMOVE: 'INDIFFERENT'
 */
export type YouTubeActionType = (typeof YT_ACTIONS)[keyof typeof YT_ACTIONS];

/**
 * Like action type from YT_LIKE_ACTIONS constant
 * Specific type for like/dislike endpoint actions only
 * Possible values:
 * - LIKE: 'LIKE'
 * - DISLIKE: 'DISLIKE'
 * - REMOVE: 'INDIFFERENT'
 */
export type LikeActionType = (typeof YT_LIKE_ACTIONS)[keyof typeof YT_LIKE_ACTIONS];

/**
 * Like endpoint command
 * Status values from YT_LIKE_ACTIONS constants
 */
export interface LikeEndpoint {
  status: LikeActionType;
  target: LikeEndpointTarget;
}

/**
 * Like command structure
 */
export interface LikeCommand {
  likeEndpoint: LikeEndpoint;
}

/**
 * Registry of all YouTube command types
 * Add new command types here, and they automatically become part of YouTubeCommand
 */
export interface YouTubeCommands {
  like: LikeCommand;
  // Future commands - just add here:
}

/**
 * Union of all YouTube command types
 * Automatically derived from YouTubeCommands registry
 */
export type YouTubeCommand = YouTubeCommands[keyof YouTubeCommands];

/** Mini player element (ytd-miniplayer). Type alias for future YouTube-specific props. */
export type MiniPlayerElement = HTMLElement;

/**
 * YouTube event name type from YT_EVENTS constant
 * Possible values:
 * - ACTION: 'yt-action'
 * - NAVIGATE: 'yt-navigate'
 */
export type YouTubeEventName = (typeof YT_EVENTS)[keyof typeof YT_EVENTS];

/**
 * YouTube app element interface
 */
export interface YouTubeAppElement extends HTMLElement {
  resolveCommand?(command: YouTubeCommand): void;
  fire?(eventName: YouTubeEventName, detail?: unknown): void;

  miniplayerIsActive: boolean;
}
