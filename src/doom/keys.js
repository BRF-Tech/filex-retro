// Browser keys to DOOM-engine key codes (doomgeneric's doomkeys.h).
//
// Controls follow the engine's defaults, as doomgeneric's own browser port
// maps them: arrows move, Ctrl fires, Space uses (doors, switches), Shift
// runs, Alt strafes, Esc opens the menu, Tab the map, F1-F12 the function
// keys. Letters, digits and punctuation go as lower-case ASCII (the menu's
// y/n, weapon numbers, a save game's name); a letter that is not ASCII on
// the person's layout (the Turkish ı, ş…) goes as the key's place on a US
// keyboard, so every key does something.

export const KEY = {
  RIGHTARROW: 0xae,
  LEFTARROW: 0xac,
  UPARROW: 0xad,
  DOWNARROW: 0xaf,
  USE: 0xa2,
  FIRE: 0xa3,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  BACKSPACE: 0x7f,
  PAUSE: 0xff,
  EQUALS: 0x3d,
  MINUS: 0x2d,
  RSHIFT: 0x80 + 0x36,
  RALT: 0x80 + 0x38,
  CAPSLOCK: 0x80 + 0x3a,
  HOME: 0x80 + 0x47,
  END: 0x80 + 0x4f,
  PGUP: 0x80 + 0x49,
  PGDN: 0x80 + 0x51,
  INS: 0x80 + 0x52,
  DEL: 0x80 + 0x53,
};

const F_KEYS = [0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x57, 0x58].map((n) => 0x80 + n);

const BY_CODE = {
  ArrowUp: KEY.UPARROW,
  ArrowDown: KEY.DOWNARROW,
  ArrowLeft: KEY.LEFTARROW,
  ArrowRight: KEY.RIGHTARROW,
  Enter: KEY.ENTER,
  NumpadEnter: KEY.ENTER,
  Escape: KEY.ESCAPE,
  Tab: KEY.TAB,
  Backspace: KEY.BACKSPACE,
  Pause: KEY.PAUSE,
  Space: KEY.USE,
  ControlLeft: KEY.FIRE,
  ControlRight: KEY.FIRE,
  ShiftLeft: KEY.RSHIFT,
  ShiftRight: KEY.RSHIFT,
  AltLeft: KEY.RALT,
  AltRight: KEY.RALT,
  CapsLock: KEY.CAPSLOCK,
  Home: KEY.HOME,
  End: KEY.END,
  PageUp: KEY.PGUP,
  PageDown: KEY.PGDN,
  Insert: KEY.INS,
  Delete: KEY.DEL,
  Minus: KEY.MINUS,
  NumpadSubtract: KEY.MINUS,
  Equal: KEY.EQUALS,
  NumpadAdd: KEY.EQUALS,
  Comma: 0x2c,
  Period: 0x2e,
  Slash: 0x2f,
  Semicolon: 0x3b,
  Quote: 0x27,
  BracketLeft: 0x5b,
  BracketRight: 0x5d,
  Backslash: 0x5c,
  Backquote: 0x60,
};
F_KEYS.forEach((k, i) => {
  BY_CODE['F' + (i + 1)] = k;
});

/**
 * The DOOM-engine key for a keyboard event ({code, key}), or 0 when the key
 * means nothing to the game (the page then leaves it alone).
 */
export function doomKey(e) {
  const code = e.code || '';
  if (BY_CODE[code] !== undefined) return BY_CODE[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) {
    const k = typeof e.key === 'string' && e.key.length === 1 ? e.key.toLowerCase() : '';
    return /^[a-z]$/.test(k) ? k.charCodeAt(0) : m[1].toLowerCase().charCodeAt(0);
  }
  m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (m) return m[1].charCodeAt(0);
  if (!code && typeof e.key === 'string' && e.key.length === 1) {
    const c = e.key.toLowerCase().charCodeAt(0);
    if (c > 0x20 && c < 0x7f) return c;
  }
  return 0;
}
