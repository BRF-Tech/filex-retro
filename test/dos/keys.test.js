import { describe, expect, it } from 'vitest';
import { dosKey, dosMouseButton, screenPoint } from '../../src/dos/keys.js';

const k = (code, key = '') => ({ code, key });

describe('dosKey', () => {
  it('maps letters, digits and the punctuation keys by place', () => {
    expect(dosKey(k('KeyA', 'a'))).toBe(65);
    expect(dosKey(k('KeyZ', 'z'))).toBe(90);
    expect(dosKey(k('KeyQ', 'a'))).toBe(81);
    expect(dosKey(k('Digit0', '0'))).toBe(48);
    expect(dosKey(k('Digit9', '('))).toBe(57);
    expect(dosKey(k('Space', ' '))).toBe(32);
    expect(dosKey(k('Minus'))).toBe(45);
    expect(dosKey(k('Equal'))).toBe(61);
    expect(dosKey(k('BracketLeft'))).toBe(91);
    expect(dosKey(k('Backslash'))).toBe(92);
    expect(dosKey(k('Semicolon'))).toBe(59);
    expect(dosKey(k('Quote'))).toBe(39);
    expect(dosKey(k('Backquote'))).toBe(96);
    expect(dosKey(k('Comma'))).toBe(44);
    expect(dosKey(k('Period'))).toBe(46);
    expect(dosKey(k('Slash'))).toBe(47);
    expect(dosKey(k('IntlBackslash'))).toBe(348);
  });

  it('maps the keys games use most', () => {
    expect(dosKey(k('Escape'))).toBe(256);
    expect(dosKey(k('Enter'))).toBe(257);
    expect(dosKey(k('Tab'))).toBe(258);
    expect(dosKey(k('Backspace'))).toBe(259);
    expect(dosKey(k('ArrowRight'))).toBe(262);
    expect(dosKey(k('ArrowLeft'))).toBe(263);
    expect(dosKey(k('ArrowDown'))).toBe(264);
    expect(dosKey(k('ArrowUp'))).toBe(265);
    expect(dosKey(k('ShiftLeft'))).toBe(340);
    expect(dosKey(k('ControlLeft'))).toBe(341);
    expect(dosKey(k('AltLeft'))).toBe(342);
    expect(dosKey(k('ShiftRight'))).toBe(344);
    expect(dosKey(k('ControlRight'))).toBe(345);
    expect(dosKey(k('AltRight'))).toBe(346);
    expect([1, 2, 10, 11, 12].map((n) => dosKey(k('F' + n)))).toEqual([290, 291, 299, 300, 301]);
    expect(['Insert', 'Delete', 'PageUp', 'PageDown', 'Home', 'End'].map((c) => dosKey(k(c)))).toEqual([260, 261, 266, 267, 268, 269]);
    expect(['CapsLock', 'ScrollLock', 'NumLock', 'PrintScreen', 'Pause'].map((c) => dosKey(k(c)))).toEqual([280, 281, 282, 283, 284]);
  });

  it('maps the number pad', () => {
    expect(dosKey(k('Numpad0'))).toBe(320);
    expect(dosKey(k('Numpad9'))).toBe(329);
    expect(['NumpadDecimal', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'NumpadAdd', 'NumpadEnter'].map((c) => dosKey(k(c)))).toEqual([330, 331, 332, 333, 334, 335]);
  });

  it('answers 0 for a key DOS has no place for', () => {
    expect(dosKey(k('MetaLeft'))).toBe(0);
    expect(dosKey(k('ContextMenu'))).toBe(0);
    expect(dosKey(k('AudioVolumeUp'))).toBe(0);
    expect(dosKey(null)).toBe(0);
    expect(dosKey(k('', 'é'))).toBe(0);
  });

  it('falls back to the letter for a key with no place', () => {
    expect(dosKey(k('', 'w'))).toBe(87);
    expect(dosKey(k('', '7'))).toBe(55);
  });
});

describe('the mouse', () => {
  it('sends the left and the right button', () => {
    expect(dosMouseButton(0)).toBe(0);
    expect(dosMouseButton(2)).toBe(1);
    expect(dosMouseButton(1)).toBe(-1);
    expect(dosMouseButton(3)).toBe(-1);
  });
  it('places the pointer on the screen, 0..1 on each axis', () => {
    const rect = { left: 100, top: 50, width: 640, height: 480 };
    expect(screenPoint(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenPoint(rect, 420, 290)).toEqual({ x: 0.5, y: 0.5 });
    expect(screenPoint(rect, 740, 530)).toEqual({ x: 1, y: 1 });
    expect(screenPoint(rect, 0, 900)).toEqual({ x: 0, y: 1 });
    expect(screenPoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 1, y: 1 });
  });
});
