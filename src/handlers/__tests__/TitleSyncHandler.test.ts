import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeNotifyRenderer, createFakeWindow } from '../../test-utils/test-helpers';
import { TitleSyncHandler } from '../TitleSyncHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { YtdAppProvider } from '../../core/YtdAppProvider';
import { PlayerManager } from '../../core/PlayerManager';
import { SELECTORS } from '../../selectors';
import type { YouTubePlayer } from '../../types/youtube';

describe('TitleSyncHandler', () => {
  let handler: TitleSyncHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;
  let mockPlayerManager: MockProxy<PlayerManager>;
  let mockPlayer: YouTubePlayer & HTMLElement;
  let videoEl: HTMLVideoElement;
  let pipDoc: Document;

  beforeEach(() => {
    pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider = mock<PipWindowProvider>();
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    mockYtdAppProvider = mock<YtdAppProvider>();
    mockYtdAppProvider.getNotifyRenderer.mockReturnValue(null);
    mockPlayerManager = mock<PlayerManager>();
    videoEl = document.createElement('video');
    mockPlayer = document.createElement('div') as YouTubePlayer & HTMLElement;
    mockPlayer.querySelector = vi.fn((sel: string) =>
      sel === SELECTORS.PLAYER_VIDEO ? videoEl : null
    ) as typeof mockPlayer.querySelector;
    mockPlayer.getVideoData = vi.fn().mockReturnValue({ title: 'Test Video', video_id: 'v1' });
    mockPlayerManager.getPlayer.mockReturnValue(mockPlayer);

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    c.bind(PlayerManager).toInstance(mockPlayerManager);
    c.bind(TitleSyncHandler).toSelf();
    handler = c.get(TitleSyncHandler);
  });

  it('initialize when PiP not open does nothing', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    expect(mockPlayerManager.getPlayer).not.toHaveBeenCalled();
  });

  it('initialize when PiP open syncs title once and sets up observer', () => {
    handler.initialize();
    expect(pipDoc.title).toContain('Test Video');
    expect(pipDoc.title).toContain('YouTube');
  });

  it('initialize when video not found in player does not throw', () => {
    (mockPlayer.querySelector as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(() => handler.initialize()).not.toThrow();
    expect(pipDoc.title).not.toContain('Test Video');
  });

  it('when video src changes syncs title from getVideoData', async () => {
    handler.initialize();
    (mockPlayer.getVideoData as ReturnType<typeof vi.fn>).mockReturnValue({
      title: 'New Title',
      video_id: 'v2',
    });
    videoEl.setAttribute('src', 'https://example.com/new.mp4');
    await Promise.resolve();
    expect(pipDoc.title).toContain('New Title');
  });

  it('cleanup when never initialized does not throw', () => {
    expect(() => handler.cleanup()).not.toThrow();
  });

  it('cleanup disconnects observer', async () => {
    handler.initialize();
    handler.cleanup();
    (mockPlayer.getVideoData as ReturnType<typeof vi.fn>).mockReturnValue({
      title: 'After Cleanup',
      video_id: 'v3',
    });
    videoEl.setAttribute('src', 'https://example.com/after.mp4');
    await Promise.resolve();
    expect(pipDoc.title).not.toContain('After Cleanup');
  });

  it('initialize when getVideoData has no title does not set title', () => {
    (mockPlayer.getVideoData as ReturnType<typeof vi.fn>).mockReturnValue({
      video_id: 'v1',
    });
    handler.initialize();
    expect(pipDoc.title).not.toContain('Test Video');
  });

  it('when video src changes and getVideoData has no title, does not set title', async () => {
    (mockPlayer.getVideoData as ReturnType<typeof vi.fn>).mockReturnValue({
      video_id: 'v1',
    });
    handler.initialize();
    videoEl.setAttribute('src', 'https://example.com/no-title.mp4');
    await Promise.resolve();
    expect(pipDoc.title).not.toContain('Test Video');
  });

  it('initialize when getWasMiniPlayerActiveBeforePiP true does not set title', () => {
    mockPlayerManager.getWasMiniPlayerActiveBeforePiP.mockReturnValue(true);
    handler.initialize();
    expect(pipDoc.title).not.toContain('Test Video');
  });

  it('when pipWindow closed during observation, setWindowsTitle skips update', async () => {
    handler.initialize();
    videoEl.setAttribute('src', 'https://example.com/initial.mp4');
    await Promise.resolve();
    expect(pipDoc.title).toContain('Test Video');
    mockPipProvider.getWindow.mockReturnValue(null);
    (mockPlayer.getVideoData as ReturnType<typeof vi.fn>).mockReturnValue({
      title: 'After Close',
      video_id: 'v2',
    });
    videoEl.setAttribute('src', 'https://example.com/after.mp4');
    await Promise.resolve();
    expect(pipDoc.title).not.toContain('After Close');
  });

  it('when video src changes includes notification count from getNotifyRenderer', async () => {
    mockYtdAppProvider.getNotifyRenderer.mockReturnValue(
      createFakeNotifyRenderer({ showNotificationCount: 3 })
    );
    handler.initialize();
    videoEl.setAttribute('src', 'https://example.com/v.mp4');
    await Promise.resolve();
    expect(pipDoc.title).toContain('(3) ');
    expect(pipDoc.title).toContain('Test Video');
  });
});
