import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect } from '../../scripts/pack.mjs';
import { readZip, writeZip } from '../../src/shell/zip.js';

let root = null;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function tree(files) {
  root = mkdtempSync(join(tmpdir(), 'retro-pack-'));
  for (const [p, data] of Object.entries(files)) {
    const abs = join(root, ...p.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
  return root;
}

const base = () => ({
  'src/doom.html': '<!doctype html>\r\n<title>x</title>\r\n',
  'src/shell/shell.js': 'export {};\n',
  'src/shell/notes.md': 'not packed',
  'build/engines/doom/retro-doom.js': 'var RetroDoom;\n',
  'build/engines/doom/retro-doom.wasm': Buffer.from([0, 0x61, 0x73, 0x6d, 13, 10, 1, 0]),
  'build/engines/doom/retro-doom.log': 'not packed',
  'node_modules/@brftech/filex-app-ui/dist/filex-app-ui.iife.js': 'var FilexAppUI;\n',
  'node_modules/emulators/dist/emulators.js': 'var emulators;\n',
  'node_modules/emulators/dist/wdosbox.js': 'var WDOSBOX;\n',
  'node_modules/emulators/dist/wdosbox.wasm': Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  'node_modules/emulators/dist/wlibzip.js': 'var WLIBZIP;\n',
  'node_modules/emulators/dist/wlibzip.wasm': Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  'node_modules/emulators/dist/wdosbox-x.wasm': 'not packed',
  'node_modules/emulators/dist/emulators.js.map': 'not packed',
  'node_modules/emulators/dist/types/emulators.d.ts': 'not packed',
  LICENSE: 'GPL\r\n',
  NOTICE: 'notice\n',
  'licenses/SDL2.txt': 'zlib\n',
});

describe('the ui.zip packer', () => {
  it('packs the interface, the engine, the SDK and the licences, sorted', () => {
    const names = collect(tree(base())).map((e) => e.name);
    expect(names).toEqual([
      'LICENSE',
      'NOTICE',
      'doom.html',
      'dos/emulators/emulators.js',
      'dos/emulators/wdosbox.js',
      'dos/emulators/wdosbox.wasm',
      'dos/emulators/wlibzip.js',
      'dos/emulators/wlibzip.wasm',
      'engines/doom/retro-doom.js',
      'engines/doom/retro-doom.wasm',
      'licenses/SDL2.txt',
      'shell/shell.js',
      'vendor/filex-app-ui.iife.js',
    ]);
  });

  it('packs only the single-threaded DOSBox of the js-dos emulators', () => {
    const names = collect(tree(base())).map((e) => e.name);
    expect(names.filter((n) => n.startsWith('dos/emulators/') && /wdosbox-x|\.map$|\.d\.ts$/.test(n))).toEqual([]);
  });

  it('stops when the js-dos emulators are missing', () => {
    const files = base();
    for (const k of Object.keys(files)) if (k.startsWith('node_modules/emulators/')) delete files[k];
    expect(() => collect(tree(files))).toThrow(/missing input: node_modules\/emulators\/dist/);
  });

  it('writes text with LF line ends and leaves binary bytes alone', () => {
    const entries = collect(tree(base()));
    const get = (n) => entries.find((e) => e.name === n).data;
    expect(new TextDecoder().decode(get('doom.html'))).toBe('<!doctype html>\n<title>x</title>\n');
    expect(new TextDecoder().decode(get('LICENSE'))).toBe('GPL\n');
    expect(Array.from(get('engines/doom/retro-doom.wasm'))).toEqual([0, 0x61, 0x73, 0x6d, 13, 10, 1, 0]);
  });

  it('gives the same zip from the same files, stored', async () => {
    const a = await writeZip(collect(tree(base())));
    rmSync(root, { recursive: true, force: true });
    const b = await writeZip(collect(tree(base())));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(readZip(a).every((e) => e.method === 0)).toBe(true);
  });

  it('stops when game data turns up among its inputs', () => {
    expect(() => collect(tree({ ...base(), 'src/freedoom2.wad': 'IWAD' }))).toThrow(/game data/);
  });

  it('stops when an input is missing', () => {
    const files = base();
    delete files['node_modules/@brftech/filex-app-ui/dist/filex-app-ui.iife.js'];
    expect(() => collect(tree(files))).toThrow(/missing input/);
  });
});
