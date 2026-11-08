import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { createTestContainer } from '../../test-utils/test-container';
import { createFakeWindow } from '../../test-utils/test-helpers';
import { PiPHotkeyHandler } from '../PiPHotkeyHandler';
import { PipWindowProvider } from '../../core/PipWindowProvider';
import { PIP_HOTKEY } from '../../constants';

describe('PiPHotkeyHandler', () => {
  let handler: PiPHotkeyHandler;
  let pipWindowProvider: MockProxy<PipWindowProvider>;
  let pipDoc: Document;
  let close: ReturnType<typeof vi.fn<() => void>>;

  function press(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', {
      key: PIP_HOTKEY,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(e);
    return e;
  }

  beforeEach(() => {
    pipWindowProvider = mock<PipWindowProvider>();
    const c = createTestContainer();
    c.bind(PipWindowProvider).toInstance(pipWindowProvider);
    c.bind(PiPHotkeyHandler).toSelf();
    handler = c.get(PiPHotkeyHandler);
    pipDoc = document.implementation.createHTMLDocument();
    close = vi.fn<() => void>();
  });

  it('the key in the PiP window closes it', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    handler.initialize();
    const e = press(pipDoc.body);
    expect(close).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores modifiers, typing and keys the page already handled', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    handler.initialize();
    press(pipDoc.body, { shiftKey: true });
    const input = pipDoc.createElement('input');
    pipDoc.body.appendChild(input);
    press(input);
    const handled = (e: Event) => e.preventDefault();
    pipDoc.body.addEventListener('keydown', handled);
    press(pipDoc.body);
    expect(close).not.toHaveBeenCalled();
  });

  it('cleanup stops listening; without a PiP window nothing happens', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    handler.initialize();
    handler.cleanup();
    press(pipDoc.body);
    expect(close).not.toHaveBeenCalled();

    pipWindowProvider.getWindow.mockReturnValue(null);
    expect(() => {
      handler.initialize();
      handler.cleanup();
    }).not.toThrow();
  });
});
