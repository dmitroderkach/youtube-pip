import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow, createFakeYtdApp } from '../../test-utils/test-helpers';
import { DocumentFocusHandler } from '../DocumentFocusHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';
import { YtdAppProvider } from '../../core/YtdAppProvider';

describe('DocumentFocusHandler', () => {
  let handler: DocumentFocusHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockContextMenuHandler: MockProxy<ContextMenuHandler>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;

  beforeEach(() => {
    mockPipProvider = mock<PipWindowProvider>();
    mockContextMenuHandler = mock<ContextMenuHandler>();
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    mockYtdAppProvider = mock<YtdAppProvider>();
    mockYtdAppProvider.getApp.mockReturnValue(createFakeYtdApp({}));

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(ContextMenuHandler).toInstance(mockContextMenuHandler);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
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

    handler.initialize();
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

  it('onKey dispatches synthetic keyup to ytdApp', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: KeyboardEvent[] = [];
    ytdApp.addEventListener('keyup', (e) => dispatched.push(e as KeyboardEvent));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
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
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
    const keyEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    pipDoc.dispatchEvent(keyEvent);

    expect(dispatched).toHaveLength(0);
    handler.cleanup();
  });

  it('onKey does nothing when key is Escape', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    mockPipProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc }));
    const ytdApp = createFakeYtdApp({});
    mockYtdAppProvider.getApp.mockReturnValue(ytdApp);
    const dispatched: Event[] = [];
    ytdApp.addEventListener('keydown', (e: Event) => dispatched.push(e));
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    handler.initialize();
    const keyEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    pipDoc.dispatchEvent(keyEvent);

    expect(dispatched).toHaveLength(0);
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
