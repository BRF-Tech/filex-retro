import { describe, expect, it } from 'vitest';
import { createTranslator, pickLocale } from '../../src/shell/i18n.js';
import { strings } from '../../src/shell/strings.js';

describe('pickLocale', () => {
  it('reads a bare tag, a region tag and an underscore tag', () => {
    expect(pickLocale('tr')).toBe('tr');
    expect(pickLocale('tr-TR')).toBe('tr');
    expect(pickLocale('TR_tr')).toBe('tr');
    expect(pickLocale('en-GB')).toBe('en');
  });
  it('falls back to English for a language Retro does not speak', () => {
    expect(pickLocale('pt-br')).toBe('en');
    expect(pickLocale('')).toBe('en');
    expect(pickLocale(undefined)).toBe('en');
  });
});

describe('createTranslator', () => {
  const dict = {
    en: { hello: 'Hello {name}', saves: '{count} saved games', saves_one: '{count} saved game', only: 'only English' },
    tr: { hello: 'Merhaba {name}', saves: '{count} kayıtlı oyun' },
  };
  it('fills placeholders', () => {
    expect(createTranslator('en', dict)('hello', { name: 'Ada' })).toBe('Hello Ada');
    expect(createTranslator('tr', dict)('hello', { name: 'Ada' })).toBe('Merhaba Ada');
  });
  it('uses the _one form for a count of one, where the language has it', () => {
    const en = createTranslator('en', dict);
    expect(en('saves', { count: 1 })).toBe('1 saved game');
    expect(en('saves', { count: 3 })).toBe('3 saved games');
    expect(createTranslator('tr', dict)('saves', { count: 1 })).toBe('1 kayıtlı oyun');
  });
  it('falls back to English, then to the key itself', () => {
    const tr = createTranslator('tr', dict);
    expect(tr('only')).toBe('only English');
    expect(tr('missing.key')).toBe('missing.key');
  });
  it('lets a later dictionary win', () => {
    const t = createTranslator('en', dict, { en: { hello: 'Hi {name}' } });
    expect(t('hello', { name: 'Ada' })).toBe('Hi Ada');
  });
  it('leaves a placeholder it has no value for', () => {
    expect(createTranslator('en', dict)('hello', {})).toBe('Hello {name}');
  });
});

describe('the shell strings', () => {
  it('have the same keys in English and Turkish', () => {
    expect(Object.keys(strings.tr).sort()).toEqual(Object.keys(strings.en).sort());
  });
  it('write Turkish with its own letters', () => {
    expect(strings.tr['shell.start']).toBe('Başla');
    expect(strings.tr['shell.paused']).toBe('Duraklatıldı');
    expect(strings.tr['shell.settings']).toBe('Ayarlar');
  });
  it('use no long dashes or dash look-alikes', () => {
    const banned = /[‐-―−]/;
    for (const lang of ['en', 'tr']) {
      for (const [k, v] of Object.entries(strings[lang])) expect(banned.test(v), `${lang} ${k}`).toBe(false);
    }
  });
});
