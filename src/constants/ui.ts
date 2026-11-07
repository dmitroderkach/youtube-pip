/**
 * UI-related constants
 */

/**
 * Position of the copy items in the player context menu, counted from the end (0 = last item).
 * YouTube always ends the menu with: Copy video URL, Copy video URL at current time, Copy embed code,
 * Copy debug info, Troubleshoot playback issue, Stats for nerds. Optional items (Account, Loop, Miniplayer,
 * Picture-in-picture; several behind experiment flags) are only added above them, so absolute indices shift
 * but positions from the end do not.
 */
export const COPY_MENU_POSITIONS_FROM_END = {
  VIDEO_URL: 5,
  URL_AT_TIME: 4,
  EMBED: 3,
  DEBUG_INFO: 2,
} as const;

/** Mouse button codes (MouseEvent.button) */
/** KeyboardEvent.key values used by handlers */
export const KEYS = {
  ESCAPE: 'Escape',
} as const;

export const MOUSE_BUTTONS = {
  PRIMARY: 0, // Left button
  AUXILIARY: 1, // Middle button (wheel)
  SECONDARY: 2, // Right button
  FOURTH: 3, // Browser back
  FIFTH: 4, // Browser forward
} as const;
