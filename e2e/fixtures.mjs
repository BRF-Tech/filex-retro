// Builds the end-to-end test files into <out> (argument 1) from the
// Freedoom IWAD (argument 2). Our own small files cover the refusals; the
// .fxdoom packs are written with the app's own pack writer. Nothing here is
// committed or packed: the files live on the test host only.
//
//   node e2e/fixtures.mjs <out> <freedoom2.wad> [browser …]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePack } from '../src/doom/fxdoom.js';
import { writeZip } from '../src/shell/zip.js';

const [out, freedoom2, ...browsers] = process.argv.slice(2);
// Chromium's pack is the one the README's screenshots show.
const packName = (b) => (b === 'chromium' ? 'freedoom2.fxdoom' : `pack-${b}.fxdoom`);
if (!out || !freedoom2) {
  console.error('usage: fixtures.mjs <out> <freedoom2.wad> [browser …]');
  process.exit(2);
}

function wad(kind, lumps) {
  const dir = 12;
  const b = new Uint8Array(dir + lumps.length * 16);
  const dv = new DataView(b.buffer);
  b.set(new TextEncoder().encode(kind), 0);
  dv.setInt32(4, lumps.length, true);
  dv.setInt32(8, dir, true);
  lumps.forEach((name, i) => b.set(new TextEncoder().encode(name), dir + i * 16 + 8));
  return b;
}

const files = {
  'textures.wad': wad('WAD3', ['WALL01']),
  'mod.wad': wad('PWAD', ['MAP01', 'THINGS', 'LINEDEFS']),
  'heretic.wad': wad('IWAD', ['E1M1', 'MUS_E1M1']),
  'damaged.wad': (() => {
    const b = wad('IWAD', ['E1M1']);
    new DataView(b.buffer).setInt32(4, 5000, true);
    return b;
  })(),
  'notpack.fxdoom': await writeZip([{ name: 'readme.txt', data: 'not a pack' }]),
};
const iwad = new Uint8Array(readFileSync(freedoom2));
for (const b of browsers) files[packName(b)] = await writePack({ iwad: { name: 'freedoom2.wad', data: iwad } });

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), data);
  console.log(String(data.length).padStart(10) + '  ' + name);
}
