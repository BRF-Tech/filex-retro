import { describe, expect, it } from 'vitest';
import { defaultSettings, loadSettings, normalizeSettings, saveSettings, settingsKey } from '../../src/shell/settings.js';

const schema = [
  { key: 'music', label: 'x', default: true },
  { key: 'sfx', label: 'y', default: true },
  { key: 'crt', label: 'z', default: false },
];

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    state: {
      get: async (k) => data[k],
      set: async (k, v) => {
        data[k] = JSON.parse(JSON.stringify(v));
      },
    },
  };
}

describe('settings', () => {
  it('keys the store by view', () => {
    expect(settingsKey('doom')).toBe('settings.doom');
  });
  it('starts from the defaults', () => {
    expect(defaultSettings(schema)).toEqual({ music: true, sfx: true, crt: false });
  });
  it('keeps only known boolean values', () => {
    expect(normalizeSettings(schema, { music: false, sfx: 'no', other: true })).toEqual({ music: false, sfx: true, crt: false });
    expect(normalizeSettings(schema, null)).toEqual({ music: true, sfx: true, crt: false });
    expect(normalizeSettings(schema, [false])).toEqual({ music: true, sfx: true, crt: false });
  });
  it('reads the person store and writes it back', async () => {
    const fx = fakeStore({ 'settings.doom': { music: false } });
    expect(await loadSettings(fx, 'doom', schema)).toEqual({ music: false, sfx: true, crt: false });
    await saveSettings(fx, 'doom', schema, { music: true, sfx: false, crt: true, junk: 1 });
    expect(fx.data['settings.doom']).toEqual({ music: true, sfx: false, crt: true });
  });
  it('reads the defaults when the store fails', async () => {
    const fx = { state: { get: async () => { throw new Error('busy'); } } };
    expect(await loadSettings(fx, 'doom', schema)).toEqual({ music: true, sfx: true, crt: false });
  });
});
