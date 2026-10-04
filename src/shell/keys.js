// The keyboard for a game.
//
// filex hands the frame every key pressed in it (and none of filex's own
// shortcuts work inside it). A game takes a key only when the
// person is on the game screen - not while they are on a button, in the
// settings panel or in a message - and a key it takes does nothing else in
// the page (no scrolling, no button press).
//
// A held key whose release the game never sees (the person clicked out of
// the frame, switched tabs) would keep the player running: when the window
// loses focus or the page is hidden, every held key is released.

/** True when `target` is the game screen or nothing in particular. */
export function isGameTarget(target, doc) {
  if (!target || target === doc.body || target === doc.documentElement || target === doc) return true;
  return !!(target.closest && target.closest('.rx-screen'));
}

/**
 * Listen to the keyboard for a game. `onKey(key, down)` gets
 * `{code, key, repeat, ctrlKey, altKey, shiftKey, metaKey}` and answers true
 * when the game took it. `active()` says whether the game is listening at all
 * (false while it is not running or is paused). Returns the stop function.
 */
export function captureKeys({ doc = document, onKey, active = () => true }) {
  const win = doc.defaultView;
  const held = new Map();

  function pick(e) {
    return { code: e.code, key: e.key, repeat: !!e.repeat, ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, shiftKey: !!e.shiftKey, metaKey: !!e.metaKey };
  }

  function onDown(e) {
    if (!active() || !isGameTarget(e.target, doc)) return;
    const k = pick(e);
    if (onKey(k, true)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code) held.set(e.code, k);
    }
  }

  function onUp(e) {
    const k = pick(e);
    const was = held.delete(e.code);
    if (!was && (!active() || !isGameTarget(e.target, doc))) return;
    if (onKey(k, false)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function releaseAll() {
    const keys = [...held.values()];
    held.clear();
    for (const k of keys) onKey({ ...k, repeat: false }, false);
  }

  function onVisibility() {
    if (doc.hidden) releaseAll();
  }

  doc.addEventListener('keydown', onDown, true);
  doc.addEventListener('keyup', onUp, true);
  if (win) win.addEventListener('blur', releaseAll);
  doc.addEventListener('visibilitychange', onVisibility);

  const stop = () => {
    doc.removeEventListener('keydown', onDown, true);
    doc.removeEventListener('keyup', onUp, true);
    if (win) win.removeEventListener('blur', releaseAll);
    doc.removeEventListener('visibilitychange', onVisibility);
    held.clear();
  };
  stop.releaseAll = releaseAll;
  return stop;
}
