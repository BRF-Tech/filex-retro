import { describe, expect, it } from 'vitest';
import { strings } from '../../src/dos/strings.js';

const keys = (lang) => Object.keys(strings[lang]).filter((k) => !k.endsWith('_one')).sort();

describe('the DOS player strings', () => {
  it('have the same keys in English and Turkish', () => {
    expect(keys('tr')).toEqual(keys('en'));
  });

  it('say why for every bundle the player refuses', () => {
    for (const code of ['not_zip', 'damaged', 'unsupported', 'encrypted', 'unsafe', 'empty', 'no_program']) {
      expect(strings.en['dos.bad.' + code], code).toBeTruthy();
      expect(strings.tr['dos.bad.' + code], code).toBeTruthy();
    }
  });

  it('write Turkish with its own letters', () => {
    expect(strings.tr['dos.player']).toBe('DOS oynatıcı');
    expect(strings.tr['dos.running']).toBe('Çalışıyor');
    expect(strings.tr['dos.change']).toBe('Programı değiştir');
    expect(strings.tr['dos.pick.title']).toBe('Oyunu hangi program başlatır?');
    expect(strings.tr['dos.bad.empty']).toBe('Paket boş.');
  });

  it('keep the placeholders of the English text', () => {
    const holes = (s) => (s.match(/\{[a-z]+\}/g) || []).sort();
    for (const k of keys('en')) expect(holes(strings.tr[k]), k).toEqual(holes(strings.en[k]));
  });

  it('use no long dashes or dash look-alikes', () => {
    const banned = /[‐-―−]/;
    for (const lang of ['en', 'tr']) {
      for (const [k, v] of Object.entries(strings[lang])) expect(banned.test(v), `${lang} ${k}`).toBe(false);
    }
  });
});
