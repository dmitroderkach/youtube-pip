import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { DocumentFocusHandler } from '../DocumentFocusHandler';
import { PlayerManager } from '../../core/PlayerManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { ContextMenuHandler } from '../../ui/ContextMenuHandler';

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
    c.bind(DocumentFocusHandler).toSelf();
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

  it('onBodyClick returns focus to player when activeElement outside player', async () => {
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
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(focusFn).toHaveBeenCalled();
    handler.cleanup();
  });

  it('onBodyClick does nothing when activeElement is player', () => {
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
    pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusFn).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('onBodyClick does nothing when activeElement is inside player', () => {
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
    pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('onBodyClick does nothing when context menu open', () => {
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
    pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('onBodyClick does nothing when activeElement is null', () => {
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
    pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('onBodyClick does nothing when player.focus is not a function', () => {
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
    expect(() =>
      pipDoc.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    ).not.toThrow();
    handler.cleanup();
  });

  it('onKeyUp returns focus to player when activeElement outside and key is not Tab', async () => {
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
    mockContextMenuHandler.subscribeContextMenu.mockReturnValue(() => {});
    handler.initialize();
    Object.defineProperty(pipDoc, 'activeElement', { value: outer, configurable: true });
    pipDoc.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    await vi.runAllTimersAsync();
    expect(focusFn).toHaveBeenCalled();
    handler.cleanup();
  });

  it('onKeyUp does nothing when key is Tab', () => {
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
    pipDoc.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
    expect(player.focus).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it('subscribe callback with false calls onBodyClick and returns focus', async () => {
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
    await vi.runAllTimersAsync();
    expect(player.focus).toHaveBeenCalled();
    handler.cleanup();
  });
});
