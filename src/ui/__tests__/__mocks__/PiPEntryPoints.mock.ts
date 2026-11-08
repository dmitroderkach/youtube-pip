import { mock, type MockProxy } from 'vitest-mock-extended';
import { PiPManager } from '../../../core/PiPManager';
import { PipWindowProvider } from '../../../core/PipWindowProvider';

export interface PiPEntryPointsMocks {
  pipManager: MockProxy<PiPManager>;
  pipWindowProvider: MockProxy<PipWindowProvider>;
}

export function createPiPEntryPointsMocks(): PiPEntryPointsMocks {
  return {
    pipManager: mock<PiPManager>(),
    pipWindowProvider: mock<PipWindowProvider>(),
  };
}
