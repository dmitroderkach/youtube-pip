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

/** States that mean playback is active (playing or buffering). */
const PLAYING_STATES: number[] = [PLAYER_STATES.PLAYING, PLAYER_STATES.BUFFERING];

/** True if the given player state means video is playing (or buffering). */
export function isPlayingState(state: number): boolean {
  return PLAYING_STATES.includes(state);
}

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

/** YouTube web page types */
export const WEB_PAGE_TYPES = {
  WATCH: 'WEB_PAGE_TYPE_WATCH',
} as const;

/** YouTube root visual element ID */
export const ROOT_VE = 3832;

/** YouTube scheduler (scheduler.js) job priorities. */
export const YT_SCHEDULER = {
  /** Kevlar's addLowPriorityJob(fn, delay) = addJob(fn, LOW_PRIORITY, delay). */
  LOW_PRIORITY: 1,
  /** Delay of the watch-while IntersectionObserver job; a barrier with the same delay is queued after it. */
  WATCH_WHILE_JOB_DELAY_MS: 100,
} as const;
