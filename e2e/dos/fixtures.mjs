// Builds the DOS player's end-to-end test files into <out> (argument 1) from
// DOSPROBE.COM (argument 2, our own program: e2e/dos/probe.asm). One copy of
// each bundle per browser, since every browser saves into its own. Nothing
// here is committed or packed: the files live on the test host only.
//
//   node e2e/dos/fixtures.mjs <out> <DOSPROBE.COM> [browser …]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeZip } from '../../src/shell/zip.js';

const [out, probePath, ...browsers] = process.argv.slice(2);
if (!out || !probePath) {
  console.error('usage: fixtures.mjs <out> <DOSPROBE.COM> [browser …]');
  process.exit(2);
}
const probe = new Uint8Array(readFileSync(probePath));
const CONF = '[sdl]\nautolock=false\n\n[cpu]\ncore=auto\ncputype=auto\ncycles=auto\n\n[autoexec]\necho off\nmount c .\nc:\nDOSPROBE.COM\n';

// 9 MiB that do not compress (a xorshift stream from a fixed seed): a
// bundle over filex's 8 MiB single-request limit, so saving it is chunked.
function noise(size) {
  const b = new Uint8Array(size);
  let x = 0x9e3779b9;
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b[i] = x & 0xff;
  }
  return b;
}

const files = {
  'notzip.jsdos': new TextEncoder().encode('This is not a zip file.\n'),
  'noprog.jsdos': await writeZip([
    { name: 'README.TXT', data: 'A bundle with nothing to start.\n' },
    { name: 'DATA/LEVEL.DAT', data: new Uint8Array(256).fill(1) },
  ]),
};
const withConf = () =>
  writeZip([
    { name: '.jsdos/dosbox.conf', data: CONF },
    { name: 'DOSPROBE.COM', data: probe },
  ]);
const withoutConf = () =>
  writeZip([
    { name: 'DOSPROBE.COM', data: probe },
    { name: 'README.TXT', data: 'Two programs and no dosbox.conf: the player asks which one starts.\n' },
    { name: 'TOOLS/OTHER.COM', data: probe },
  ]);
// The README's pictures open these two (and noprog.jsdos).
files['probe.jsdos'] = await withConf();
files['programs.jsdos'] = await withoutConf();
const big = noise(9 * 1024 * 1024);
for (const b of browsers) {
  files[`probe-${b}.jsdos`] = await withConf();
  files[`pick-${b}.jsdos`] = await withoutConf();
  files[`big-${b}.jsdos`] = await writeZip([
    { name: '.jsdos/dosbox.conf', data: CONF },
    { name: 'DATA/NOISE.BIN', data: big },
    { name: 'DOSPROBE.COM', data: probe },
  ]);
}

for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), data);
  console.log(String(data.length).padStart(10) + '  ' + name);
}
