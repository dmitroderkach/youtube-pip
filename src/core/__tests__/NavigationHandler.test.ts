import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { NavigationHandler } from '../NavigationHandler';
import { PipWindowProvider } from '../PipWindowProvider';

describe('NavigationHandler', () => {
  let handler: NavigationHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;
  let pipDoc: Document;
  let popstateSpy: ReturnType<typeof vi.fn<(ev: PopStateEvent) => void>>;

  beforeEach(() => {
    pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = { document: pipDoc } as unknown as Window;
    mockPipProvider = mock<PipWindowProvider>();
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    popstateSpy = vi.fn<(ev: PopStateEvent) => void>();
    window.addEventListener('popstate', popstateSpy);

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    handler = c.get(NavigationHandler);
  });

  afterEach(() => {
    window.removeEventListener('popstate', popstateSpy);
  });

  it('initialize sets up click handler and cleanup clears pipWindow', () => {
    handler.initialize();
    expect(() => handler.cleanup()).not.toThrow();
  });

  it('click on link dispatches popstate', () => {
    handler.initialize();
    const link = pipDoc.createElement('a');
    link.href = 'https://www.youtube.com/watch?v=abc';
    link.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popstateSpy).toHaveBeenCalled();
  });

  it('click on link with playlist and index builds state', () => {
    handler.initialize();
    const link = pipDoc.createElement('a');
    link.href = 'https://www.youtube.com/watch?v=vid&list=PL1&index=2&pp=foo';
    link.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popstateSpy).toHaveBeenCalled();
    const ev = popstateSpy.mock.calls[0][0] as PopStateEvent;
    const watchEndpoint = (
      ev.state as { endpoint?: { watchEndpoint?: { playlistId?: string; index?: number } } }
    )?.endpoint?.watchEndpoint;
    expect(watchEndpoint?.playlistId).toBe('PL1');
    expect(watchEndpoint?.index).toBe(1);
  });

  it('click on endpoint with no href does not dispatch popstate', () => {
    handler.initialize();
    const link = pipDoc.createElement('a');
    link.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popstateSpy).not.toHaveBeenCalled();
  });

  it('click on button skips navigation', () => {
    handler.initialize();
    const btn = pipDoc.createElement('button');
    btn.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(btn);
    pipDoc.body.appendChild(pipDoc.createElement('a'));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popstateSpy).not.toHaveBeenCalled();
  });

  it('setupClickHandler logs error when pip window is null', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    expect(mockPipProvider.getWindow).toHaveBeenCalled();
  });

  it('click on link with invalid href triggers catch', () => {
    handler.initialize();
    const link = pipDoc.createElement('a');
    link.setAttribute('href', '');
    link.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(link);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popstateSpy).not.toHaveBeenCalled();
  });

  it('click when URL constructor throws is caught', () => {
    handler.initialize();
    const link = pipDoc.createElement('a');
    link.href = 'https://www.youtube.com/watch?v=x';
    link.className = 'yt-simple-endpoint';
    pipDoc.body.appendChild(link);
    const OrigURL = globalThis.URL;
    globalThis.URL = function () {
      throw new Error('URL error');
    } as unknown as typeof URL;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    globalThis.URL = OrigURL;
    expect(popstateSpy).not.toHaveBeenCalled();
  });
});
