import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContainer } from '../../test-utils/test-container';
import { FALLBACK_LANGUAGE, I18n, resolveLanguage } from '../I18n';
import { DICTIONARIES } from '../dictionaries';
import { EN_MESSAGES, type MessageKey } from '../messages';

/** Interface languages of YouTube's language picker (`hl` codes, account_menu), one dictionary each. */
const YOUTUBE_LANGUAGES =
  'af az id ms bs ca cs da de et en-IN en-GB en es es-419 es-US eu fil fr fr-CA gl hr zu is it sw lv lt hu nl no uz pl pt-PT pt ro sq sk sl sr-Latn fi sv vi tr be bg ky kk mk mn ru sr uk el hy iw ur ar fa ne mr hi as bn pa gu or ta te kn ml si th lo my ka am km zh-CN zh-TW zh-HK ja ko'.split(
    ' '
  );

type YtcfgWindow = Window & { ytcfg?: { get?: (key: string) => unknown } };

describe('dictionaries', () => {
  it('cover every YouTube interface language and nothing else', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...YOUTUBE_LANGUAGES].sort());
  });

  it('have every key, non-empty, and no unknown keys', () => {
    const keys = Object.keys(EN_MESSAGES).sort();
    for (const [language, messages] of Object.entries(DICTIONARIES)) {
      expect(Object.keys(messages).sort(), language).toEqual(keys);
      for (const key of keys)
        expect(messages[key as MessageKey].trim(), `${language} ${key}`).not.toBe('');
    }
  });

  it('English matches the reference messages', () => {
    expect(DICTIONARIES[FALLBACK_LANGUAGE]).toEqual(EN_MESSAGES);
  });
});

describe('resolveLanguage', () => {
  it.each([
    ['uk', 'uk'],
    ['pt-PT', 'pt-PT'],
    ['sr-Latn', 'sr-Latn'],
    ['es-419', 'es-419'],
    ['zh-CN', 'zh-CN'],
    // <html lang> tags
    ['uk-UA', 'uk'],
    ['pt-BR', 'pt'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-HK'],
    ['sr-Latn-RS', 'sr-Latn'],
    ['he-IL', 'iw'],
    ['nb-NO', 'no'],
    ['fil-PH', 'fil'],
    ['en_GB', 'en-GB'],
    ['DE-de', 'de'],
  ])('%s → %s', (tag, language) => {
    expect(resolveLanguage(tag)).toBe(language);
  });

  it.each([null, undefined, '', '-', 'xx', 'xx-YY'])('falls back to English for %s', (tag) => {
    expect(resolveLanguage(tag)).toBe(FALLBACK_LANGUAGE);
  });
});

describe('I18n', () => {
  let i18n: I18n;
  const win = window as YtcfgWindow;

  beforeEach(() => {
    const c = createTestContainer();
    c.bind(I18n).toSelf();
    i18n = c.get(I18n);
  });

  afterEach(() => {
    delete win.ytcfg;
    document.documentElement.lang = '';
  });

  it('uses YouTube hl from ytcfg', () => {
    win.ytcfg = { get: (key) => (key === 'HL' ? 'uk' : undefined) };
    document.documentElement.lang = 'de-DE';
    expect(i18n.getLanguage()).toBe('uk');
    expect(i18n.t('PIP')).toBe(DICTIONARIES.uk.PIP);
    expect(i18n.t('PIP')).toBe(DICTIONARIES.uk.PIP);
  });

  it('uses <html lang> when ytcfg has no hl', () => {
    win.ytcfg = { get: () => undefined };
    document.documentElement.lang = 'zh-Hant-TW';
    expect(i18n.t('PIP')).toBe(DICTIONARIES['zh-TW'].PIP);
  });

  it('uses <html lang> without ytcfg, English when the language is unknown', () => {
    document.documentElement.lang = 'tlh';
    expect(i18n.t('PIP')).toBe(EN_MESSAGES.PIP);
  });

  it('resolves the language once', () => {
    win.ytcfg = { get: () => 'pl' };
    expect(i18n.getLanguage()).toBe('pl');
    win.ytcfg = { get: () => 'de' };
    expect(i18n.getLanguage()).toBe('pl');
  });
});
