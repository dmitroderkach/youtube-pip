import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { YtdPlayerElement } from '../../types/youtube';
import {
  createTestContainer,
  createMockLogger,
  createLoggerFactoryWithLogger,
} from '../../test-utils/test-container';
import { createFakeWindow, createFakePlayer } from '../../test-utils/test-helpers';
import { LoggerFactory } from '../../logger';
import { createPiPManagerMocks } from './__mocks__/PiPManager.mock';
import { PiPManager } from '../PiPManager';
import { MiniPlayerController } from '../../ui/MiniPlayerController';
import { PlayerManager } from '../PlayerManager';
import { YtdAppProvider } from '../YtdAppProvider';
import { PipWindowProvider } from '../PipWindowProvider';
import { PiPWindowHandlers } from '../PiPWindowHandlers';
import { PipShortsWindowHandlers } from '../PipShortsWindowHandlers';
import { TitleSyncHandler } from '../../handlers/TitleSyncHandler';
import { YtdShortsProvider } from '../YtdShortsProvider';
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
    c.bind(YtdShortsProvider).toInstance(mocks.ytdShortsProvider);
    c.bind(PipWindowProvider).toInstance(mocks.pipProvider);
    c.bind(PiPWindowHandlers).toInstance(mocks.pipWindowHandlers);
    c.bind(PipShortsWindowHandlers).toInstance(mocks.pipShortsWindowHandlers);
    c.bind(TitleSyncHandler).toInstance(mocks.titleSyncHandler);
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
    mocks.playerManager.getWasMiniPlayerActiveBeforePiP.mockReturnValue(true);
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
    mocks.playerManager.getWasMiniPlayerActiveBeforePiP.mockReturnValue(true);
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
    c.bind(YtdShortsProvider).toInstance(mocks.ytdShortsProvider);
    c.bind(PipWindowProvider).toInstance(mocks.pipProvider);
    c.bind(PiPWindowHandlers).toInstance(mocks.pipWindowHandlers);
    c.bind(PipShortsWindowHandlers).toInstance(mocks.pipShortsWindowHandlers);
    c.bind(TitleSyncHandler).toInstance(mocks.titleSyncHandler);
    c.bind(LoggerFactory).toInstance(createLoggerFactoryWithLogger(mockLogger));
    c.bind(PiPManager).toSelf();
    const mgr = c.get<PiPManager>(PiPManager);

    mocks.pipProvider.getWindow.mockReturnValue(window);
    mgr['returnPlayerToMain'] = vi.fn().mockRejectedValue(new Error('returnPlayerToMain failed'));

    const close = mgr['close']();
    await expect(close).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unhandled error in return to main:',
      expect.any(Error)
    );
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
  let mockYtdShortsProvider: ReturnType<typeof createPiPManagerMocks>['ytdShortsProvider'];
  let mockPipHandlers: ReturnType<typeof createPiPManagerMocks>['pipWindowHandlers'];
  let mockPipShortsHandlers: ReturnType<typeof createPiPManagerMocks>['pipShortsWindowHandlers'];
  let mockTitleSync: ReturnType<typeof createPiPManagerMocks>['titleSyncHandler'];
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

    const mocks = createPiPManagerMocks();
    mockMiniController = mocks.miniPlayerController;
    mockPlayerManager = mocks.playerManager;
    mockYtdAppProvider = mocks.ytdAppProvider;
    mockYtdShortsProvider = mocks.ytdShortsProvider;
    mockPipHandlers = mocks.pipWindowHandlers;
    mockPipShortsHandlers = mocks.pipShortsWindowHandlers;
    mockTitleSync = mocks.titleSyncHandler;

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
    c.bind(YtdShortsProvider).toInstance(mockYtdShortsProvider);
    c.bind(PipWindowProvider).toSelf();
    c.bind(PiPWindowHandlers).toInstance(mockPipHandlers);
    c.bind(PipShortsWindowHandlers).toInstance(mockPipShortsHandlers);
    c.bind(TitleSyncHandler).toInstance(mockTitleSync);
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

    const order: string[] = [];
    mockPlayerManager.restorePlayingState.mockImplementation(() => {
      order.push('player restored');
    });
    mockTitleSync.releasePageTitleWhenIdle.mockImplementation(() => {
      order.push('title released');
    });

    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(manager.isOpen()).toBe(false);
    expect(miniplayerEl.parentNode).toBe(document.body);
    // The title is held until the player is back (YouTube rewrites it while the mini player goes away)
    expect(order).toEqual(['player restored', 'title released']);
    expect(mockPlayerManager.savePlayingState).toHaveBeenCalled();
    expect(mockPlayerManager.restorePlayingState).toHaveBeenCalled();
  });

  it('open with mini player inactive waits for YouTube low-priority jobs before activating it', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    const { YouTubeScheduler } = await import('../../utils/YouTubeScheduler');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockResolvedValue(containerEl as never);
    const order: string[] = [];
    const barrier = vi
      .spyOn(YouTubeScheduler, 'waitForLowPriorityJobs')
      .mockImplementation(async () => {
        order.push('barrier');
      });
    mockMiniController.toggleMiniPlayer.mockImplementation(() => {
      order.push('toggle');
    });
    mockTitleSync.holdPageTitle.mockImplementation(() => {
      order.push('hold title');
    });

    await manager.open();

    // The title is held before YouTube's mini player switches it to "YouTube"
    expect(order).toEqual(['barrier', 'hold title', 'toggle']);
    barrier.mockRestore();
    vi.mocked(DOMUtils.waitForElementSelector).mockRestore();
  });

  it('full flow: open with mini player inactive waits for container then opens', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockResolvedValue(containerEl as never);

    await manager.open();

    expect(DOMUtils.waitForElementSelector).toHaveBeenCalledWith(SELECTORS.MINIPLAYER_CONTAINER);
    expect(DOMUtils.waitForElementSelector).toHaveBeenCalledWith(
      SELECTORS.MOVIE_PLAYER,
      containerEl
    );
    expect(mockMiniController.toggleMiniPlayer).toHaveBeenCalled();
    expect(manager.isOpen()).toBe(true);
    vi.mocked(DOMUtils.waitForElementSelector).mockRestore();
  });

  it('open with mini inactive fails without opening a window when the player never reaches the container', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockImplementation(((sel: string) =>
      sel === SELECTORS.MOVIE_PLAYER
        ? Promise.reject(new Error(`Timeout: ${sel} not found`))
        : Promise.resolve(containerEl)) as never);

    await expect(manager.open()).rejects.toThrow('Error opening PiP');

    expect(window.documentPictureInPicture!.requestWindow).not.toHaveBeenCalled();
    expect(manager.isOpen()).toBe(false);
    // The held title is released: YouTube manages it again
    expect(mockTitleSync.holdPageTitle).toHaveBeenCalled();
    expect(mockTitleSync.cleanup).toHaveBeenCalled();
    vi.mocked(DOMUtils.waitForElementSelector).mockRestore();
  });

  it('full flow: open with mini inactive opens PiP', async () => {
    mockMiniController.isVisible.mockReturnValue(false);
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.spyOn(DOMUtils, 'waitForElementSelector').mockResolvedValue(containerEl as never);

    await manager.open();

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

  describe('ytd-player parking (CoW-safe move)', () => {
    function addYtdPlayer(appendTo?: YtdPlayerElement['appendTo']): {
      ytdPlayer: YtdPlayerElement;
      slot: HTMLElement;
    } {
      const slot = document.createElement('div');
      const ytdPlayer = document.createElement(SELECTORS.YTD_PLAYER) as YtdPlayerElement;
      const moviePlayer = document.createElement('div');
      moviePlayer.id = SELECTORS.MOVIE_PLAYER.slice(1);
      ytdPlayer.appendChild(moviePlayer);
      if (appendTo) ytdPlayer.appendTo = appendTo;
      slot.appendChild(ytdPlayer);
      containerEl.appendChild(slot);
      return { ytdPlayer, slot };
    }

    it('moves ytd-player with appendTo via a holder and back into its slot on open and close', async () => {
      const appendTo = vi.fn(function (this: YtdPlayerElement, target: Element) {
        target.appendChild(this);
        return Promise.resolve();
      });
      const { ytdPlayer, slot } = addYtdPlayer(appendTo);

      await manager.open();
      expect(appendTo).toHaveBeenCalledTimes(2);
      expect(ytdPlayer.parentElement).toBe(slot);

      await awaitClose(manager);
      expect(appendTo).toHaveBeenCalledTimes(4);
      expect(ytdPlayer.parentElement).toBe(slot);
    });

    it('falls back to appendChild when appendTo rejects', async () => {
      const { ytdPlayer, slot } = addYtdPlayer(vi.fn().mockRejectedValue(new Error('boom')));

      await manager.open();

      expect(ytdPlayer.parentElement).toBe(slot);
    });

    it('falls back to appendChild when appendTo resolves without moving the player', async () => {
      const { ytdPlayer, slot } = addYtdPlayer(vi.fn().mockResolvedValue(undefined));

      await manager.open();

      expect(ytdPlayer.parentElement).toBe(slot);
    });

    it('uses appendChild when ytd-player has no appendTo', async () => {
      const { ytdPlayer, slot } = addYtdPlayer();

      await manager.open();
      await awaitClose(manager);

      expect(ytdPlayer.parentElement).toBe(slot);
    });

    it('puts the player into the fresh slot when a CoW component around it re-rendered during the move', async () => {
      // root > anchor > ytd-reel-video-renderer-cow > #player-container > ytd-player (Shorts with
      // web_migrate_reel_video_renderer_to_cow): moving root makes the CoW host drop its content and render anew
      const root = document.createElement('div');
      const anchor = document.createElement('div');
      const cowHost = document.createElement('ytd-reel-video-renderer-cow');
      const oldSlot = document.createElement('div');
      oldSlot.id = 'player-container';
      const ytdPlayer = document.createElement(SELECTORS.YTD_PLAYER) as YtdPlayerElement;
      const shortsPlayer = document.createElement('div');
      shortsPlayer.id = 'shorts-player';
      ytdPlayer.appendChild(shortsPlayer);
      oldSlot.appendChild(ytdPlayer);
      cowHost.appendChild(oldSlot);
      anchor.appendChild(cowHost);
      root.appendChild(anchor);
      document.body.appendChild(root);
      const pipDoc = document.implementation.createHTMLDocument();

      const parked = await manager['parkYtdPlayer'](root, pipDoc, '#shorts-player');
      expect(parked?.liveSlot?.selector).toBe(
        'ytd-reel-video-renderer-cow [id="player-container"]'
      );
      pipDoc.body.appendChild(pipDoc.adoptNode(root));
      cowHost.replaceChildren(); // CoW dispose
      const freshSlot = pipDoc.createElement('div');
      freshSlot.id = 'player-container';
      cowHost.appendChild(freshSlot); // re-rendered (waiting for it is DOMUtils.waitForElementSelector's job)
      await manager['unparkYtdPlayer'](parked);

      expect(ytdPlayer.parentElement).toBe(freshSlot);
      expect(oldSlot.isConnected).toBe(false);
    });

    it('keeps the original slot when it is still connected after the move (no re-render)', async () => {
      const root = document.createElement('div');
      const cowHost = document.createElement('ytd-reel-video-renderer-cow');
      const slot = document.createElement('div');
      slot.id = 'player-container';
      const ytdPlayer = document.createElement(SELECTORS.YTD_PLAYER) as YtdPlayerElement;
      const shortsPlayer = document.createElement('div');
      shortsPlayer.id = 'shorts-player';
      ytdPlayer.appendChild(shortsPlayer);
      slot.appendChild(ytdPlayer);
      cowHost.appendChild(slot);
      root.appendChild(cowHost);
      document.body.appendChild(root);

      const parked = await manager['parkYtdPlayer'](root, document, '#shorts-player');
      await manager['unparkYtdPlayer'](parked);

      expect(ytdPlayer.parentElement).toBe(slot);
    });
  });

  it('full flow: close keeps mini player container while the player is still inside it', async () => {
    await manager.open();
    const playerInside = document.createElement('div');
    playerInside.id = SELECTORS.MOVIE_PLAYER.slice(1);
    containerEl.appendChild(playerInside);

    await awaitClose(manager);

    expect(containerEl.isConnected).toBe(true);
    expect(playerInside.isConnected).toBe(true);
  });

  it('full flow: close removes empty mini player container', async () => {
    await manager.open();

    await awaitClose(manager);

    expect(containerEl.isConnected).toBe(false);
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
    mockPlayerManager.getWasMiniPlayerActiveBeforePiP.mockReturnValue(true);
    mockMiniController.activateMiniPlayer.mockImplementation(() => {});

    await manager.open();
    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(mockMiniController.activateMiniPlayer).toHaveBeenCalled();
    expect(mockPlayerManager.waitForMiniPlayer).toHaveBeenCalled();
  });

  it('full flow: when mini player was active and waitForMiniPlayer rejects, close still completes', async () => {
    mockMiniController.isVisible.mockReturnValue(true);
    mockPlayerManager.getWasMiniPlayerActiveBeforePiP.mockReturnValue(true);
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
