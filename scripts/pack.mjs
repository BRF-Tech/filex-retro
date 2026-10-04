#!/usr/bin/env node
// Packs ui.zip: the interface (src/), the engines (build/engines for the
// DOOM engine, js-dos 8.5.1's emulators from node_modules for DOS), the
// filex app SDK and the licences, in a zip that is the same, byte for byte,
// on every machine (src/shell/zip.js: sorted entries, every entry stored,
// a fixed date, no extra fields; text files with LF line ends).
//
//   node scripts/pack.mjs            ui.zip + ui.zip.sha256
//   node scripts/pack.mjs --stamp    ... and writes the sha256 into
//                                    filex-app.json (ui.bundle.sha256)
//   node scripts/pack.mjs --check    ... and fails unless filex-app.json
//                                    already names this sha256
//
// It refuses a package over the size gate (RETRO_MAX_ZIP_MB, 64 by default:
// half of filex's 128 MiB default limit) and a manifest view whose page is
// not in the package. Game data never goes in: a WAD, a js-dos bundle or a
// pack found among the inputs stops the build.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../src/shell/zip.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MB = Number(process.env.RETRO_MAX_ZIP_MB || 64);

// What goes in: [source (file or folder, relative to the repository), path
// in the package, filter for a folder's files].
export const SOURCES = [
  ['src', '', (p) => /\.(html|js|css)$/.test(p)],
  ['build/engines/doom', 'engines/doom', (p) => /^retro-doom\.(js|wasm)$/.test(p)],
  // DOS: only the single-threaded DOSBox and the zip library it uses (the
  // package also carries DOSBox-X builds, which need a SharedArrayBuffer).
  ['node_modules/emulators/dist', 'dos/emulators', (p) => /^(emulators\.js|wdosbox\.(js|wasm)|wlibzip\.(js|wasm))$/.test(p)],
  ['node_modules/@brftech/filex-app-ui/dist/filex-app-ui.iife.js', 'vendor/filex-app-ui.iife.js'],
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['licenses', 'licenses', (p) => /\.txt$/.test(p)],
];

const TEXT = /\.(html|js|css|json|txt|md)$|(^|\/)(LICENSE|NOTICE)$/;
const GAME_DATA = /\.(wad|jsdos|fxdoom|dsg)$/i;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p).map((q) => name + '/' + q));
    else out.push(name);
  }
  return out;
}

export function collect(root = ROOT) {
  const files = [];
  for (const [from, to, filter] of SOURCES) {
    const abs = join(root, from);
    if (!existsSync(abs)) throw new Error(`missing input: ${from}`);
    if (statSync(abs).isDirectory()) {
      for (const rel of walk(abs)) {
        if (GAME_DATA.test(rel)) throw new Error(`game data among the inputs: ${from}/${rel}`);
        if (filter && !filter(rel)) continue;
        files.push({ path: to ? posix.join(to, rel) : rel, abs: join(abs, ...rel.split('/')) });
      }
    } else {
      files.push({ path: to, abs });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files.map((f) => {
    let data = readFileSync(f.abs);
    if (TEXT.test(f.path)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return { name: f.path, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  });
}

async function main() {
  const mode = process.argv[2] || '';
  if (mode && mode !== '--stamp' && mode !== '--check') throw new Error('usage: pack.mjs [--stamp|--check]');
  const entries = collect();
  const manifestPath = join(ROOT, 'filex-app.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const names = new Set(entries.map((e) => e.name));
  for (const v of manifest.views || []) {
    if (v.ui && !names.has(v.ui)) throw new Error(`view ${v.id}: ${v.ui} is not in the package`);
  }

  const zip = await writeZip(entries);
  const sha = createHash('sha256').update(zip).digest('hex');
  for (const e of entries) console.log(String(e.data.length).padStart(10) + '  ' + e.name);
  console.log(`ui.zip bytes=${zip.length} files=${entries.length} sha256=${sha}`);
  if (zip.length > MAX_MB * 1024 * 1024) throw new Error(`ui.zip is ${zip.length} bytes, over the ${MAX_MB} MiB gate`);

  writeFileSync(join(ROOT, 'ui.zip'), zip);
  writeFileSync(join(ROOT, 'ui.zip.sha256'), `${sha}  ui.zip\n`);

  if (mode === '--stamp') {
    manifest.ui.bundle.sha256 = sha;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log('stamped filex-app.json');
  } else if (mode === '--check' && manifest.ui.bundle.sha256 !== sha) {
    throw new Error(`filex-app.json names ${manifest.ui.bundle.sha256 || '(nothing)'}, the build is ${sha}`);
  }
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  main().catch((e) => {
    console.error('pack: ' + e.message);
    process.exit(1);
  });
}
