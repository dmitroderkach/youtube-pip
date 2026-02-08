/**
 * UI-related constants
 */

/** DOM class names (for element.className / classList) – use with selectors.ts for queries */
export const UI_CLASSES = {
  PANEL_MENU: 'ytp-panel-menu',
  MENU_ITEM: 'ytp-menuitem',
  CONTEXT_MENU: 'ytp-popup ytp-contextmenu',
  CONTEXT_MENU_CONTAINER: 'ytp-contextmenu',
  PLAYLIST_PANEL: 'ytdMiniplayerComponentPlaylistPanel',
  BUTTON_SHAPE: 'yt-spec-button-shape-next',
  PROGRESS_BAR: 'ytp-progress-bar',
  /** Class string for mini player host (visible) – matches SELECTORS.MINIPLAYER_HOST */
  MINIPLAYER_HOST: 'ytdMiniplayerComponentHost ytdMiniplayerComponentVisible',
} as const;

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
