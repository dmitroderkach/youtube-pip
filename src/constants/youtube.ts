/**
 * YouTube API constants
 */

/** YouTube player states */
export const PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** YouTube event names */
export const YT_EVENTS = {
  ACTION: 'yt-action',
  NAVIGATE: 'yt-navigate',
} as const;

/** YouTube action names for fire() */
export const YT_ACTION_NAMES = {
  ACTIVATE_MINIPLAYER: 'yt-activate-miniplayer',
  ACTIVATE_MINIPLAYER_FROM_WATCH: 'yt-activate-miniplayer-from-watch-action',
} as const;

/** YouTube like/dislike action types */
export const YT_LIKE_ACTIONS = {
  LIKE: 'LIKE',
  DISLIKE: 'DISLIKE',
  REMOVE: 'INDIFFERENT',
} as const;

/** YouTube action types (general-purpose, extensible) */
export const YT_ACTIONS = {
  ...YT_LIKE_ACTIONS,
} as const;

/** YouTube web page types */
export const WEB_PAGE_TYPES = {
  WATCH: 'WEB_PAGE_TYPE_WATCH',
} as const;

/** YouTube root visual element ID */
export const ROOT_VE = 3832;
