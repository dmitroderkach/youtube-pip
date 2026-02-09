import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakePlayer, createFakeResizeObserverEntry } from '../../test-utils/test-helpers';
import { ResizeTracker } from '../ResizeTracker';
import { PlayerManager } from '../../core/PlayerManager';

/** ContentRect width for resize callback tests */
const RESIZE_WIDTH_PRIMARY = 200;
const RESIZE_WIDTH_SECONDARY = 100;

describe('ResizeTracker', () => {
  let tracker: ResizeTracker;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let resizeCallback: (entries: ResizeObserverEntry[]) => void;

  beforeEach(() => {
    mockObserve = vi.fn((_target: Element) => {});
    mockDisconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class MockResizeObserver {
        constructor(cb: (entries: ResizeObserverEntry[]) => void) {
          resizeCallback = cb;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
      }
    );

    mockPlayerManager = mock<PlayerManager>();
    const fakePlayer = createFakePlayer({
      setInternalSize: vi.fn(),
      setSize: vi.fn(),
    });
    mockPlayerManager.getPlayer.mockReturnValue(fakePlayer);

    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(ResizeTracker).toSelf();
    tracker = c.get(ResizeTracker);
  });

  it('start observes target element and stop disconnects', () => {
    const el = document.createElement('div');
    tracker.start(el);
    expect(mockObserve).toHaveBeenCalledWith(el);
    tracker.stop();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('resize callback calls player setInternalSize and setSize', () => {
    const el = document.createElement('div');
    tracker.start(el);
    expect(resizeCallback).toBeDefined();
    const entry = createFakeResizeObserverEntry({
      contentRect: { width: RESIZE_WIDTH_PRIMARY } as DOMRectReadOnly,
      target: el,
    });
    resizeCallback!([entry]);
    expect(mockPlayerManager.getPlayer().setInternalSize).toHaveBeenCalled();
    expect(mockPlayerManager.getPlayer().setSize).toHaveBeenCalled();
  });

  it('resize callback when player has no resize methods still dispatches resize event', () => {
    const playerNoResize = createFakePlayer({});
    mockPlayerManager.getPlayer.mockReturnValue(playerNoResize);
    const el = document.createElement('div');
    tracker.start(el);
    const dispatchSpy = vi.spyOn(playerNoResize, 'dispatchEvent');
    const entry = createFakeResizeObserverEntry({
      contentRect: { width: RESIZE_WIDTH_SECONDARY } as DOMRectReadOnly,
      target: el,
    });
    resizeCallback!([entry]);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize' }));
  });

  it('start when ResizeObserver undefined logs and returns', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(ResizeTracker).toSelf();
    const tracker2 = c.get(ResizeTracker) as ResizeTracker;
    tracker2.start(document.createElement('div'));
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('stop when observer null does not throw', () => {
    expect(() => tracker.stop()).not.toThrow();
  });
});
