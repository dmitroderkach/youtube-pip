import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { MediaSessionHandler } from '../MediaSessionHandler';
import { PiPManager } from '../../core/PiPManager';
import { AppInitializationError } from '../../errors/AppInitializationError';

/** Navigator type for tests that remove mediaSession */
type NavigatorWithoutMediaSession = Omit<Navigator, 'mediaSession'> & {
  mediaSession?: unknown;
};

/** MediaSession type for metadata tests */
type MediaSessionWithMetadata<T = unknown> = {
  setActionHandler: (action: string, cb: () => void) => void;
  metadata?: T;
};

describe('MediaSessionHandler', () => {
  let handler: MediaSessionHandler;
  let mockPipManager: MockProxy<PiPManager>;

  beforeEach(() => {
    mockPipManager = mock<PiPManager>();
    const c = createTestContainer();
    c.bind(PiPManager).toInstance(mockPipManager);
    c.bind(MediaSessionHandler).toSelf();
    handler = c.get(MediaSessionHandler);
  });

  it('initialize when mediaSession not in navigator does not throw', () => {
    const nav = { ...navigator };
    vi.stubGlobal('navigator', nav);
    expect(() => handler.initialize()).not.toThrow();
  });

  it('registerActionHandler when mediaSession not in navigator returns early', () => {
    const nav = { ...navigator };
    delete (nav as NavigatorWithoutMediaSession).mediaSession;
    vi.stubGlobal('navigator', nav);
    expect(() => handler['registerActionHandler']()).not.toThrow();
  });

  it('setupTitleSync when mediaSession not in navigator returns early', () => {
    const nav = { ...navigator };
    delete (nav as NavigatorWithoutMediaSession).mediaSession;
    vi.stubGlobal('navigator', nav);
    expect(() => handler['setupTitleSync']()).not.toThrow();
  });

  it('initialize when mediaSession exists registers action handler', () => {
    const setActionHandler = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaSession: { setActionHandler },
    });
    handler.initialize();
    expect(setActionHandler).toHaveBeenCalledWith('enterpictureinpicture', expect.any(Function));
  });

  it('enterpictureinpicture callback calls pipManager.open', () => {
    let actionCb: () => void = () => {};
    const setActionHandler = vi.fn((_action: string, cb: () => void) => {
      actionCb = cb;
    });
    const metaDesc = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      configurable: true,
      enumerable: true,
    };
    const mediaSessionObj: { setActionHandler: ReturnType<typeof vi.fn>; metadata?: unknown } = {
      setActionHandler,
    };
    Object.defineProperty(mediaSessionObj, 'metadata', metaDesc);
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', metaDesc);
    Object.setPrototypeOf(mediaSessionObj, proto);
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    handler.initialize();
    mockPipManager.open.mockResolvedValue(undefined);
    actionCb();
    expect(mockPipManager.open).toHaveBeenCalled();
  });

  it('enterpictureinpicture when open rejects logs error', () => {
    let actionCb: () => void = () => {};
    const setActionHandler = vi.fn((_action: string, cb: () => void) => {
      actionCb = cb;
    });
    const metaDesc = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      configurable: true,
      enumerable: true,
    };
    const mediaSessionObj: { setActionHandler: ReturnType<typeof vi.fn>; metadata?: unknown } = {
      setActionHandler,
    };
    Object.defineProperty(mediaSessionObj, 'metadata', metaDesc);
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', metaDesc);
    Object.setPrototypeOf(mediaSessionObj, proto);
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    handler.initialize();
    mockPipManager.open.mockRejectedValue(new Error('PiP denied'));
    actionCb();
    expect(mockPipManager.open).toHaveBeenCalled();
  });

  it('registerActionHandler throws AppInitializationError when setActionHandler throws', () => {
    const setActionHandler = vi.fn().mockImplementation(() => {
      throw new Error('not supported');
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaSession: { setActionHandler },
    });
    expect(() => handler.initialize()).toThrow(AppInitializationError);
  });

  it('setupTitleSync when descriptor invalid (no get/set) does not throw', () => {
    const setActionHandler = vi.fn();
    const proto = Object.create(null);
    const mediaSession = Object.create(proto);
    mediaSession.setActionHandler = setActionHandler;
    vi.stubGlobal('navigator', { ...navigator, mediaSession });
    expect(() => handler.initialize()).not.toThrow();
  });

  it('setupTitleSync when metadata descriptor has no get/set logs warn', () => {
    const setActionHandler = vi.fn();
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', {
      value: null,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    const mediaSession = Object.create(proto);
    mediaSession.setActionHandler = setActionHandler;
    vi.stubGlobal('navigator', { ...navigator, mediaSession });
    expect(() => handler.initialize()).not.toThrow();
  });

  it('setupTitleSync throws when defineProperty throws', () => {
    const setActionHandler = vi.fn();
    const metaDesc = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      configurable: true,
      enumerable: true,
    };
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', metaDesc);
    const mediaSessionObj = Object.create(proto);
    mediaSessionObj.setActionHandler = setActionHandler;
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    const origDefine = Object.defineProperty;
    Object.defineProperty = vi
      .fn()
      .mockImplementation((o: object, p: PropertyKey, attributes?: PropertyDescriptor) => {
        if (p === 'metadata') throw new Error('defineProperty failed');
        return origDefine.call(Object, o, p, attributes!);
      }) as typeof Object.defineProperty;
    expect(() => handler.initialize()).toThrow(AppInitializationError);
    Object.defineProperty = origDefine;
  });

  it('metadata setter does not call updateTitle when value has no title', () => {
    const metaGet = vi.fn().mockReturnValue(null);
    const metaSet = vi.fn();
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', {
      get: metaGet,
      set: metaSet,
      configurable: true,
      enumerable: true,
    });
    const mediaSessionObj = Object.create(proto);
    mediaSessionObj.setActionHandler = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    handler.initialize();
    (navigator.mediaSession as MediaSessionWithMetadata<{ artist: string }>).metadata = {
      artist: 'Only artist',
    };
    expect(mockPipManager.updateTitle).not.toHaveBeenCalled();
  });

  it('metadata setter calls pipManager.updateTitle when value has title', () => {
    const metaGet = vi.fn().mockReturnValue(null);
    const metaSet = vi.fn();
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', {
      get: metaGet,
      set: metaSet,
      configurable: true,
      enumerable: true,
    });
    const mediaSessionObj = Object.create(proto);
    mediaSessionObj.setActionHandler = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    handler.initialize();
    (navigator.mediaSession as MediaSessionWithMetadata<{ title: string }>).metadata = {
      title: 'My Video',
    };
    expect(mockPipManager.updateTitle).toHaveBeenCalledWith('My Video');
  });

  it('metadata getter delegates to original descriptor', () => {
    const metaGet = vi.fn().mockReturnValue({ title: 'Test' });
    const metaSet = vi.fn();
    const proto = Object.create(null);
    Object.defineProperty(proto, 'metadata', {
      get: metaGet,
      set: metaSet,
      configurable: true,
      enumerable: true,
    });
    const mediaSessionObj = Object.create(proto);
    mediaSessionObj.setActionHandler = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaSession: mediaSessionObj });
    handler.initialize();
    const value = (navigator.mediaSession as MediaSessionWithMetadata).metadata;
    expect(metaGet).toHaveBeenCalled();
    expect(value).toEqual({ title: 'Test' });
  });
});
