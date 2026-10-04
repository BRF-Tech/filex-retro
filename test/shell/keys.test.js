// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { captureKeys, isGameTarget } from '../../src/shell/keys.js';

function setup() {
  document.body.innerHTML = '<canvas class="rx-screen" tabindex="0"></canvas><button>Save</button>';
  return { canvas: document.querySelector('canvas'), button: document.querySelector('button') };
}

function press(target, type, code, key = code) {
  const e = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

let stop = null;
afterEach(() => {
  if (stop) stop();
  stop = null;
});

describe('isGameTarget', () => {
  it('is the screen, the body or nothing; not a button', () => {
    const { canvas, button } = setup();
    expect(isGameTarget(canvas, document)).toBe(true);
    expect(isGameTarget(document.body, document)).toBe(true);
    expect(isGameTarget(null, document)).toBe(true);
    expect(isGameTarget(button, document)).toBe(false);
  });
});

describe('captureKeys', () => {
  it('hands the game the keys pressed on the screen and stops them there', () => {
    const { canvas } = setup();
    const seen = [];
    stop = captureKeys({ doc: document, onKey: (k, down) => (seen.push(`${down ? 'down' : 'up'} ${k.code}`), true) });
    const e = press(canvas, 'keydown', 'ArrowUp');
    press(canvas, 'keyup', 'ArrowUp');
    expect(seen).toEqual(['down ArrowUp', 'up ArrowUp']);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves the keys pressed on a button alone', () => {
    const { button } = setup();
    const seen = [];
    stop = captureKeys({ doc: document, onKey: (k) => (seen.push(k.code), true) });
    const e = press(button, 'keydown', 'Space', ' ');
    expect(seen).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not take a key the game did not want', () => {
    const { canvas } = setup();
    stop = captureKeys({ doc: document, onKey: () => false });
    expect(press(canvas, 'keydown', 'F5').defaultPrevented).toBe(false);
  });

  it('listens only while the game is active', () => {
    const { canvas } = setup();
    let active = false;
    const seen = [];
    stop = captureKeys({ doc: document, active: () => active, onKey: (k) => (seen.push(k.code), true) });
    press(canvas, 'keydown', 'KeyW');
    active = true;
    press(canvas, 'keydown', 'KeyA');
    expect(seen).toEqual(['KeyA']);
  });

  it('releases a held key when the window loses focus', () => {
    const { canvas } = setup();
    const seen = [];
    stop = captureKeys({ doc: document, onKey: (k, down) => (seen.push(`${down ? 'down' : 'up'} ${k.code}`), true) });
    press(canvas, 'keydown', 'ArrowLeft');
    window.dispatchEvent(new Event('blur'));
    expect(seen).toEqual(['down ArrowLeft', 'up ArrowLeft']);
    window.dispatchEvent(new Event('blur'));
    expect(seen.length).toBe(2);
  });

  it('forwards the release of a held key even after the game went inactive', () => {
    const { canvas } = setup();
    let active = true;
    const seen = [];
    stop = captureKeys({ doc: document, active: () => active, onKey: (k, down) => (seen.push(`${down ? 'down' : 'up'} ${k.code}`), true) });
    press(canvas, 'keydown', 'ControlLeft', 'Control');
    active = false;
    press(canvas, 'keyup', 'ControlLeft', 'Control');
    expect(seen).toEqual(['down ControlLeft', 'up ControlLeft']);
  });
});
