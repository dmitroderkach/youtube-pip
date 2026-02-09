import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { PipWindowProvider } from '../PipWindowProvider';

describe('PipWindowProvider', () => {
  let provider: PipWindowProvider;

  beforeEach(() => {
    const c = createTestContainer();
    c.bind(PipWindowProvider).toSelf();
    provider = c.get(PipWindowProvider);
  });

  it('getWindow returns null initially', () => {
    expect(provider.getWindow()).toBeNull();
  });

  it('setWindow and getWindow roundtrip', () => {
    const win = window;
    provider.setWindow(win);
    expect(provider.getWindow()).toBe(win);
  });

  it('setWindow null clears', () => {
    provider.setWindow(window);
    provider.setWindow(null);
    expect(provider.getWindow()).toBeNull();
  });
});
