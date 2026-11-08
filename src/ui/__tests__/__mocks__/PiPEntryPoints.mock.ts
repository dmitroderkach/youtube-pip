import { mock, type MockProxy } from 'vitest-mock-extended';
import { PiPManager } from '../../../core/PiPManager';
import { PipWindowProvider } from '../../../core/PipWindowProvider';
import { I18n } from '../../../i18n/I18n';
import { EN_MESSAGES, type MessageKey } from '../../../i18n/messages';

export interface PiPEntryPointsMocks {
  pipManager: MockProxy<PiPManager>;
  pipWindowProvider: MockProxy<PipWindowProvider>;
  i18n: MockProxy<I18n>;
}

export function createPiPEntryPointsMocks(): PiPEntryPointsMocks {
  return {
    pipManager: mock<PiPManager>(),
    pipWindowProvider: mock<PipWindowProvider>(),
    // English texts, as for a page without a dictionary of its own
    i18n: mock<I18n>({ t: (key: MessageKey) => EN_MESSAGES[key] }),
  };
}
