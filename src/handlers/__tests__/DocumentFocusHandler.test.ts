import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow, createFakeYtdApp } from '../../test-utils/test-helpers';
import { DocumentFocusHandler } from '../DocumentFocusHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';
import { YtdAppProvider } from '../../core/YtdAppProvider';
import { PlayerManager } from '../../core/PlayerManager';

describe('DocumentFocusHandler', () => {
  let handler: DocumentFocusHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockContextMenuHandler: MockProxy<ContextMenuHandler>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;
  let mockPlayerManager: MockProxy<PlayerManager>;

  beforeEach(() => {
    mockPipProvider = mock<PipWindowProvider>();
    mockContextMenuHandler = mock<ContextMenuHandler>();
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    mockYtdAppProvider = mock<YtdAppProvider>();
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdApp({}));
    mockPlayerManager = mock<PlayerManager>();
    mockPlayerManager.getPlayer.mockReturnValue(document.createElement('div'));

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(ContextMenuHandler).toInstance(mockContextMenuHandler);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(DocumentFocusHandler).toSelf();
    handler = c.get(DocumentFocusHandler);
  });

  it('cleanup when never initialized does not throw', () => {
    expect(() => handler.cleanup()).not.toThrow();
  });

  it('initialize when pip window null does not subscribe', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    expect(mockContextMenuHandler.subscribeContextMenu).not.toHaveBeenCalled();
  });

  it('initialize when pip window set subscribes to context menu and cleanup unsubscribes', () => {
    const pipWindow = createFakeWindow({
      document: document.implementation.createHTMLDocument(),
    });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const unsubscribe = vi.fn();
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(unsubscribe);

    handler.initialize();
    expect(mockContextMenuHandler.subscribeContextMenu).toHaveBeenCalledOnce();
    handler.cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('onKey dispatches synthetic keydown to ytdApp and prevents default', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: KeyboardEvent[] = [];
    ytdApp.addEventListener('keydown', (e) => dispatched.push(e as KeyboardEvent));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize(true);
    const keyEvent = {
      isTrusted: true,
      key: 'ArrowDown',
      code: 'ArrowDown',
      type: 'keydown',
      keyCode: 40,
      which: 40,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].key).toBe('ArrowDown');
    expect(keyEvent.preventDefault).toHaveBeenCalled();
    handler.cleanup();
  });

  it('onKey keeps modifier keys on the synthetic event sent to the player (Shift+N next video)', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdApp({}));
    const player = document.createElement('div');
    const dispatched: KeyboardEvent[] = [];
    player.addEventListener('keydown', (e) => dispatched.push(e as KeyboardEvent));
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize(false);
    const keyEvent = {
      isTrusted: true,
      key: 'N',
      code: 'KeyN',
      type: 'keydown',
      keyCode: 78,
      which: 78,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      location: 0,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].shiftKey).toBe(true);
    expect(dispatched[0].code).toBe('KeyN');
    handler.cleanup();
  });

  it('onKey dispatches synthetic keyup to ytdApp', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: KeyboardEvent[] = [];
    ytdApp.addEventListener('keyup', (e) => dispatched.push(e as KeyboardEvent));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize(true);
    const keyEvent = {
      isTrusted: true,
      key: 'a',
      code: 'KeyA',
      type: 'keyup',
      keyCode: 65,
      which: 65,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].key).toBe('a');
    handler.cleanup();
  });

  it('onKey does nothing when key is Tab', () => {
    mockPipProvider.getWindow.mockReturnValue(
      createFakeWindow({ document: document.implementation.createHTMLDocument() })
    );
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
    const keyEvent = {
      isTrusted: true,
      key: 'Tab',
      type: 'keydown',
      code: 'Tab',
      keyCode: 9,
      which: 9,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });

  it('onKey does nothing when key is Escape', () => {
    mockPipProvider.getWindow.mockReturnValue(
      createFakeWindow({ document: document.implementation.createHTMLDocument() })
    );
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
    const keyEvent = {
      isTrusted: true,
      key: 'Escape',
      type: 'keydown',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });

  function trustedKey(key: string, target: EventTarget | null = null): KeyboardEvent {
    return {
      isTrusted: true,
      key,
      code: key,
      type: 'keydown',
      keyCode: 0,
      which: 0,
      view: null,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
  }

  it('onKey leaves keys to a menu YouTube opened in PiP itself (not reported by subscribeContextMenu)', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const player = document.createElement('div');
    mockPlayerManager.getPlayer.mockReturnValue(player);
    const dispatched: Event[] = [];
    player.addEventListener('keydown', (e) => dispatched.push(e));
    mockContextMenuHandler.isMenuOpenInPip.mockReturnValue(true);

    handler.initialize();
    for (const key of ['Enter', 'ArrowDown', ' ', 'Home']) {
      const keyEvent = trustedKey(key);
      handler['onKey'](keyEvent);
      expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    }

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });

  it('onKey leaves keys to a focused player popup (e.g. settings menu)', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const player = document.createElement('div');
    mockPlayerManager.getPlayer.mockReturnValue(player);
    const dispatched: Event[] = [];
    player.addEventListener('keydown', (e) => dispatched.push(e));
    mockContextMenuHandler.isMenuOpenInPip.mockReturnValue(false);
    const popup = pipDoc.createElement('div');
    popup.className = 'ytp-popup ytp-settings-menu';
    const item = pipDoc.createElement('div');
    popup.appendChild(item);
    pipDoc.body.appendChild(popup);

    handler.initialize();
    const keyEvent = trustedKey('Enter', item);
    handler['onKey'](keyEvent);

    expect(dispatched).toHaveLength(0);
    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('onKey does nothing when context menu is open', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    let visibilityCb: (visible: boolean) => void = () => {};
    mockContextMenuHandler.subscribeContextMenu.mockImplementation((cb) => {
      visibilityCb = cb;
      return () => {};
    });

    handler.initialize();
    visibilityCb(true);
    const keyEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    pipDoc.dispatchEvent(keyEvent);

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });

  it('onKey does nothing when event is not trusted', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
    const fakeEvent = {
      isTrusted: false,
      key: 'a',
      type: 'keydown',
      code: 'KeyA',
      keyCode: 65,
      which: 65,
      view: null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handler['onKey'](fakeEvent);

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });
});
