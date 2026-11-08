import { describe, it, expect } from 'vitest';
import { isPlainKey, isTypingTarget } from '../hotkeys';

const KEY = 'p';

describe('isPlainKey', () => {
  it('matches the key alone, either case', () => {
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'p' }), KEY)).toBe(true);
    expect(isPlainKey(new KeyboardEvent('keydown', { key: 'P' }), KEY)).toBe(true);
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
