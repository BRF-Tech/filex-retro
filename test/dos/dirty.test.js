import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Unsaved changes have one owner: the shell. A player calls shell.setDirty,
// which tells filex and writes <html data-rx-dirty> (the tests read it); no
// player writes that mark itself.
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function sources(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const writesMark = /dataset\.rxDirty\s*=(?!=)|setAttribute\(\s*['"]data-rx-dirty['"]/;

describe('unsaved changes', () => {
  it('the DOS player marks them through the shell', () => {
    const src = readFileSync(join(SRC, 'dos', 'main.js'), 'utf8');
    expect(src).toMatch(/shell\.setDirty\(/);
    expect(src).not.toMatch(writesMark);
  });

  it('only the shell writes <html data-rx-dirty>', () => {
    const writers = sources()
      .filter((p) => writesMark.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p).split('\\').join('/'));
    expect(writers).toEqual(['shell/shell.js']);
  });
});
