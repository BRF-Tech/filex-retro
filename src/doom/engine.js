// Runs the DOOM-engine WebAssembly (engines/doom: doomgeneric + Retro's
// platform layer, built by engines/doom/build.sh) in the page.
//
// The engine's files come from this app's own package (`package_fetch`):
// the script by a <script> element, the wasm by the script's own fetch -
// nothing from anywhere else. The game's files go into the engine's memory
// file system (MEMFS) under /retro, which is also its working directory: its
// configuration (default.cfg, doomgeneric.cfg) and its saves
// (.savegame/doomsavN.dsg) are written there, and read back from there when
// the person keeps them.

import { SAVE_RE, CONFIG_FILES } from './fxdoom.js';

export const ENGINE_SCRIPT = 'engines/doom/retro-doom.js';
const DIR = '/retro';
const SAVE_DIR = DIR + '/.savegame';

let scriptLoad = null;

/** Loads the engine's script once; resolves its factory (window.RetroDoom). */
export function loadEngineScript(doc = document, src = ENGINE_SCRIPT) {
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = src;
      s.onload = () => (typeof doc.defaultView.RetroDoom === 'function' ? resolve(doc.defaultView.RetroDoom) : reject(new Error('the engine script defined no RetroDoom')));
      s.onerror = () => reject(new Error('the engine script could not be loaded'));
      doc.head.append(s);
    });
    scriptLoad.catch(() => {
      scriptLoad = null;
    });
  }
  return scriptLoad;
}

/** The engine's command line for a game: the IWAD, then any PWADs. */
export function engineArgs(iwadName, pwadNames = []) {
  const args = ['-iwad', DIR + '/wads/' + iwadName];
  if (pwadNames.length) args.push('-file', ...pwadNames.map((n) => DIR + '/wads/' + n));
  return args;
}

/**
 * Starts a game. `game` is {iwad: {name, data}, pwads: [{name, data}],
 * saves: [{name, data}], config: [{name, data}]}. Hooks: onTitle(text),
 * onExit(code, lastErrorLines), onLog(line). Resolves the running engine.
 */
export async function startEngine({ factory, canvas, audio, game, onTitle, onExit, onLog }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let image = null;
  let pixels = null;
  const errLines = [];
  let exited = false;
  let M = null;

  const log = (line, isErr) => {
    if (isErr) {
      errLines.push(line);
      if (errLines.length > 12) errLines.shift();
    }
    if (onLog) onLog(line, isErr);
  };

  const finish = (code, quiet = false) => {
    if (exited) return;
    exited = true;
    try {
      if (M && M._retro_halt) M._retro_halt();
    } catch {
      /* the engine is gone already */
    }
    if (onExit && !quiet) onExit(code, errLines.slice());
  };

  const moduleArgs = {
    noInitialRun: true,
    print: (t) => log(String(t), false),
    printErr: (t) => log(String(t), true),
    // exit() in the engine (the menu's Quit, I_Error): its platform layer
    // has stopped the loop already (retro_platform.c, __wrap_exit).
    retroExit: (code) => finish(code),
    onAbort: (what) => {
      log(String(what), true);
      finish(-2);
    },
    retroDraw: (ptr, w, h) => {
      if (!image || image.width !== w || image.height !== h) {
        canvas.width = w;
        canvas.height = h;
        image = ctx.createImageData(w, h);
        pixels = new Uint32Array(image.data.buffer);
      }
      // DG_ScreenBuffer is 0x00RRGGBB per pixel; ImageData wants R, G, B, A
      // in memory order (0xAABBGGRR as a little-endian word).
      const src = new Uint32Array(M.HEAPU8.buffer, ptr, w * h);
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        pixels[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >>> 16) & 0xff);
      }
      ctx.putImageData(image, 0, 0);
    },
    retroTitle: (t) => onTitle && onTitle(t),
    preRun: [
      (mod) => {
        const FS = (mod || M).FS;
        FS.mkdirTree(DIR + '/wads');
        FS.mkdirTree(SAVE_DIR);
        FS.writeFile(DIR + '/wads/' + game.iwad.name, game.iwad.data);
        for (const p of game.pwads || []) FS.writeFile(DIR + '/wads/' + p.name, p.data);
        for (const c of game.config || []) FS.writeFile(DIR + '/' + c.name, c.data);
        for (const s of game.saves || []) FS.writeFile(SAVE_DIR + '/' + s.name, s.data);
        FS.chdir(DIR);
      },
    ],
  };
  // SDL's audio takes the AudioContext the Start click made (it would make
  // its own, outside any gesture, and that one stays suspended).
  if (audio) moduleArgs.SDL2 = { audioContext: audio };

  M = await factory(moduleArgs);
  try {
    M.callMain(engineArgs(game.iwad.name, (game.pwads || []).map((p) => p.name)));
  } catch (e) {
    // The main loop is set with simulate_infinite_loop: main() returns by
    // throwing 'unwind'. Anything else is a real failure.
    if (e !== 'unwind' && !(e && e.name === 'ExitStatus')) {
      log(String((e && e.message) || e), true);
      finish(-3);
    }
  }

  const FS = M.FS;
  const listSaves = () => {
    try {
      return FS.readdir(SAVE_DIR).filter((n) => SAVE_RE.test(n)).sort();
    } catch {
      return [];
    }
  };

  return {
    module: M,
    get exited() {
      return exited;
    },
    key(down, code) {
      if (!exited && code) M._retro_key(down ? 1 : 0, code);
    },
    pause(on) {
      if (!exited) M._retro_pause(on ? 1 : 0);
    },
    setMusic(on) {
      if (!exited) M._retro_set_music(on ? 1 : 0);
    },
    setSfx(on) {
      if (!exited) M._retro_set_sfx(on ? 1 : 0);
    },
    /** A string that changes whenever a save slot is written. */
    savesSignature() {
      return listSaves()
        .map((n) => {
          const st = FS.stat(SAVE_DIR + '/' + n);
          return `${n}:${st.size}:${+st.mtime}`;
        })
        .join('|');
    },
    readSaves() {
      return listSaves().map((name) => ({ name, data: FS.readFile(SAVE_DIR + '/' + name) }));
    },
    /** The engine's settings, written out first (it writes them only on quit). */
    readConfig() {
      if (!exited) M._retro_save_config();
      const out = [];
      for (const name of CONFIG_FILES) {
        try {
          out.push({ name, data: FS.readFile(DIR + '/' + name) });
        } catch {
          /* not written */
        }
      }
      return out;
    },
    /** Stops the engine without telling onExit (the page is starting another). */
    halt() {
      finish(0, true);
    },
  };
}
