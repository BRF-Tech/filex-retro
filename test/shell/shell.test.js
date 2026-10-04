// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeError, startShell } from '../../src/shell/shell.js';
import { createTranslator } from '../../src/shell/i18n.js';
import { strings } from '../../src/shell/strings.js';

function fakeFx({ locale = 'en', stored = {} } = {}) {
  const listeners = {};
  const fx = {
    session: { locale, dir: 'ltr', files: [{ index: 0, name: 'freedoom2.wad', ext: 'wad', size: 10, readOnly: false }], grants: [] },
    store: { ...stored },
    calls: [],
    state: {
      get: async (k) => fx.store[k],
      set: async (k, v) => {
        fx.store[k] = v;
      },
    },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn);
      return () => {};
    },
    emit(ev, data) {
      for (const fn of listeners[ev] || []) fn(data);
    },
    dirty: (on) => fx.calls.push(['dirty', on]),
    title: (t) => fx.calls.push(['title', t]),
    toast: (t, tone) => fx.calls.push(['toast', t, tone]),
  };
  return fx;
}

const schema = [
  { key: 'music', label: 'test.music', default: true },
  { key: 'sfx', label: 'test.sfx', default: true },
];
const viewStrings = { en: { 'test.music': 'Music', 'test.sfx': 'Sound effects' }, tr: { 'test.music': 'Müzik', 'test.sfx': 'Ses efektleri' } };

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.rxState;
});

describe('startShell', () => {
  it('connects without taking Ctrl+S, and reads the person settings', async () => {
    const fx = fakeFx({ stored: { 'settings.doom': { music: false } } });
    const connect = vi.fn(async () => fx);
    const shell = await startShell({ view: 'doom', settings: schema, strings: viewStrings, connect });
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ saveShortcut: false }));
    expect(shell.fx).toBe(fx);
    expect(shell.settings.all()).toEqual({ music: false, sfx: true });
  });

  it('says so on screen when filex does not answer', async () => {
    const shell = await startShell({ view: 'doom', connect: async () => { throw new Error('timeout'); } });
    expect(shell.fx).toBe(null);
    expect(document.documentElement.dataset.rxState).toBe('no-filex');
    expect(document.querySelector('.rx-overlay').hidden).toBe(false);
    expect(document.querySelector('.rx-card__text').textContent).toContain('inside filex');
  });

  it('speaks Turkish when filex says tr, and switches when filex says en', async () => {
    const fx = fakeFx({ locale: 'tr-TR' });
    const shell = await startShell({ view: 'doom', settings: schema, strings: viewStrings, connect: async () => fx });
    expect(shell.locale).toBe('tr');
    expect(document.querySelector('[data-action="settings"]').textContent).toBe('Ayarlar');
    fx.emit('locale', { locale: 'en', dir: 'ltr' });
    expect(shell.locale).toBe('en');
    expect(document.querySelector('[data-action="settings"]').textContent).toBe('Settings');
  });

  it('keeps a switch the person turns, per person, and tells the player', async () => {
    const fx = fakeFx();
    const shell = await startShell({ view: 'doom', settings: schema, strings: viewStrings, connect: async () => fx });
    const changes = [];
    shell.settings.onChange((v, key) => changes.push([key, v.music]));
    document.querySelector('[data-action="settings"]').click();
    const music = document.querySelector('input[data-setting="music"]');
    expect(music.checked).toBe(true);
    expect(music.parentElement.textContent).toContain('Music');
    music.checked = false;
    music.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(changes).toEqual([['music', false]]);
    expect(fx.store['settings.doom']).toEqual({ music: false, sfx: true });
  });

  it('pauses while the settings are open and while the page is hidden', async () => {
    const shell = await startShell({ view: 'doom', settings: schema, strings: viewStrings, connect: async () => fakeFx() });
    const seen = [];
    shell.onPause((p, reasons) => seen.push([p, reasons.join(',')]));
    shell.settings.open();
    expect(shell.paused).toBe(true);
    shell.settings.close();
    expect(shell.paused).toBe(false);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(shell.paused).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([[true, 'settings'], [false, ''], [true, 'hidden'], [false, '']]);
    expect(document.querySelector('.rx-status').textContent).toBe('');
  });

  it('starts on the person click, with an AudioContext made in that click', async () => {
    const made = [];
    window.AudioContext = class {
      constructor() {
        made.push(this);
        this.state = 'suspended';
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      addEventListener() {}
    };
    const shell = await startShell({ view: 'doom', connect: async () => fakeFx() });
    const started = shell.showStart({ title: 'Freedoom: Phase 2', text: 'freedoom2.wad' });
    expect(made.length).toBe(0);
    const button = document.querySelector('[data-action="start"]');
    expect(button.textContent).toBe('Start');
    expect(document.activeElement).toBe(button);
    button.click();
    const { audio } = await started;
    expect(made.length).toBe(1);
    expect(audio.state).toBe('running');
    expect(document.documentElement.dataset.rxAudio).toBe('running');
    expect(document.querySelector('.rx-overlay').hidden).toBe(true);
    delete window.AudioContext;
  });

  it('hides Settings when there is nothing to set, and closes the panel', async () => {
    const shell = await startShell({ view: 'doom', settings: schema, strings: viewStrings, connect: async () => fakeFx() });
    shell.settings.open();
    shell.settings.setAvailable(false);
    expect(document.querySelector('[data-action="settings"]').hidden).toBe(true);
    expect(document.querySelector('.rx-panel').hidden).toBe(true);
    expect(shell.paused).toBe(false);
  });

  it('marks unsaved changes once per change', async () => {
    const fx = fakeFx();
    const shell = await startShell({ view: 'doom', connect: async () => fx });
    shell.setDirty(true);
    shell.setDirty(true);
    shell.setDirty(false);
    expect(fx.calls.filter((c) => c[0] === 'dirty')).toEqual([['dirty', true], ['dirty', false]]);
  });
});

describe('describeError', () => {
  const t = createTranslator('en', strings);
  it('reads the server short code from the message', () => {
    expect(describeError(t, { code: 'failed', message: 'quota_exceeded' })).toBe(strings.en['shell.err.quota_exceeded']);
    expect(describeError(t, { code: 'unavailable', message: 'busy' })).toBe(strings.en['shell.err.busy']);
  });
  it('falls back to the code, then to the message', () => {
    expect(describeError(t, { code: 'read_only', message: 'whatever the host said' })).toBe(strings.en['shell.err.read_only']);
    expect(describeError(t, new Error('boom'))).toBe('Unexpected error: boom');
  });
});
