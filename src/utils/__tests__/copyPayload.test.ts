import { describe, it, expect } from 'vitest';
import {
  buildVideoUrlPayload,
  buildUrlAtTimePayload,
  buildEmbedPayload,
  buildCopyPayload,
} from '../copyPayload';
import { CopyType } from '../../types/app';
import {
  YOUTUBE_SHORT_BASE,
  YOUTUBE_EMBED_BASE,
  COPY_PAYLOAD_QUERY,
  EMBED_IFRAME_DEFAULTS,
} from '../../constants';

/** Sample embed size for tests (not used in app code) */
const EMBED_SAMPLE = { WIDTH: 640, HEIGHT: 360 } as const;

describe('copyPayload', () => {
  it('buildVideoUrlPayload without playlist', () => {
    expect(buildVideoUrlPayload('vid1', null)).toBe(`${YOUTUBE_SHORT_BASE}/vid1`);
  });

  it('buildVideoUrlPayload with playlist', () => {
    expect(buildVideoUrlPayload('v', 'PL123')).toBe(
      `${YOUTUBE_SHORT_BASE}/v?${COPY_PAYLOAD_QUERY.LIST}=PL123`
    );
  });

  it('buildUrlAtTimePayload with time only', () => {
    const timeSec = 30;
    const result = buildUrlAtTimePayload('v2', null, timeSec);
    expect(result).toContain(`${COPY_PAYLOAD_QUERY.TIME}=${timeSec}s`);
    expect(result).toBe(`${YOUTUBE_SHORT_BASE}/v2?${COPY_PAYLOAD_QUERY.TIME}=${timeSec}s`);
  });

  it('buildUrlAtTimePayload with list and time', () => {
    const playlistId = 'PL1';
    const timeSec = 5;
    const s = buildUrlAtTimePayload('v2', playlistId, timeSec);
    expect(s).toContain(`${COPY_PAYLOAD_QUERY.LIST}=${playlistId}`);
    expect(s).toContain(`${COPY_PAYLOAD_QUERY.TIME}=${timeSec}s`);
  });

  it('buildUrlAtTimePayload with currentTime 0 returns base and list only', () => {
    const result = buildUrlAtTimePayload('v', null, 0);
    expect(result).toBe(`${YOUTUBE_SHORT_BASE}/v`);
    const withList = buildUrlAtTimePayload('v', 'PL1', 0);
    expect(withList).toBe(`${YOUTUBE_SHORT_BASE}/v?${COPY_PAYLOAD_QUERY.LIST}=PL1`);
  });

  it('buildEmbedPayload without embedSize uses default dimensions', () => {
    const html = buildEmbedPayload('emb1', null, 'Title');
    expect(html).toContain('<iframe');
    expect(html).toContain(`${YOUTUBE_EMBED_BASE}/emb1`);
    expect(html).toContain(`width="${EMBED_IFRAME_DEFAULTS.WIDTH}"`);
    expect(html).toContain(`height="${EMBED_IFRAME_DEFAULTS.HEIGHT}"`);
  });

  it('buildEmbedPayload builds iframe with videoId and optional list', () => {
    const videoId = 'emb1';
    const title = 'Title';
    const size = { width: EMBED_SAMPLE.WIDTH, height: EMBED_SAMPLE.HEIGHT };
    const html = buildEmbedPayload(videoId, null, title, size);
    expect(html).toContain('<iframe');
    expect(html).toContain(`${YOUTUBE_EMBED_BASE}/${videoId}`);
    expect(html).toContain(`width="${EMBED_SAMPLE.WIDTH}"`);
    expect(html).toContain(`height="${EMBED_SAMPLE.HEIGHT}"`);
    expect(html).toContain(`title="${title}"`);
  });

  it('buildEmbedPayload with playlist adds list to src', () => {
    const playlistId = 'PL456';
    const html = buildEmbedPayload('v2', playlistId, 'T2', {
      width: EMBED_SAMPLE.WIDTH,
      height: EMBED_SAMPLE.HEIGHT,
    });
    expect(html).toContain(`?${COPY_PAYLOAD_QUERY.LIST}=${playlistId}`);
  });

  it('buildCopyPayload returns empty string for unknown copyType', () => {
    const params = {
      videoId: 'x',
      playlistId: null as string | null,
      currentTime: 0,
      title: 'T',
      copyType: 'unknown' as CopyType,
    };
    expect(buildCopyPayload(params)).toBe('');
  });
});
