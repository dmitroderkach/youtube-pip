import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow, createFakePlayer } from '../../test-utils/test-helpers';
import { SeekHandler } from '../SeekHandler';
import { PlayerManager } from '../../core/PlayerManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { SELECTORS } from '../../selectors';

/** Progress bar rect for seek tests: full width */
const BAR_RECT = { left: 0, width: 100 } as const;
/** Mock duration for seek tests */
const MOCK_DURATION_SEC = 100;
/** ClientX values for mousedown/mousemove in seek tests */
const SEEK_CLICK_X = 50;
const SEEK_MOVE_X_1 = 75;
const SEEK_MOVE_X_2 = 80;

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: { waitForElementSelector: vi.fn().mockResolvedValue(document.createElement('div')) },
}));

describe('SeekHandler', () => {
  let handler: SeekHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let pipDoc: Document;
  let mockSeekTo: ReturnType<typeof vi.fn>;
  let mockGetDuration: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockSeekTo = vi.fn();
    mockGetDuration = vi.fn().mockReturnValue(MOCK_DURATION_SEC);
    const fakePlayer = createFakePlayer({
      getDuration: mockGetDuration as () => number,
      seekTo: mockSeekTo as (s: number, a: boolean) => void,
    });

    mockPipProvider = mock<PipWindowProvider>();
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockPlayerManager = mock<PlayerManager>();
    mockPlayerManager.getPlayer.mockReturnValue(fakePlayer);

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(SeekHandler).toSelf();
    handler = c.get(SeekHandler);
  });

  it('initialize and cleanup run without error', () => {
    handler.initialize();
    handler.cleanup();
  });

  it('initialize when pip window null does not throw', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    expect(() => handler.initialize()).not.toThrow();
  });

  it('mousedown on progress bar seeks', () => {
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = SELECTORS.PROGRESS_BAR.slice(1);
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => BAR_RECT,
    });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: SEEK_CLICK_X, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(SEEK_CLICK_X, true);
  });

  it('mousedown not on progress bar does not seek', () => {
    handler.initialize();
    const other = pipDoc.createElement('div');
    pipDoc.body.appendChild(other);
    other.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousedown when getDuration returns 0 does not seek', () => {
    mockGetDuration.mockReturnValue(0);
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = SELECTORS.PROGRESS_BAR.slice(1);
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => BAR_RECT });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: SEEK_CLICK_X, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousedown when getDuration missing logs and does not seek', () => {
    const playerNoDuration = createFakePlayer({
      seekTo: mockSeekTo as (s: number, a: boolean) => void,
    });
    mockPlayerManager.getPlayer.mockReturnValue(playerNoDuration);
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = SELECTORS.PROGRESS_BAR.slice(1);
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => BAR_RECT });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: SEEK_CLICK_X, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousedown when seekTo missing logs and does not seek', () => {
    const playerNoSeekTo = createFakePlayer({
      getDuration: mockGetDuration as () => number,
    });
    mockPlayerManager.getPlayer.mockReturnValue(playerNoSeekTo);
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = SELECTORS.PROGRESS_BAR.slice(1);
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => BAR_RECT });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: SEEK_CLICK_X, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousemove after mousedown seeks again, mouseup removes listeners', () => {
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = SELECTORS.PROGRESS_BAR.slice(1);
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => BAR_RECT });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: SEEK_CLICK_X, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(SEEK_CLICK_X, true);
    pipDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: SEEK_MOVE_X_1, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(SEEK_MOVE_X_1, true);
    pipDoc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    mockSeekTo.mockClear();
    pipDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: SEEK_MOVE_X_2, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
});
