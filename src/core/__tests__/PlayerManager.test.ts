import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { createMockPlayer, type MockPlayerMethods } from './__mocks__/PlayerManager.mock';
import { PlayerManager } from '../PlayerManager';
import { PLAYER_STATES, DEFAULT_DIMENSIONS } from '../../constants';

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    waitForElementSelector: vi.fn(),
  },
}));

describe('PlayerManager', () => {
  let manager: PlayerManager;
  let mockPlayer: MockPlayerMethods;

  beforeEach(async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValue(document.createElement('div'));
    const c = createTestContainer();
    manager = c.get(PlayerManager);
    await manager.initialize();
    mockPlayer = createMockPlayer();
    Object.assign(manager.getPlayer(), mockPlayer);
  });

  it('getPlayer returns initialized player', () => {
    expect(manager.getPlayer()).toBeDefined();
  });

  it('getPlayerState returns state from player', () => {
    expect(manager.getPlayerState(manager.getPlayer())).toBe(PLAYER_STATES.PLAYING);
  });

  it('getPlayerState returns UNSTARTED when getPlayerState missing', () => {
    const p = manager.getPlayer();
    delete p['getPlayerState'];
    expect(manager.getPlayerState(p)).toBe(PLAYER_STATES.UNSTARTED);
  });

  it('isPlaying returns true when state is PLAYING', () => {
    expect(manager.isPlaying(manager.getPlayer())).toBe(true);
  });

  it('savePlayingState and restorePlayingState', () => {
    manager.savePlayingState(manager.getPlayer());
    manager.restorePlayingState(manager.getPlayer());
    expect(mockPlayer.playVideo).toHaveBeenCalled();
  });

  it('restorePlayingState does nothing when wasPlaying false', () => {
    mockPlayer.getPlayerState.mockReturnValue(PLAYER_STATES.PAUSED);
    manager.savePlayingState(manager.getPlayer());
    manager.restorePlayingState(manager.getPlayer());
    expect(mockPlayer.playVideo).not.toHaveBeenCalled();
  });

  it('getVideoId returns video_id from player', () => {
    expect(manager.getVideoId()).toBe('abc');
  });

  it('getVideoId returns null when no video_id', () => {
    mockPlayer.getVideoData.mockReturnValue({});
    expect(manager.getVideoId()).toBeNull();
  });

  it('getVideoData returns data from player', () => {
    expect(manager.getVideoData()).toEqual({ video_id: 'abc', title: 't' });
  });

  it('getCurrentTime returns floor of player time', () => {
    mockPlayer.getCurrentTime.mockReturnValue(42.7);
    expect(manager.getCurrentTime()).toBe(42);
  });

  it('getPlayerSize returns size from player', () => {
    expect(manager.getPlayerSize()).toEqual({
      width: DEFAULT_DIMENSIONS.PIP_WIDTH,
      height: DEFAULT_DIMENSIONS.PIP_HEIGHT,
    });
  });

  it('getDebugInfo returns debug text', () => {
    expect(manager.getDebugInfo()).toBe('debug');
  });

  it('resetState clears wasPlaying', () => {
    manager.savePlayingState(manager.getPlayer());
    manager.resetState();
    manager.restorePlayingState(manager.getPlayer());
    expect(mockPlayer.playVideo).not.toHaveBeenCalled();
  });

  it('getDebugInfo returns null when getDebugText missing', () => {
    delete manager.getPlayer()['getDebugText'];
    expect(manager.getDebugInfo()).toBeNull();
  });

  it('getDebugInfo returns null when getDebugText returns empty', () => {
    mockPlayer.getDebugText.mockReturnValue('');
    expect(manager.getDebugInfo()).toBeNull();
  });

  it('restorePlayingState logs when playVideo missing', () => {
    manager.savePlayingState(manager.getPlayer());
    delete manager.getPlayer()['playVideo'];
    manager.restorePlayingState(manager.getPlayer());
    expect(mockPlayer.playVideo).not.toHaveBeenCalled();
  });

  it('waitForMainPlayer returns player when found', async () => {
    const el = document.createElement('div');
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValueOnce(el as never);
    const result = await manager.waitForMainPlayer();
    expect(result).toBe(el);
  });

  it('waitForMainPlayer returns null when wait fails', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValueOnce(new Error('timeout'));
    const result = await manager.waitForMainPlayer();
    expect(result).toBeNull();
  });

  it('waitForMiniPlayer returns element when found', async () => {
    const el = document.createElement('div');
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockResolvedValueOnce(el as never);
    const result = await manager.waitForMiniPlayer();
    expect(result).toBe(el);
  });

  it('waitForMiniPlayer returns null when wait fails', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValueOnce(new Error('timeout'));
    const result = await manager.waitForMiniPlayer();
    expect(result).toBeNull();
  });

  it('getVideoData returns null when getVideoData returns null', () => {
    mockPlayer.getVideoData.mockReturnValue(null);
    expect(manager.getVideoData()).toBeNull();
  });

  it('getVideoData returns null when getVideoData is not a function', () => {
    const p = manager.getPlayer();
    delete p['getVideoData'];
    expect(manager.getVideoData()).toBeNull();
  });

  it('getCurrentTime returns 0 when getCurrentTime is not a function', () => {
    const p = manager.getPlayer();
    delete p['getCurrentTime'];
    expect(manager.getCurrentTime()).toBe(0);
  });

  it('getCurrentTime returns 0 when getCurrentTime returns NaN', () => {
    mockPlayer.getCurrentTime.mockReturnValue(Number.NaN);
    expect(manager.getCurrentTime()).toBe(0);
  });

  it('getPlayerSize returns null when getPlayerSize is not a function', () => {
    const p = manager.getPlayer();
    delete p['getPlayerSize'];
    expect(manager.getPlayerSize()).toBeNull();
  });

  it('initialize throws AppInitializationError when waitForElementSelector rejects', async () => {
    const c = createTestContainer();
    const m = c.get(PlayerManager) as PlayerManager;
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValueOnce(new Error('timeout'));
    const { AppInitializationError } = await import('../../errors/AppInitializationError');
    await expect(m.initialize()).rejects.toThrow(AppInitializationError);
  });

  it('restorePlayingState when playVideo throws logs error', () => {
    manager.savePlayingState(manager.getPlayer());
    mockPlayer.playVideo.mockImplementationOnce(() => {
      throw new Error('play failed');
    });
    expect(() => manager.restorePlayingState(manager.getPlayer())).not.toThrow();
  });
});
