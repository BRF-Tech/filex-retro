import { describe, expect, it } from 'vitest';
import { strings } from '../../src/doom/strings.js';

// A `_one` form is English's singular; a language that has no separate
// singular (Turkish) does not carry it.
const keys = (lang) => Object.keys(strings[lang]).filter((k) => !k.endsWith('_one')).sort();

describe('the DOOM-engine player strings', () => {
  it('have the same keys in English and Turkish', () => {
    expect(keys('tr')).toEqual(keys('en'));
  });
  it('write Turkish with its own letters', () => {
    expect(strings.tr['doom.player']).toBe('DOOM motoru oynatıcı');
    expect(strings.tr['doom.settings.music']).toBe('Müzik');
    expect(strings.tr['doom.keep']).toBe('Kayıtları sakla…');
  });
  it('use no long dashes or dash look-alikes', () => {
    const banned = /[‐-―−]/;
    for (const lang of ['en', 'tr']) {
      for (const [k, v] of Object.entries(strings[lang])) expect(banned.test(v), `${lang} ${k}`).toBe(false);
    }
  });
});
