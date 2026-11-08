import { describe, it, expect } from 'vitest';
import { isPlainKey, isTypingTarget } from '../hotkeys';

const KEY = 'p';

describe('isPlainKey', () => {
  it('matches the key alone, either case', () => {
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'p' }), KEY)).toBe(true);
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'P' }), KEY)).toBe(true);
  });

  /** Legacy key code of P, as Chrome reports it for the key on every layout. */
  const P_KEY_CODE = 80;

  it('matches by key code whatever the layout (Ukrainian layout types "з" on P)', () => {
    expect(
      isPlainKey(new KeyboardEvent('keydown', { key: 'з', code: 'KeyP', keyCode: P_KEY_CODE }), KEY)
    ).toBe(true);
  });

  it('Dvorak: the key labelled P (code KeyR) counts, the QWERTY P position typing "l" does not', () => {
    expect(
      isPlainKey(new KeyboardEvent('keydown', { key: 'p', code: 'KeyR', keyCode: P_KEY_CODE }), KEY)
    ).toBe(true);
    expect(
      isPlainKey(new KeyboardEvent('keydown', { key: 'l', code: 'KeyP', keyCode: 76 }), KEY)
    ).toBe(false);
  });

  it('without a key code, the physical key decides, then the character', () => {
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'з', code: 'KeyP' }), KEY)).toBe(true);
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'p', code: 'KeyG' }), KEY)).toBe(false);
  });

  it.each([
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { repeat: true },
    { key: 'o' },
  ])('rejects %o', (init) => {
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'p', ...init }), KEY)).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it.each(['input', 'textarea', 'select'])('%s is typing', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('inside editable content is typing, a plain element or no target is not', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', '');
    const inner = document.createElement('b');
    editor.appendChild(inner);
    expect(isTypingTarget(inner)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});
