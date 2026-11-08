/**
 * Helpers for our keyboard shortcuts (PIP_HOTKEY).
 */

/** The event is `key` pressed alone: no Ctrl / Alt / Meta / Shift, not a repeat (case-insensitive). */
export function isPlainKey(e: KeyboardEvent, key: string): boolean {
  return (
    !e.repeat &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    e.key?.toLowerCase() === key.toLowerCase()
  );
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
