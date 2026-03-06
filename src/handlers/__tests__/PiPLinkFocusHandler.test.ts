import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { PiPLinkFocusHandler } from '../PiPLinkFocusHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { SELECTORS } from '../../selectors';

describe('PiPLinkFocusHandler', () => {
  let handler: PiPLinkFocusHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;

  beforeEach(() => {
    mockPipProvider = mock<PipWindowProvider>();
    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(PiPLinkFocusHandler).toSelf();
    handler = c.get(PiPLinkFocusHandler);
  });

  it('initialize when pip window null does not add listener', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    handler.stop();
  });

  it('initialize when pip document body missing does not add listener', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    const bodySpy = vi.spyOn(pipDoc, 'body', 'get').mockReturnValue(null as never);
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    handler.initialize();
    handler.stop();
    bodySpy.mockRestore();
  });

  it('initialize adds click listener and stop removes it', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});

    handler.initialize();
    const anchor = pipDoc.createElement('a');
    anchor.href = 'https://example.com';
    pipDoc.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusSpy).toHaveBeenCalled();

    handler.stop();
    focusSpy.mockClear();
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
  });

  it('click on link with target _blank does not focus window', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});

    handler.initialize();
    const anchor = pipDoc.createElement('a');
    anchor.href = 'https://example.com';
    anchor.target = '_blank';
    pipDoc.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
    handler.stop();
  });

  it('click on shorts video title prevents default and does not focus', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});

    handler.initialize();
    const titleEl = pipDoc.createElement('div');
    titleEl.className = SELECTORS.SHORTS_VIDEO_TITLE.slice(1).replace(/\./g, ' ');
    const link = pipDoc.createElement('a');
    link.href = 'https://youtube.com/shorts/abc';
    titleEl.appendChild(link);
    pipDoc.body.appendChild(titleEl);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(ev, 'preventDefault');
    link.dispatchEvent(ev);
    expect(preventSpy).toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    focusSpy.mockRestore();
    handler.stop();
  });

  it('stop when never initialized does not throw', () => {
    expect(() => handler.stop()).not.toThrow();
  });
});
