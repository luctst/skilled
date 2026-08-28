import { describe, it, expect } from 'vitest';
import { findEntry, removeEntry, upsertEntry } from '../src/manifest.js';
import type { Entry, Manifest } from '../src/types.js';

function makeEntry(id: string, repo = 'owner/repo'): Entry {
  return {
    id,
    source: { type: 'github', repo, ref: 'main', subpath: id },
    base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: false },
    detection: {
      method: 'inline-url',
      confidence: 1,
      confirmedBy: 'auto',
      evidence: 'the file names its own upstream',
    },
  };
}

const empty: Manifest = { version: 1, entries: [], unknown: [] };

describe('findEntry', () => {
  it('finds an entry by id', () => {
    const manifest: Manifest = { version: 1, entries: [makeEntry('skills/cso')], unknown: [] };

    expect(findEntry(manifest, 'skills/cso')?.source.repo).toBe('owner/repo');
    expect(findEntry(manifest, 'skills/nope')).toBeUndefined();
  });
});

describe('upsertEntry', () => {
  it('adds an entry and keeps entries sorted by id', () => {
    const withSkill = upsertEntry(empty, makeEntry('skills/cso'));
    const withAgent = upsertEntry(withSkill, makeEntry('agents/ponytail.md'));

    expect(withAgent.entries.map((e) => e.id)).toEqual(['agents/ponytail.md', 'skills/cso']);
    expect(withAgent.version).toBe(1);
  });

  it('replaces an existing entry rather than duplicating it', () => {
    const first = upsertEntry(empty, makeEntry('skills/cso', 'owner/first'));
    const second = upsertEntry(first, makeEntry('skills/cso', 'owner/second'));

    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].source.repo).toBe('owner/second');
  });

  it('drops the id from unknown, because it now has a source', () => {
    const manifest: Manifest = { version: 1, entries: [], unknown: ['skills/cso', 'skills/retro'] };

    const next = upsertEntry(manifest, makeEntry('skills/cso'));

    expect(next.unknown).toEqual(['skills/retro']);
  });

  it('does not mutate its input', () => {
    const manifest: Manifest = { version: 1, entries: [], unknown: ['skills/cso'] };

    upsertEntry(manifest, makeEntry('skills/cso'));

    expect(manifest.entries).toEqual([]);
    expect(manifest.unknown).toEqual(['skills/cso']);
  });
});

describe('removeEntry', () => {
  it('removes the entry and records the id as unknown', () => {
    const manifest = upsertEntry(empty, makeEntry('skills/cso'));

    const next = removeEntry(manifest, 'skills/cso');

    expect(next.entries).toEqual([]);
    expect(next.unknown).toEqual(['skills/cso']);
  });

  it('is a no-op for an id it does not track', () => {
    const manifest = upsertEntry(empty, makeEntry('skills/cso'));

    const next = removeEntry(manifest, 'skills/nope');

    expect(next.entries.map((e) => e.id)).toEqual(['skills/cso']);
    expect(next.unknown).toEqual([]);
  });

  it('does not record the same unknown id twice', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [makeEntry('skills/cso')],
      unknown: ['skills/cso'],
    };

    expect(removeEntry(manifest, 'skills/cso').unknown).toEqual(['skills/cso']);
  });
});
