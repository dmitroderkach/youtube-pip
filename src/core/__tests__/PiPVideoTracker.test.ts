import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { PiPVideoTracker } from '../PiPVideoTracker';
import { PlayerManager } from '../PlayerManager';
import { YT_EVENTS, YT_PLAYER_EVENTS } from '../../constants';
import type { PlayVideoEvent } from '../../types/youtube';

const PAGE_VIDEO = 'page-video';
const NEXT_VIDEO = 'next-video';
const AUTOPLAY_VIDEO = 'autoplay-video';

type PlayVideoListener = (data: PlayVideoEvent) => void;

describe('PiPVideoTracker', () => {
  let tracker: PiPVideoTracker;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let playVideoListener: PlayVideoListener | null;

  const navigate = (detail: unknown) =>
    window.dispatchEvent(new CustomEvent(YT_EVENTS.NAVIGATE, { detail }));

  beforeEach(() => {
    playVideoListener = null;
    mockPlayerManager = mock<PlayerManager>();
    mockPlayerManager.addPlayerListener.mockImplementation((name, listener) => {
      if (name === YT_PLAYER_EVENTS.PLAY_VIDEO) playVideoListener = listener as PlayVideoListener;
    });
    mockPlayerManager.removePlayerListener.mockImplementation((name, listener) => {
      if (name === YT_PLAYER_EVENTS.PLAY_VIDEO && listener === playVideoListener) {
        playVideoListener = null;
      }
    });
    const c = createTestContainer();
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(PiPVideoTracker).toSelf();
    tracker = c.get(PiPVideoTracker);
  });

  afterEach(() => {
    tracker.stop();
  });

  it('starts from the watch page video and returns it on stop', () => {
    tracker.start(PAGE_VIDEO);
    expect(tracker.getVideoId()).toBe(PAGE_VIDEO);
    expect(tracker.stop()).toBe(PAGE_VIDEO);
    expect(tracker.getVideoId()).toBeNull();
  });

  it('follows a watch navigation (yt-navigate)', () => {
    tracker.start(PAGE_VIDEO);
    navigate({ endpoint: { watchEndpoint: { videoId: NEXT_VIDEO } } });
    expect(tracker.stop()).toBe(NEXT_VIDEO);
  });

  it('ignores a navigation that is not a watch navigation', () => {
    tracker.start(PAGE_VIDEO);
    navigate({ endpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } } });
    navigate(undefined);
    expect(tracker.stop()).toBe(PAGE_VIDEO);
  });

  it('follows the popstate a link clicked in PiP sends (NavigationHandler)', () => {
    tracker.start(PAGE_VIDEO);
    window.dispatchEvent(
      new PopStateEvent('popstate', {
        state: { endpoint: { watchEndpoint: { videoId: NEXT_VIDEO } } },
      })
    );
    expect(tracker.stop()).toBe(NEXT_VIDEO);
  });

  it('follows the player autoplay of the next video (onPlayVideo)', () => {
    tracker.start(PAGE_VIDEO);
    playVideoListener?.({ videoId: AUTOPLAY_VIDEO });
    expect(tracker.getVideoId()).toBe(AUTOPLAY_VIDEO);
    playVideoListener?.({ watchEndpoint: { watchEndpoint: { videoId: NEXT_VIDEO } } });
    expect(tracker.stop()).toBe(NEXT_VIDEO);
  });

  it('stop removes every listener: later events change nothing', () => {
    tracker.start(PAGE_VIDEO);
    tracker.stop();
    expect(playVideoListener).toBeNull();
    navigate({ endpoint: { watchEndpoint: { videoId: NEXT_VIDEO } } });
    expect(tracker.getVideoId()).toBeNull();
  });

  it('start without a page video still follows what comes next', () => {
    tracker.start(null);
    expect(tracker.getVideoId()).toBeNull();
    navigate({ endpoint: { watchEndpoint: { videoId: NEXT_VIDEO } } });
    expect(tracker.stop()).toBe(NEXT_VIDEO);
  });
});
