import { describe, expect, it } from 'vitest';
import { doomKey, KEY } from '../../src/doom/keys.js';

describe('doomKey', () => {
  it('maps the controls the way doomgeneric does', () => {
    expect(doomKey({ code: 'ArrowUp', key: 'ArrowUp' })).toBe(KEY.UPARROW);
    expect(doomKey({ code: 'ControlLeft', key: 'Control' })).toBe(KEY.FIRE);
    expect(doomKey({ code: 'ControlRight', key: 'Control' })).toBe(KEY.FIRE);
    expect(doomKey({ code: 'Space', key: ' ' })).toBe(KEY.USE);
    expect(doomKey({ code: 'ShiftLeft', key: 'Shift' })).toBe(KEY.RSHIFT);
    expect(doomKey({ code: 'AltLeft', key: 'Alt' })).toBe(KEY.RALT);
    expect(doomKey({ code: 'Escape', key: 'Escape' })).toBe(27);
    expect(doomKey({ code: 'Enter', key: 'Enter' })).toBe(13);
    expect(doomKey({ code: 'Tab', key: 'Tab' })).toBe(9);
    expect(doomKey({ code: 'Backspace', key: 'Backspace' })).toBe(0x7f);
  });
  it('maps every function key', () => {
    expect(doomKey({ code: 'F1' })).toBe(0x80 + 0x3b);
    expect(doomKey({ code: 'F10' })).toBe(0x80 + 0x44);
    expect(doomKey({ code: 'F11' })).toBe(0x80 + 0x57);
    expect(doomKey({ code: 'F12' })).toBe(0x80 + 0x58);
  });
  it('sends letters and digits as lower-case ASCII', () => {
    expect(doomKey({ code: 'KeyY', key: 'y' })).toBe('y'.charCodeAt(0));
    expect(doomKey({ code: 'KeyY', key: 'Y' })).toBe('y'.charCodeAt(0));
    expect(doomKey({ code: 'Digit3', key: '3' })).toBe('3'.charCodeAt(0));
    expect(doomKey({ code: 'Minus', key: '-' })).toBe(KEY.MINUS);
    expect(doomKey({ code: 'Equal', key: '=' })).toBe(KEY.EQUALS);
  });
  it('follows the layout for a letter, and the key place for a non-ASCII one', () => {
    expect(doomKey({ code: 'KeyQ', key: 'a' })).toBe('a'.charCodeAt(0));
    expect(doomKey({ code: 'KeyI', key: 'ı' })).toBe('i'.charCodeAt(0));
    expect(doomKey({ code: 'Semicolon', key: 'ş' })).toBe(0x3b);
  });
  it('leaves alone a key that means nothing to the game', () => {
    expect(doomKey({ code: 'MetaLeft', key: 'Meta' })).toBe(0);
    expect(doomKey({ code: 'ContextMenu', key: 'ContextMenu' })).toBe(0);
    expect(doomKey({ code: '', key: 'Unidentified' })).toBe(0);
  });
});
