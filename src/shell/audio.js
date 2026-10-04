// Sound starts on a gesture. Browsers keep an AudioContext created without
// one "suspended"; one created and resumed inside the person's click (or key
// press) on the Start button runs. Measured in Chromium, Firefox and WebKit
// inside filex's app frame: the frame's own click is enough.
//
// Call `unlockAudio()` synchronously in the click handler, before any await.

export function unlockAudio(win = globalThis) {
  const AC = win.AudioContext || win.webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}
