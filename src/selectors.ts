/**
 * DOM selectors – single source of truth
 */

export const SELECTORS = {
  MINIPLAYER: 'ytd-miniplayer',
  MINIPLAYER_CONTAINER: 'ytd-miniplayer-player-container',
  /** Slot inside the mini player container where ytd-player lives. */
  MINIPLAYER_PLAYER_SLOT: '#player-container',
  MINIPLAYER_HOST: '.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible',
  MOVIE_PLAYER: '#movie_player',
  /** Player that is back on the page, i.e. not inside the mini player container. */
  MOVIE_PLAYER_OUTSIDE_MINIPLAYER: '#movie_player:not(ytd-miniplayer-player-container *)',
  SHORTS_PLAYER: '#shorts-player',
  /** Full screen button of a Shorts player's top controls (our PiP button goes before it). */
  /** "⋮" buttons of a Shorts reel (top controls; action bar). */
  SHORTS_MENU_BUTTON: 'ytd-shorts #menu-button',
  /** Dropdowns YouTube opens for menus (e.g. the Shorts "⋮" menu). */
  POPUP_DROPDOWN: 'ytd-popup-container tp-yt-iron-dropdown',
  /** Row of a view-model list menu (Shorts "⋮" menu). */
  LIST_ITEM: 'yt-list-item-view-model',
  /** Slot of the "⋮" button in the Shorts top controls (our PiP button goes right after it). */
  SHORTS_MENU_BUTTON_SLOT: 'ytd-shorts-player-controls #right-controls > #menu-button',
  /** Slot of the full screen button next to it (not rendered with web_shorts_hide_fullscreen_and_captions_for_ask). */
  SHORTS_FULLSCREEN_SLOT: ':scope > #fullscreen-button-shape',
  /** <video> element inside the player (query relative to player root) */
  PLAYER_VIDEO: 'video',
  YTD_APP: 'ytd-app',
  /** Player component wrapper inside the mini player container (holds #movie_player). */
  YTD_PLAYER: 'ytd-player',
  YTD_SHORTS: 'ytd-shorts',
  /** Scroll container inside ytd-shorts; use to preserve scrollTop when moving to PiP. */
  SHORTS_CONTAINER: '#shorts-container',
  /** Shorts video title (prevent default click to avoid navigation) */
  SHORTS_VIDEO_TITLE: '.ytShortsVideoTitleViewModelShortsVideoTitle',
  YT_DRAGGABLE: 'yt-draggable',
  CONTEXT_MENU: 'body > .ytp-popup.ytp-contextmenu',
  CONTEXT_MENU_CONTAINER: '.ytp-contextmenu',
  /** Any player popup (context menu, settings menu); its items handle keys themselves. */
  PLAYER_POPUP: '.ytp-popup',
  MENU_ITEM: '.ytp-menuitem',
  MENU_ITEM_LABEL: '.ytp-menuitem-label',
  /** YouTube's own PiP button of the player controls (web_watch_pip). */
  YT_PIP_BUTTON: '.ytp-pip-button',
  /** Panel inside a player popup (context menu); YouTube sizes it inline together with the popup. */
  PANEL: '.ytp-panel',
  PANEL_MENU: '.ytp-panel-menu',
  PANEL_MENU_ITEMS: '.ytp-contextmenu .ytp-panel-menu > .ytp-menuitem',
  /** Mini-player expand; YouTube uses either host or inner spec button class depending on rollout. */
  MENU_BUTTON:
    '.yt-spec-button-shape-next[aria-expanded], .ytSpecButtonShapeNextHost[aria-expanded]',
  PLAYLIST_PANEL: '.ytdMiniplayerComponentPlaylistPanel',
  PROGRESS_BAR: '.ytp-progress-bar',
  /** Player settings (gear) button; our PiP button goes before it. */
  SETTINGS_BUTTON: '.ytp-settings-button',
  LIKE_BUTTON: 'ytd-slim-metadata-toggle-button-renderer',
  /** Click target inside like/dislike toggles; match both class variants. */
  BUTTON_SHAPE: '.yt-spec-button-shape-next, .ytSpecButtonShapeNextHost',
  SIMPLE_ENDPOINT: '.yt-simple-endpoint',
  BUTTON: 'button',
  /** Expanded engagement panel sections (collapse via visibility button). */
  ENGAGEMENT_PANEL_EXPANDED:
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
  /** Visibility toggle button inside engagement panel section. */
  ENGAGEMENT_PANEL_VISIBILITY_BUTTON: '#visibility-button button',
  STYLESHEETS: 'style, link[rel="stylesheet"]',
  NOTIFICATION_TOPBAR_BUTTON_RENDERER: 'ytd-notification-topbar-button-renderer',
} as const;

export type Selector = (typeof SELECTORS)[keyof typeof SELECTORS];
