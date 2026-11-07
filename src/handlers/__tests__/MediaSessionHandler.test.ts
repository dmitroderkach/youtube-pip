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
    vi.stubGlobal('navigator', { ...navigator, mediaSession: { setActionHandler } });
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
    vi.stubGlobal('navigator', { ...navigator, mediaSession: { setActionHandler } });
    handler.initialize();
    mockPipManager.open.mockRejectedValue(new Error('PiP denied'));
    actionCb();
    expect(mockPipManager.open).toHaveBeenCalled();
  });

  it('ignores later page attempts to replace or clear enterpictureinpicture handler', () => {
    const setActionHandler = vi.fn();
    const mediaSession = { setActionHandler } as unknown as MediaSession;
    vi.stubGlobal('navigator', { ...navigator, mediaSession });
    handler.initialize();
    const ours = setActionHandler.mock.calls[0][1] as () => void;

    mediaSession.setActionHandler('enterpictureinpicture', () => {});
    mediaSession.setActionHandler('enterpictureinpicture', null);

    expect(setActionHandler).toHaveBeenCalledTimes(1);
    mockPipManager.open.mockResolvedValue(undefined);
    ours();
    expect(mockPipManager.open).toHaveBeenCalled();
  });

  it('passes other media session actions through to the original setActionHandler', () => {
    const setActionHandler = vi.fn();
    const mediaSession = { setActionHandler } as unknown as MediaSession;
    vi.stubGlobal('navigator', { ...navigator, mediaSession });
    handler.initialize();
    const play = (): void => {};

    mediaSession.setActionHandler('play', play);
    mediaSession.setActionHandler('pause', null);

    expect(setActionHandler).toHaveBeenCalledWith('play', play);
    expect(setActionHandler).toHaveBeenCalledWith('pause', null);
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
});
