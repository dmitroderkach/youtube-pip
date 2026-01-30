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

// YouTube event names
export const YT_EVENTS = {
  ACTION: 'yt-action',
  NAVIGATE: 'yt-navigate',
} as const;

// YouTube action names
export const YT_ACTION_NAMES = {
  ACTIVATE_MINIPLAYER: 'yt-activate-miniplayer',
  ACTIVATE_MINIPLAYER_FROM_WATCH: 'yt-activate-miniplayer-from-watch-action',
} as const;

// YouTube like/dislike action types
export const YT_LIKE_ACTIONS = {
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  REMOVE: 'INDIFFERENT',
} as const;

// YouTube action types (general-purpose, extensible)
export const YT_ACTIONS = {
  ...YT_LIKE_ACTIONS,
} as const;

// YouTube web page types
export const WEB_PAGE_TYPES = {
  WATCH: 'WEB_PAGE_TYPE_WATCH',
} as const;

// YouTube root VE
export const ROOT_VE = 3832;

// Player context menu copy-item indices (.ytp-panel-menu .ytp-menuitem)
export const COPY_MENU_INDICES = {
  VIDEO_URL: 2,
  URL_AT_TIME: 3,
  EMBED: 4,
} as const;

// Mouse button codes (MouseEvent.button)
export const MOUSE_BUTTONS = {
  PRIMARY: 0, // Left button
  AUXILIARY: 1, // Middle button (wheel)
  SECONDARY: 2, // Right button
  FOURTH: 3, // Browser back
  FIFTH: 4, // Browser forward
} as const;
