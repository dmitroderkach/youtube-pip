/**
 * DOM selectors – single source of truth
 */

export const SELECTORS = {
  MINIPLAYER: 'ytd-miniplayer',
  MINIPLAYER_CONTAINER: 'ytd-miniplayer-player-container',
  MINIPLAYER_HOST: '.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible',
  MOVIE_PLAYER: '#movie_player',
  YTD_APP: 'ytd-app',
  YT_DRAGGABLE: 'yt-draggable',
  HTML5_VIDEO_PLAYER: '.html5-video-player',
  CONTEXT_MENU: '.ytp-popup.ytp-contextmenu',
  CONTEXT_MENU_CONTAINER: '.ytp-contextmenu',
  MENU_BUTTON: '.yt-spec-button-shape-next[aria-expanded]',
  PLAYLIST_PANEL: '.ytdMiniplayerComponentPlaylistPanel',
  PROGRESS_BAR: '.ytp-progress-bar',
  LIKE_BUTTON: 'ytd-slim-metadata-toggle-button-renderer',
  BUTTON_SHAPE: '.yt-spec-button-shape-next',
  SIMPLE_ENDPOINT: '.yt-simple-endpoint',
  BUTTON: 'button',
  STYLESHEETS: 'style, link[rel="stylesheet"]',
} as const;

export type Selector = (typeof SELECTORS)[keyof typeof SELECTORS];
