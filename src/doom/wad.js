// DOOM-engine WAD files: the header, the lump directory, and which game an
// IWAD is.
//
// A WAD starts with four letters - IWAD (a whole game) or PWAD (a mod, a map
// pack: it needs an IWAD under it) - then the number of lumps and where the
// directory is; the directory has 16 bytes per lump (offset, size, an 8-byte
// name). Other files share the extension: Half-Life's texture WADs (WAD3),
// Quake's (WAD2), Wii channel WADs. They are told apart here so the person
// reads what the file is instead of a crash.
//
// The engine finds out which game it runs from the IWAD's FILE NAME
// (Chocolate Doom's d_iwad.c: doom2.wad, tnt.wad, freedoom2.wad…), and a
// file in filex can be called anything. So the game is recognised from the
// lumps inside (the same marks source ports use) and the IWAD is handed to
// the engine under its canonical name.

export class WadError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'WadError';
    this.code = code;
    this.detail = detail;
  }
}

const ascii4 = (b, at = 0) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** What a file is, from its first bytes: IWAD, PWAD, WAD2, WAD3, wii, zip or unknown. */
export function wadKind(bytes) {
  if (!bytes || bytes.length < 12) return 'unknown';
  const magic = ascii4(bytes);
  if (magic === 'IWAD' || magic === 'PWAD' || magic === 'WAD2' || magic === 'WAD3') return magic;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  // A Wii WAD: a big-endian header size of 0x20, then "Is", "ib" or "Bk".
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0x20) {
    const t = String.fromCharCode(bytes[4], bytes[5]);
    if (t === 'Is' || t === 'ib' || t === 'Bk') return 'wii';
  }
  return 'unknown';
}

const MAX_LUMPS = 1 << 20;

/**
 * The WAD's header and lump directory: {kind, lumps: [{name, offset, size}],
 * has(name)}. Throws WadError: `not_wad` (detail: wadKind) for anything but an
 * IWAD or a PWAD, `damaged` when the directory or a lump lies outside the file.
 */
export function readWad(bytes) {
  const kind = wadKind(bytes);
  if (kind !== 'IWAD' && kind !== 'PWAD') throw new WadError('not_wad', kind);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getInt32(4, true);
  const dir = dv.getInt32(8, true);
  if (count < 0 || count > MAX_LUMPS || dir < 12 || dir + count * 16 > bytes.length) {
    throw new WadError('damaged', 'directory');
  }
  const lumps = [];
  const names = new Set();
  for (let i = 0; i < count; i++) {
    const p = dir + i * 16;
    const offset = dv.getInt32(p, true);
    const size = dv.getInt32(p + 4, true);
    let name = '';
    for (let k = 0; k < 8; k++) {
      const c = bytes[p + 8 + k];
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    name = name.toUpperCase();
    if (size < 0 || (size > 0 && (offset < 0 || offset + size > bytes.length))) {
      throw new WadError('damaged', 'lump ' + name);
    }
    lumps.push({ name, offset, size });
    names.add(name);
  }
  return { kind, lumps, has: (n) => names.has(n) };
}

/** The maps in a WAD (ExMy and MAPxx markers), in directory order. */
export function wadMaps(wad) {
  return wad.lumps.filter((l) => /^(E[1-9]M[1-9]|MAP[0-9][0-9])$/.test(l.name)).map((l) => l.name);
}

// Recognised IWADs, most specific first: [id, mark lumps (all required),
// canonical file name for the engine, or null where this engine cannot run it].
const GAMES = [
  ['strife', ['MAP01', 'ENDSTRF'], null],
  ['hexen', ['MAP01', 'WINNOWR'], null],
  ['heretic', ['E1M1', 'MUS_E1M1'], null],
  ['freedm', ['MAP01', 'FREEDM'], 'freedm.wad'],
  ['freedoom2', ['MAP01', 'FREEDOOM'], 'freedoom2.wad'],
  ['freedoom1', ['E1M1', 'FREEDOOM'], 'freedoom1.wad'],
  ['hacx', ['MAP01', 'HACX-R'], 'hacx.wad'],
  ['plutonia', ['MAP01', 'CAMO1'], 'plutonia.wad'],
  ['tnt', ['MAP01', 'REDTNT2'], 'tnt.wad'],
  ['chex', ['E1M1', 'W94_1'], 'chex.wad'],
  ['doom2', ['MAP01'], 'doom2.wad'],
  ['ultimate', ['E1M1', 'E4M1'], 'doom.wad'],
  ['doom', ['E1M1', 'E2M1'], 'doom.wad'],
  ['doom1', ['E1M1'], 'doom1.wad'],
];

/**
 * Which game an IWAD is: {id, file, supported}. `file` is the name the engine
 * must see it under; `supported` is false for the games this engine does not
 * play (Heretic, Hexen, Strife). An IWAD with no map Retro knows is
 * {id: 'unknown', file: null, supported: false}.
 */
export function identifyGame(wad) {
  for (const [id, marks, file] of GAMES) {
    if (marks.every((m) => wad.has(m))) return { id, file, supported: file !== null };
  }
  return { id: 'unknown', file: null, supported: false };
}
