import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { changelogSection, releaseNotes } from '../../scripts/release-notes.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '- not yet',
  '',
  '## [0.2.0] - 2026-11-01',
  '',
  '### Fixed',
  '',
  '- a fix',
  '',
  '## [0.1.0] - 2026-10-04',
  '',
  'The first version.',
  '',
  '### Added',
  '',
  '- a player',
  '',
].join('\r\n');

describe('release notes', () => {
  it('is the version section, up to the next heading', () => {
    expect(releaseNotes(CHANGELOG, '0.2.0')).toBe('### Fixed\n\n- a fix\n');
    expect(releaseNotes(CHANGELOG, 'v0.1.0')).toBe('The first version.\n\n### Added\n\n- a player\n');
  });

  it('does not take a version for a longer one', () => {
    expect(changelogSection('## [0.1.01] - 2026-10-04\n\nx\n', '0.1.0')).toBe(null);
  });

  it('refuses a version with no section, an empty one and a draft', () => {
    expect(releaseNotes(CHANGELOG, '0.3.0')).toBeInstanceOf(Error);
    expect(releaseNotes('## [0.1.0] - 2026-10-04\n\n## [0.0.9] - 2026-10-01\n\nx\n', '0.1.0')).toBeInstanceOf(Error);
    const draft = releaseNotes('## [0.1.0] - draft, not released\n\nx\n', '0.1.0');
    expect(draft).toBeInstanceOf(Error);
    expect(draft.message).toMatch(/draft/);
    expect(releaseNotes(CHANGELOG, '')).toBeInstanceOf(Error);
  });

  it("has this repository's version written up", () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const manifest = JSON.parse(readFileSync(new URL('../../filex-app.json', import.meta.url), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
    const notes = releaseNotes(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'), manifest.version);
    expect(notes).not.toBeInstanceOf(Error);
  });
});
