/**
 * Application constants
 */

// LocalStorage flag for enabling debug logs
export const DEBUG_FLAG = 'YOUTUBE_PIP_DEBUG';

// Timeout values (in milliseconds)
export const TIMEOUTS = {
  ELEMENT_WAIT: 5000,
  ELEMENT_WAIT_INFINITE: 0,
  MENU_RETRY_DELAY: 100,
} as const;

// Retry counts
export const RETRY_LIMITS = {
  MINIPLAYER_SWITCH: 5,
} as const;

// Default dimensions
export const DEFAULT_DIMENSIONS = {
  PIP_WIDTH: 480,
  PIP_HEIGHT: 270,
  PIP_EXPANDED_HEIGHT: 600,
} as const;

// YouTube player states
export const PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

// YouTube action types
export const YT_ACTIONS = {
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  REMOVE: 'INDIFFERENT',
} as const;

// YouTube web page types
export const WEB_PAGE_TYPES = {
  WATCH: 'WEB_PAGE_TYPE_WATCH',
} as const;

// YouTube root VE
export const ROOT_VE = 3832;
