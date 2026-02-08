import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { ResizeTracker } from '../ResizeTracker';
import { PlayerManager } from '../../core/PlayerManager';

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
    const fakePlayer = document.createElement('div') as HTMLDivElement & {
      setInternalSize: ReturnType<typeof vi.fn>;
      setSize: ReturnType<typeof vi.fn>;
    };
    fakePlayer.setInternalSize = vi.fn();
    fakePlayer.setSize = vi.fn();
    mockPlayerManager.getPlayer.mockReturnValue(
      fakePlayer as unknown as ReturnType<PlayerManager['getPlayer']>
    );

    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
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
    const fakePlayer = mockPlayerManager.getPlayer() as {
      setInternalSize?: ReturnType<typeof vi.fn>;
      setSize?: ReturnType<typeof vi.fn>;
    };
    const entry = {
      contentRect: { width: 200 },
      target: el,
    } as unknown as ResizeObserverEntry;
    resizeCallback!([entry]);
    expect(fakePlayer.setInternalSize).toHaveBeenCalled();
    expect(fakePlayer.setSize).toHaveBeenCalled();
  });

  it('resize callback when player has no resize methods still dispatches resize event', () => {
    const playerNoResize = document.createElement('div');
    mockPlayerManager.getPlayer.mockReturnValue(
      playerNoResize as unknown as ReturnType<PlayerManager['getPlayer']>
    );
    const el = document.createElement('div');
    tracker.start(el);
    const dispatchSpy = vi.spyOn(playerNoResize, 'dispatchEvent');
    const entry = { contentRect: { width: 100 }, target: el } as unknown as ResizeObserverEntry;
    resizeCallback!([entry]);
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'resize' }));
  });

  it('start when ResizeObserver undefined logs and returns', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    const tracker2 = c.get(ResizeTracker) as ResizeTracker;
    tracker2.start(document.createElement('div'));
    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('stop when observer null does not throw', () => {
    expect(() => tracker.stop()).not.toThrow();
  });
});
