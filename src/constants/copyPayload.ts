/**
 * Constants for context menu "Copy" payloads (URLs, iframe, query params).
 */

/** Base URL for short YouTube links (youtu.be) */
export const YOUTUBE_SHORT_BASE = 'https://youtu.be';

/** Base URL for YouTube Shorts page (copy URL / URL at time) */
export const YOUTUBE_SHORTS_PAGE_BASE = 'https://www.youtube.com/shorts';

/** Base URL for embed player */
export const YOUTUBE_EMBED_BASE = 'https://www.youtube.com/embed';

/** Query param names for copy payload URLs */
export const COPY_PAYLOAD_QUERY = {
  LIST: 'list',
  TIME: 't',
} as const;

/** Escaped double quote for iframe title attribute */
export const IFRAME_TITLE_QUOT = '&quot;';

/** iframe allow attribute value */
export const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

/** iframe referrerpolicy value */
export const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin';
