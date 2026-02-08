import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createPiPManagerMocks } from './__mocks__/PiPManager.mock';
import { PiPManager } from '../PiPManager';
import { MiniPlayerController } from '../../ui/MiniPlayerController';
import { PlayerManager } from '../PlayerManager';
import { YtdAppProvider } from '../YtdAppProvider';
import { PipWindowProvider } from '../PipWindowProvider';
import { PiPWindowHandlers } from '../PiPWindowHandlers';
import { SELECTORS } from '../../selectors';
import { TIMEOUTS } from '../../constants';

/** Trigger close (same as pagehide handler) and await all async work; use with fake timers + runAllTimersAsync */
async function awaitClose(manager: PiPManager): Promise<void> {
  const closePromise = (manager as unknown as { close(): Promise<void> }).close();
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

  it('updateTitle sets pip window title when window is open', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mocks.pipProvider.getWindow.mockReturnValue(pipWindow);
    manager.updateTitle('Test Video');
    expect(pipDoc.title).toContain('Test Video');
  });

  it('updateTitle includes notification count when getNotifyRenderer provides showNotificationCount', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as Window;
    mocks.pipProvider.getWindow.mockReturnValue(pipWindow);
    mocks.ytdAppProvider.getNotifyRenderer.mockReturnValue({
      showNotificationCount: 3,
    } as never);
    manager.updateTitle('My Video');
    expect(pipDoc.title).toContain('(3) ');
    expect(pipDoc.title).toContain('My Video');
  });

  it('open stores onBeforeReturn when handlers.initialize returns a function', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = {
      document: pipDoc,
      addEventListener: vi.fn(),
      closed: false,
    } as unknown as Window;
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
  let pipWindow: Window & { dispatchEvent: (e: Event) => boolean };
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

  function buildPipWindow(doc: Document): Window & { dispatchEvent: (e: Event) => boolean } {
    const listeners: { type: string; handler: (e: Event) => void }[] = [];
    const win = {
      document: doc,
      closed: false,
      addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
        listeners.push({ type, handler });
      }),
      dispatchEvent: vi.fn((e: Event) => {
        listeners.filter((l) => l.type === e.type).forEach((l) => l.handler(e));
        return true;
      }),
    } as unknown as Window & { dispatchEvent: (e: Event) => boolean };
    return win;
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
    mockPlayerManager.getPlayer.mockReturnValue({
      getPlayerState: vi.fn(),
      playVideo: vi.fn(),
    } as never);
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

    (pipWindow as unknown as { closed: boolean }).closed = true;
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

  it('full flow: when yt-draggable missing on return, error is caught and window still cleared', async () => {
    await manager.open();
    mainDraggable.remove();
    await awaitClose(manager);

    expect(manager.getWindow()).toBeNull();
    expect(manager.isOpen()).toBe(false);
  });
});
