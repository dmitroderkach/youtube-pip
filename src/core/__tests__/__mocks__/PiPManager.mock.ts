import { mock, type MockProxy } from 'vitest-mock-extended';
import { PipWindowProvider } from '../../PipWindowProvider';
import { MiniPlayerController } from '../../../ui/MiniPlayerController';
import { PlayerManager } from '../../PlayerManager';
import { YtdAppProvider } from '../../YtdAppProvider';
import { YtdShortsProvider } from '../../YtdShortsProvider';
import { PiPWindowHandlers } from '../../PiPWindowHandlers';
import { PipShortsWindowHandlers } from '../../PipShortsWindowHandlers';
import { TitleSyncHandler } from '../../../handlers/TitleSyncHandler';

export interface PiPManagerMocks {
  pipProvider: MockProxy<PipWindowProvider>;
  miniPlayerController: MockProxy<MiniPlayerController>;
  playerManager: MockProxy<PlayerManager>;
  ytdAppProvider: MockProxy<YtdAppProvider>;
  ytdShortsProvider: MockProxy<YtdShortsProvider>;
  pipWindowHandlers: MockProxy<PiPWindowHandlers>;
  pipShortsWindowHandlers: MockProxy<PipShortsWindowHandlers>;
  titleSyncHandler: MockProxy<TitleSyncHandler>;
}

export function createPiPManagerMocks(): PiPManagerMocks {
  // Keep "was mini player active before PiP" stateful like PlayerManager, so open() takes the same branch
  // (mini player already visible vs. activate it first) that the test set up via isVisible().
  const playerManager = mock<PlayerManager>();
  let wasMiniPlayerActive = false;
  playerManager.setWasMiniPlayerActiveBeforePiP.mockImplementation((value: boolean) => {
    wasMiniPlayerActive = value;
  });
  playerManager.getWasMiniPlayerActiveBeforePiP.mockImplementation(() => wasMiniPlayerActive);

  return {
    pipProvider: mock<PipWindowProvider>(),
    miniPlayerController: mock<MiniPlayerController>(),
    playerManager,
    ytdAppProvider: mock<YtdAppProvider>(),
    ytdShortsProvider: mock<YtdShortsProvider>(),
    pipWindowHandlers: mock<PiPWindowHandlers>(),
    pipShortsWindowHandlers: mock<PipShortsWindowHandlers>(),
    titleSyncHandler: mock<TitleSyncHandler>(),
  };
}
