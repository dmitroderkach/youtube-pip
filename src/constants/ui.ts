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
  ENTER: 'Enter',
  SPACE: ' ',
} as const;

/** Legacy KeyboardEvent.keyCode values, for synthetic events YouTube's handlers read by keyCode. */
export const KEY_CODES = {
  ESCAPE: 27,
} as const;

/** Key that opens our PiP on the page and closes it in the PiP window (plain, no modifiers; YouTube uses only Shift+P). */
export const PIP_HOTKEY = 'p';

/** Classes of our entry points (styles.css hides the button and its tooltip in the PiP window). */
export const ENTRY_POINT_CLASSES = {
  MENU_ITEM: 'ytpip-open-menuitem',
  BUTTON: 'ytpip-open-button',
  TOOLTIP: 'ytpip-tooltip',
  /** Our button in the Shorts player's top controls. */
  SHORTS_BUTTON: 'ytpip-shorts-button',
  /** id of our style element on the page (hides YouTube's own PiP button). */
  PAGE_STYLE: 'ytpip-page-style',
} as const;

/** Placement of the player's control tooltips (`.ytp-tooltip.ytp-bottom`), as YouTube shows them. */
export const PLAYER_TOOLTIP = {
  /** Space between the tooltip and the top of the button. */
  GAP_PX: 22,
  /** Smallest distance from the tooltip to the player's left / right edge. */
  EDGE_PX: 12,
  MAX_WIDTH_PX: 300,
  /** `data-layer` YouTube gives its tooltip. */
  LAYER: '4',
} as const;

/** Picture-in-picture icon (Material "picture_in_picture_alt", 24×24). */
export const PIP_ICON_PATH =
  'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z';

export const MOUSE_BUTTONS = {
  PRIMARY: 0, // Left button
  AUXILIARY: 1, // Middle button (wheel)
  SECONDARY: 2, // Right button
  FOURTH: 3, // Browser back
  FIFTH: 4, // Browser forward
} as const;
