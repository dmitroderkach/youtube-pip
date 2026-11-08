/**
 * Helpers for our keyboard shortcuts (PIP_HOTKEY).
 */

/**
 * The event is the letter `key` pressed alone: no Ctrl / Alt / Meta / Shift, not a repeat. Matched like YouTube's own
 * shortcuts, by the legacy `keyCode` (the OS key code: the letter's code on Latin layouts, also Dvorak / AZERTY,
 * and the physical key on others, e.g. a Ukrainian layout types "з" on P but still reports 80), then by the physical
 * key (`code`, "KeyP") and the typed character when the browser gives no key code.
 */
export function isPlainKey(e: KeyboardEvent, key: string): boolean {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const letter = key.toUpperCase();
  if (e.keyCode) return e.keyCode === letter.charCodeAt(0);
  if (e.code) return e.code === `Key${letter}`;
  return e.key?.toUpperCase() === letter;
}

/** The key goes to text the user is typing: an input, a text area, a select or editable content. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (typeof element?.closest !== 'function') return false;
  return (
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  );
}
