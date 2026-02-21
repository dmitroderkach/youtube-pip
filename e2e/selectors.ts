/** Selectors used in e2e (mirror of src/selectors subset to avoid cross-rootDir import). */
export const E2E_SELECTORS = {
  MINIPLAYER: 'ytd-miniplayer',
  MINIPLAYER_HOST: '.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible',
  MOVIE_PLAYER: '#movie_player',
  YTD_APP: 'ytd-app',
  /** Expand button in mini player to show playlist (aria-expanded). */
  MENU_BUTTON: '.yt-spec-button-shape-next[aria-expanded]',
  /** Playlist panel container in mini player. */
  PLAYLIST_PANEL: '.ytdMiniplayerComponentPlaylistPanel',
  /** Single video row in mini player playlist panel. */
  PLAYLIST_VIDEO_ITEM: 'ytd-playlist-panel-video-renderer > a',
  /** Context menu popup (YouTube player). */
  CONTEXT_MENU: '.ytp-popup.ytp-contextmenu',
  /** Copy menu items container. */
  PANEL_MENU_ITEMS: '.ytp-panel-menu > .ytp-menuitem',
  /** YouTube ad overlay in player; when absent or hidden, ad has ended. */
  AD_PLAYER_OVERLAY: '.ytp-ad-player-overlay-layout',
} as const;
