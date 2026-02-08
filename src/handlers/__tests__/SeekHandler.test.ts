import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { SeekHandler } from '../SeekHandler';
import { PlayerManager } from '../../core/PlayerManager';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { UI_CLASSES } from '../../constants';

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
    const pipWindow = { document: pipDoc } as unknown as Window;
    mockSeekTo = vi.fn();
    mockGetDuration = vi.fn().mockReturnValue(100);
    const fakePlayer = {
      getDuration: mockGetDuration,
      seekTo: mockSeekTo,
    };

    mockPipProvider = mock<PipWindowProvider>();
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockPlayerManager = mock<PlayerManager>();
    mockPlayerManager.getPlayer.mockReturnValue(
      fakePlayer as unknown as ReturnType<PlayerManager['getPlayer']>
    );

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
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
    bar.className = UI_CLASSES.PROGRESS_BAR;
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 100 }),
    });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(50, true);
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
    bar.className = UI_CLASSES.PROGRESS_BAR;
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100 }) });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousedown when getDuration missing logs and does not seek', () => {
    const playerNoDuration = {
      getDuration: undefined,
      seekTo: mockSeekTo,
    };
    mockPlayerManager.getPlayer.mockReturnValue(
      playerNoDuration as unknown as ReturnType<PlayerManager['getPlayer']>
    );
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = UI_CLASSES.PROGRESS_BAR;
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100 }) });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousedown when seekTo missing logs and does not seek', () => {
    const playerNoSeekTo = {
      getDuration: mockGetDuration,
      seekTo: undefined,
    };
    mockPlayerManager.getPlayer.mockReturnValue(
      playerNoSeekTo as unknown as ReturnType<PlayerManager['getPlayer']>
    );
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = UI_CLASSES.PROGRESS_BAR;
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100 }) });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('mousemove after mousedown seeks again, mouseup removes listeners', () => {
    handler.initialize();
    const bar = pipDoc.createElement('div');
    bar.className = UI_CLASSES.PROGRESS_BAR;
    pipDoc.body.appendChild(bar);
    Object.defineProperty(bar, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100 }) });
    bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(50, true);
    pipDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, bubbles: true }));
    expect(mockSeekTo).toHaveBeenCalledWith(75, true);
    pipDoc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    mockSeekTo.mockClear();
    pipDoc.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, bubbles: true }));
    expect(mockSeekTo).not.toHaveBeenCalled();
  });
});
