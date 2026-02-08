import { vi } from 'vitest';
import { PLAYER_STATES, DEFAULT_DIMENSIONS } from '../../../constants';
import type { VideoData, PlayerSize } from '../../../types/youtube';

export interface MockPlayerMethods {
  getPlayerState: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;
  getVideoData: ReturnType<typeof vi.fn>;
  getCurrentTime: ReturnType<typeof vi.fn>;
  getPlayerSize: ReturnType<typeof vi.fn>;
  getDebugText: ReturnType<typeof vi.fn>;
  getDuration: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
}

const defaultVideoData: VideoData = { video_id: 'abc', title: 't' };
const defaultPlayerSize: PlayerSize = {
  width: DEFAULT_DIMENSIONS.PIP_WIDTH,
  height: DEFAULT_DIMENSIONS.PIP_HEIGHT,
};

/**
 * Creates a mock player methods object for PlayerManager tests.
 * Assign to manager.getPlayer() after initialize(), then override in tests as needed.
 */
export function createMockPlayer(): MockPlayerMethods {
  return {
    getPlayerState: vi.fn().mockReturnValue(PLAYER_STATES.PLAYING),
    playVideo: vi.fn(),
    getVideoData: vi.fn().mockReturnValue(defaultVideoData),
    getCurrentTime: vi.fn().mockReturnValue(42),
    getPlayerSize: vi.fn().mockReturnValue(defaultPlayerSize),
    getDebugText: vi.fn().mockReturnValue('debug'),
    getDuration: vi.fn().mockReturnValue(100), // arbitrary test duration
    seekTo: vi.fn(),
  };
}
