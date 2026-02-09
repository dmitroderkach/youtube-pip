import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOMUtils } from '../DOMUtils';
import { TIMEOUTS } from '../../constants';
import { createFakeWindow } from '../../test-utils/test-helpers';

vi.mock('../../logger', () => ({
  Logger: { getInstance: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

/** Short timeout for "rejects on timeout" test */
const SHORT_TIMEOUT_MS = 50;
/** Minimal timeout for "rejects when no body" test */
const TINY_TIMEOUT_MS = 10;
/** Delay after which element is appended in mutation test (fake timers) */
const MUTATION_DELAY_MS = 20;
/** Timeout for "mutation skips non-matching" test */
const MUTATION_SKIP_TIMEOUT_MS = 500;
/** Step size when advancing timers for mutation tests */
const MUTATION_STEP_MS = 10;

describe('DOMUtils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createPlaceholder returns comment with text', () => {
    const c = DOMUtils.createPlaceholder('placeholder');
    expect(c.nodeType).toBe(Node.COMMENT_NODE);
    expect(c.textContent).toBe('placeholder');
  });

  it('insertPlaceholderBefore inserts and returns true when parent exists', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    const placeholder = DOMUtils.createPlaceholder('p');
    expect(DOMUtils.insertPlaceholderBefore(child, placeholder)).toBe(true);
    expect(parent.firstChild).toBe(placeholder);
    expect(parent.lastChild).toBe(child);
  });

  it('insertPlaceholderBefore returns false when element has no parent', () => {
    const el = document.createElement('div');
    const placeholder = DOMUtils.createPlaceholder('p');
    expect(DOMUtils.insertPlaceholderBefore(el, placeholder)).toBe(false);
  });

  it('restoreElementFromPlaceholder moves element and removes placeholder', () => {
    const parent = document.createElement('div');
    const placeholder = document.createComment('p');
    const el = document.createElement('span');
    parent.appendChild(placeholder);
    DOMUtils.restoreElementFromPlaceholder(el, placeholder);
    expect(parent.contains(placeholder)).toBe(false);
    expect(parent.firstChild).toBe(el);
  });

  it('restoreElementFromPlaceholder does nothing when placeholder has no parent', () => {
    const placeholder = document.createComment('p');
    const el = document.createElement('span');
    expect(() => DOMUtils.restoreElementFromPlaceholder(el, placeholder)).not.toThrow();
  });

  it('copyAttributes copies all attributes', () => {
    const src = document.createElement('div');
    src.setAttribute('a', '1');
    src.setAttribute('b', '2');
    const target = document.createElement('div');
    DOMUtils.copyAttributes(src, target);
    expect(target.getAttribute('a')).toBe('1');
    expect(target.getAttribute('b')).toBe('2');
  });

  it('copyAttributes uses empty string when attribute nodeValue is null', () => {
    const src = document.createElement('div');
    src.setAttribute('data-x', 'v');
    const attr = src.attributes.getNamedItem('data-x');
    expect(attr).not.toBeNull();
    const target = document.createElement('div');
    if (attr) {
      Object.defineProperty(attr, 'nodeValue', { value: null, configurable: true });
    }
    DOMUtils.copyAttributes(src, target);
    expect(target.getAttribute('data-x')).toBe('');
  });

  it('copyAttributes does nothing when source or target null', () => {
    const el = document.createElement('div');
    DOMUtils.copyAttributes(null, el);
    DOMUtils.copyAttributes(el, null);
    expect(el.attributes.length).toBe(0);
  });

  it('copyViaTextarea creates textarea and returns execCommand result', () => {
    const doc = document;
    const ok = DOMUtils.copyViaTextarea(doc, 'hello');
    expect(typeof ok).toBe('boolean');
  });

  it('unwrap moves children to parent and removes wrapper', () => {
    const parent = document.createElement('div');
    const wrapper = document.createElement('span');
    const child = document.createElement('b');
    wrapper.appendChild(child);
    parent.appendChild(wrapper);
    DOMUtils.unwrap(wrapper);
    expect(parent.contains(wrapper)).toBe(false);
    expect(parent.firstChild).toBe(child);
  });

  it('unwrap does nothing when wrapper is null', () => {
    expect(() => DOMUtils.unwrap(null)).not.toThrow();
  });

  it('waitForElementSelector resolves when element already exists', async () => {
    const parent = document.createElement('div');
    const el = document.createElement('span');
    el.className = 'target';
    parent.appendChild(el);
    document.body.appendChild(parent);
    const found = await DOMUtils.waitForElementSelector<HTMLSpanElement>(
      '.target',
      document,
      TIMEOUTS.MENU_RETRY_DELAY
    );
    expect(found).toBe(el);
  });

  it('waitForElementSelector with element as parent (not document)', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const el = document.createElement('span');
    el.className = 'in-element';
    parent.appendChild(el);
    const found = await DOMUtils.waitForElementSelector<HTMLSpanElement>(
      '.in-element',
      parent,
      TIMEOUTS.MENU_RETRY_DELAY
    );
    expect(found).toBe(el);
  });

  it('waitForElementSelector resolves when element appears via mutation', async () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const p = DOMUtils.waitForElementSelector<HTMLSpanElement>(
      '.dynamic',
      document,
      TIMEOUTS.PHANTOM_WINDOW_CHECK
    );
    setTimeout(() => {
      const el = document.createElement('span');
      el.className = 'dynamic';
      parent.appendChild(el);
    }, MUTATION_DELAY_MS);
    await vi.advanceTimersByTimeAsync(MUTATION_DELAY_MS);
    const found = await p;
    expect(found.classList.contains('dynamic')).toBe(true);
  });

  it('waitForElementSelector rejects on timeout', async () => {
    await expect(
      DOMUtils.waitForElementSelector('.never-appears', document, SHORT_TIMEOUT_MS)
    ).rejects.toThrow(/Timeout|not found/);
  });

  it('unwrap does nothing when wrapper has no parent', () => {
    const wrapper = document.createElement('span');
    expect(() => DOMUtils.unwrap(wrapper)).not.toThrow();
  });

  it('waitForElementSelector rejects when document has no body', async () => {
    const origBody = document.body;
    Object.defineProperty(document, 'body', { value: null, configurable: true });
    try {
      const p = DOMUtils.waitForElementSelector('.x', document, TINY_TIMEOUT_MS);
      await expect(p).rejects.toThrow(/Target element not found/);
    } finally {
      Object.defineProperty(document, 'body', { value: origBody, configurable: true });
    }
  });

  it('waitForElementSelector MutationObserver callback skips when mutation does not add matching element', async () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const p = DOMUtils.waitForElementSelector<HTMLSpanElement>(
      '.will-appear-later',
      document,
      MUTATION_SKIP_TIMEOUT_MS
    );
    parent.appendChild(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(MUTATION_STEP_MS);
    const el = document.createElement('span');
    el.className = 'will-appear-later';
    parent.appendChild(el);
    await vi.advanceTimersByTimeAsync(MUTATION_STEP_MS);
    const found = await p;
    expect(found.classList.contains('will-appear-later')).toBe(true);
  });

  it('waitForElementSelector rejects on pagehide when timeout 0 and targetWindow given', async () => {
    const addSpy = vi.fn();
    const win = createFakeWindow({
      document: document.implementation.createHTMLDocument(),
      closed: false,
      addEventListener: addSpy,
    });
    const p = DOMUtils.waitForElementSelector(
      '.never',
      document,
      TIMEOUTS.ELEMENT_WAIT_INFINITE,
      win
    );
    const handler = addSpy.mock.calls.find((c: unknown[]) => c[0] === 'pagehide')?.[1];
    expect(handler).toBeDefined();
    handler?.();
    await expect(p).rejects.toThrow(/Wait aborted|closed/);
  });

  it('copyAttributes handles setAttribute throwing', () => {
    const src = document.createElement('div');
    src.setAttribute('data-x', '1');
    const target = document.createElement('div');
    vi.spyOn(target, 'setAttribute').mockImplementation(() => {
      throw new Error('setAttribute');
    });
    expect(() => DOMUtils.copyAttributes(src, target)).not.toThrow();
  });

  it('copyAttributes handles outer try throwing', () => {
    const src = document.createElement('div');
    const target = document.createElement('div');
    vi.spyOn(Array, 'from').mockImplementationOnce(() => {
      throw new Error('Array.from');
    });
    expect(() => DOMUtils.copyAttributes(src, target)).not.toThrow();
  });

  it('unwrap handles removeChild throwing', () => {
    const parent = document.createElement('div');
    const wrapper = document.createElement('span');
    parent.appendChild(wrapper);
    vi.spyOn(parent, 'removeChild').mockImplementation(() => {
      throw new Error('removeChild');
    });
    expect(() => DOMUtils.unwrap(wrapper)).not.toThrow();
  });
});
