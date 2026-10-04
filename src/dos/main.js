// The DOS player (view `dos`): opens a js-dos bundle (`.jsdos`), checks it,
// and runs it in js-dos 8.5.1's DOSBox, drawn by this page (its own screen,
// sound and keys; not the js-dos player's interface).
//
//   open -> read the bytes (file.read as bytes) -> a zip? what is in it?
//     no zip / damaged / encrypted / empty / nothing to start -> a message
//     .jsdos/dosbox.conf                 -> Start (the bundle says what runs)
//     no dosbox.conf, one DOS program    -> Start (that program)
//     no dosbox.conf, several programs   -> the picker (remembered per bundle)
//   Start (the click starts the sound too) -> DOSBox runs in a worker; the
//   page polls its change set, and the Save button (filex's own Save does the
//   same) writes the bundle again with the changes merged in, as a new
//   version of the file - plus the dosbox.conf that starts the picked program,
//   the first time.
//
// Ctrl+S is a key for the game here (the SDK does not take it over).

import { startShell } from '../shell/shell.js';
import { captureKeys } from '../shell/keys.js';
import { readZip } from '../shell/zip.js';
import { strings } from './strings.js';
import {
  BundleError,
  PICKS_KEY,
  bundleKey,
  confFor,
  deletedFiles,
  dosPath,
  inspectBundle,
  mergeBundle,
  rememberedPick,
  stateSignature,
  treePaths,
  withPick,
} from './bundle.js';
import { dosKey, dosMouseButton, screenPoint } from './keys.js';
import { EMULATORS_DIR, loadEmulators, startDos } from './emulators.js';
import { playSound } from './audio.js';
import { pickProgram } from './picker.js';

const SETTINGS = [{ key: 'sound', label: 'dos.settings.sound', default: true }];
const POLL_MS = 3000;
const CALL_TIMEOUT_MS = 30000;
/** Over this size every save is a heavy upload: the Start screen says so. */
export const LARGE_BYTES = 64 * 1024 * 1024;

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(what + ' did not answer')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function paint(image, rgb, rgba) {
  const d = image.data;
  if (rgba) {
    d.set(rgba.length > d.length ? rgba.subarray(0, d.length) : rgba);
    return;
  }
  if (!rgb) return;
  for (let i = 0, j = 0; j + 2 < rgb.length && i < d.length; i += 4, j += 3) {
    d[i] = rgb[j];
    d[i + 1] = rgb[j + 1];
    d[i + 2] = rgb[j + 2];
    d[i + 3] = 255;
  }
}

async function main() {
  const shell = await startShell({ view: 'dos', strings, settings: SETTINGS });
  if (!shell.fx) return;
  const fx = shell.fx;
  const t = shell.t;
  const info = fx.session.files[0];
  shell.setTitle({ key: 'dos.player' });

  const fail = (spec, state = 'message') => {
    shell.setState(state);
    shell.setStatus(null);
    shell.settings.setAvailable(false);
    shell.showMessage(spec);
  };

  if (!info) {
    fail((tt) => ({ title: tt('shell.errorTitle'), text: tt('shell.readFailed'), tone: 'error' }), 'error');
    return;
  }

  // ---- read and check the bundle ---------------------------------------------
  shell.setStatus('dos.reading');
  let bytes;
  try {
    const file = await fx.open();
    bytes = new Uint8Array(await file.bytes());
  } catch (e) {
    fail((tt) => ({ title: tt('shell.errorTitle'), lines: [tt('shell.readFailed'), shell.describeError(e)], tone: 'error' }), 'error');
    return;
  }
  // DOS loads while the person reads the Start screen.
  const engineReady = loadEmulators(document, new URL(EMULATORS_DIR, location.href).href);
  engineReady.catch(() => {});

  let bundle;
  try {
    bundle = inspectBundle(bytes);
  } catch (e) {
    if (!(e instanceof BundleError)) throw e;
    fail((tt) => ({ title: tt('dos.bad.title'), text: tt('dos.bad.' + e.code) }), 'bad');
    return;
  }
  shell.setTitle({ text: info.name });

  const grants = fx.session.grants || [];
  const canWrite = grants.includes('files:write') && !info.readOnly;

  // ---- which program starts it -------------------------------------------------
  let program = null;
  let picks = null;
  let key = null;
  const remember = async (p) => {
    picks = withPick(picks, key, p.name);
    try {
      await fx.state.set(PICKS_KEY, picks);
    } catch {
      shell.toast(t('shell.settingsFailed'), 'warning');
    }
  };
  if (!bundle.conf) {
    key = await bundleKey(info.name, bytes);
    try {
      picks = await fx.state.get(PICKS_KEY);
    } catch {
      picks = null;
    }
    const before = rememberedPick(picks, key);
    program = bundle.programs.find((p) => p.name === before) || (bundle.programs.length === 1 ? bundle.programs[0] : null);
    if (!program) {
      shell.setStatus(null);
      program = await pickProgram(shell, bundle.programs, null);
      await remember(program);
    }
  }
  const confToAdd = () => (bundle.conf ? null : confFor(program));

  // ---- the screen, the buttons, the keys and the mouse ---------------------------
  const screen = document.createElement('canvas');
  screen.className = 'rx-screen rx-dos-screen';
  screen.tabIndex = 0;
  screen.width = 640;
  screen.height = 400;
  shell.el.stage.prepend(screen);
  shell.setFocusTarget(screen);
  const g = screen.getContext('2d');
  let image = null;

  let ci = null;
  let exited = true;
  let sound = null;
  let audio = null;
  // What DOSBox started from (the opened bundle; after a restart, the bundle
  // with the changes so far), the last change set seen, and the signature of
  // the changes already saved.
  let base = bundle.entries;
  let baseBytes = bytes;
  let lastChanges = [];
  let baseline = '';
  let savedDeleted = new Set();
  let baseUnsaved = false;
  let confSaved = false;
  let busy = false;
  let polling = false;

  const running = () => !!ci && !exited;
  const pendingConf = () => !bundle.conf && !confSaved;

  const saveButton = canWrite ? shell.addButton({ id: 'save', label: 'shell.save', primary: true, onClick: () => save() }) : null;
  // Save is offered while DOS runs (a file the game deleted shows only when
  // saving: the poll reads the change set, not the file tree), when the
  // game changed something, and while a picked program's configuration is
  // not in the bundle yet.
  const updateSave = () => {
    if (saveButton) saveButton.setDisabled(busy || !(running() || shell.dirty || pendingConf()));
  };
  updateSave();

  // Unsaved changes: filex asks before the person leaves them. Also
  // `<html data-rx-dirty>`, for the person's browser tools and the tests.
  const markDirty = (on) => {
    shell.setDirty(on);
    document.documentElement.dataset.rxDirty = String(!!on);
    updateSave();
  };

  const readChanges = async () => {
    const z = await withTimeout(ci.persist(true), CALL_TIMEOUT_MS, 'DOS');
    return z && z.length ? readZip(z) : [];
  };

  const noteChanges = (changes) => {
    lastChanges = changes;
    markDirty(canWrite && (baseUnsaved || stateSignature(changes, savedDeleted) !== baseline));
    updateSave();
  };

  async function save() {
    if (busy || !canWrite) return;
    busy = true;
    updateSave();
    shell.setStatus('shell.saving');
    try {
      let changes = lastChanges;
      let deleted = savedDeleted;
      if (running()) {
        while (polling) await new Promise((r) => setTimeout(r, 50));
        changes = await readChanges();
        try {
          deleted = deletedFiles(base, treePaths(await withTimeout(ci.fsTree(), CALL_TIMEOUT_MS, 'DOS')));
        } catch {
          deleted = savedDeleted;
        }
      }
      const sig = stateSignature(changes, deleted);
      if (sig === baseline && !baseUnsaved && !pendingConf()) {
        lastChanges = changes;
        markDirty(false);
        shell.toast(t('dos.nothingToSave'), 'info');
        return;
      }
      const out = await mergeBundle({ entries: base, changes, conf: confToAdd(), deleted });
      await fx.save(out);
      lastChanges = changes;
      savedDeleted = deleted;
      baseline = sig;
      baseUnsaved = false;
      confSaved = true;
      markDirty(false);
      shell.toast(t('dos.saved', { name: info.name }), 'success');
    } catch (e) {
      shell.toast(shell.describeError(e), 'error');
    } finally {
      busy = false;
      updateSave();
      shell.setStatus(running() ? 'dos.running' : null);
    }
  }
  if (canWrite) fx.onSave(() => save());

  // `<html data-rx-sound>`: how many samples the page has played (the
  // person's browser tools and the tests read it; 'none' without sound).
  const showSound = () => {
    document.documentElement.dataset.rxSound = sound && sound.resampler ? String(sound.resampler.played) : 'none';
  };
  setInterval(async () => {
    showSound();
    if (!running() || busy || polling || shell.paused) return;
    polling = true;
    try {
      noteChanges(await readChanges());
    } catch {
      /* the next poll tries again */
    } finally {
      polling = false;
    }
  }, POLL_MS);

  captureKeys({
    doc: document,
    active: () => running() && !shell.paused,
    onKey: (k, down) => {
      const code = dosKey(k);
      if (!code) return false;
      if (!(down && k.repeat)) ci.sendKeyEvent(code, down);
      return true;
    },
  });

  const mouseOn = () => running() && !shell.paused;
  const move = (e) => {
    const p = screenPoint(screen.getBoundingClientRect(), e.clientX, e.clientY);
    ci.sendMouseMotion(p.x, p.y);
  };
  screen.addEventListener('pointerdown', (e) => {
    screen.focus();
    if (!mouseOn()) return;
    const b = dosMouseButton(e.button);
    if (b < 0) return;
    e.preventDefault();
    move(e);
    ci.sendMouseButton(b, true);
    if (screen.setPointerCapture) {
      try {
        screen.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
    }
  });
  screen.addEventListener('pointerup', (e) => {
    if (!mouseOn()) return;
    const b = dosMouseButton(e.button);
    if (b >= 0) ci.sendMouseButton(b, false);
  });
  screen.addEventListener('pointermove', (e) => {
    if (mouseOn()) move(e);
  });
  screen.addEventListener('contextmenu', (e) => e.preventDefault());

  const applyPause = (paused) => {
    if (!running()) return;
    if (paused) ci.pause();
    else ci.resume();
    if (audio) (paused ? audio.suspend() : audio.resume()).catch(() => {});
  };
  shell.onPause((paused) => applyPause(paused));
  shell.settings.onChange((values) => {
    if (sound) sound.setEnabled(values.sound);
  });

  // ---- Start, and starting again ---------------------------------------------
  const mb = (n) => new Intl.NumberFormat(shell.locale, { maximumFractionDigits: 1 }).format(n / 1048576);
  let changeRequested = null;
  const readySpec = (tt) => ({
    title: info.name,
    text: program ? tt('dos.runs', { program: dosPath(program) }) : tt('dos.runsConf'),
    lines: [
      canWrite && info.size > LARGE_BYTES ? tt('dos.large', { size: mb(info.size) }) : '',
      !canWrite ? tt(info.readOnly ? 'dos.readOnly' : 'dos.noWrite') : '',
      tt('dos.keys'),
    ],
    actions: program && bundle.programs.length > 1 ? [{ id: 'change', label: tt('dos.change'), onClick: () => changeRequested && changeRequested() }] : [],
  });
  const endedSpec = (tt) => ({ title: tt('dos.ended.title'), text: tt('dos.ended.text') });

  async function startScreen(spec, state) {
    for (;;) {
      shell.setState(state);
      shell.setStatus(state === 'ready' ? 'dos.ready' : null);
      const choice = await new Promise((resolve) => {
        changeRequested = () => resolve({ change: true });
        shell.showStart(spec).then((r) => resolve({ start: r }));
      });
      changeRequested = null;
      if (choice.start) return choice.start;
      const p = await pickProgram(shell, bundle.programs, program);
      if (p && p.name !== program.name) {
        program = p;
        await remember(p);
      }
    }
  }

  async function run(started) {
    if (audio) audio.close().catch(() => {});
    audio = started.audio;
    shell.setState('starting');
    shell.setStatus('dos.loadingEngine');
    const failStart = (e) =>
      fail((tt) => ({ title: tt('shell.errorTitle'), text: tt('dos.engineFailed', { detail: String((e && e.message) || e) }), tone: 'error' }), 'error');
    let emulators;
    try {
      emulators = await engineReady;
      ci = await startDos(emulators, baseBytes, confToAdd());
    } catch (e) {
      failStart(e);
      return;
    }
    exited = false;
    updateSave();
    image = null;
    const events = ci.events();
    events.onFrameSize((w, h) => {
      screen.width = w;
      screen.height = h;
      image = g.createImageData(w, h);
    });
    events.onFrame((rgb, rgba) => {
      if (!image || image.width !== ci.width() || image.height !== ci.height()) {
        screen.width = ci.width();
        screen.height = ci.height();
        image = g.createImageData(screen.width, screen.height);
      }
      paint(image, rgb, rgba);
      g.putImageData(image, 0, 0);
    });
    events.onExit(() => {
      if (exited) return;
      exited = true;
      updateSave();
      if (sound) sound.stop();
      if (audio) audio.suspend().catch(() => {});
      again();
    });
    sound = playSound(audio, ci);
    sound.setEnabled(shell.settings.get('sound'));
    showSound();
    applyPause(shell.paused);
    shell.setState('running');
    shell.setStatus('dos.running');
    screen.focus();
  }

  // DOSBox stopped (the person typed EXIT): it starts again from the bundle
  // with the changes made so far, which stay unsaved until Save.
  async function again() {
    const sig = stateSignature(lastChanges, savedDeleted);
    if (sig !== '') {
      const merged = await mergeBundle({ entries: base, changes: lastChanges, deleted: savedDeleted });
      baseUnsaved = baseUnsaved || sig !== baseline;
      base = readZip(merged);
      baseBytes = merged;
      baseline = '';
      lastChanges = [];
      savedDeleted = new Set();
    }
    updateSave();
    run(await startScreen(endedSpec, 'ended'));
  }

  run(await startScreen(readySpec, 'ready'));
}

main().catch((e) => {
  document.documentElement.dataset.rxState = 'error';
  console.error('[retro] dos', e);
});
