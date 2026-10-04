// The `.fxdoom` pack: a DOOM-engine game and the person's saved games in
// one file.
//
// An app interface in filex can only read the file it was opened with and
// write that file back (or save a NEW file where the person picks); it
// cannot write a save beside a WAD. So the saves travel with the game: the
// first time the person keeps their saves, Retro writes a pack (save as);
// from then on the pack is what they open, and saving writes a new version
// of it.
//
// A pack is a zip (src/shell/zip.js: the same game and saves give the same
// bytes in the same browser; the WAD's deflate is the browser's own, and
// Chromium, Firefox and WebKit compress it a little differently):
//
//   fxdoom.json               {"format": 1, "iwad": "freedoom2.wad", "pwads": []}
//   wads/<iwad>               the IWAD, under the name the engine knows it by
//   wads/<pwad>               mods, in load order (none written yet)
//   config/default.cfg       the engine's settings (keys, volumes, screen size)
//   config/doomgeneric.cfg
//   saves/doomsav0.dsg …     the saved games (slots 0-9)
//
// A WAD is deflated once, when the pack is first written; later saves copy
// its compressed bytes as they are. Entries this version does not know are
// kept, so a newer Retro's additions survive an older one's save.

import { readZip, writeZip } from '../shell/zip.js';

export const FXDOOM_FORMAT = 1;
export const SAVE_RE = /^doomsav[0-9]\.dsg$/;
export const CONFIG_FILES = ['default.cfg', 'doomgeneric.cfg'];

export class PackError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PackError';
    this.code = code;
  }
}

/** A file name safe to use as a MEMFS name and a zip entry: no folder, no dot-dot. */
export function safeWadName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,63}$/.test(name) && !name.includes('..');
}

/** True when the bytes are a zip (a pack, or something else zipped). */
export function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads a pack. Resolves {format, iwad, pwads, saves, config, extra}: `iwad`
 * and each pwad are {name, entry, data}; `saves` and `config` are
 * {name, data}; `extra` the zip entries this version does not use. Rejects
 * with PackError: not_pack, damaged, newer (made by a newer Retro), no_iwad.
 */
export async function readPack(bytes) {
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw new PackError(e && e.code === 'not_zip' ? 'not_pack' : 'damaged', e && e.code);
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const metaEntry = byName.get('fxdoom.json');
  if (!metaEntry) throw new PackError('not_pack', 'no fxdoom.json');

  let meta;
  try {
    meta = JSON.parse(new TextDecoder().decode(await metaEntry.data()));
  } catch {
    throw new PackError('damaged', 'fxdoom.json');
  }
  if (!meta || typeof meta !== 'object' || !Number.isInteger(meta.format) || meta.format < 1) throw new PackError('damaged', 'format');
  if (meta.format > FXDOOM_FORMAT) throw new PackError('newer', String(meta.format));
  const pwadNames = meta.pwads === undefined ? [] : meta.pwads;
  if (!safeWadName(meta.iwad) || !Array.isArray(pwadNames) || !pwadNames.every(safeWadName)) throw new PackError('damaged', 'names');

  const wad = async (name) => {
    const entry = byName.get('wads/' + name);
    if (!entry) return null;
    try {
      return { name, entry, data: await entry.data() };
    } catch (e) {
      throw new PackError('damaged', 'wads/' + name);
    }
  };
  const iwad = await wad(meta.iwad);
  if (!iwad) throw new PackError('no_iwad', meta.iwad);
  const pwads = [];
  for (const n of pwadNames) {
    const p = await wad(n);
    if (!p) throw new PackError('damaged', 'missing wads/' + n);
    pwads.push(p);
  }

  const used = new Set(['fxdoom.json', 'wads/' + meta.iwad, ...pwadNames.map((n) => 'wads/' + n)]);
  const saves = [];
  const config = [];
  const extra = [];
  for (const e of entries) {
    if (used.has(e.name)) continue;
    const save = e.name.startsWith('saves/') && SAVE_RE.test(e.name.slice(6));
    const cfg = e.name.startsWith('config/') && CONFIG_FILES.includes(e.name.slice(7));
    if (!save && !cfg) {
      extra.push(e);
      continue;
    }
    let data;
    try {
      data = await e.data();
    } catch {
      throw new PackError('damaged', e.name);
    }
    (save ? saves : config).push({ name: e.name.slice(save ? 6 : 7), data });
  }
  return { format: meta.format, iwad, pwads, saves, config, extra };
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Writes a pack: {iwad, pwads?, saves?, config?, extra?}. `iwad` and each pwad
 * is {name, entry} (copied as it is) or {name, data} (deflated). Saves and
 * config files are {name, data}; names that are not a save slot or a config
 * file Retro knows are refused.
 */
export async function writePack({ iwad, pwads = [], saves = [], config = [], extra = [] }) {
  if (!iwad || !safeWadName(iwad.name)) throw new PackError('invalid', 'iwad');
  for (const p of pwads) if (!safeWadName(p.name)) throw new PackError('invalid', 'pwad ' + p.name);
  for (const s of saves) if (!SAVE_RE.test(s.name)) throw new PackError('invalid', 'save ' + s.name);
  for (const c of config) if (!CONFIG_FILES.includes(c.name)) throw new PackError('invalid', 'config ' + c.name);

  const meta = { format: FXDOOM_FORMAT, iwad: iwad.name, pwads: pwads.map((p) => p.name) };
  const wadEntry = (w) => (w.entry ? { name: 'wads/' + w.name, raw: w.entry } : { name: 'wads/' + w.name, data: w.data, compress: true });
  const known = new Set(['fxdoom.json', 'wads/' + iwad.name, ...pwads.map((p) => 'wads/' + p.name), ...config.map((c) => 'config/' + c.name), ...saves.map((s) => 'saves/' + s.name)]);
  return writeZip([
    { name: 'fxdoom.json', data: JSON.stringify(meta) + '\n' },
    wadEntry(iwad),
    ...pwads.map(wadEntry),
    ...[...config].sort(byName).map((c) => ({ name: 'config/' + c.name, data: c.data, compress: true })),
    ...[...saves].sort(byName).map((s) => ({ name: 'saves/' + s.name, data: s.data, compress: true })),
    ...[...extra].filter((e) => !known.has(e.name)).sort(byName).map((e) => ({ name: e.name, raw: e })),
  ]);
}

/** The pack's file name for a WAD's name: freedoom2.wad -> freedoom2.fxdoom. */
export function packNameFor(fileName) {
  const base = String(fileName || 'game').replace(/\.[^./\\]*$/, '') || 'game';
  return base + '.fxdoom';
}
