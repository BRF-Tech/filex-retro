// The DOOM-engine player (view `doom`): opens a `.wad` (an IWAD) or a
// `.fxdoom` pack (an IWAD with saved games), checks it, and plays it.
//
//   open -> read the bytes (file.read as bytes) -> what is it?
//     .wad    IWAD of a game this engine plays  -> Start
//             PWAD                              -> "needs an IWAD"
//             WAD3 / WAD2 / Wii / anything else -> "not a DOOM-engine WAD"
//     .fxdoom a pack with an IWAD               -> Start (its saves loaded)
//   Start (the click starts the sound too) -> the engine runs; the game's
//   own menu saves into the page's memory; Retro sees a new save and offers
//   to keep it:
//     .wad    "Keep saves…" writes a NEW .fxdoom pack (save as, filex asks
//             where); from then on the person opens the pack;
//     .fxdoom "Save" writes the pack again (a new version of it).
//
// filex's own Save (and a draft's) does the same as the button. Ctrl+S is
// not a save here: in DOOM, Ctrl fires.

import { startShell } from '../shell/shell.js';
import { captureKeys } from '../shell/keys.js';
import { strings } from './strings.js';
import { identifyGame, readWad, wadKind, WadError } from './wad.js';
import { packNameFor, readPack, writePack } from './fxdoom.js';
import { doomKey } from './keys.js';
import { loadEngineScript, startEngine } from './engine.js';

const SETTINGS = [
  { key: 'music', label: 'doom.settings.music', hint: 'doom.settings.musicHint', default: true },
  { key: 'sfx', label: 'doom.settings.sfx', default: true },
];
const POLL_MS = 1000;

function lastMessage(lines) {
  const useful = lines.filter((l) => l && !/keepRuntimeAlive|EXIT_RUNTIME|program exited/.test(l));
  return (useful.reverse().find((l) => /error/i.test(l)) || useful[0] || '').trim();
}

async function main() {
  const shell = await startShell({ view: 'doom', strings, settings: SETTINGS });
  if (!shell.fx) return;
  const fx = shell.fx;
  const t = shell.t;
  const info = fx.session.files[0];
  shell.setTitle({ key: 'doom.player' });

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

  // ---- read and check the file ---------------------------------------------
  shell.setStatus('doom.reading');
  let bytes;
  try {
    const file = await fx.open();
    bytes = new Uint8Array(await file.bytes());
  } catch (e) {
    fail((tt) => ({ title: tt('shell.errorTitle'), lines: [tt('shell.readFailed'), shell.describeError(e)], tone: 'error' }), 'error');
    return;
  }
  // The engine loads while the person reads the Start screen.
  const engineScript = loadEngineScript(document);
  engineScript.catch(() => {});

  const mode = info.ext === 'fxdoom' ? 'pack' : 'wad';
  let game;
  if (mode === 'pack') {
    let pack;
    try {
      pack = await readPack(bytes);
    } catch (e) {
      const code = e && e.code ? e.code : 'damaged';
      fail((tt) => ({ title: tt('doom.pack.title'), text: tt('doom.pack.' + code) === 'doom.pack.' + code ? tt('doom.pack.damaged') : tt('doom.pack.' + code), tone: 'error' }));
      return;
    }
    let g = null;
    try {
      const wad = readWad(pack.iwad.data);
      g = wad.kind === 'IWAD' ? identifyGame(wad) : null;
    } catch {
      g = null;
    }
    if (!g || !g.supported) {
      fail((tt) => ({ title: tt('doom.pack.title'), text: tt('doom.pack.badIwad'), tone: 'error' }));
      return;
    }
    game = {
      id: g.id,
      // The engine sees the IWAD under its canonical name; the pack keeps
      // the name (and the compressed bytes) it came with.
      iwad: { name: g.file, data: pack.iwad.data },
      packIwad: { name: pack.iwad.name, entry: pack.iwad.entry },
      pwads: pack.pwads,
      saves: pack.saves,
      config: pack.config,
      extra: pack.extra,
    };
  } else {
    const kind = wadKind(bytes);
    if (kind === 'PWAD') {
      fail((tt) => ({ title: tt('doom.needsIwad.title'), lines: [tt('doom.needsIwad.text'), tt('doom.needsIwad.hint')] }), 'needs-iwad');
      return;
    }
    if (kind !== 'IWAD') {
      fail((tt) => ({ title: tt('doom.notWad.title'), text: tt('doom.notWad.' + kind) }), 'not-wad');
      return;
    }
    let wad;
    try {
      wad = readWad(bytes);
    } catch (e) {
      if (!(e instanceof WadError)) throw e;
      fail((tt) => ({ title: tt('doom.damaged.title'), text: tt('doom.damaged.text'), tone: 'error' }), 'damaged');
      return;
    }
    const g = identifyGame(wad);
    if (g.id === 'unknown') {
      fail((tt) => ({ title: tt('doom.unknownIwad.title'), text: tt('doom.unknownIwad.text') }), 'unsupported');
      return;
    }
    if (!g.supported) {
      fail((tt) => ({ title: tt('doom.unsupported.title', { game: tt('game.' + g.id) }), text: tt('doom.unsupported.text') }), 'unsupported');
      return;
    }
    game = { id: g.id, iwad: { name: g.file, data: bytes }, packIwad: null, pwads: [], saves: [], config: [], extra: [] };
  }
  shell.setTitle({ key: 'game.' + game.id });

  // ---- the screen, the buttons, the keys -------------------------------------
  const screen = document.createElement('canvas');
  screen.className = 'rx-screen';
  screen.tabIndex = 0;
  screen.width = 320;
  screen.height = 200;
  shell.el.stage.prepend(screen);
  shell.setFocusTarget(screen);
  screen.addEventListener('pointerdown', () => screen.focus());

  const canWrite = (fx.session.grants || []).includes('files:write');
  const saveKind = !canWrite ? null : mode === 'pack' && !info.readOnly ? 'save' : 'keep';
  let engine = null;
  let audio = null;
  let baseline = '';
  let busy = false;

  const saveButton = saveKind
    ? shell.addButton({
        id: saveKind,
        label: saveKind === 'save' ? 'shell.save' : 'doom.keep',
        primary: saveKind === 'save',
        onClick: () => (saveKind === 'save' ? savePack() : keepSaves()),
      })
    : null;
  if (saveButton) saveButton.setDisabled(true);

  const currentSaves = () => (engine ? engine.readSaves() : game.saves);
  const currentConfig = () => (engine ? engine.readConfig() : game.config);
  const buildPack = (saves, config) =>
    writePack({
      iwad: game.packIwad || { name: game.iwad.name, data: game.iwad.data },
      pwads: game.pwads.map((p) => (p.entry ? { name: p.name, entry: p.entry } : { name: p.name, data: p.data })),
      saves,
      config,
      extra: game.extra,
    });

  async function savePack() {
    if (busy) return;
    busy = true;
    if (saveButton) saveButton.setDisabled(true);
    shell.setStatus('doom.saving');
    try {
      const sig = engine ? engine.savesSignature() : baseline;
      const bytesOut = await buildPack(currentSaves(), currentConfig());
      await fx.save(bytesOut);
      baseline = sig;
      shell.setDirty(false);
      shell.toast(t('doom.saved', { name: info.name }), 'success');
    } catch (e) {
      shell.toast(shell.describeError(e), 'error');
      if (saveButton) saveButton.setDisabled(false);
    } finally {
      busy = false;
      shell.setStatus(engine && !engine.exited ? 'doom.playing' : null);
    }
  }

  async function keepSaves() {
    if (busy) return;
    const saves = currentSaves();
    if (!saves.length) {
      shell.toast(t('doom.nothingToKeep'), 'info');
      return;
    }
    busy = true;
    if (saveButton) saveButton.setDisabled(true);
    shell.setStatus('doom.saving');
    try {
      const sig = engine ? engine.savesSignature() : baseline;
      const bytesOut = await buildPack(saves, currentConfig());
      const name = packNameFor(info.name);
      const res = await fx.saveAs(name, bytesOut);
      baseline = sig;
      shell.setDirty(false);
      shell.toast(t('doom.kept', { name: (res && res.name) || name }), 'success');
    } catch (e) {
      if (e && e.code === 'unavailable' && !/busy/.test(e.message || '')) shell.toast(t('doom.keepUnavailable'), 'warning');
      else if (!(e && e.code === 'cancelled')) shell.toast(shell.describeError(e), 'error');
      if (saveButton) saveButton.setDisabled(false);
    } finally {
      busy = false;
      shell.setStatus(engine && !engine.exited ? 'doom.playing' : null);
    }
  }

  if (saveKind) fx.onSave(() => (saveKind === 'save' ? savePack() : keepSaves()));

  // A save the game wrote that is not kept yet: unsaved changes.
  setInterval(() => {
    if (!engine || busy) return;
    let sig = '';
    try {
      sig = engine.savesSignature();
    } catch {
      return;
    }
    if (sig !== baseline && sig !== '') {
      shell.setDirty(true);
      if (saveButton) saveButton.setDisabled(false);
    }
  }, POLL_MS);

  captureKeys({
    doc: document,
    active: () => !!engine && !engine.exited && !shell.paused,
    onKey: (k, down) => {
      const code = doomKey(k);
      if (!code) return false;
      if (!(down && k.repeat) && engine) engine.key(down, code);
      return true;
    },
  });

  const applyPause = (paused) => {
    if (!engine || engine.exited) return;
    engine.pause(paused);
    if (audio) (paused ? audio.suspend() : audio.resume()).catch(() => {});
  };
  shell.onPause((paused) => applyPause(paused));
  shell.settings.onChange((values) => {
    if (!engine || engine.exited) return;
    engine.setMusic(values.music);
    engine.setSfx(values.sfx);
  });

  // Megabytes as filex's own file details count them (10^6 bytes).
  const mb = (n) => new Intl.NumberFormat(shell.locale, { maximumFractionDigits: 1 }).format(n / 1e6);
  const startSpec = (tt) => ({
    title: tt('game.' + game.id),
    text: tt('doom.fileLine', { name: info.name, size: mb(bytes.length) }),
    lines: [
      mode === 'pack' ? (game.saves.length ? tt('doom.packSaves', { count: game.saves.length }) : tt('doom.packNoSaves')) : saveKind ? tt('doom.wadHint') : '',
      tt('doom.keys'),
    ],
  });

  async function play(spec, state = 'ready') {
    shell.setState(state);
    shell.setStatus(state === 'ready' ? 'doom.ready' : null);
    const started = await shell.showStart(spec);
    if (audio) audio.close().catch(() => {});
    audio = started.audio;
    shell.setState('starting');
    shell.setStatus('doom.loadingEngine');
    let factory;
    try {
      factory = await engineScript;
    } catch (e) {
      fail((tt) => ({ title: tt('shell.errorTitle'), text: tt('doom.engineFailed', { detail: String((e && e.message) || e) }), tone: 'error' }), 'error');
      return;
    }
    const previous = engine;
    if (previous) {
      // Starting again after the game ended: what it saved goes on.
      game.saves = previous.readSaves();
      game.config = previous.readConfig();
    }
    try {
      engine = await startEngine({
        factory,
        canvas: screen,
        audio,
        game,
        onTitle: () => {},
        onExit: (code, lines) => {
          if (audio) audio.suspend().catch(() => {});
          const detail = lastMessage(lines);
          if (code === 0) play((tt) => ({ title: tt('doom.ended.title'), text: tt('doom.ended.text') }), 'ended');
          else play((tt) => ({ title: tt('doom.crashed.title'), text: tt('doom.crashed.text', { detail: detail || String(code) }), tone: 'error' }), 'crashed');
        },
      });
    } catch (e) {
      fail((tt) => ({ title: tt('shell.errorTitle'), text: tt('doom.engineFailed', { detail: String((e && e.message) || e) }), tone: 'error' }), 'error');
      return;
    }
    if (engine.exited) return;
    if (!shell.dirty) baseline = engine.savesSignature();
    engine.setMusic(shell.settings.get('music'));
    engine.setSfx(shell.settings.get('sfx'));
    applyPause(shell.paused);
    shell.setState('running');
    shell.setStatus('doom.playing');
    screen.focus();
  }

  play(startSpec);
}

main().catch((e) => {
  document.documentElement.dataset.rxState = 'error';
  console.error('[retro] doom', e);
});
