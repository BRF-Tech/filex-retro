// The keyboard for DOS: a key the person presses (its `code`, the key's
// place on the keyboard, not the letter it types) becomes the key code
// js-dos's emulator takes (`ci.sendKeyEvent`). The numbers are js-dos 8's
// KBD_* codes (the GLFW numbering). The place, not the letter, is what a
// DOS program reads: it has its own keyboard layout.

const CODES = {
  Escape: 256,
  Enter: 257,
  Tab: 258,
  Backspace: 259,
  Insert: 260,
  Delete: 261,
  ArrowRight: 262,
  ArrowLeft: 263,
  ArrowDown: 264,
  ArrowUp: 265,
  PageUp: 266,
  PageDown: 267,
  Home: 268,
  End: 269,
  CapsLock: 280,
  ScrollLock: 281,
  NumLock: 282,
  PrintScreen: 283,
  Pause: 284,
  Space: 32,
  Quote: 39,
  Comma: 44,
  Minus: 45,
  Period: 46,
  Slash: 47,
  Semicolon: 59,
  Equal: 61,
  BracketLeft: 91,
  Backslash: 92,
  BracketRight: 93,
  Backquote: 96,
  IntlBackslash: 348,
  NumpadDecimal: 330,
  NumpadDivide: 331,
  NumpadMultiply: 332,
  NumpadSubtract: 333,
  NumpadAdd: 334,
  NumpadEnter: 335,
  ShiftLeft: 340,
  ControlLeft: 341,
  AltLeft: 342,
  ShiftRight: 344,
  ControlRight: 345,
  AltRight: 346,
};
for (let i = 1; i <= 12; i++) CODES['F' + i] = 289 + i;
for (let i = 0; i <= 9; i++) {
  CODES['Digit' + i] = 48 + i;
  CODES['Numpad' + i] = 320 + i;
}
for (let c = 65; c <= 90; c++) CODES['Key' + String.fromCharCode(c)] = c;

/** The js-dos key code for a key (`{code, key}`), or 0 for a key DOS has no place for. */
export function dosKey(k) {
  if (!k) return 0;
  if (k.code && CODES[k.code] !== undefined) return CODES[k.code];
  // A key with no place (some on-screen keyboards): a plain letter or digit.
  if (!k.code && typeof k.key === 'string' && /^[a-zA-Z0-9]$/.test(k.key)) return k.key.toUpperCase().charCodeAt(0);
  return 0;
}

/** The mouse button js-dos takes for a pointer button: left 0, right 1 (the others are not sent). */
export function dosMouseButton(button) {
  if (button === 0) return 0;
  if (button === 2) return 1;
  return -1;
}

/** Where a pointer is on the screen, as js-dos takes it: 0..1 on each axis. */
export function screenPoint(rect, clientX, clientY) {
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const w = rect.width || 1;
  const h = rect.height || 1;
  return { x: clamp((clientX - rect.left) / w), y: clamp((clientY - rect.top) / h) };
}
