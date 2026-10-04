// Reading and writing zip files: small, dependency-free and deterministic.
//
// Both players keep their games in zips (a js-dos bundle is one, a `.fxdoom`
// pack is one), and the build packs `ui.zip` with the same writer. The
// writer is deterministic: the same entries in the same order give the same
// bytes - a fixed date (1980-01-01 00:00), no extra fields, no comments, the
// same header versions on every machine. Entries are stored, or deflated when
// asked (with the platform's CompressionStream; a platform without one
// stores). An entry read from another zip can be written again as it is,
// compressed bytes and all, without inflating it (`raw`).
//
// Not supported, and refused with a ZipError: zip64, multi-disk archives,
// encrypted entries, and any method but stored (0) and deflate (8).

export class ZipError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ZipError';
    this.code = code;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (the zip one) of `bytes`, continuing from `crc`. */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new ZipError('invalid', 'zip data must be bytes or a string');
}

async function pump(bytes, transform) {
  const s = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Raw deflate, or null where the platform has no CompressionStream. */
export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  return pump(bytes, new CompressionStream('deflate-raw'));
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('unsupported', 'no DecompressionStream');
  try {
    return await pump(bytes, new DecompressionStream('deflate-raw'));
  } catch (e) {
    throw new ZipError('damaged', 'inflate failed');
  }
}

function decodeName(bytes, flags) {
  if (flags & 0x800) return new TextDecoder('utf-8').decode(bytes);
  // No UTF-8 flag: ASCII as it is; anything else is read as UTF-8 too (most
  // tools write UTF-8 without the flag), Latin-1 when it is not valid UTF-8.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/**
 * The entries of a zip, in central-directory order. Each entry has `name`,
 * `method`, `crc`, `size`, `csize`, `dir` (a folder entry), `raw()` (its
 * stored or compressed bytes, a view into `input`) and `data()` (its content,
 * checked against its CRC).
 */
export function readZip(input) {
  const bytes = toBytes(input);
  if (bytes.length < 22) throw new ZipError('not_zip');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not_zip');
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) throw new ZipError('multi_disk');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || p === 0xffffffff) throw new ZipError('zip64');
  if (p + cdSize > eocd) throw new ZipError('damaged', 'central directory out of range');

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw new ZipError('damaged', 'bad central directory');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    if (csize === 0xffffffff || size === 0xffffffff || lho === 0xffffffff) throw new ZipError('zip64');
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nlen), flags);
    p += 46 + nlen + xlen + clen;
    if (lho + 30 > bytes.length || dv.getUint32(lho, true) !== 0x04034b50) throw new ZipError('damaged', 'bad local header: ' + name);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    if (start + csize > bytes.length) throw new ZipError('damaged', 'entry out of range: ' + name);
    const encrypted = (flags & 1) !== 0;
    entries.push({
      name,
      method,
      crc,
      size,
      csize,
      encrypted,
      dir: name.endsWith('/'),
      raw: () => bytes.subarray(start, start + csize),
      async data() {
        if (encrypted) throw new ZipError('encrypted', name);
        const raw = bytes.subarray(start, start + csize);
        let out;
        if (method === 0) out = raw;
        else if (method === 8) out = await inflateRaw(raw);
        else throw new ZipError('method', `${name} uses method ${method}`);
        if (out.length !== size || crc32(out) !== crc) throw new ZipError('damaged', 'checksum: ' + name);
        return out;
      },
    });
  }
  return entries;
}

/**
 * A zip of `entries`, in the order given. Each entry is
 *   {name, data, compress?}  - content (bytes or a string), deflated when
 *                              `compress` is true and that makes it smaller;
 *   {name, raw: entry}       - an entry of readZip written again unchanged.
 */
export async function writeZip(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  const names = new Set();
  let offset = 0;

  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || !e.name) throw new ZipError('invalid', 'entry without a name');
    if (names.has(e.name)) throw new ZipError('duplicate', e.name);
    names.add(e.name);

    let method;
    let crc;
    let size;
    let body;
    if (e.raw) {
      if (e.raw.encrypted) throw new ZipError('encrypted', e.name);
      if (e.raw.method !== 0 && e.raw.method !== 8) throw new ZipError('method', e.name);
      method = e.raw.method;
      crc = e.raw.crc;
      size = e.raw.size;
      body = e.raw.raw();
    } else {
      const data = toBytes(e.data);
      size = data.length;
      crc = crc32(data);
      method = 0;
      body = data;
      if (e.compress && size > 0) {
        const z = await deflateRaw(data);
        if (z && z.length < size) {
          method = 8;
          body = z;
        }
      }
    }

    const nameBytes = enc.encode(e.name);
    const utf8 = nameBytes.some((b) => b > 0x7f);
    const flags = utf8 ? 0x800 : 0;

    const lh = new Uint8Array(30 + nameBytes.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, method, true);
    l.setUint16(10, 0, true);
    l.setUint16(12, 0x21, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, body.length, true);
    l.setUint32(22, size, true);
    l.setUint16(26, nameBytes.length, true);
    l.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    const ch = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, flags, true);
    c.setUint16(10, method, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, size, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    locals.push(lh, body);
    centrals.push(ch);
    offset += lh.length + body.length;
    if (offset > 0xfffffffe) throw new ZipError('too_large');
  }
  if (names.size > 0xfffe) throw new ZipError('too_large');

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, names.size, true);
  d.setUint16(10, names.size, true);
  d.setUint32(12, cdSize, true);
  d.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
