import { mock, type MockProxy } from 'vitest-mock-extended';
import { PipWindowProvider } from '../../PipWindowProvider';
import { MiniPlayerController } from '../../../ui/MiniPlayerController';
import { PlayerManager } from '../../PlayerManager';
import { YtdAppProvider } from '../../YtdAppProvider';
import { YtdShortsProvider } from '../../YtdShortsProvider';
import { PiPWindowHandlers } from '../../PiPWindowHandlers';
import { PipShortsWindowHandlers } from '../../PipShortsWindowHandlers';

export interface PiPManagerMocks {
  pipProvider: MockProxy<PipWindowProvider>;
  miniPlayerController: MockProxy<MiniPlayerController>;
  playerManager: MockProxy<PlayerManager>;
  ytdAppProvider: MockProxy<YtdAppProvider>;
  ytdShortsProvider: MockProxy<YtdShortsProvider>;
  pipWindowHandlers: MockProxy<PiPWindowHandlers>;
  pipShortsWindowHandlers: MockProxy<PipShortsWindowHandlers>;
}

export function createPiPManagerMocks(): PiPManagerMocks {
  return {
    pipProvider: mock<PipWindowProvider>(),
    miniPlayerController: mock<MiniPlayerController>(),
    playerManager: mock<PlayerManager>(),
    ytdAppProvider: mock<YtdAppProvider>(),
    ytdShortsProvider: mock<YtdShortsProvider>(),
    pipWindowHandlers: mock<PiPWindowHandlers>(),
    pipShortsWindowHandlers: mock<PipShortsWindowHandlers>(),
  };
}
