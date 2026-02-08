import { mock, type MockProxy } from 'vitest-mock-extended';
import { PipWindowProvider } from '../../../core/PipWindowProvider';

export interface MenuObserverMocks {
  pipWindowProvider: MockProxy<PipWindowProvider>;
}

export function createMenuObserverMocks(): MenuObserverMocks {
  return {
    pipWindowProvider: mock<PipWindowProvider>(),
  };
}
