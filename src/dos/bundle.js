// What is inside a js-dos bundle, which program starts it, and how the
// game's changes go back into it.
//
// A js-dos bundle (`.jsdos`) is a zip: the game's files at the top, and
// `.jsdos/dosbox.conf`, the DOSBox configuration whose [autoexec] starts the
// game. A zip of a game folder without that file is a bundle too: the
// player lists the DOS programs in it, the person picks one, and the
// configuration that starts it goes into the bundle the first time they
// save.
//
// Saving writes the bundle again as a new version of the same file (filex
// keeps the earlier ones). The new bundle is the opened one with the
// game's changes merged in, and it is deterministic: entries sorted by name,
// a fixed date (src/shell/zip.js), unchanged entries copied as they are
// (their compressed bytes too) and changed ones copied from the emulator's
// own change set, so the same bundle and the same changes give the same
// bytes, in every browser.

import { readZip, writeZip, ZipError } from '../shell/zip.js';

export const CONF_PATH = '.jsdos/dosbox.conf';
const JSDOS_DIR = '.jsdos/';
export const PROGRAM_EXTS = ['exe', 'com', 'bat'];

/** A bundle the player cannot open; `code` names the reason (strings: dos.bad.<code>). */
export class BundleError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BundleError';
    this.code = code;
  }
}

// One part of a DOS path: a name of up to 8 characters and an extension of
// up to 3, in the characters DOS allows (case does not matter, DOS sees
// upper case). A longer name would be shortened by DOSBox in a way the
// configuration cannot know, so a program under one is not offered.
const DOS_PART = /^[A-Za-z0-9_!#$%&'()@^`{}~-]{1,8}(\.[A-Za-z0-9_!#$%&'()@^`{}~-]{1,3})?$/;

export function isDosName(part) {
  return typeof part === 'string' && DOS_PART.test(part);
}

/** A name inside the bundle that stays inside it once unpacked. */
export function isSafeName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024) return false;
  if (name.startsWith('/') || name.includes('\\') || name.includes(String.fromCharCode(0)) || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  if (name.endsWith('/')) parts.pop();
  return parts.every((p) => p !== '' && p !== '.' && p !== '..');
}

// Programs that set a game up rather than start it go to the end of the list.
const HELPER = /^(setup|setsound|setblast|sndsetup|install|instal|uninst|uninstal|deinstal|config|configur|readme|catalog|order|help|info)/i;

/**
 * The DOS programs in a bundle, best first: shallower before deeper, a
 * starter before a setup program, then by name. Each is
 * `{name, size, dir, file}` - `name` the path in the zip, `dir` and `file`
 * the DOS path (upper case, `dir` with backslashes, '' at the top).
 */
export function findPrograms(entries) {
  const out = [];
  for (const e of entries) {
    if (e.dir || e.name.startsWith(JSDOS_DIR) || !isSafeName(e.name)) continue;
    const parts = e.name.split('/');
    const file = parts[parts.length - 1];
    const dot = file.lastIndexOf('.');
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
    if (!PROGRAM_EXTS.includes(ext)) continue;
    if (!parts.every(isDosName)) continue;
    out.push({ name: e.name, size: e.size, dir: parts.slice(0, -1).join('\\').toUpperCase(), file: file.toUpperCase(), depth: parts.length });
  }
  out.sort((a, b) => a.depth - b.depth || Number(HELPER.test(a.file)) - Number(HELPER.test(b.file)) || cmp(a.name.toUpperCase(), b.name.toUpperCase()) || cmp(a.name, b.name));
  return out.map(({ depth, ...p }) => p);
}

/** The program as DOS writes it: `GAME\GAME.EXE`. */
export function dosPath(p) {
  return p.dir ? p.dir + '\\' + p.file : p.file;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reads a bundle. Answers `{entries, conf, programs, files, size}` - `conf`
 * is the `.jsdos/dosbox.conf` entry or null - or throws a BundleError:
 * not_zip, damaged, unsupported, encrypted, unsafe, empty, no_program.
 */
export function inspectBundle(bytes) {
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    if (!(e instanceof ZipError)) throw e;
    if (e.code === 'not_zip') throw new BundleError('not_zip');
    if (e.code === 'damaged' || e.code === 'invalid') throw new BundleError('damaged', e.message);
    throw new BundleError('unsupported', e.message);
  }
  if (entries.some((e) => e.encrypted)) throw new BundleError('encrypted');
  const bad = entries.find((e) => !isSafeName(e.name));
  if (bad) throw new BundleError('unsafe', bad.name);
  const files = entries.filter((e) => !e.dir);
  if (!files.length) throw new BundleError('empty');
  for (const e of files) {
    if (e.method !== 0 && e.method !== 8) throw new BundleError('unsupported', `${e.name} uses method ${e.method}`);
  }
  const conf = files.find((e) => e.name === CONF_PATH) || null;
  const programs = findPrograms(entries);
  if (!conf && !programs.length) throw new BundleError('no_program');
  return { entries, conf, programs, files: files.length, size: files.reduce((n, e) => n + e.size, 0) };
}

/** The DOSBox configuration that starts `program` (a findPrograms row). */
export function confFor(program) {
  const lines = ['[sdl]', 'autolock=false', '', '[cpu]', 'core=auto', 'cputype=auto', 'cycles=auto', '', '[autoexec]', 'echo off', 'mount c .', 'c:'];
  if (program.dir) lines.push('cd \\' + program.dir);
  lines.push(program.file);
  return lines.join('\n') + '\n';
}

const lower = (s) => s.toLowerCase();

/**
 * The files of a change set that go into the bundle: not folders, not
 * js-dos's own `.jsdos/` (DOS cannot write there; the player adds the
 * configuration itself), not a name that would leave the bundle.
 */
export function changedFiles(changes) {
  return (changes || []).filter((e) => !e.dir && !e.name.startsWith(JSDOS_DIR) && isSafeName(e.name) && !e.encrypted && (e.method === 0 || e.method === 8));
}

/**
 * A short, stable signature of a change set: '' when the game changed
 * nothing. Two change sets with the same files, sizes and checksums sign
 * alike.
 */
export function changeSignature(changes) {
  return changedFiles(changes)
    .map((e) => JSON.stringify([e.name, e.size, e.crc]))
    .sort()
    .join('\n');
}

/**
 * Where the game stands against the opened bundle: its change set and the
 * files it deleted, as one signature ('' when it changed nothing). Saving
 * when the signature is the one last saved writes nothing new.
 */
export function stateSignature(changes, deleted) {
  const gone = deleted && deleted.size ? [...deleted].sort().map((n) => JSON.stringify(['-', n])) : [];
  return [changeSignature(changes), ...gone].filter(Boolean).join('\n');
}

/**
 * The files the game deleted, from the emulator's file tree (`present`: the
 * paths there now). Only trusted when the tree plainly is the bundle's: when
 * fewer than half of the bundle's files are found in it, nothing counts as
 * deleted (a tree rooted elsewhere must not empty the bundle).
 */
export function deletedFiles(entries, present) {
  if (!present) return new Set();
  const have = new Set([...present].map(lower));
  const files = entries.filter((e) => !e.dir && !e.name.startsWith(JSDOS_DIR));
  const missing = files.filter((e) => !have.has(lower(e.name)));
  if (!files.length || missing.length * 2 > files.length) return new Set();
  return new Set(missing.map((e) => e.name));
}

/** The file paths in an emulator file tree (`ci.fsTree()`), relative to its root. */
export function treePaths(root) {
  const out = new Set();
  const walk = (node, prefix) => {
    for (const n of (node && node.nodes) || []) {
      if (!n || typeof n.name !== 'string') continue;
      const path = prefix + n.name;
      if (Array.isArray(n.nodes)) walk(n, path + '/');
      else out.add(path);
    }
  };
  walk(root, '');
  return out;
}

/**
 * The bundle with the game's changes in it. `entries` are the opened
 * bundle's (inspectBundle), `changes` the emulator's change set (readZip of
 * `ci.persist(true)`), `conf` the configuration to put in when the bundle had
 * none (or null), `deleted` names the game removed. A change replaces the
 * bundle's file of the same name, ignoring case (DOS does); the result is
 * written sorted, with a fixed date: the same inputs give the same bytes.
 */
export async function mergeBundle({ entries, changes = [], conf = null, deleted = null }) {
  const byKey = new Map();
  for (const e of entries) {
    if (deleted && deleted.has(e.name)) continue;
    byKey.set(lower(e.name), { name: e.name, raw: e });
  }
  for (const e of changedFiles(changes)) byKey.set(lower(e.name), { name: e.name, raw: e });
  if (conf !== null && conf !== undefined) byKey.set(lower(CONF_PATH), { name: CONF_PATH, data: conf });
  const list = [...byKey.values()].sort((a, b) => cmp(a.name, b.name));
  return writeZip(list);
}

// ---- the program the person picked, remembered per bundle ------------------
//
// A bundle without a configuration asks which program starts it once; the
// answer is kept in the person's small store for this app (`state`, 8 KiB a
// value), under a key made of the file's name, its size and the sha256 of
// its first MiB, so the same bundle opens straight away the next time (also
// before it was ever saved). The most recent picks are kept, as many as fit.

export const PICKS_KEY = 'dos.programs';
export const PICKS_MAX = 32;
export const PICKS_BUDGET = 6000;
const HEAD = 1024 * 1024;

async function sha256hex(data) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key of a bundle in the picks: from its name, its size and its first MiB. */
export async function bundleKey(name, bytes) {
  const head = await sha256hex(bytes.subarray(0, Math.min(HEAD, bytes.length)));
  const full = await sha256hex(new TextEncoder().encode(`${name}\n${bytes.length}\n${head}`));
  return full.slice(0, 32);
}

/** The picks as stored, cleaned: a list of [key, zip path], newest first. */
export function readPicks(stored) {
  const list = stored && typeof stored === 'object' && Array.isArray(stored.picks) ? stored.picks : [];
  return list.filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && /^[0-9a-f]{32}$/.test(p[0]) && typeof p[1] === 'string' && p[1].length <= 1024);
}

/** The program remembered for `key`, or null. */
export function rememberedPick(stored, key) {
  const hit = readPicks(stored).find((p) => p[0] === key);
  return hit ? hit[1] : null;
}

/** The picks with `key` -> `name` first, trimmed to PICKS_MAX and to the byte budget. */
export function withPick(stored, key, name) {
  let picks = [[key, name], ...readPicks(stored).filter((p) => p[0] !== key)].slice(0, PICKS_MAX);
  const size = (list) => new TextEncoder().encode(JSON.stringify({ v: 1, picks: list })).length;
  while (picks.length > 1 && size(picks) > PICKS_BUDGET) picks = picks.slice(0, -1);
  if (size(picks) > PICKS_BUDGET) picks = [];
  return { v: 1, picks };
}
