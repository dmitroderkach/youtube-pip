/**
 * Application-level constants
 */

/** LocalStorage flag for enabling debug logs */
export const DEBUG_FLAG = 'YOUTUBE_PIP_DEBUG';

/** Timeout values (in milliseconds) */
export const TIMEOUTS = {
  ACTIVE_ELEMENT_POLL: 100,
  ELEMENT_WAIT: 5000,
  ELEMENT_WAIT_INFINITE: 0,
  MENU_RETRY_DELAY: 100,
  PHANTOM_WINDOW_CHECK: 500,
} as const;

/** Retry counts */
export const RETRY_LIMITS = {
  MINIPLAYER_SWITCH: 5,
} as const;

/** Default dimensions for PiP window */
export const DEFAULT_DIMENSIONS = {
  PIP_WIDTH: 480,
  PIP_HEIGHT: 270,
  PIP_EXPANDED_HEIGHT: 600,
} as const;

/** Default dimensions for embed iframe (fallback when player size unknown) */
export const EMBED_IFRAME_DEFAULTS = {
  WIDTH: 400,
  HEIGHT: 225,
} as const;
