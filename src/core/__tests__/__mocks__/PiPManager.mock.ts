import { mock, type MockProxy } from 'vitest-mock-extended';
import { PipWindowProvider } from '../../PipWindowProvider';
import { MiniPlayerController } from '../../../ui/MiniPlayerController';
import { PlayerManager } from '../../PlayerManager';
import { YtdAppProvider } from '../../YtdAppProvider';
import { PiPWindowHandlers } from '../../PiPWindowHandlers';

export interface PiPManagerMocks {
  pipProvider: MockProxy<PipWindowProvider>;
  miniPlayerController: MockProxy<MiniPlayerController>;
  playerManager: MockProxy<PlayerManager>;
  ytdAppProvider: MockProxy<YtdAppProvider>;
  pipWindowHandlers: MockProxy<PiPWindowHandlers>;
}

export function createPiPManagerMocks(): PiPManagerMocks {
  return {
    pipProvider: mock<PipWindowProvider>(),
    miniPlayerController: mock<MiniPlayerController>(),
    playerManager: mock<PlayerManager>(),
    ytdAppProvider: mock<YtdAppProvider>(),
    pipWindowHandlers: mock<PiPWindowHandlers>(),
  };
}
