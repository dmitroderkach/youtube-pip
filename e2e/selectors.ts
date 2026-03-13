/** Selectors used in e2e (mirror of src/selectors subset to avoid cross-rootDir import). */
export const E2E_SELECTORS = {
  MINIPLAYER: 'ytd-miniplayer',
  MINIPLAYER_HOST: '.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible',
  MOVIE_PLAYER: '#movie_player',
  /** <video> element inside the player (query relative to player root) */
  PLAYER_VIDEO: 'video',
  YTD_APP: 'ytd-app',
  /** Shorts root element on Shorts page/feed. */
  YTD_SHORTS: 'ytd-shorts',
  /** Shorts player container inside Shorts. */
  SHORTS_PLAYER: '#shorts-player',
  /** Scroll container inside Shorts feed (used to switch reels). */
  SHORTS_CONTAINER: '#shorts-container',
  /** Expand button in mini player to show playlist (aria-expanded). */
  MENU_BUTTON: '.yt-spec-button-shape-next[aria-expanded]',
  /** Playlist panel container in mini player. */
  PLAYLIST_PANEL: '.ytdMiniplayerComponentPlaylistPanel',
  /** Single video row in mini player playlist panel (host element; has selected when active). */
  PLAYLIST_VIDEO_ROW: 'ytd-playlist-panel-video-renderer',
  /** Link inside playlist row (use for click). */
  PLAYLIST_VIDEO_ITEM: 'ytd-playlist-panel-video-renderer > a',
  /** Context menu popup (YouTube player). */
  CONTEXT_MENU: '.ytp-popup.ytp-contextmenu',
  /** Copy menu items container. */
  PANEL_MENU_ITEMS: '.ytp-panel-menu > .ytp-menuitem',
  /** YouTube ad overlay in player; when absent or hidden, ad has ended. */
  AD_PLAYER_OVERLAY: '.ytp-ad-player-overlay-layout',
  /** Skip ad button; click when visible to end ad sooner. */
  SKIP_AD_BUTTON: '.ytp-skip-ad-button',
  /** Like/dislike toggle wrapper (first = like, second = dislike). Same as src/selectors.LIKE_BUTTON. */
  LIKE_BUTTON: 'ytd-slim-metadata-toggle-button-renderer',
  /** Clickable button inside toggle. Same as src/selectors.BUTTON_SHAPE. */
  BUTTON_SHAPE: '.yt-spec-button-shape-next',
} as const;
