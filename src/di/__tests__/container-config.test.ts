import { describe, it, expect } from 'vitest';
import { createContainer } from '../container-config';
import { PiPManager } from '../../core/PiPManager';
import { PiPEntryPoints } from '../../ui/PiPEntryPoints';
import { MediaSessionHandler } from '../../handlers/MediaSessionHandler';

/**
 * The app's real container (the one exception to the test container rule, like container.test.ts): every service
 * the app resolves at startup has all its dependencies bound. A dependency added without a binding fails here, not
 * only in the browser ("No binding for …").
 */
describe('createContainer', () => {
  it.each([
    ['PiPManager', PiPManager],
    ['PiPEntryPoints', PiPEntryPoints],
    ['MediaSessionHandler', MediaSessionHandler],
  ])('resolves %s with all its dependencies', (_name, service) => {
    expect(() => createContainer().get(service)).not.toThrow();
  });
});
