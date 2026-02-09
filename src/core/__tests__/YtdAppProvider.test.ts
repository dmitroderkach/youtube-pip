import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { SELECTORS } from '../../selectors';
import { YtdAppProvider } from '../YtdAppProvider';

vi.mock('../../utils/DOMUtils', () => ({
  DOMUtils: {
    waitForElementSelector: vi.fn(),
  },
}));

describe('YtdAppProvider', () => {
  let provider: YtdAppProvider;
  const mockApp = document.createElement('div');
  const mockNotify = document.createElement('div');

  beforeEach(async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector)
      .mockResolvedValueOnce(mockApp)
      .mockResolvedValueOnce(mockNotify);
    const c = createTestContainer();
    provider = c.get(YtdAppProvider);
    await provider.initialize();
  });

  it('getApp returns initialized app', () => {
    expect(provider.getApp()).toBe(mockApp);
  });

  it('getNotifyRenderer returns notification renderer', () => {
    expect(provider.getNotifyRenderer()).toBe(mockNotify);
  });
});

describe('YtdAppProvider initialize failure', () => {
  it('throws when ytd-app not found', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector).mockRejectedValueOnce(new Error('timeout'));
    const c = createTestContainer();
    const provider = c.get(YtdAppProvider) as YtdAppProvider;
    await expect(provider.initialize()).rejects.toThrow(
      new RegExp(`${SELECTORS.YTD_APP}|element not found`)
    );
  });

  it('sets notifyRenderer null when notification element not found', async () => {
    const { DOMUtils } = await import('../../utils/DOMUtils');
    vi.mocked(DOMUtils.waitForElementSelector)
      .mockResolvedValueOnce(document.createElement('div'))
      .mockRejectedValueOnce(new Error('timeout'));
    const c = createTestContainer();
    const provider = c.get(YtdAppProvider) as YtdAppProvider;
    await provider.initialize();
    expect(provider.getNotifyRenderer()).toBeNull();
  });
});
