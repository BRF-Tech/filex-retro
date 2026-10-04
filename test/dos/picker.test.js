// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/shell/i18n.js';
import { strings as shellStrings } from '../../src/shell/strings.js';
import { strings } from '../../src/dos/strings.js';
import { findPrograms } from '../../src/dos/bundle.js';
import { pickProgram } from '../../src/dos/picker.js';

function fakeShell(locale = 'en') {
  const stage = document.createElement('main');
  document.body.append(stage);
  const listeners = new Set();
  const shell = {
    el: { stage },
    locale,
    t: createTranslator(locale, shellStrings, strings),
    states: [],
    hidden: 0,
    setState: (s) => shell.states.push(s),
    hideOverlay: () => (shell.hidden += 1),
    onLocale(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setLocale(l) {
      shell.locale = l;
      shell.t = createTranslator(l, shellStrings, strings);
      for (const fn of listeners) fn(l);
    },
    listeners,
  };
  return shell;
}

const programs = findPrograms(
  [
    ['SETUP.EXE', 2048],
    ['GAME/GAME.EXE', 153600],
    ['PLAY.BAT', 40],
  ].map(([name, size]) => ({ name, size, dir: false })),
);
const items = () => [...document.querySelectorAll('.rx-dos-pick__item')];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('pickProgram', () => {
  it('lists the programs best first, as DOS names them, with their sizes', async () => {
    const shell = fakeShell();
    const picked = pickProgram(shell, programs);
    expect(shell.hidden).toBe(1);
    expect(shell.states).toEqual(['pick']);
    expect(document.querySelector('.rx-card__title').textContent).toBe('Which program starts the game?');
    expect(items().map((b) => b.querySelector('.rx-dos-pick__name').textContent)).toEqual(['PLAY.BAT', 'SETUP.EXE', 'GAME\\GAME.EXE']);
    expect(items().map((b) => b.querySelector('.rx-dos-pick__size').textContent)).toEqual(['0 KB', '2 KB', '150 KB']);
    expect(document.activeElement).toBe(items()[0]);
    expect(document.querySelector('[data-action="pick-back"]')).toBe(null);
    items()[2].click();
    expect((await picked).name).toBe('GAME/GAME.EXE');
    expect(document.querySelector('.rx-dos-pick')).toBe(null);
    expect(shell.listeners.size).toBe(0);
  });

  it('marks the program in use and lets the person go back to it', async () => {
    const shell = fakeShell();
    const current = programs.find((p) => p.name === 'GAME/GAME.EXE');
    const picked = pickProgram(shell, programs, current);
    const marked = items().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(marked.map((b) => b.dataset.program)).toEqual(['GAME/GAME.EXE']);
    expect(document.activeElement).toBe(marked[0]);
    document.querySelector('[data-action="pick-back"]').click();
    expect(await picked).toBe(null);
  });

  it('goes back on Escape only when there is a program to go back to', async () => {
    const shell = fakeShell();
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
    const shell = fakeShell('tr');
    const picked = pickProgram(shell, programs, programs[0]);
    expect(document.querySelector('.rx-card__title').textContent).toBe('Oyunu hangi program başlatır?');
    expect(document.querySelector('[data-action="pick-back"]').textContent).toBe('Kapat');
    shell.setLocale('en');
    expect(document.querySelector('.rx-card__title').textContent).toBe('Which program starts the game?');
    expect(document.querySelector('[data-action="pick-back"]').textContent).toBe('Close');
    items()[1].click();
    expect((await picked).name).toBe('SETUP.EXE');
  });
});
