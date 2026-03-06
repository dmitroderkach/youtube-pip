import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { YtdShortsProvider } from '../YtdShortsProvider';
import { ShortsInfoPanelHandler } from '../../handlers/ShortsInfoPanelHandler';
import { SELECTORS } from '../../selectors';
import { PLAYER_STATES } from '../../constants';
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
