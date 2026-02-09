import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeYtdApp, createFakeYtdAppWithFire } from '../../test-utils/test-helpers';
import { MiniPlayerController } from '../MiniPlayerController';
import { PlayerManager } from '../../core/PlayerManager';
import { YtdAppProvider } from '../../core/YtdAppProvider';
import { YT_EVENTS, YT_ACTION_NAMES, UI_CLASSES } from '../../constants';

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    waitForElementSelector: vi.fn(),
  },
}));

describe('MiniPlayerController', () => {
  let controller: MiniPlayerController;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;
  let mockFire: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFire = vi.fn();
    mockPlayerManager = mock<PlayerManager>();
    mockYtdAppProvider = mock<YtdAppProvider>();
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdAppWithFire(mockFire, false));

    const { DOMUtils } = await import('../../utils/DOMUtils');
    const miniplayerEl = document.createElement('div');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(miniplayerEl as never);

    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    controller = c.get(MiniPlayerController);
    await controller.initialize();
  });

  it('getMiniplayer returns initialized element', () => {
    expect(controller.getMiniplayer()).toBeDefined();
  });

  it('isVisible returns true when MINIPLAYER_HOST in document', () => {
    const host = document.createElement('div');
    host.className = UI_CLASSES.MINIPLAYER_HOST;
    document.body.appendChild(host);
    expect(controller.isVisible()).toBe(true);
    host.remove();
  });

  it('isVisible returns false when MINIPLAYER_HOST not in document', () => {
    expect(controller.isVisible()).toBe(false);
  });

  it('activateMiniPlayer calls fire with ACTIVATE_MINIPLAYER', () => {
    controller.activateMiniPlayer();
    expect(mockFire).toHaveBeenCalledWith(YT_EVENTS.ACTION, {
      actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER,
      args: [false],
      optionalAction: false,
      returnValue: [undefined],
    });
  });

  it('toggleMiniPlayer when not active calls fire with ACTIVATE_MINIPLAYER_FROM_WATCH', () => {
    controller.toggleMiniPlayer();
    expect(mockFire).toHaveBeenCalledWith(YT_EVENTS.ACTION, {
      actionName: YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH,
      args: null,
      optionalAction: false,
      returnValue: [undefined],
    });
  });

  it('toggleMiniPlayer when miniplayerIsActive calls fire with NAVIGATE and getVideoId', () => {
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdAppWithFire(mockFire, true));
    mockPlayerManager.getVideoId.mockReturnValue('vid123');
    controller.toggleMiniPlayer();
    expect(mockFire).toHaveBeenCalledWith(YT_EVENTS.NAVIGATE, {
      endpoint: { watchEndpoint: { videoId: 'vid123' } },
    });
  });

  it('initialize throws AppInitializationError when miniplayer not found', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValue(new Error('timeout'));
    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    const ctrl = c.get(MiniPlayerController) as MiniPlayerController;
    const { AppInitializationError } = await import('../../errors/AppInitializationError');
    await expect(ctrl.initialize()).rejects.toThrow(AppInitializationError);
  });

  it('activateMiniPlayer does nothing when fire is not function', () => {
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdApp({ fire: undefined }));
    controller.activateMiniPlayer();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('toggleMiniPlayer does nothing when fire is not function', () => {
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdApp({ fire: undefined }));
    controller.toggleMiniPlayer();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('toggleMiniPlayer when miniplayerIsActive and no videoId does not fire', () => {
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdAppWithFire(mockFire, true));
    mockPlayerManager.getVideoId.mockReturnValue(null);
    controller.toggleMiniPlayer();
    expect(mockFire).not.toHaveBeenCalled();
  });

  it('activateMiniPlayer logs error when fire throws', () => {
    mockFire.mockImplementationOnce(() => {
      throw new Error('fire failed');
    });
    expect(() => controller.activateMiniPlayer()).not.toThrow();
  });

  it('toggleMiniPlayer logs error when fire throws', () => {
    mockFire.mockImplementationOnce(() => {
      throw new Error('toggle fire failed');
    });
    expect(() => controller.toggleMiniPlayer()).not.toThrow();
  });
});
