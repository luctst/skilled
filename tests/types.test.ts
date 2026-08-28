import { describe, it, expect } from 'vitest';
import '../src/types.js';
import type {
  Entry,
  LocalItem,
  Manifest,
  MergeOutcome,
  ResolvedConfig,
  StatusReport,
} from '../src/types.js';

describe('shared types', () => {
  it('describes a complete manifest entry', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.92,
        confirmedBy: 'user',
        evidence: 'matched 14 consecutive lines of SKILL.md',
      },
    };
    const manifest: Manifest = { version: 1, entries: [entry], unknown: ['skills/qa-only'] };

    expect(manifest.entries[0].id).toBe('skills/cso');
    expect(manifest.entries[0].base.commit).toHaveLength(40);
    expect(manifest.unknown).toEqual(['skills/qa-only']);
  });

  it('describes a single-file agent item', () => {
    const item: LocalItem = {
      id: 'agents/ponytail.md',
      absPath: '/tmp/skilled-x/agents/ponytail.md',
      kind: 'agent',
      files: [''],
    };

    expect(item.files).toEqual(['']);
  });

  it('describes a resolved config and a status report', () => {
    const config: ResolvedConfig = {
      dirs: ['/home/u/.claude'],
      origin: 'autodetect',
      configPath: '/home/u/.config/skilled/config.json',
      configExists: false,
    };
    const report: StatusReport = {
      dir: config.dirs[0],
      rows: [{ id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false }],
      identified: 1,
      total: 1,
      behind: 1,
      unknown: 0,
      fetchedAt: null,
    };

    expect(config.origin).toBe('autodetect');
    expect(report.rows[0].behindBy).toBe(6);
    expect(report.fetchedAt).toBeNull();
  });

  it('describes both merge outcomes', () => {
    const clean: MergeOutcome = { kind: 'clean', content: 'merged' };
    const conflict: MergeOutcome = { kind: 'conflict', content: '<<<<<<< LOCAL', conflictCount: 1 };

    expect(clean.kind).toBe('clean');
    expect(conflict.kind === 'conflict' ? conflict.conflictCount : 0).toBe(1);
  });
});
