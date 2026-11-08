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

  it('the key in the PiP window brings the video tab to the front, then closes the window', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    handler.initialize();
    const e = press(pipDoc.body);
    expect(focus).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    focus.mockRestore();
    expect(e.defaultPrevented).toBe(true);
  });

  it('sees the key before a capture listener registered later stops it (DocumentFocusHandler)', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    handler.initialize();
    pipDoc.addEventListener(
      'keydown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
    press(pipDoc.body);
    expect(close).toHaveBeenCalledOnce();
  });

  it('ignores modifiers and typing', () => {
    pipWindowProvider.getWindow.mockReturnValue(createFakeWindow({ document: pipDoc, close }));
    handler.initialize();
    press(pipDoc.body, { shiftKey: true });
    const input = pipDoc.createElement('input');
    pipDoc.body.appendChild(input);
    press(input);
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
