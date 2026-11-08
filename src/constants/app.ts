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
  /** If loadVideo is not called for this long after lockLoadVideo, original is restored. */
  IDLE_TIMEOUT: 200,
  /**
   * Max wait for YouTube's pending low-priority jobs before activating the mini player for PiP. Usually ~100 ms;
   * on a busy page (ads, navigation) YouTube holds them back longer. Kept well below Chrome's ~5 s user
   * activation window that requestWindow() needs; on timeout we go ahead anyway.
   */
  YOUTUBE_LOW_PRIORITY_JOBS: 2000,
  /**
   * Max wait, when PiP closes, for the player to report the video switched to in PiP (no video_id while it is
   * loading); after it the id requested by the switch is used (the video may never load, e.g. bot check).
   */
  VIDEO_ID_WAIT: 5000,
  VIDEO_ID_POLL: 100,
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
  PIP_SHORTS_WIDTH: 337.5,
  PIP_SHORTS_HEIGHT: 600,
} as const;

/** Default dimensions for embed iframe (fallback when player size unknown) */
export const EMBED_IFRAME_DEFAULTS = {
  WIDTH: 400,
  HEIGHT: 225,
} as const;
