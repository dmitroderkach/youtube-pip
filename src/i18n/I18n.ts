import type { Logger } from '../logger';
import { LoggerFactory } from '../logger';
import { inject, injectable } from '../di';
import { DICTIONARIES } from './dictionaries';
import { EN_MESSAGES, type MessageKey } from './messages';

/** Language used when the page's language has no dictionary. */
export const FALLBACK_LANGUAGE = 'en';

/** BCP 47 language subtags of the page (`<html lang>`) whose YouTube `hl` code differs. */
const HTML_LANG_ALIASES: Readonly<Record<string, string>> = { he: 'iw', nb: 'no' };

/** Window with YouTube's config store (the page's `ytcfg`). */
type YtcfgWindow = Window & { ytcfg?: { get?: (key: string) => unknown } };

/**
 * Dictionary language for a YouTube `hl` code (`uk`, `pt-PT`, `sr-Latn`) or a page language tag (`uk-UA`,
 * `zh-Hant-TW`, `he-IL`): the exact code, then language + script / region (first two subtags, then language + last
 * subtag), then the language alone, then FALLBACK_LANGUAGE.
 */
export function resolveLanguage(tag: string | null | undefined): string {
  if (!tag) return FALLBACK_LANGUAGE;
  const parts = tag.replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts.length) return FALLBACK_LANGUAGE;
  const language = parts[0].toLowerCase();
  const base = HTML_LANG_ALIASES[language] ?? language;
  const rest = parts.slice(1);
  const candidates = [
    [base, ...rest].join('-'),
    rest.length > 1 ? `${base}-${rest[0]}` : null,
    rest.length ? `${base}-${rest[rest.length - 1]}` : null,
    base,
  ];
  const found = candidates.find((code): code is string => code !== null && code in DICTIONARIES);
  return found ?? FALLBACK_LANGUAGE;
}

/**
 * UI texts in the language of the YouTube interface: YouTube's `hl` from `ytcfg`, else `<html lang>`. Resolved on
 * first use; YouTube reloads the page when the user changes its language.
 */
@injectable()
export class I18n {
  private readonly logger: Logger;
  private language: string | null = null;

  constructor(@inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create('I18n');
  }

  /** Dictionary language in use (resolved on the first call). */
  public getLanguage(): string {
    if (this.language === null) {
      const hl = (window as YtcfgWindow).ytcfg?.get?.('HL');
      const tag = typeof hl === 'string' && hl ? hl : document.documentElement.lang;
      this.language = resolveLanguage(tag);
      this.logger.debug(`UI language: ${this.language} (page: ${tag || 'unknown'})`);
    }
    return this.language;
  }

  /** Text for `key` in the page's language; English when the dictionary has no such text. */
  public t(key: MessageKey): string {
    return DICTIONARIES[this.getLanguage()]?.[key] || EN_MESSAGES[key];
  }
}
