import { describe, expect, it } from 'vitest';
import { identifyGame, readWad, wadKind, wadMaps, WadError } from '../../src/doom/wad.js';
import { makeWad } from './helpers.js';

const id = (lumps) => identifyGame(readWad(makeWad('IWAD', lumps)));

describe('wadKind', () => {
  it('tells an IWAD from a PWAD', () => {
    expect(wadKind(makeWad('IWAD', ['MAP01']))).toBe('IWAD');
    expect(wadKind(makeWad('PWAD', ['MAP01']))).toBe('PWAD');
  });
  it('names the files that share the extension', () => {
    expect(wadKind(makeWad('WAD3', ['TEXTURE']))).toBe('WAD3');
    expect(wadKind(makeWad('WAD2', ['TEXTURE']))).toBe('WAD2');
    const wii = new Uint8Array(64);
    wii.set([0, 0, 0, 0x20, 0x49, 0x73, 0, 0]);
    expect(wadKind(wii)).toBe('wii');
    expect(wadKind(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('zip');
    expect(wadKind(new TextEncoder().encode('just some text file'))).toBe('unknown');
    expect(wadKind(new Uint8Array(3))).toBe('unknown');
  });
});

describe('readWad', () => {
  it('reads the lump directory, names in upper case', () => {
    const wad = readWad(makeWad('PWAD', [{ name: 'map01', data: new Uint8Array(0) }, { name: 'THINGS', data: new Uint8Array([1, 2, 3]) }]));
    expect(wad.kind).toBe('PWAD');
    expect(wad.lumps.map((l) => [l.name, l.size])).toEqual([['MAP01', 0], ['THINGS', 3]]);
    expect(wad.has('MAP01')).toBe(true);
    expect(wadMaps(wad)).toEqual(['MAP01']);
  });
  it('refuses a WAD3 with not_wad', () => {
    expect(() => readWad(makeWad('WAD3', ['X']))).toThrow(expect.objectContaining({ code: 'not_wad', detail: 'WAD3' }));
  });
  it('refuses a directory past the end of the file', () => {
    const bytes = makeWad('IWAD', ['E1M1']);
    new DataView(bytes.buffer).setInt32(4, 1000, true);
    expect(() => readWad(bytes)).toThrow(WadError);
    expect(() => readWad(bytes)).toThrow(expect.objectContaining({ code: 'damaged' }));
  });
  it('refuses a lump past the end of the file', () => {
    const bytes = makeWad('IWAD', [{ name: 'PLAYPAL', data: new Uint8Array(8) }]);
    const dir = new DataView(bytes.buffer).getInt32(8, true);
    new DataView(bytes.buffer).setInt32(dir + 4, 99999, true);
    expect(() => readWad(bytes)).toThrow(expect.objectContaining({ code: 'damaged' }));
  });
});

describe('identifyGame', () => {
  it('recognises the games by their lumps, not their file names', () => {
    expect(id(['MAP01', 'FREEDOOM'])).toEqual({ id: 'freedoom2', file: 'freedoom2.wad', supported: true });
    expect(id(['E1M1', 'E2M1', 'FREEDOOM'])).toEqual({ id: 'freedoom1', file: 'freedoom1.wad', supported: true });
    expect(id(['MAP01', 'FREEDM', 'FREEDOOM'])).toMatchObject({ id: 'freedm', file: 'freedm.wad' });
    expect(id(['MAP01', 'CAMO1'])).toMatchObject({ id: 'plutonia', file: 'plutonia.wad' });
    expect(id(['MAP01', 'REDTNT2'])).toMatchObject({ id: 'tnt', file: 'tnt.wad' });
    expect(id(['MAP01'])).toMatchObject({ id: 'doom2', file: 'doom2.wad' });
    expect(id(['E1M1', 'E2M1', 'E4M1'])).toMatchObject({ id: 'ultimate', file: 'doom.wad' });
    expect(id(['E1M1', 'E2M1'])).toMatchObject({ id: 'doom', file: 'doom.wad' });
    expect(id(['E1M1'])).toMatchObject({ id: 'doom1', file: 'doom1.wad' });
  });
  it('knows the games this engine does not play', () => {
    expect(id(['E1M1', 'MUS_E1M1'])).toEqual({ id: 'heretic', file: null, supported: false });
    expect(id(['MAP01', 'WINNOWR'])).toMatchObject({ id: 'hexen', supported: false });
    expect(id(['MAP01', 'ENDSTRF'])).toMatchObject({ id: 'strife', supported: false });
  });
  it('finds no game in an IWAD without maps', () => {
    expect(id(['PLAYPAL', 'COLORMAP'])).toEqual({ id: 'unknown', file: null, supported: false });
  });
});
