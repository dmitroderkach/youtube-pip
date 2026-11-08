/**
 * Keys of the userscript's UI texts and the English dictionary, the reference and fallback (docs/I18N.md).
 */
export const EN_MESSAGES = {
  /**
   * YouTube's name of picture-in-picture: label of our context menu items and of our PiP buttons (PiPEntryPoints),
   * the same text as YouTube's own PiP button / menu item.
   */
  PIP: 'Picture-in-picture',
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;

/** A full dictionary: every key, translated. */
export type Messages = Record<MessageKey, string>;
