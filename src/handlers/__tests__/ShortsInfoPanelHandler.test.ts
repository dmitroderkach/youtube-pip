import { describe, it, expect, beforeEach } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { ShortsInfoPanelHandler } from '../ShortsInfoPanelHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';

describe('ShortsInfoPanelHandler', () => {
  let handler: ShortsInfoPanelHandler;
  let mockPipProvider: MockProxy<PipWindowProvider>;

  beforeEach(() => {
    mockPipProvider = mock<PipWindowProvider>();

    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(mockPipProvider);
    c.bind(ShortsInfoPanelHandler).toSelf();
    handler = c.get(ShortsInfoPanelHandler);
  });

  it('initialize when pip window null does not set observer', () => {
    mockPipProvider.getWindow.mockReturnValue(null);
    handler.initialize();
    expect(handler['observer']).toBeNull();
  });

  it('initialize when pip window set starts observer and runs unhide once', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);

    handler.initialize();

    expect(handler['observer']).not.toBeNull();
    handler.stop();
  });

  it('stop when never initialized does not throw', () => {
    expect(() => handler.stop()).not.toThrow();
  });

  it('stop disconnects observer', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);
    handler.initialize();
    expect(handler['observer']).not.toBeNull();
    handler.stop();
    expect(handler['observer']).toBeNull();
  });

  it('unhideVisibleInfoPanelParagraphs when link-only found removes is-empty and hidden', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);

    const container = pipDoc.createElement('div');
    container.className = 'ytd-info-panel-content-renderer';

    const emptyParagraph = pipDoc.createElement('yt-formatted-string');
    emptyParagraph.setAttribute('is-empty', '');
    const hiddenAttributed = pipDoc.createElement('yt-attributed-string');
    hiddenAttributed.setAttribute('hidden', 'true');
    hiddenAttributed.textContent = 'BBC World Service text';
    emptyParagraph.appendChild(hiddenAttributed);
    container.appendChild(emptyParagraph);

    const linkOnly = pipDoc.createElement('yt-formatted-string');
    linkOnly.setAttribute('has-link-only_', '');
    container.appendChild(linkOnly);

    pipDoc.body.appendChild(container);

    handler.initialize();

    expect(emptyParagraph.hasAttribute('is-empty')).toBe(false);
    expect(hiddenAttributed.hasAttribute('hidden')).toBe(false);
    handler.stop();
  });

  it('unhideVisibleInfoPanelParagraphs when no link-only does not modify DOM', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const container = pipDoc.createElement('div');
    container.className = 'ytd-info-panel-content-renderer';
    const emptyParagraph = pipDoc.createElement('yt-formatted-string');
    emptyParagraph.setAttribute('is-empty', '');
    container.appendChild(emptyParagraph);
    pipDoc.body.appendChild(container);

    handler['unhideVisibleInfoPanelParagraphs'](pipDoc);

    expect(emptyParagraph.hasAttribute('is-empty')).toBe(true);
  });

  it('unhideVisibleInfoPanelParagraphs when link-only has no matching container does not throw', () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const linkOnly = pipDoc.createElement('yt-formatted-string');
    linkOnly.setAttribute('has-link-only_', '');
    pipDoc.body.appendChild(linkOnly);

    expect(() => handler['unhideVisibleInfoPanelParagraphs'](pipDoc)).not.toThrow();
  });

  it('when mutation adds has-link-only_ observer runs and unhides paragraph', async () => {
    const pipDoc = document.implementation.createHTMLDocument();
    const pipWindow = createFakeWindow({ document: pipDoc });
    mockPipProvider.getWindow.mockReturnValue(pipWindow);

    const container = pipDoc.createElement('div');
    container.className = 'ytd-info-panel-content-renderer';
    const emptyParagraph = pipDoc.createElement('yt-formatted-string');
    emptyParagraph.setAttribute('is-empty', '');
    const hiddenAttributed = pipDoc.createElement('yt-attributed-string');
    hiddenAttributed.setAttribute('hidden', 'true');
    emptyParagraph.appendChild(hiddenAttributed);
    container.appendChild(emptyParagraph);
    const linkOnly = pipDoc.createElement('yt-formatted-string');
    container.appendChild(linkOnly);
    pipDoc.body.appendChild(container);

    handler.initialize();
    expect(emptyParagraph.hasAttribute('is-empty')).toBe(true);

    linkOnly.setAttribute('has-link-only_', '');

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(emptyParagraph.hasAttribute('is-empty')).toBe(false);
    expect(hiddenAttributed.hasAttribute('hidden')).toBe(false);
    handler.stop();
  });
});
