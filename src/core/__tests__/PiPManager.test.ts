import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createTestContainer,
  createMockLogger,
  createLoggerFactoryWithLogger,
} from '../../test-utils/test-container';
import {
  createFakeWindow,
  createFakePlayer,
  createFakeNotifyRenderer,
} from '../../test-utils/test-helpers';
import { LoggerFactory } from '../../logger';
import { createPiPManagerMocks } from './__mocks__/PiPManager.mock';
import { PiPManager } from '../PiPManager';
import { MiniPlayerController } from '../../ui/MiniPlayerController';
import { PlayerManager } from '../PlayerManager';
import { YtdAppProvider } from '../YtdAppProvider';
import { PipWindowProvider } from '../PipWindowProvider';
import { PiPWindowHandlers } from '../PiPWindowHandlers';
import { SELECTORS } from '../../selectors';
import { TIMEOUTS } from '../../constants';
import { PiPError } from '../../errors/PiPError';
import { PiPCriticalError } from '../../errors/PiPCriticalError';

/** Trigger close (same as pagehide handler) and await all async work; use with fake timers + runAllTimersAsync */
async function awaitClose(manager: PiPManager): Promise<void> {
  const closePromise = manager['close']();
  await vi.runAllTimersAsync();
  await closePromise;
}

describe('PiPManager', () => {
  let manager: PiPManager;
  let mocks: ReturnType<typeof createPiPManagerMocks>;

  beforeEach(() => {
    mocks = createPiPManagerMocks();
    const c = createTestContainer();
    c.bind(MiniPlayerController).toInstance(mocks.miniPlayerController);
    c.bind(PlayerManager).toInstance(mocks.playerManager);
    c.bind(YtdAppProvider).toInstance(mocks.ytdAppProvider);
    c.bind(PipWindowProvider).toInstance(mocks.pipProvider);
    c.bind(PiPWindowHandlers).toInstance(mocks.pipWindowHandlers);
    c.bind(PiPManager).toSelf();
    manager = c.get(PiPManager);
  });

  it('isOpen returns false when pip window is null', () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    expect(manager.isOpen()).toBe(false);
  });

  it('isOpen returns true when pip window is set', () => {
    mocks.pipProvider.getWindow.mockReturnValue(window);
    expect(manager.isOpen()).toBe(true);
  });

  it('getWindow returns value from PipWindowProvider', () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    expect(manager.getWindow()).toBeNull();
    const win = window;
    mocks.pipProvider.getWindow.mockReturnValue(win);
    expect(manager.getWindow()).toBe(win);
  });

  it('open when already open logs warn and returns without calling handlers', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(window);

    await manager.open();

    expect(mocks.pipWindowHandlers.initialize).not.toHaveBeenCalled();
  });

  it('open throws PiPError when documentPictureInPicture not available', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(
      document.createElement('div') as never
    );
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    const orig = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: undefined,
      configurable: true,
    });

    await expect(manager.open()).rejects.toThrow('Error opening PiP');

    Object.defineProperty(window, 'documentPictureInPicture', { value: orig, configurable: true });
  });

  it('open throws PiPError when miniplayer-container not found', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(
      document.createElement('div') as never
    );
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    const orig = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: {
        requestWindow: vi
          .fn()
          .mockResolvedValue(
            createFakeWindow({ document: document.implementation.createHTMLDocument() })
          ),
      },
      configurable: true,
    });
    vi.spyOn(document, 'querySelector').mockReturnValue(null);

    const err = await manager.open().catch((e) => e);
    expect(err).toBeInstanceOf(PiPError);
    const pipErr = err as PiPError;
    expect(pipErr.cause).toBeInstanceOf(PiPError);
    expect(pipErr.cause).toMatchObject({
      message: 'miniplayer-container element not found',
    });

    vi.mocked(document.querySelector).mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', { value: orig, configurable: true });
  });

  it('open throws PiPError when requestWindow rejects', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(
      document.createElement('div') as never
    );
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    const orig = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const querySpy = vi
      .spyOn(document, 'querySelector')
      .mockReturnValue(document.createElement('div'));

    await expect(manager.open()).rejects.toThrow('Error opening PiP');

    querySpy.mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', { value: orig, configurable: true });
  });

  it('close when never opened returns early without error', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    const close = manager['close']();
    await expect(close).resolves.toBeUndefined();
  });

  it('movePlayerToMain returns early when placeholder or miniPlayerContainer is null', async () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    const movePlayerToMain = manager['movePlayerToMain'].bind(manager);
    await expect(movePlayerToMain()).resolves.toBeUndefined();
  });

  it('close catch logs when returnPlayerToMain throws', async () => {
    const mockLogger = createMockLogger();
    const c = createTestContainer();
    c.bind(MiniPlayerController).toInstance(mocks.miniPlayerController);
    c.bind(PlayerManager).toInstance(mocks.playerManager);
    c.bind(YtdAppProvider).toInstance(mocks.ytdAppProvider);
    c.bind(PipWindowProvider).toInstance(mocks.pipProvider);
    c.bind(PiPWindowHandlers).toInstance(mocks.pipWindowHandlers);
    c.bind(LoggerFactory).toInstance(createLoggerFactoryWithLogger(mockLogger));
    c.bind(PiPManager).toSelf();
    const mgr = c.get<PiPManager>(PiPManager);

    mocks.pipProvider.getWindow.mockReturnValue(window);
    mgr['returnPlayerToMain'] = vi.fn().mockRejectedValue(new Error('returnPlayerToMain failed'));

    const close = mgr['close']();
    await expect(close).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unhandled error in returnPlayerToMain:',
      expect.any(Error)
    );
  });

  it('updateTitle sets pip window title when window is open', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mocks.pipProvider.getWindow.mockReturnValue(pipWindow);
    manager.updateTitle('Test Video');
    expect(pipDoc.title).toContain('Test Video');
  });

  it('updateTitle includes notification count when getNotifyRenderer provides showNotificationCount', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mocks.pipProvider.getWindow.mockReturnValue(pipWindow);
    mocks.ytdAppProvider.getNotifyRenderer.mockReturnValue(
      createFakeNotifyRenderer({ showNotificationCount: 3 })
    );
    manager.updateTitle('My Video');
    expect(pipDoc.title).toContain('(3) ');
    expect(pipDoc.title).toContain('My Video');
  });

  it('open throws PiPCriticalError when pipDoc has no yt-draggable', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    // Do NOT add yt-draggable so pipDoc.querySelector returns null
    const pipWindow = createFakeWindow({
      document: pipDoc,
      addEventListener: vi.fn(),
      closed: false,
    });
    const miniplayerEl = document.createElement('div');
    const containerEl = document.createElement('div');
    const ytdAppEl = document.createElement(SELECTORS.YTD_APP);

    mocks.pipProvider.getWindow
      .mockReturnValue(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(pipWindow);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(miniplayerEl as never);
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    mocks.ytdAppProvider.getApp.mockReturnValue(ytdAppEl as never);

    const origDpp = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: vi.fn().mockResolvedValue(pipWindow) },
      configurable: true,
    });

    const querySelector = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.MINIPLAYER_CONTAINER) return containerEl;
      return null;
    });

    const err = await manager.open().catch((e) => e);
    expect(err).toBeInstanceOf(PiPCriticalError);
    expect(err).toMatchObject({ message: 'yt-draggable element not found' });

    querySelector.mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: origDpp,
      configurable: true,
    });
  });

  it('open when getWindow returns null after movePlayerToPIP skips handlers', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const draggableEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(draggableEl);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      addEventListener: vi.fn(),
      closed: false,
    });
    const miniplayerEl = document.createElement('div');
    const containerEl = document.createElement('div');
    const ytdAppEl = document.createElement(SELECTORS.YTD_APP);

    mocks.pipProvider.getWindow.mockReturnValue(null);
    mocks.pipProvider.setWindow.mockImplementation(() => {});
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(miniplayerEl as never);
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    mocks.ytdAppProvider.getApp.mockReturnValue(ytdAppEl as never);

    const origDpp = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: vi.fn().mockResolvedValue(pipWindow) },
      configurable: true,
    });

    const querySelector = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.MINIPLAYER_CONTAINER) return containerEl;
      return null;
    });
    const pipQuerySelector = vi.spyOn(pipDoc, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.YT_DRAGGABLE) return draggableEl;
      return null;
    });

    await manager.open();

    expect(mocks.pipWindowHandlers.initialize).not.toHaveBeenCalled();
    querySelector.mockRestore();
    pipQuerySelector.mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: origDpp,
      configurable: true,
    });
  });

  it('open when handlers.initialize returns non-function does not set onBeforeReturn', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const draggableEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(draggableEl);
    const pipWindow = createFakeWindow({
      document: pipDoc,
      addEventListener: vi.fn(),
      closed: false,
    });
    const miniplayerEl = document.createElement('div');
    const containerEl = document.createElement('div');
    const ytdAppEl = document.createElement(SELECTORS.YTD_APP);

    mocks.pipProvider.getWindow
      .mockReturnValue(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(pipWindow);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(miniplayerEl as never);
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    mocks.ytdAppProvider.getApp.mockReturnValue(ytdAppEl as never);
    mocks.pipWindowHandlers.initialize.mockResolvedValue(undefined as never);
    mocks.playerManager.getPlayer.mockReturnValue(
      createFakePlayer({ getPlayerState: vi.fn(), playVideo: vi.fn() })
    );
    mocks.playerManager.savePlayingState.mockImplementation(() => {});
    mocks.playerManager.restorePlayingState.mockImplementation(() => {});
    mocks.playerManager.waitForMainPlayer.mockResolvedValue(document.createElement('div') as never);
    mocks.playerManager.waitForMiniPlayer.mockResolvedValue(miniplayerEl as never);

    const origDpp = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: vi.fn().mockResolvedValue(pipWindow) },
      configurable: true,
    });

    const querySelector = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.MINIPLAYER_CONTAINER) return containerEl;
      if (sel === SELECTORS.YT_DRAGGABLE) return document.createElement('div');
      return null;
    });
    const pipQuerySelector = vi.spyOn(pipDoc, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.YT_DRAGGABLE) return draggableEl;
      return null;
    });

    vi.useFakeTimers();
    await manager.open();
    expect(mocks.pipWindowHandlers.initialize).toHaveBeenCalled();

    await awaitClose(manager);

    vi.useRealTimers();
    querySelector.mockRestore();
    pipQuerySelector.mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: origDpp,
      configurable: true,
    });
  });

  it('updateTitle when pip closed does not throw (setWindowsTitle skips when window null)', () => {
    mocks.pipProvider.getWindow.mockReturnValue(null);
    expect(() => manager.updateTitle('Test')).not.toThrow();
  });

  it('open stores onBeforeReturn when handlers.initialize returns a function', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({
      document: pipDoc,
      addEventListener: vi.fn(),
      closed: false,
    });
    const miniplayerEl = document.createElement('div');
    const containerEl = document.createElement('div');
    const ytdAppEl = document.createElement(SELECTORS.YTD_APP);
    const draggableEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(draggableEl);

    mocks.pipProvider.getWindow
      .mockReturnValue(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(pipWindow);
    mocks.miniPlayerController.getMiniplayer.mockReturnValue(miniplayerEl as never);
    mocks.miniPlayerController.isVisible.mockReturnValue(true);
    mocks.ytdAppProvider.getApp.mockReturnValue(ytdAppEl as never);
    mocks.pipWindowHandlers.initialize.mockResolvedValue(() => Promise.resolve());

    const origDpp = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: {
        requestWindow: vi.fn().mockResolvedValue(pipWindow),
      },
      configurable: true,
    });

    const querySelector = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.MINIPLAYER_CONTAINER) return containerEl;
      return null;
    });
    const pipQuerySelector = vi.spyOn(pipDoc, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.YT_DRAGGABLE) return draggableEl;
      return null;
    });

    await manager.open();

    expect(mocks.pipWindowHandlers.initialize).toHaveBeenCalledWith(miniplayerEl);
    querySelector.mockRestore();
    pipQuerySelector.mockRestore();
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: origDpp,
      configurable: true,
    });
  });
});

describe('PiPManager (integration)', () => {
  let manager: PiPManager;
  let pipWindow: Window;
  let pipDoc: Document;
  let miniplayerEl: HTMLElement;
  let containerEl: HTMLElement;
  let mainDraggable: HTMLElement;
  let ytdAppEl: HTMLElement;
  let mockMiniController: ReturnType<typeof createPiPManagerMocks>['miniPlayerController'];
  let mockPlayerManager: ReturnType<typeof createPiPManagerMocks>['playerManager'];
  let mockYtdAppProvider: ReturnType<typeof createPiPManagerMocks>['ytdAppProvider'];
  let mockPipHandlers: ReturnType<typeof createPiPManagerMocks>['pipWindowHandlers'];
  let origDpp: typeof window.documentPictureInPicture;
  let pipQuerySelectorRestore: () => void;

  function buildPipWindow(doc: Document): Window {
    const listeners: { type: string; handler: (e: Event) => void }[] = [];
    return createFakeWindow({
      document: doc,
      closed: false,
      addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
        listeners.push({ type, handler });
      }),
      dispatchEvent: vi.fn((e: Event) => {
        listeners.filter((l) => l.type === e.type).forEach((l) => l.handler(e));
        return true;
      }),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    pipDoc = document.implementation.createHTMLDocument();
    const pipDraggable = pipDoc.createElement(SELECTORS.YT_DRAGGABLE);
    pipDoc.body.appendChild(pipDraggable);
    const pipQuerySpy = vi.spyOn(pipDoc, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.YT_DRAGGABLE) return pipDraggable;
      return null;
    });
    pipQuerySelectorRestore = () => pipQuerySpy.mockRestore();
    pipWindow = buildPipWindow(pipDoc);

    miniplayerEl = document.createElement(SELECTORS.MINIPLAYER);
    containerEl = document.createElement(SELECTORS.MINIPLAYER_CONTAINER);
    mainDraggable = document.createElement(SELECTORS.YT_DRAGGABLE);
    ytdAppEl = document.createElement(SELECTORS.YTD_APP);
    document.body.appendChild(mainDraggable);
    document.body.appendChild(containerEl);
    document.body.appendChild(ytdAppEl);
    document.body.appendChild(miniplayerEl);

    mockMiniController = createPiPManagerMocks().miniPlayerController;
    mockPlayerManager = createPiPManagerMocks().playerManager;
    mockYtdAppProvider = createPiPManagerMocks().ytdAppProvider;
    mockPipHandlers = createPiPManagerMocks().pipWindowHandlers;

    mockMiniController.getMiniplayer.mockReturnValue(miniplayerEl as never);
    mockMiniController.isVisible.mockReturnValue(true);
    mockMiniController.toggleMiniPlayer.mockImplementation(() => {});
    mockPlayerManager.getPlayer.mockReturnValue(
      createFakePlayer({ getPlayerState: vi.fn(), playVideo: vi.fn() })
    );
    mockPlayerManager.savePlayingState.mockImplementation(() => {});
    mockPlayerManager.restorePlayingState.mockImplementation(() => {});
    mockPlayerManager.waitForMainPlayer.mockResolvedValue(document.createElement('div') as never);
    mockPlayerManager.waitForMiniPlayer.mockResolvedValue(miniplayerEl as never);
    mockYtdAppProvider.getApp.mockReturnValue(ytdAppEl as never);
    mockPipHandlers.initialize.mockResolvedValue(() => Promise.resolve());

    origDpp = window.documentPictureInPicture;
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: { requestWindow: vi.fn().mockResolvedValue(pipWindow) },
      configurable: true,
    });

    const c = createTestContainer();
    c.bind(MiniPlayerController).toInstance(mockMiniController);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    c.bind(PipWindowProvider).toSelf();
    c.bind(PiPWindowHandlers).toInstance(mockPipHandlers);
    c.bind(PiPManager).toSelf();
    manager = c.get(PiPManager);
  });

  afterEach(() => {
    pipQuerySelectorRestore?.();
    vi.useRealTimers();
    Object.defineProperty(window, 'documentPictureInPicture', {
      value: origDpp,
      configurable: true,
    });
    miniplayerEl?.remove();
    containerEl?.remove();
    mainDraggable?.remove();
    ytdAppEl?.remove();
  });

  it('full flow: open then close returns player to main', async () => {
    await manager.open();
    expect(manager.isOpen()).toBe(true);
    expect(manager.getWindow()).toBe(pipWindow);

    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(manager.isOpen()).toBe(false);
    expect(miniplayerEl.parentNode).toBe(document.body);
    expect(mockPlayerManager.savePlayingState).toHaveBeenCalled();
    expect(mockPlayerManager.restorePlayingState).toHaveBeenCalled();
  });

  it('full flow: open with mini player inactive waits for container then opens', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockResolvedValue(containerEl as never);

    await manager.open();

    expect(DOMUtils.waitForElementSelector).toHaveBeenCalledWith(SELECTORS.MINIPLAYER_CONTAINER);
    expect(mockMiniController.toggleMiniPlayer).toHaveBeenCalled();
    expect(manager.isOpen()).toBe(true);
    vi.mocked(DOMUtils.waitForElementSelector).mockRestore();
  });

  it('full flow: open with mini inactive then close calls toggleMiniPlayer and waitForMainPlayer on return', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockResolvedValue(containerEl as never);

    await manager.open();
    expect(manager.isOpen()).toBe(true);

    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(mockMiniController.toggleMiniPlayer).toHaveBeenCalledTimes(2); // open + close
    expect(mockPlayerManager.waitForMainPlayer).toHaveBeenCalled();
    vi.mocked(DOMUtils.waitForElementSelector).mockRestore();
  });

  it('full flow: close when miniplayerContainer not in DOM skips remove (defensive branch)', async () => {
    await manager.open();
    expect(manager.isOpen()).toBe(true);

    const origQuerySelector = document.querySelector.bind(document);
    const querySpy = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === SELECTORS.MINIPLAYER_CONTAINER) return null;
      return origQuerySelector(sel);
    });

    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    querySpy.mockRestore();
  });

  it('full flow: onBeforeReturn is called when closing', async () => {
    const onBeforeReturn = vi.fn().mockResolvedValue(undefined);
    mockPipHandlers.initialize.mockResolvedValue(onBeforeReturn);

    await manager.open();
    await awaitClose(manager);

    expect(onBeforeReturn).toHaveBeenCalled();
    expect(manager.getWindow()).toBeNull();
  });

  it('full flow: onBeforeReturn throwing is caught and close still completes', async () => {
    const onBeforeReturn = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    mockPipHandlers.initialize.mockResolvedValue(onBeforeReturn);

    await manager.open();
    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
  });

  it('phantom window check: when pip window closed triggers cleanup', async () => {
    await manager.open();
    expect(manager.isOpen()).toBe(true);

    Object.defineProperty(pipWindow, 'closed', { value: true, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.PHANTOM_WINDOW_CHECK);
    await vi.runAllTimersAsync();

    expect(manager.getWindow()).toBeNull();
  });

  it('full flow: when mini player was active before PiP, restore path calls activateMiniPlayer and waitForMiniPlayer', async () => {
    mockMiniController.isVisible.mockReturnValue(true);
    mockMiniController.activateMiniPlayer.mockImplementation(() => {});

    await manager.open();
    pipDoc.title = '';
    manager.updateTitle('Should Not Sync From Mini');
    expect(pipDoc.title).not.toContain('Should Not Sync From Mini');

    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(mockMiniController.activateMiniPlayer).toHaveBeenCalled();
    expect(mockPlayerManager.waitForMiniPlayer).toHaveBeenCalled();
  });

  it('full flow: when mini player was active and waitForMiniPlayer rejects, close still completes', async () => {
    mockMiniController.isVisible.mockReturnValue(true);
    mockMiniController.activateMiniPlayer.mockImplementation(() => {});
    mockPlayerManager.waitForMiniPlayer.mockRejectedValue(new Error('timeout'));

    await manager.open();
    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(mockPlayerManager.waitForMiniPlayer).toHaveBeenCalled();
  });

  it('full flow: when yt-draggable missing on return, error is caught and window still cleared', async () => {
    await manager.open();
    mainDraggable.remove();
    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(manager.isOpen()).toBe(false);
  });
});
