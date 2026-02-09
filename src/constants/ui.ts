/**
 * UI-related constants
 */

/** Player context menu copy-item indices (.ytp-panel-menu .ytp-menuitem) */
export const COPY_MENU_INDICES = {
  VIDEO_URL: 2,
  URL_AT_TIME: 3,
  EMBED: 4,
  DEBUG_INFO: 5,
} as const;

/** Mouse button codes (MouseEvent.button) */
export const MOUSE_BUTTONS = {
  PRIMARY: 0, // Left button
  AUXILIARY: 1, // Middle button (wheel)
  SECONDARY: 2, // Right button
  FOURTH: 3, // Browser back
  FIFTH: 4, // Browser forward
} as const;
