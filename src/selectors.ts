/**
 * DOM selectors – single source of truth
 */

export const SELECTORS = {
  MINIPLAYER: 'ytd-miniplayer',
  MINIPLAYER_CONTAINER: 'ytd-miniplayer-player-container',
  MINIPLAYER_HOST: '.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible',
  MOVIE_PLAYER: '#movie_player',
  SHORTS_PLAYER: '#shorts-player',
  /** <video> element inside the player (query relative to player root) */
  PLAYER_VIDEO: 'video',
  YTD_APP: 'ytd-app',
  YTD_SHORTS: 'ytd-shorts',
  /** Scroll container inside ytd-shorts; use to preserve scrollTop when moving to PiP. */
  SHORTS_CONTAINER: '#shorts-container',
  /** Shorts video title (prevent default click to avoid navigation) */
  SHORTS_VIDEO_TITLE: '.ytShortsVideoTitleViewModelShortsVideoTitle',
  YT_DRAGGABLE: 'yt-draggable',
  CONTEXT_MENU: 'body > .ytp-popup.ytp-contextmenu',
  CONTEXT_MENU_CONTAINER: '.ytp-contextmenu',
  MENU_ITEM: '.ytp-menuitem',
  PANEL_MENU: '.ytp-panel-menu',
  PANEL_MENU_ITEMS: '.ytp-contextmenu .ytp-panel-menu > .ytp-menuitem',
  /** Mini-player expand; YouTube uses either host or inner spec button class depending on rollout. */
  MENU_BUTTON:
    '.yt-spec-button-shape-next[aria-expanded], .ytSpecButtonShapeNextHost[aria-expanded]',
  PLAYLIST_PANEL: '.ytdMiniplayerComponentPlaylistPanel',
  PROGRESS_BAR: '.ytp-progress-bar',
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
  /** Shorts info panel container (paragraph + link); has class ytd-info-panel-content-renderer. */
  INFO_PANEL_CONTENT: 'div.ytd-info-panel-content-renderer:not(.inline-source)',
  /** Visible link-only block; when present, we show the sibling paragraph. */
  INFO_PANEL_LINK_ONLY: 'yt-formatted-string[has-link-only_]',
  /** Paragraph block that may have is-empty; we remove it to show text. */
  INFO_PANEL_EMPTY_PARAGRAPH: ':scope > yt-formatted-string[is-empty]',
  /** Hidden attributed string wrapper; we remove hidden to show content. */
  INFO_PANEL_ATTRIBUTED_HIDDEN:
    ':scope > yt-formatted-string > yt-attributed-string[hidden="true"]',
  STYLESHEETS: 'style, link[rel="stylesheet"]',
  NOTIFICATION_TOPBAR_BUTTON_RENDERER: 'ytd-notification-topbar-button-renderer',
} as const;

export type Selector = (typeof SELECTORS)[keyof typeof SELECTORS];
