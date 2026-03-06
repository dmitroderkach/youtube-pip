import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { PiPEventBridgeHandler } from '../PiPEventBridgeHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { YtdAppProvider } from '../../core/YtdAppProvider';
import { YT_EVENTS } from '../../constants';

describe('PiPEventBridgeHandler', () => {
  let handler: PiPEventBridgeHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let mockYtdAppProvider: MockProxy<YtdAppProvider>;

  beforeEach(() => {
    mockPipProvider = mock<PipWindowProvider>();
    mockYtdAppProvider = mock<YtdAppProvider>();
    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(YtdAppProvider).toInstance(mockYtdAppProvider);
    c.bind(PiPEventBridgeHandler).toSelf();
    handler = c.get(PiPEventBridgeHandler);
  });

  it('initialize when pip window null does not add listeners', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    handler.stop();
    expect(mockYtdAppProvider.getApp).not.toHaveBeenCalled();
  });

  it('initialize when app.fire missing does not add listeners', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const app = document.createElement('div');
    (app as unknown as { fire?: unknown }).fire = undefined;
    mockYtdAppProvider.getApp.mockReturnValue(app as never);
    const addSpy = vi.spyOn(pipDoc, 'addEventListener');
    handler.initialize();
    expect(addSpy).not.toHaveBeenCalled();
    addSpy.mockRestore();
    handler.stop();
  });

  it('initialize adds listeners and stop removes them', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const fireSpy = vi.fn();
    const app = document.createElement('div');
    (app as unknown as { fire: (name: string, detail: unknown) => void }).fire = fireSpy;
    mockYtdAppProvider.getApp.mockReturnValue(app as never);

    handler.initialize();
    const navDetail = { endpoint: {} };
    pipDoc.dispatchEvent(new CustomEvent(YT_EVENTS.NAVIGATE, { detail: navDetail }));
    expect(fireSpy).toHaveBeenCalledWith(YT_EVENTS.NAVIGATE, navDetail);

    const actionDetail = { action: 'like' };
    pipDoc.dispatchEvent(new CustomEvent(YT_EVENTS.ACTION, { detail: actionDetail }));
    expect(fireSpy).toHaveBeenCalledWith(YT_EVENTS.ACTION, actionDetail);

    handler.stop();
    fireSpy.mockClear();
    pipDoc.dispatchEvent(new CustomEvent(YT_EVENTS.NAVIGATE, { detail: {} }));
    expect(fireSpy).not.toHaveBeenCalled();
  });

  it('stop when never initialized does not throw', () => {
    expect(() => handler.stop()).not.toThrow();
  });
});
