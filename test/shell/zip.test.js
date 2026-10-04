import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip, ZipError } from '../../src/shell/zip.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

describe('crc32', () => {
  it('matches the known value for "123456789"', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });
  it('continues across chunks', () => {
    const a = enc('12345');
    const b = enc('6789');
    expect(crc32(b, crc32(a))).toBe(0xcbf43926);
  });
});

describe('writeZip and readZip', () => {
  it('give back what went in, stored and deflated, in order', async () => {
    const big = enc('DOOM '.repeat(2000));
    const zip = await writeZip([
      { name: 'fxdoom.json', data: '{"format":1}' },
      { name: 'wads/freedoom2.wad', data: big, compress: true },
      { name: 'saves/doomsav0.dsg', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['fxdoom.json', 'wads/freedoom2.wad', 'saves/doomsav0.dsg']);
    expect(entries[0].method).toBe(0);
    expect(entries[1].method).toBe(8);
    expect(entries[1].csize).toBeLessThan(big.length);
    expect(dec(await entries[0].data())).toBe('{"format":1}');
    expect(await entries[1].data()).toEqual(big);
    expect(Array.from(await entries[2].data())).toEqual([0, 1, 2, 255]);
  });

  it('is deterministic: the same entries give the same bytes', async () => {
    const make = () =>
      writeZip([
        { name: 'b.txt', data: 'second' },
        { name: 'a.bin', data: new Uint8Array(4096).fill(7), compress: true },
      ]);
    const one = await make();
    const two = await make();
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
  });

  it('writes a fixed date and no extra fields', async () => {
    const zip = await writeZip([{ name: 'x', data: 'y' }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint16(10, true)).toBe(0);
    expect(dv.getUint16(12, true)).toBe(0x21);
    expect(dv.getUint16(28, true)).toBe(0);
  });

  it('stores an entry that would not get smaller', async () => {
    const zip = await writeZip([{ name: 'r', data: new Uint8Array([9]), compress: true }]);
    expect(readZip(zip)[0].method).toBe(0);
  });

  it('copies an entry of another zip as it is, compressed bytes and all', async () => {
    const first = await writeZip([{ name: 'w.wad', data: enc('x'.repeat(5000)), compress: true }]);
    const [w] = readZip(first);
    const second = await writeZip([{ name: 'fxdoom.json', data: '{}' }, { name: 'w.wad', raw: w }]);
    const [, copy] = readZip(second);
    expect(copy.method).toBe(8);
    expect(Buffer.from(copy.raw()).equals(Buffer.from(w.raw()))).toBe(true);
    expect(dec(await copy.data())).toBe('x'.repeat(5000));
  });

  it('marks and reads a UTF-8 name', async () => {
    const zip = await writeZip([{ name: 'kayıtlar/oyun-ş.dsg', data: 'a' }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(dv.getUint16(6, true) & 0x800).toBe(0x800);
    expect(readZip(zip)[0].name).toBe('kayıtlar/oyun-ş.dsg');
  });

  it('refuses a duplicate name', async () => {
    await expect(writeZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }])).rejects.toMatchObject({ code: 'duplicate' });
  });
});

describe('readZip refuses', () => {
  it('something that is not a zip', () => {
    expect(() => readZip(enc('IWAD and some more bytes to pass the length check'))).toThrow(ZipError);
    expect(() => readZip(enc('PWAD........................'))).toThrow(expect.objectContaining({ code: 'not_zip' }));
    expect(() => readZip(enc('short'))).toThrow(expect.objectContaining({ code: 'not_zip' }));
  });
  it('a damaged entry, by its checksum', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello world' }]);
    const bad = zip.slice();
    bad[30 + 'a.txt'.length] ^= 0xff;
    await expect(readZip(bad)[0].data()).rejects.toMatchObject({ code: 'damaged' });
  });
  it('a truncated archive', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello world' }]);
    expect(() => readZip(zip.slice(0, zip.length - 30))).toThrow(ZipError);
  });
  it('an encrypted entry', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: 'hello' }]);
    const dv = new DataView(zip.buffer);
    const cd = dv.getUint32(zip.length - 22 + 16, true);
    dv.setUint16(cd + 8, 1, true);
    await expect(readZip(zip)[0].data()).rejects.toMatchObject({ code: 'encrypted' });
  });
});
