import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { DocumentFocusHandler } from '../DocumentFocusHandler';
import { PlayerManager } from '../../core/PlayerManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';
import { TIMEOUTS } from '../../constants';

describe('DocumentFocusHandler', () => {
  let handler: DocumentFocusHandler;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockContextMenuHandler: MockProxy<ContextMenuHandler>;

  beforeEach(() => {
    mockPlayerManager = mock<PlayerManager>();
    mockPipProvider = mock<PipWindowProvider>();
    mockContextMenuHandler = mock<ContextMenuHandler>();
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});

    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(ContextMenuHandler).toInstance(mockContextMenuHandler);
    handler = c.get(DocumentFocusHandler);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('pollActiveElement returns focus to player when activeElement outside player', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    const focusFn = vi.fn();
    player.focus = focusFn;
    mockPlayerManager.getPlayer.mockReturnValue(player as never);

    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockImplementation((_cb) => {
      return () => {};
    });
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(focusFn).toHaveBeenCalled();
    handler.cleanup();
  });

  it('pollActiveElement does nothing when activeElement equals lastActiveElement', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).toHaveBeenCalledTimes(1);
    handler.cleanup();
  });

  it('pollActiveElement does nothing when activeElement is player', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    const focusFn = vi.fn();
    player.focus = focusFn;
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: player, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(focusFn).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('pollActiveElement does nothing when activeElement is inside player', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const inner = pipDoc.createElement('span');
    player.appendChild(inner);
    pipDoc.body.appendChild(player);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: inner, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('pollActiveElement does nothing when context menu open', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    let visibilityCb: (visible: boolean) => void = () => {};
    mockContextMenuHandler.subscribeContextMenu.mockImplementation((cb) => {
      visibilityCb = cb;
      return () => {};
    });
    handler.initialize();
    visibilityCb(true);
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('pollActiveElement does nothing when activeElement is null', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: null, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('pollActiveElement does nothing when player.focus is not a function', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    Object.defineProperty(player, 'focus', { value: undefined, configurable: true });
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    handler.cleanup();
  });

  it('pollActiveElement returns early when activeElement becomes null after focus was outside', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    let activeValue: Element | null = outer;
    Object.defineProperty(pipDoc, 'activeElement', {
      get: () => activeValue,
      configurable: true,
    });
    handler.initialize();
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).toHaveBeenCalledTimes(1);
    activeValue = null;
    await vi.advanceTimersByTimeAsync(TIMEOUTS.ACTIVE_ELEMENT_POLL);
    expect(player.focus).toHaveBeenCalledTimes(1);
    handler.cleanup();
  });

  it('subscribe callback with false calls pollActiveElement', async () => {
    vi.useFakeTimers();
    const pipDoc = document.implementation.createHTMLDocument();
    const player = pipDoc.createElement('div');
    const outer = pipDoc.createElement('div');
    pipDoc.body.appendChild(player);
    pipDoc.body.appendChild(outer);
    player.focus = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(player as never);
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    let visibilityCb: (visible: boolean) => void = () => {};
    mockContextMenuHandler.subscribeContextMenu.mockImplementation((cb) => {
      visibilityCb = cb;
      return () => {};
    });
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    visibilityCb(false);
    expect(player.focus).toHaveBeenCalled();
    handler.cleanup();
  });
});
