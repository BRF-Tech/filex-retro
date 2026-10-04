import { describe, expect, it } from 'vitest';
import { readZip, writeZip } from '../../src/shell/zip.js';
import {
  BundleError,
  CONF_PATH,
  PICKS_BUDGET,
  PICKS_MAX,
  bundleKey,
  changeSignature,
  changedFiles,
  confFor,
  deletedFiles,
  dosPath,
  findPrograms,
  inspectBundle,
  isDosName,
  isSafeName,
  mergeBundle,
  readPicks,
  rememberedPick,
  stateSignature,
  treePaths,
  withPick,
} from '../../src/dos/bundle.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const sha = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

const CONF = '[autoexec]\nmount c .\nc:\nPROBE.COM\n';
const zip = (list) => writeZip(list.map((e) => (typeof e === 'string' ? { name: e, data: e.endsWith('/') ? '' : 'x' } : e)));

function refused(fn) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BundleError);
    return e.code;
  }
  throw new Error('not refused');
}

// Central directory offset of a zip writeZip made with one entry: right
// after the local header and the data.
function patchFirst(bytes, { localFlags, centralFlags, method, eocdCount }) {
  const b = new Uint8Array(bytes);
  const dv = new DataView(b.buffer);
  const eocd = b.length - 22;
  const cd = dv.getUint32(eocd + 16, true);
  if (localFlags !== undefined) dv.setUint16(6, localFlags, true);
  if (centralFlags !== undefined) dv.setUint16(cd + 8, centralFlags, true);
  if (method !== undefined) {
    dv.setUint16(8, method, true);
    dv.setUint16(cd + 10, method, true);
  }
  if (eocdCount !== undefined) {
    dv.setUint16(eocd + 8, eocdCount, true);
    dv.setUint16(eocd + 10, eocdCount, true);
  }
  return b;
}

describe('inspectBundle', () => {
  it('reads a bundle that says what to run', async () => {
    const b = inspectBundle(await zip([{ name: CONF_PATH, data: CONF }, { name: 'PROBE.COM', data: new Uint8Array(40) }, '.jsdos/']));
    expect(b.conf && b.conf.name).toBe(CONF_PATH);
    expect(dec(await b.conf.data())).toBe(CONF);
    expect(b.programs.map((p) => p.name)).toEqual(['PROBE.COM']);
    expect(b.files).toBe(2);
    expect(b.size).toBe(CONF.length + 40);
  });

  it('reads a game folder zip with no dosbox.conf and lists its programs', async () => {
    const b = inspectBundle(await zip(['GAME/', 'GAME/GAME.EXE', 'GAME/SETUP.EXE', 'README.TXT']));
    expect(b.conf).toBe(null);
    expect(b.programs.map(dosPath)).toEqual(['GAME\\GAME.EXE', 'GAME\\SETUP.EXE']);
  });

  it('refuses a file that is not a zip', () => {
    expect(refused(() => inspectBundle(enc('MZ this is a DOS program, not a bundle')))).toBe('not_zip');
    expect(refused(() => inspectBundle(new Uint8Array(0)))).toBe('not_zip');
  });

  it('refuses a damaged zip', async () => {
    const b = new Uint8Array(await zip(['PROBE.COM']));
    new DataView(b.buffer).setUint32(b.length - 22 + 16, 3, true);
    expect(refused(() => inspectBundle(b))).toBe('damaged');
  });

  it('refuses an encrypted bundle', async () => {
    const b = patchFirst(await zip(['PROBE.COM']), { localFlags: 1, centralFlags: 1 });
    expect(refused(() => inspectBundle(b))).toBe('encrypted');
  });

  it('refuses a compression it does not read', async () => {
    const b = patchFirst(await zip(['PROBE.COM']), { method: 12 });
    expect(refused(() => inspectBundle(b))).toBe('unsupported');
  });

  it('refuses zip64', async () => {
    const b = patchFirst(await zip(['PROBE.COM']), { eocdCount: 0xffff });
    expect(refused(() => inspectBundle(b))).toBe('unsupported');
  });

  it('refuses a name that leaves the bundle', async () => {
    for (const name of ['../EVIL.COM', '/ROOT.COM', 'A/../../B.COM', 'C:/X.COM', 'A\\B.COM']) {
      const b = await zip([name]);
      expect(refused(() => inspectBundle(b)), name).toBe('unsafe');
    }
  });

  it('refuses an empty bundle', async () => {
    const none = await writeZip([]);
    const dirsOnly = await zip(['GAME/', 'GAME/SAVES/']);
    expect(refused(() => inspectBundle(none))).toBe('empty');
    expect(refused(() => inspectBundle(dirsOnly))).toBe('empty');
  });

  it('refuses a bundle with nothing to start', async () => {
    const b = await zip(['README.TXT', 'DATA/LEVEL1.DAT', 'Long Folder Name/GAME.EXE', 'GAME.EXE.BAK']);
    expect(refused(() => inspectBundle(b))).toBe('no_program');
  });
});

describe('DOS names', () => {
  it('takes 8.3 names in the characters DOS allows', () => {
    for (const n of ['GAME.EXE', 'game.exe', 'A', 'SETUP', 'X_1-2.C', "IT'S.BAT", 'ABCDEFGH.ABC']) expect(isDosName(n), n).toBe(true);
    for (const n of ['ABCDEFGHI.EXE', 'GAME.EXEC', 'MY GAME.EXE', 'A.B.C', '.', '..', '', 'GAME.', 'ĞAME.EXE']) expect(isDosName(n), n).toBe(false);
  });
  it('keeps names inside the bundle', () => {
    for (const n of ['GAME.EXE', 'GAME/', 'A/B/C.DAT', '.jsdos/dosbox.conf']) expect(isSafeName(n), n).toBe(true);
    for (const n of ['', '/A', '../A', 'A/../B', 'A//B', './A', 'A\\B', 'C:/A', 'C:A']) expect(isSafeName(n), n).toBe(false);
  });
});

describe('findPrograms (the program picker list)', () => {
  const entries = (names) => names.map((name) => ({ name, size: name.length, dir: name.endsWith('/') }));
  it('puts the top folder first, a starter before a setup program, then by name', () => {
    const list = findPrograms(
      entries(['SUB/RUN.BAT', 'SETUP.EXE', 'install.exe', 'GAME.EXE', 'AUTO.BAT', 'SUB/', 'SUB/DEEP/X.COM', 'B.COM', 'SUB/CONFIG.EXE', 'SUB/AAA.EXE']),
    );
    expect(list.map((p) => p.name)).toEqual(['AUTO.BAT', 'B.COM', 'GAME.EXE', 'install.exe', 'SETUP.EXE', 'SUB/AAA.EXE', 'SUB/RUN.BAT', 'SUB/CONFIG.EXE', 'SUB/DEEP/X.COM']);
  });
  it('writes each as DOS does: upper case, backslashes', () => {
    const [p] = findPrograms(entries(['games/doom/doom.exe']));
    expect(p).toEqual({ name: 'games/doom/doom.exe', size: 19, dir: 'GAMES\\DOOM', file: 'DOOM.EXE' });
    expect(dosPath(p)).toBe('GAMES\\DOOM\\DOOM.EXE');
  });
  it('leaves out what DOS cannot start or reach', () => {
    const list = findPrograms(entries(['.jsdos/X.EXE', 'Long Folder Name/GAME.EXE', 'GAME.EXE.BAK', 'README.TXT', 'DIR.EXE/', 'VERYLONGNAME.EXE', 'OK.COM']));
    expect(list.map((p) => p.name)).toEqual(['OK.COM']);
  });
});

describe('confFor', () => {
  it('starts a program at the top of the bundle', () => {
    const conf = confFor({ dir: '', file: 'PROBE.COM' });
    expect(conf).toContain('[autoexec]\necho off\nmount c .\nc:\nPROBE.COM\n');
    expect(conf).not.toContain('cd ');
    expect(conf).toContain('autolock=false');
  });
  it('changes into the program folder first', () => {
    const conf = confFor({ dir: 'GAME\\BIN', file: 'RUN.BAT' });
    expect(conf.endsWith('c:\ncd \\GAME\\BIN\nRUN.BAT\n')).toBe(true);
  });
});

async function bundleAndChanges() {
  const big = enc('LEVEL DATA '.repeat(500));
  const bundleBytes = await writeZip([
    { name: 'GAME.EXE', data: new Uint8Array(300).fill(0x90) },
    { name: 'DATA/', data: '' },
    { name: 'DATA/LEVELS.DAT', data: big, compress: true },
    { name: 'save.txt', data: 'old save' },
    { name: 'GONE.TMP', data: 'temporary' },
  ]);
  const changesBytes = await writeZip([
    { name: 'SAVE.TXT', data: 'new save' },
    { name: 'SAVES/', data: '' },
    { name: 'SAVES/SLOT1.SAV', data: new Uint8Array(64).fill(7), compress: true },
    { name: '.jsdos/dosbox.conf', data: 'from the emulator' },
  ]);
  return { bundleBytes, changesBytes, entries: readZip(bundleBytes), changes: readZip(changesBytes) };
}

describe('mergeBundle', () => {
  it('puts the changes in: replaced ignoring case, added, js-dos files left out', async () => {
    const { entries, changes } = await bundleAndChanges();
    const out = readZip(await mergeBundle({ entries, changes }));
    expect(out.map((e) => e.name)).toEqual(['DATA/', 'DATA/LEVELS.DAT', 'GAME.EXE', 'GONE.TMP', 'SAVE.TXT', 'SAVES/SLOT1.SAV']);
    const by = Object.fromEntries(out.map((e) => [e.name, e]));
    expect(dec(await by['SAVE.TXT'].data())).toBe('new save');
    expect(Array.from(await by['SAVES/SLOT1.SAV'].data())).toEqual(new Array(64).fill(7));
  });

  it('copies what did not change as it was, compressed bytes and all', async () => {
    const { entries, changes } = await bundleAndChanges();
    const out = readZip(await mergeBundle({ entries, changes }));
    const before = entries.find((e) => e.name === 'DATA/LEVELS.DAT');
    const after = out.find((e) => e.name === 'DATA/LEVELS.DAT');
    expect(after.method).toBe(8);
    expect(Array.from(after.raw())).toEqual(Array.from(before.raw()));
    expect(after.crc).toBe(before.crc);
    const slot = changes.find((e) => e.name === 'SAVES/SLOT1.SAV');
    expect(Array.from(out.find((e) => e.name === 'SAVES/SLOT1.SAV').raw())).toEqual(Array.from(slot.raw()));
  });

  it('adds the configuration and drops what the game deleted', async () => {
    const { entries, changes } = await bundleAndChanges();
    const conf = confFor({ dir: '', file: 'GAME.EXE' });
    const out = readZip(await mergeBundle({ entries, changes, conf, deleted: new Set(['GONE.TMP']) }));
    expect(out.map((e) => e.name)).toEqual(['.jsdos/dosbox.conf', 'DATA/', 'DATA/LEVELS.DAT', 'GAME.EXE', 'SAVE.TXT', 'SAVES/SLOT1.SAV']);
    expect(dec(await out[0].data())).toBe(conf);
  });

  it('is deterministic: the same bundle and changes give the same bytes, whatever order they come in', async () => {
    const { entries, changes } = await bundleAndChanges();
    const conf = confFor({ dir: '', file: 'GAME.EXE' });
    const a = await mergeBundle({ entries, changes, conf });
    const b = await mergeBundle({ entries, changes, conf });
    const c = await mergeBundle({ entries: [...entries].reverse(), changes: [...changes].reverse(), conf });
    expect(await sha(a)).toBe(await sha(b));
    expect(await sha(a)).toBe(await sha(c));
    // Every entry carries the same fixed date (1980-01-01 00:00).
    const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
    let p = 0;
    let n = 0;
    while (dv.getUint32(p, true) === 0x04034b50) {
      expect(dv.getUint16(p + 10, true)).toBe(0);
      expect(dv.getUint16(p + 12, true)).toBe(0x21);
      p += 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true) + dv.getUint32(p + 18, true);
      n++;
    }
    expect(n).toBe(7);
  });

  it('changes nothing when nothing changed: the bundle comes back the same, again and again', async () => {
    const { entries } = await bundleAndChanges();
    const once = await mergeBundle({ entries, changes: [] });
    const twice = await mergeBundle({ entries: readZip(once), changes: [] });
    expect(await sha(twice)).toBe(await sha(once));
    for (const e of readZip(once)) if (!e.dir) await e.data();
  });
});

describe('change sets', () => {
  it('sign as empty when the game changed nothing it keeps', async () => {
    expect(changeSignature([])).toBe('');
    expect(changeSignature(null)).toBe('');
    expect(changeSignature(readZip(await writeZip([{ name: '.jsdos/dosbox.conf', data: 'x' }, { name: 'D/', data: '' }])))).toBe('');
  });
  it('sign alike in any order, and differently when a file differs', async () => {
    const a = readZip(await writeZip([{ name: 'A.SAV', data: 'one' }, { name: 'B.SAV', data: 'two' }]));
    const b = readZip(await writeZip([{ name: 'B.SAV', data: 'two' }, { name: 'A.SAV', data: 'one' }]));
    const c = readZip(await writeZip([{ name: 'A.SAV', data: 'one' }, { name: 'B.SAV', data: 'tWo' }]));
    expect(changeSignature(a)).not.toBe('');
    expect(changeSignature(a)).toBe(changeSignature(b));
    expect(changeSignature(a)).not.toBe(changeSignature(c));
    expect(changedFiles(a).map((e) => e.name)).toEqual(['A.SAV', 'B.SAV']);
  });
  it('count a deleted file as a change too, so a save is not skipped', async () => {
    const a = readZip(await writeZip([{ name: 'A.SAV', data: 'one' }]));
    expect(stateSignature([], new Set())).toBe('');
    expect(stateSignature(a, null)).toBe(changeSignature(a));
    const gone = stateSignature(a, new Set(['OLD.SAV']));
    expect(gone).not.toBe(changeSignature(a));
    expect(stateSignature([], new Set(['B', 'A']))).toBe(stateSignature([], new Set(['A', 'B'])));
    expect(stateSignature([], new Set(['A']))).not.toBe('');
  });
});

describe('deleted files', () => {
  const entries = ['GAME.EXE', 'DATA/', 'DATA/L1.DAT', 'save.txt', 'GONE.TMP', '.jsdos/dosbox.conf'].map((name) => ({ name, dir: name.endsWith('/') }));
  it('are the bundle files missing from the emulator tree, ignoring case', () => {
    const present = new Set(['GAME.EXE', 'DATA/L1.DAT', 'SAVE.TXT', 'NEW.SAV']);
    expect([...deletedFiles(entries, present)]).toEqual(['GONE.TMP']);
  });
  it('are none when the tree is plainly not the bundle, or unknown', () => {
    expect(deletedFiles(entries, new Set(['home/web_user/GAME.EXE'])).size).toBe(0);
    expect(deletedFiles(entries, new Set())).toEqual(new Set());
    expect(deletedFiles(entries, null).size).toBe(0);
  });
  it('come from the emulator file tree', () => {
    const tree = { name: '.', size: null, nodes: [{ name: 'GAME.EXE', size: 3, nodes: null }, { name: 'DATA', size: null, nodes: [{ name: 'L1.DAT', size: 1, nodes: null }, { name: 'EMPTY', size: null, nodes: [] }] }] };
    expect([...treePaths(tree)].sort()).toEqual(['DATA/L1.DAT', 'GAME.EXE']);
    expect(treePaths(null).size).toBe(0);
  });
});

describe('the remembered program', () => {
  it('is keyed by the bundle name, size and first MiB', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(1);
    const k = await bundleKey('game.jsdos', bytes);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(await bundleKey('game.jsdos', bytes)).toBe(k);
    expect(await bundleKey('other.jsdos', bytes)).not.toBe(k);
    expect(await bundleKey('game.jsdos', bytes.subarray(0, bytes.length - 1))).not.toBe(k);
    const head = bytes.slice();
    head[10] = 2;
    expect(await bundleKey('game.jsdos', head)).not.toBe(k);
    const tail = bytes.slice();
    tail[tail.length - 1] = 2;
    expect(await bundleKey('game.jsdos', tail)).toBe(k);
  });

  it('is kept newest first, once per bundle, within the store budget', () => {
    const key = (i) => i.toString(16).padStart(32, '0');
    let stored = undefined;
    stored = withPick(stored, key(1), 'GAME.EXE');
    stored = withPick(stored, key(2), 'RUN.BAT');
    stored = withPick(stored, key(1), 'SUB/GAME.EXE');
    expect(stored.picks).toEqual([
      [key(1), 'SUB/GAME.EXE'],
      [key(2), 'RUN.BAT'],
    ]);
    expect(rememberedPick(stored, key(2))).toBe('RUN.BAT');
    expect(rememberedPick(stored, key(3))).toBe(null);
    for (let i = 10; i < 100; i++) stored = withPick(stored, key(i), 'P/'.repeat(60) + 'GAME.EXE');
    expect(stored.picks.length).toBeLessThanOrEqual(PICKS_MAX);
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(PICKS_BUDGET);
    expect(stored.picks[0][0]).toBe(key(99));
  });

  it('reads only what it wrote', () => {
    expect(readPicks(null)).toEqual([]);
    expect(readPicks({ picks: 'x' })).toEqual([]);
    expect(readPicks({ picks: [['short', 'A.EXE'], ['0'.repeat(32), 5], ['0'.repeat(32), 'OK.EXE']] })).toEqual([['0'.repeat(32), 'OK.EXE']]);
  });
});
