import { describe, expect, it } from 'vitest';
import { looksLikeZip, packNameFor, readPack, safeWadName, writePack } from '../../src/doom/fxdoom.js';
import { readZip, writeZip } from '../../src/shell/zip.js';
import { makeWad } from './helpers.js';

const enc = (s) => new TextEncoder().encode(s);
const iwad = makeWad('IWAD', [{ name: 'MAP01', data: new Uint8Array(0) }, { name: 'FREEDOOM', data: enc('x'.repeat(4000)) }]);

describe('the .fxdoom pack', () => {
  it('goes there and back: the IWAD, the saves, the config', async () => {
    const bytes = await writePack({
      iwad: { name: 'freedoom2.wad', data: iwad },
      saves: [{ name: 'doomsav1.dsg', data: enc('slot one') }, { name: 'doomsav0.dsg', data: enc('slot zero') }],
      config: [{ name: 'default.cfg', data: enc('mouse_sensitivity 5\n') }],
    });
    expect(looksLikeZip(bytes)).toBe(true);
    const pack = await readPack(bytes);
    expect(pack.format).toBe(1);
    expect(pack.iwad.name).toBe('freedoom2.wad');
    expect(pack.iwad.data).toEqual(iwad);
    expect(pack.saves.map((s) => s.name)).toEqual(['doomsav0.dsg', 'doomsav1.dsg']);
    expect(new TextDecoder().decode(pack.saves[1].data)).toBe('slot one');
    expect(pack.config.map((c) => c.name)).toEqual(['default.cfg']);
    expect(pack.pwads).toEqual([]);
  });

  it('lays the zip out in a fixed order, fxdoom.json first', async () => {
    const bytes = await writePack({
      iwad: { name: 'doom2.wad', data: iwad },
      saves: [{ name: 'doomsav2.dsg', data: enc('2') }],
      config: [{ name: 'doomgeneric.cfg', data: enc('a') }, { name: 'default.cfg', data: enc('b') }],
    });
    expect(readZip(bytes).map((e) => e.name)).toEqual(['fxdoom.json', 'wads/doom2.wad', 'config/default.cfg', 'config/doomgeneric.cfg', 'saves/doomsav2.dsg']);
    const meta = JSON.parse(new TextDecoder().decode(await readZip(bytes)[0].data()));
    expect(meta).toEqual({ format: 1, iwad: 'doom2.wad', pwads: [] });
  });

  it('is deterministic: the same game and saves give the same bytes', async () => {
    const make = () => writePack({ iwad: { name: 'doom2.wad', data: iwad }, saves: [{ name: 'doomsav0.dsg', data: enc('s') }] });
    expect(Buffer.from(await make()).equals(Buffer.from(await make()))).toBe(true);
  });

  it('copies the IWAD of an opened pack without deflating it again', async () => {
    const first = await writePack({ iwad: { name: 'doom2.wad', data: iwad } });
    const pack = await readPack(first);
    const second = await writePack({ iwad: { name: pack.iwad.name, entry: pack.iwad.entry }, saves: [{ name: 'doomsav3.dsg', data: enc('new') }] });
    const a = readZip(first).find((e) => e.name === 'wads/doom2.wad');
    const b = readZip(second).find((e) => e.name === 'wads/doom2.wad');
    expect(Buffer.from(b.raw()).equals(Buffer.from(a.raw()))).toBe(true);
    expect((await readPack(second)).saves.map((s) => s.name)).toEqual(['doomsav3.dsg']);
  });

  it('keeps what a newer Retro added, and drops a save slot it replaced', async () => {
    const bytes = await writeZip([
      { name: 'fxdoom.json', data: JSON.stringify({ format: 1, iwad: 'doom2.wad', pwads: [] }) },
      { name: 'wads/doom2.wad', data: iwad },
      { name: 'saves/doomsav0.dsg', data: 'old' },
      { name: 'notes/readme.txt', data: 'kept' },
    ]);
    const pack = await readPack(bytes);
    expect(pack.extra.map((e) => e.name)).toEqual(['notes/readme.txt']);
    const again = await writePack({ iwad: { name: 'doom2.wad', entry: pack.iwad.entry }, saves: [{ name: 'doomsav0.dsg', data: enc('new') }], extra: pack.extra });
    const names = readZip(again).map((e) => e.name);
    expect(names).toEqual(['fxdoom.json', 'wads/doom2.wad', 'saves/doomsav0.dsg', 'notes/readme.txt']);
  });
});

describe('readPack refuses', () => {
  it('a file that is not a zip, and a zip without fxdoom.json', async () => {
    await expect(readPack(iwad)).rejects.toMatchObject({ code: 'not_pack' });
    await expect(readPack(await writeZip([{ name: 'a.txt', data: 'x' }]))).rejects.toMatchObject({ code: 'not_pack' });
  });
  it('a pack from a newer format', async () => {
    const bytes = await writeZip([{ name: 'fxdoom.json', data: '{"format":2,"iwad":"doom2.wad"}' }]);
    await expect(readPack(bytes)).rejects.toMatchObject({ code: 'newer' });
  });
  it('a pack without its IWAD', async () => {
    const bytes = await writeZip([{ name: 'fxdoom.json', data: '{"format":1,"iwad":"doom2.wad"}' }]);
    await expect(readPack(bytes)).rejects.toMatchObject({ code: 'no_iwad' });
  });
  it('a pack whose names would leave its folder', async () => {
    const bytes = await writeZip([{ name: 'fxdoom.json', data: '{"format":1,"iwad":"../doom2.wad"}' }]);
    await expect(readPack(bytes)).rejects.toMatchObject({ code: 'damaged' });
  });
  it('broken JSON', async () => {
    const bytes = await writeZip([{ name: 'fxdoom.json', data: '{format' }]);
    await expect(readPack(bytes)).rejects.toMatchObject({ code: 'damaged' });
  });
});

describe('writePack refuses', () => {
  it('a save that is not a save slot', async () => {
    await expect(writePack({ iwad: { name: 'doom2.wad', data: iwad }, saves: [{ name: '../evil.dsg', data: enc('x') }] })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('names', () => {
  it('makes the pack name from the WAD name', () => {
    expect(packNameFor('freedoom2.wad')).toBe('freedoom2.fxdoom');
    expect(packNameFor('My Game.WAD')).toBe('My Game.fxdoom');
    expect(packNameFor('noext')).toBe('noext.fxdoom');
  });
  it('accepts plain WAD names only', () => {
    expect(safeWadName('freedoom2.wad')).toBe(true);
    expect(safeWadName('../x.wad')).toBe(false);
    expect(safeWadName('a/b.wad')).toBe(false);
    expect(safeWadName('.hidden')).toBe(false);
  });
});
