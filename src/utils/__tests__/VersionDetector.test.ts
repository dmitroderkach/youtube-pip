import { describe, it, expect, afterEach } from 'vitest';
import { getGlobalMetadata } from '../VersionDetector';

describe('VersionDetector', () => {
  const originalUserAgent = navigator.userAgent;
  const originalYtcfg = typeof window !== 'undefined' ? window.ytcfg : undefined;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    if (typeof window !== 'undefined') window.ytcfg = originalYtcfg;
  });

  it('getGlobalMetadata returns scriptVersion from define', () => {
    const meta = getGlobalMetadata();
    expect(meta.scriptVersion).toBeDefined();
    expect(typeof meta.scriptVersion).toBe('string');
  });

  it('getGlobalMetadata returns youtubeVersion from ytcfg when present', () => {
    window.ytcfg = {
      data_: { INNERTUBE_CONTEXT: { client: { clientVersion: '1.20260208.00.00' } } },
    };
    const meta = getGlobalMetadata();
    expect(meta.youtubeVersion).toBe('1.20260208.00.00');
  });

  it('getGlobalMetadata returns unknown when ytcfg missing', () => {
    window.ytcfg = undefined;
    const meta = getGlobalMetadata();
    expect(meta.youtubeVersion).toBe('unknown');
  });

  it('getGlobalMetadata adds youtubeFeatureFlags when EXPERIMENT_FLAGS present', () => {
    window.ytcfg = { data_: { EXPERIMENT_FLAGS: { foo: true } } };
    const meta = getGlobalMetadata();
    expect(meta.youtubeFeatureFlags).toEqual({ foo: true });
  });

  it('getGlobalMetadata returns browserVersion from userAgent (Chrome)', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toMatch(/Chrome\/120/);
  });

  it('getGlobalMetadata returns Edge when Edg/ in userAgent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toMatch(/Edge\/120/);
  });

  it('getGlobalMetadata returns Firefox when Firefox/ in userAgent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0',
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toMatch(/Firefox\/121/);
  });

  it('getGlobalMetadata returns Safari when Version/ and Safari in userAgent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toMatch(/Safari\/17/);
  });

  it('getGlobalMetadata returns unknown when userAgent empty', () => {
    Object.defineProperty(navigator, 'userAgent', { value: '', configurable: true });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toBe('unknown');
  });

  it('getGlobalMetadata does not add youtubeFeatureFlags when empty', () => {
    window.ytcfg = { data_: {} };
    const meta = getGlobalMetadata();
    expect(meta.youtubeFeatureFlags).toBeUndefined();
  });

  it('getGlobalMetadata handles ytcfg getter throwing', () => {
    let count = 0;
    Object.defineProperty(window, 'ytcfg', {
      get() {
        count++;
        if (count === 1) throw new Error('ytcfg');
        return { data_: {} };
      },
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.youtubeVersion).toBe('unknown');
    expect(meta.youtubeFeatureFlags).toBeUndefined();
    delete (window as unknown as { ytcfg?: unknown }).ytcfg;
    window.ytcfg = originalYtcfg;
  });

  it('getGlobalMetadata handles navigator.userAgent throwing', () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', {
      get: () => {
        throw new Error('userAgent');
      },
      configurable: true,
    });
    const meta = getGlobalMetadata();
    expect(meta.browserVersion).toBe('unknown');
    if (orig) Object.defineProperty(navigator, 'userAgent', orig);
  });

  it('getGlobalMetadata handles EXPERIMENT_FLAGS access throwing', () => {
    const data: Record<string, unknown> = {
      INNERTUBE_CONTEXT: { client: { clientVersion: '1.0' } },
    };
    Object.defineProperty(data, 'EXPERIMENT_FLAGS', {
      get: () => {
        throw new Error('EXPERIMENT_FLAGS');
      },
      configurable: true,
    });
    window.ytcfg = { data_: data };
    const meta = getGlobalMetadata();
    expect(meta.youtubeVersion).toBe('1.0');
    expect(meta.youtubeFeatureFlags).toBeUndefined();
  });
});
