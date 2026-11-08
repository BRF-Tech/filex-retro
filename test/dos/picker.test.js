// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { startShell } from '../../src/shell/shell.js';
import { strings } from '../../src/dos/strings.js';
import { findPrograms } from '../../src/dos/bundle.js';
import { pickProgram } from '../../src/dos/picker.js';

// The picker asks through the shell's own message (showMessage with
// options), so it runs here in the real shell, connected to a stand-in filex.
function fakeFx(locale = 'en') {
  const listeners = {};
  return {
    session: { locale, dir: 'ltr', files: [], grants: [] },
    state: { get: async () => undefined, set: async () => {} },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn);
      return () => {};
    },
    emit(ev, data) {
      for (const fn of listeners[ev] || []) fn(data);
    },
    dirty() {},
    title() {},
    toast() {},
  };
}

async function dosShell(locale = 'en') {
  const fx = fakeFx(locale);
  const shell = await startShell({ view: 'dos', strings, connect: async () => fx });
  return { shell, fx };
}

const programs = findPrograms(
  [
    ['SETUP.EXE', 2048],
    ['GAME/GAME.EXE', 153600],
    ['PLAY.BAT', 40],
  ].map(([name, size]) => ({ name, size, dir: false })),
);
const overlay = () => document.querySelector('.rx-overlay');
const items = () => [...document.querySelectorAll('.rx-overlay .rx-option')];
const title = () => overlay().querySelector('.rx-card__title').textContent;
const back = () => document.querySelector('[data-action="pick-back"]');

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.rxState;
});

describe('pickProgram', () => {
  it('asks in the shell message: the programs best first, as DOS names them, with their sizes', async () => {
    const { shell } = await dosShell();
    const picked = pickProgram(shell, programs);
    expect(document.documentElement.dataset.rxState).toBe('pick');
    expect(document.querySelectorAll('.rx-overlay').length).toBe(1);
    expect(overlay().hidden).toBe(false);
    expect(overlay().querySelector('.rx-card').classList.contains('rx-dos-pick')).toBe(true);
    expect(title()).toBe('Which program starts the game?');
    expect(overlay().querySelector('.rx-card__text').textContent).toBe(strings.en['dos.pick.text']);
    expect(items().map((b) => b.querySelector('.rx-option__label').textContent)).toEqual(['PLAY.BAT', 'SETUP.EXE', 'GAME\\GAME.EXE']);
    expect(items().map((b) => b.querySelector('.rx-option__detail').textContent)).toEqual(['0 KB', '2 KB', '150 KB']);
    expect(items().map((b) => b.dataset.option)).toEqual(['PLAY.BAT', 'SETUP.EXE', 'GAME/GAME.EXE']);
    expect(document.activeElement).toBe(items()[0]);
    expect(back()).toBe(null);
    items()[2].click();
    expect((await picked).name).toBe('GAME/GAME.EXE');
    expect(overlay().hidden).toBe(true);
    expect(document.querySelector('.rx-dos-pick')).toBe(null);
  });

  it('marks the program in use and lets the person go back to it', async () => {
    const { shell } = await dosShell();
    const current = programs.find((p) => p.name === 'GAME/GAME.EXE');
    const picked = pickProgram(shell, programs, current);
    const marked = items().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(marked.map((b) => b.dataset.option)).toEqual(['GAME/GAME.EXE']);
    expect(document.activeElement).toBe(marked[0]);
    expect(back().textContent).toBe('Close');
    expect(back().className).toBe('rx-btn');
    back().click();
    expect(await picked).toBe(null);
    expect(overlay().hidden).toBe(true);
  });

  it('goes back on Escape only when there is a program to go back to', async () => {
    const { shell } = await dosShell();
    const first = pickProgram(shell, programs);
    const esc = () => document.querySelector('.rx-dos-pick').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    esc();
    expect(document.querySelector('.rx-dos-pick')).not.toBe(null);
    items()[0].click();
    await first;
    const second = pickProgram(shell, programs, programs[0]);
    esc();
    expect(await second).toBe(null);
  });

  it('speaks Turkish, and follows a language change', async () => {
    const { shell, fx } = await dosShell('tr');
    const picked = pickProgram(shell, programs, programs[0]);
    expect(title()).toBe('Oyunu hangi program başlatır?');
    expect(back().textContent).toBe('Kapat');
    fx.emit('locale', { locale: 'en', dir: 'ltr' });
    expect(title()).toBe('Which program starts the game?');
    expect(back().textContent).toBe('Close');
    expect(items().map((b) => b.getAttribute('aria-current'))).toEqual(['true', null, null]);
    items()[1].click();
    expect((await picked).name).toBe('SETUP.EXE');
  });
});
