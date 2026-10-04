// Builds small WADs for the tests: a header, the lumps, a directory.

export function makeWad(kind, lumps) {
  const enc = new TextEncoder();
  const datas = lumps.map((l) => (typeof l === 'string' ? { name: l, data: new Uint8Array(0) } : { name: l.name, data: l.data || new Uint8Array(0) }));
  const dataSize = datas.reduce((n, l) => n + l.data.length, 0);
  const dir = 12 + dataSize;
  const out = new Uint8Array(dir + datas.length * 16);
  const dv = new DataView(out.buffer);
  out.set(enc.encode(kind), 0);
  dv.setInt32(4, datas.length, true);
  dv.setInt32(8, dir, true);
  let p = 12;
  datas.forEach((l, i) => {
    out.set(l.data, p);
    const e = dir + i * 16;
    dv.setInt32(e, l.data.length ? p : 0, true);
    dv.setInt32(e + 4, l.data.length, true);
    out.set(enc.encode(l.name.slice(0, 8)), e + 8);
    p += l.data.length;
  });
  return out;
}
