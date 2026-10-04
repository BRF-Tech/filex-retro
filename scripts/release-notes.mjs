#!/usr/bin/env node
// The body of a GitHub release: the CHANGELOG.md section of that version.
//
//   node scripts/release-notes.mjs 0.1.0 > dist/release-notes.md
//
// filex shows an administrator the release's body under "Release notes"
// when it offers an update, so the words come from CHANGELOG.md, where they
// are already written. A version with no section, or with a section that is
// still a draft (its heading carries no release date), is an error, not an
// empty body: tag a version only once its changelog entry is written.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The section of `version`: its heading line and the text under it, up to
// the next "## " heading. null when there is none.
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const head = new RegExp('^## \\[?v?' + escapeRegExp(version) + '\\]?(\\s|$)');
  const start = lines.findIndex((line) => head.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  return { heading: lines[start], body: lines.slice(start + 1, end).join('\n').trim() };
}

// The release body, or an Error saying what is missing.
export function releaseNotes(changelog, version) {
  const v = String(version || '').replace(/^v/, '');
  if (!v) return new Error('usage: release-notes.mjs <version>');
  const s = changelogSection(changelog, v);
  if (!s || !s.body) return new Error(`CHANGELOG.md has no "## [${v}]" section with text in it: write what ${v} changes before tagging it`);
  if (!/ - \d{4}-\d{2}-\d{2}\s*$/.test(s.heading)) {
    return new Error(`CHANGELOG.md's "${s.heading}" has no release date (## [${v}] - YYYY-MM-DD): it is still a draft`);
  }
  return s.body + '\n';
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  const out = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), process.argv[2]);
  if (out instanceof Error) {
    console.error('release-notes: ' + out.message);
    process.exit(1);
  }
  process.stdout.write(out);
}
