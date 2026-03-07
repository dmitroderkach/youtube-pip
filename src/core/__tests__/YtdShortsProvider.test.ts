import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { YtdShortsProvider } from '../YtdShortsProvider';
import { ShortsInfoPanelHandler } from '../../handlers/ShortsInfoPanelHandler';
import { SELECTORS } from '../../selectors';
import { PLAYER_STATES, TIMEOUTS } from '../../constants';
import type { YouTubeShortsElement } from '../../types/youtube';

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    createPlaceholder: vi.fn(() => document.createComment('placeholder')),
    insertPlaceholderBefore: vi.fn(),
    restoreElementFromPlaceholder: vi.fn(),
  },
}));

describe('YtdShortsProvider', () => {
  let provider: YtdShortsProvider;
  let mockShortsInfoPanelHandler: MockProxy<ShortsInfoPanelHandler>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockShortsInfoPanelHandler = mock<ShortsInfoPanelHandler>();
    const c = createTestContainer();
    c.bind(ShortsInfoPanelHandler).toInstance(mockShortsInfoPanelHandler);
    c.bind(YtdShortsProvider).toSelf();
    provider = c.get(YtdShortsProvider);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getShorts returns null initially', () => {
    expect(provider.getShorts()).toBeNull();
  });

  it('getPlayer returns null initially', () => {
    expect(provider.getPlayer()).toBeNull();
  });

  it('setShorts stores element and extracts player', () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as HTMLElement;
    const player = document.createElement('div');
    player.id = SELECTORS.SHORTS_PLAYER.slice(1);
    shorts.appendChild(player);

    provider.setShorts(shorts as never);

    expect(provider.getShorts()).toBe(shorts);
    expect(provider.getPlayer()).toBe(player);
  });

  it('setShorts null clears shorts and player', () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as HTMLElement;
    provider.setShorts(shorts as never);
    provider.setShorts(null);
    expect(provider.getShorts()).toBeNull();
    expect(provider.getPlayer()).toBeNull();
  });

  it('hideAllEngagementPanelSections does nothing when shorts null', () => {
    expect(() => provider.hideAllEngagementPanelSections()).not.toThrow();
  });

  it('hideAllEngagementPanelSections clicks visibility button on expanded sections', () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as HTMLElement;
    const section = document.createElement('ytd-engagement-panel-section-list-renderer');
    section.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    const visibilityDiv = document.createElement('div');
    visibilityDiv.id = 'visibility-button';
    const button = document.createElement('button');
    visibilityDiv.appendChild(button);
    section.appendChild(visibilityDiv);
    shorts.appendChild(section);
    const clickSpy = vi.spyOn(button, 'click');

    provider.setShorts(shorts as never);
    provider.hideAllEngagementPanelSections();

    expect(clickSpy).toHaveBeenCalled();
  });

  it('reinitShortsLifeCycle when shorts null resolves without modifying DOM', async () => {
    await expect(provider.reinitShortsLifeCycle()).resolves.toBeUndefined();
  });

  it('reinitShortsLifeCycle when visibility visible runs remove and restore', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.createPlaceholder).mockReturnValue(document.createComment('ph'));
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation((el: Node, _ph: Comment) => {
      el.parentNode?.insertBefore(document.createComment('ph'), el);
      return true;
    });
    vi.mocked(DOMUtils.restoreElementFromPlaceholder).mockImplementation(() => {});

    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    shorts.player = {
      getPlayerState: vi.fn().mockReturnValue(PLAYER_STATES.PAUSED),
      playVideo: vi.fn(),
    };
    const parent = document.createElement('div');
    parent.appendChild(shorts);
    document.body.appendChild(parent);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    provider.setShorts(shorts);
    const p = provider.reinitShortsLifeCycle();
    await vi.runAllTimersAsync();
    await p;

    expect(DOMUtils.createPlaceholder).toHaveBeenCalledWith('shorts_placeholder');
    expect(DOMUtils.restoreElementFromPlaceholder).toHaveBeenCalled();
    expect(mockShortsInfoPanelHandler.unhideVisibleInfoPanelParagraphs).toHaveBeenCalledWith(
      shorts
    );
    parent.remove();
  });

  it('isShortsVisible returns false when ytd-shorts not in document', () => {
    const querySpy = vi.spyOn(document, 'querySelector').mockReturnValue(null);
    expect(provider.isShortsVisible()).toBe(false);
    querySpy.mockRestore();
  });

  it('isShortsVisible returns false when element has display none', () => {
    const el = document.createElement(SELECTORS.YTD_SHORTS);
    el.style.display = 'none';
    document.body.appendChild(el);
    expect(provider.isShortsVisible()).toBe(false);
    el.remove();
  });

  it('isShortsVisible returns true when element visible and has height', () => {
    const el = document.createElement(SELECTORS.YTD_SHORTS);
    el.getBoundingClientRect = vi.fn().mockReturnValue({ height: 100, width: 200 });
    document.body.appendChild(el);
    expect(provider.isShortsVisible()).toBe(true);
    el.remove();
  });

  it('isShortsVisible returns false when element has zero height', () => {
    const el = document.createElement(SELECTORS.YTD_SHORTS);
    el.getBoundingClientRect = vi.fn().mockReturnValue({ height: 0, width: 200 });
    document.body.appendChild(el);
    expect(provider.isShortsVisible()).toBe(false);
    el.remove();
  });

  it('getShortsPlayerFromDocument returns null when ytd-shorts not in document', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    expect(provider.getShortsPlayerFromDocument()).toBeNull();
    vi.mocked(document.querySelector).mockRestore();
  });

  it('getShortsPlayerFromDocument returns player when ytd-shorts and shorts-player exist', () => {
    const shortsEl = document.createElement(SELECTORS.YTD_SHORTS);
    const playerEl = document.createElement('div');
    playerEl.id = SELECTORS.SHORTS_PLAYER.slice(1);
    shortsEl.appendChild(playerEl);
    document.body.appendChild(shortsEl);
    expect(provider.getShortsPlayerFromDocument()).toBe(playerEl);
    shortsEl.remove();
  });

  it('isShortsPlayerPlaying returns false when no player in document', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    expect(provider.isShortsPlayerPlaying()).toBe(false);
  });

  it('isShortsPlayerPlaying returns true when player state is PLAYING', () => {
    const shortsEl = document.createElement(SELECTORS.YTD_SHORTS);
    const playerEl = document.createElement(
      'div'
    ) as unknown as import('../../types/youtube').YouTubePlayer;
    playerEl.getPlayerState = vi.fn().mockReturnValue(PLAYER_STATES.PLAYING);
    shortsEl.appendChild(playerEl as unknown as Node);
    vi.spyOn(document, 'querySelector').mockReturnValue(shortsEl);
    vi.spyOn(shortsEl, 'querySelector').mockReturnValue(playerEl);
    expect(provider.isShortsPlayerPlaying()).toBe(true);
  });

  it('isShortsPlayerPlaying returns false when player has no getPlayerState', () => {
    const shortsEl = document.createElement(SELECTORS.YTD_SHORTS);
    const playerEl = document.createElement('div');
    shortsEl.appendChild(playerEl);
    vi.spyOn(document, 'querySelector').mockReturnValue(shortsEl);
    vi.spyOn(shortsEl, 'querySelector').mockReturnValue(playerEl);
    expect(provider.isShortsPlayerPlaying()).toBe(false);
  });

  it('lockLoadVideo does nothing when shorts is null', () => {
    expect(provider.getShorts()).toBeNull();
    provider.lockLoadVideo();
  });

  it('lockLoadVideo does nothing when already locked', () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    const originalLoadVideo = vi.fn();
    shorts.loadVideo = originalLoadVideo;
    provider.setShorts(shorts);
    provider.lockLoadVideo();
    provider.lockLoadVideo();
    expect(shorts.loadVideo).not.toBe(originalLoadVideo);
    vi.advanceTimersByTime(TIMEOUTS.IDLE_TIMEOUT);
    expect(shorts.loadVideo).toBe(originalLoadVideo);
  });

  it('lockLoadVideo replaces loadVideo and restores after 500ms without calls', async () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    const originalLoadVideo = vi.fn();
    shorts.loadVideo = originalLoadVideo;
    provider.setShorts(shorts);
    provider.lockLoadVideo();
    expect(shorts.loadVideo).not.toBe(originalLoadVideo);
    expect(typeof shorts.loadVideo).toBe('function');
    await vi.advanceTimersByTimeAsync(TIMEOUTS.IDLE_TIMEOUT);
    expect(shorts.loadVideo).toBe(originalLoadVideo);
  });

  it('lockLoadVideo intercepted loadVideo calls scheduleRestore and resets timer', async () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    const originalLoadVideo = vi.fn();
    shorts.loadVideo = originalLoadVideo;
    provider.setShorts(shorts);
    provider.lockLoadVideo();
    (shorts.loadVideo as (i: number) => void)(0);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.IDLE_TIMEOUT - 1);
    expect(shorts.loadVideo).not.toBe(originalLoadVideo);
    await vi.advanceTimersByTimeAsync(1);
    expect(shorts.loadVideo).toBe(originalLoadVideo);
  });

  it('lockLoadVideo when shorts has no loadVideo restores undefined', async () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    expect(shorts.loadVideo).toBeUndefined();
    provider.setShorts(shorts);
    provider.lockLoadVideo();
    expect(typeof shorts.loadVideo).toBe('function');
    await vi.advanceTimersByTimeAsync(TIMEOUTS.IDLE_TIMEOUT);
    expect(shorts.loadVideo).toBeUndefined();
  });

  it('reinitShortsLifeCycle when parent null resolves after warn', async () => {
    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    shorts.player = {
      getPlayerState: vi.fn().mockReturnValue(PLAYER_STATES.PAUSED),
      playVideo: vi.fn(),
    };
    const parent = document.createElement('div');
    parent.appendChild(shorts);
    document.body.appendChild(parent);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    provider.setShorts(shorts);
    shorts.remove();
    await expect(provider.reinitShortsLifeCycle()).resolves.toBeUndefined();
    parent.remove();
  });

  it('reinitShortsLifeCycle when isPlaying true calls playVideo on restore', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.createPlaceholder).mockReturnValue(document.createComment('ph'));
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation((el: Node, _ph: Comment) => {
      el.parentNode?.insertBefore(document.createComment('ph'), el);
      return true;
    });
    vi.mocked(DOMUtils.restoreElementFromPlaceholder).mockImplementation(() => {});

    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    const playVideo = vi.fn();
    shorts.player = {
      getPlayerState: vi.fn().mockReturnValue(PLAYER_STATES.PLAYING),
      playVideo,
    };
    const parent = document.createElement('div');
    parent.appendChild(shorts);
    document.body.appendChild(parent);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    provider.setShorts(shorts);
    const p = provider.reinitShortsLifeCycle();
    await vi.runAllTimersAsync();
    await p;

    expect(playVideo).toHaveBeenCalled();
    parent.remove();
  });

  it('reinitShortsLifeCycle when visibility hidden waits for visibilitychange', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.createPlaceholder).mockReturnValue(document.createComment('ph'));
    vi.mocked(DOMUtils.insertPlaceholderBefore).mockImplementation((el: Node, _ph: Comment) => {
      el.parentNode?.insertBefore(document.createComment('ph'), el);
      return true;
    });
    vi.mocked(DOMUtils.restoreElementFromPlaceholder).mockImplementation(() => {});

    const shorts = document.createElement(SELECTORS.YTD_SHORTS) as YouTubeShortsElement;
    shorts.player = {
      getPlayerState: vi.fn().mockReturnValue(PLAYER_STATES.PAUSED),
      playVideo: vi.fn(),
    };
    const parent = document.createElement('div');
    parent.appendChild(shorts);
    document.body.appendChild(parent);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });

    provider.setShorts(shorts);
    const p = provider.reinitShortsLifeCycle();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();
    await p;

    expect(DOMUtils.restoreElementFromPlaceholder).toHaveBeenCalled();
    parent.remove();
  });
});
