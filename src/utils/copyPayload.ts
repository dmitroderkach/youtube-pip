/**
 * Shared URL/iframe builders for context menu "Copy" actions.
 * Single source of truth: code and tests use these so template changes don't break tests.
 */
import type { Nullable } from '../types/app';
import { CopyType } from '../types/app';
import {
  EMBED_IFRAME_DEFAULTS,
  YOUTUBE_SHORT_BASE,
  YOUTUBE_EMBED_BASE,
  COPY_PAYLOAD_QUERY,
  IFRAME_TITLE_QUOT,
  IFRAME_ALLOW,
  IFRAME_REFERRER_POLICY,
} from '../constants';

export interface CopyPayloadParams {
  videoId: string;
  playlistId: Nullable<string>;
  currentTime: number;
  title: string;
  copyType: CopyType;
  embedSize?: Nullable<{ width: number; height: number }>;
}

/**
 * Build payload for "Copy video URL" (with optional playlist).
 */
export function buildVideoUrlPayload(videoId: string, playlistId: Nullable<string>): string {
  const base = `${YOUTUBE_SHORT_BASE}/${videoId}`;
  const listPart = playlistId ? `?${COPY_PAYLOAD_QUERY.LIST}=${playlistId}` : '';
  return listPart ? `${base}${listPart}` : base;
}

/**
 * Build payload for "Copy URL at current time".
 */
export function buildUrlAtTimePayload(
  videoId: string,
  playlistId: Nullable<string>,
  currentTime: number
): string {
  const base = `${YOUTUBE_SHORT_BASE}/${videoId}`;
  const listPart = playlistId ? `?${COPY_PAYLOAD_QUERY.LIST}=${playlistId}` : '';
  const tPart =
    currentTime > 0
      ? listPart
        ? `&${COPY_PAYLOAD_QUERY.TIME}=${currentTime}s`
        : `?${COPY_PAYLOAD_QUERY.TIME}=${currentTime}s`
      : '';
  return `${base}${listPart}${tPart}`;
}

/**
 * Build embed iframe HTML (single source of truth for template).
 */
export function buildEmbedPayload(
  videoId: string,
  playlistId: Nullable<string>,
  title: string,
  embedSize?: Nullable<{ width: number; height: number }>
): string {
  const w = embedSize?.width ?? EMBED_IFRAME_DEFAULTS.WIDTH;
  const h = embedSize?.height ?? EMBED_IFRAME_DEFAULTS.HEIGHT;
  const listQ = playlistId ? `?${COPY_PAYLOAD_QUERY.LIST}=${playlistId}` : '';
  const src = `${YOUTUBE_EMBED_BASE}/${videoId}${listQ}`;
  const safeTitle = title.replace(/"/g, IFRAME_TITLE_QUOT);
  return `<iframe width="${w}" height="${h}" src="${src}" title="${safeTitle}" frameborder="0" allow="${IFRAME_ALLOW}" referrerpolicy="${IFRAME_REFERRER_POLICY}" allowfullscreen></iframe>`;
}

/**
 * Build copy payload by copy type (used by ContextMenuHandler and tests).
 */
export function buildCopyPayload(params: CopyPayloadParams): string {
  const { videoId, playlistId, currentTime, title, copyType, embedSize } = params;
  switch (copyType) {
    case CopyType.VIDEO_URL:
      return buildVideoUrlPayload(videoId, playlistId);
    case CopyType.URL_AT_TIME:
      return buildUrlAtTimePayload(videoId, playlistId, currentTime);
    case CopyType.EMBED:
      return buildEmbedPayload(videoId, playlistId, title, embedSize);
    default:
      return '';
  }
}
