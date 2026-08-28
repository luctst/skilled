import { describe, it, expect } from 'vitest';
import {
  renderConfig,
  renderConfigSaved,
  renderItemDetail,
  renderNoManagedDirHint,
} from '../../src/render/status.js';
import type { DirSummary } from '../../src/render/status.js';
import type { Entry, LocalItem, ResolvedConfig } from '../../src/types.js';

const plain = { color: false };

const oneDir: DirSummary[] = [
  { dir: '/home/u/.claude', counts: { skills: 34, agents: 17, total: 51 } },
];

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    dirs: ['/home/u/.claude'],
    origin: 'autodetect',
    configPath: '/home/u/.config/skilled/config.json',
    configExists: false,
    ...overrides,
  };
}

describe('renderConfig', () => {
  it('shows the directory, its counts, the config file, and which source won', () => {
    const text = renderConfig(config(), oneDir, plain);

    expect(text).toContain('managed directory');
    expect(text).toContain('/home/u/.claude');
    expect(text).toContain('(auto-detected)');
    expect(text).toContain('34 skills, 17 agents');
    expect(text).toContain('/home/u/.config/skilled/config.json');
    expect(text).toContain('(not created yet)');
  });

  it('reports the origin that actually applied', () => {
    expect(renderConfig(config({ origin: 'flag' }), oneDir, plain)).toContain('(--dir flag)');
    expect(renderConfig(config({ origin: 'env' }), oneDir, plain)).toContain(
      '(SKILLED_DIR env var)',
    );
    expect(renderConfig(config({ origin: 'file', configExists: true }), oneDir, plain)).toContain(
      '(config file)',
    );
  });

  it('says the config file is in use once it exists', () => {
    expect(renderConfig(config({ configExists: true }), oneDir, plain)).toContain('(in use)');
  });

  it('lists every managed directory', () => {
    const dirs: DirSummary[] = [
      { dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } },
      { dir: '/work/app/.claude', counts: { skills: 3, agents: 0, total: 3 } },
    ];

    const text = renderConfig(
      config({ dirs: dirs.map((d) => d.dir), origin: 'file', configExists: true }),
      dirs,
      plain,
    );

    expect(text).toContain('managed directories');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('8 skills, 2 agents');
    expect(text).toContain('/work/app/.claude');
    expect(text).toContain('3 skills');
  });

  it('says (none) when nothing is managed', () => {
    const text = renderConfig(config({ dirs: [] }), [], plain);

    expect(text).toContain('(none)');
    expect(text).toContain('(auto-detected)');
  });
});

describe('renderConfigSaved', () => {
  it('confirms a replace with the counts it found', () => {
    const text = renderConfigSaved(
      [{ dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } }],
      'replace',
      '/home/u/.config/skilled/config.json',
      plain,
    );

    expect(text).toContain('managed directory');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('✓ saved');
    expect(text).toContain('found 8 skills, 2 agents');
    expect(text).toContain('saved to /home/u/.config/skilled/config.json');
  });

  it('lists every directory after an add', () => {
    const text = renderConfigSaved(
      [
        { dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } },
        { dir: '/work/app/.claude', counts: { skills: 3, agents: 0, total: 3 } },
      ],
      'add',
      '/home/u/.config/skilled/config.json',
      plain,
    );

    expect(text).toContain('managing 2 directories:');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('/work/app/.claude');
    expect(text).toContain('3 skills');
  });

  it('uses the singular for one directory after an add', () => {
    const text = renderConfigSaved(
      [{ dir: '/home/u/.codex', counts: { skills: 1, agents: 0, total: 1 } }],
      'add',
      '/cfg/config.json',
      plain,
    );

    expect(text).toContain('managing 1 directory:');
  });
});

describe('renderNoManagedDirHint', () => {
  it('says where it looked and how to fix it', () => {
    const text = renderNoManagedDirHint('/home/u/.claude', plain);

    expect(text).toContain('No managed directory yet.');
    expect(text).toContain('/home/u/.claude');
    expect(text).toContain('skills/ or agents/');
    expect(text).toContain('skilled config dir <path>');
  });
});

describe('renderItemDetail', () => {
  const item: LocalItem = {
    id: 'skills/cso',
    absPath: '/home/u/.claude/skills/cso',
    kind: 'skill',
    files: ['SKILL.md'],
  };

  it('describes an untracked item and how to record it', () => {
    const text = renderItemDetail(item, undefined, plain);

    expect(text).toContain('skills/cso');
    expect(text).toContain('/home/u/.claude/skills/cso');
    expect(text).toContain('skill');
    expect(text).toContain('SKILL.md');
    expect(text).toContain('unknown — not tracked yet');
    expect(text).toContain('skilled add <url> skills/cso');
  });

  it('names the flat file of a single-file item', () => {
    const agent: LocalItem = {
      id: 'agents/ponytail.md',
      absPath: '/home/u/.claude/agents/ponytail.md',
      kind: 'agent',
      files: [''],
    };

    expect(renderItemDetail(agent, undefined, plain)).toContain('ponytail.md');
  });

  it('shows source, base, and detection evidence for a tracked item', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: 'c'.repeat(40), adoptedAt: '2026-05-12', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.92,
        confirmedBy: 'user',
        evidence: 'matched 14 consecutive lines of SKILL.md',
      },
    };

    const text = renderItemDetail(item, entry, plain);

    expect(text).toContain('github.com/owner/repo (main)');
    expect(text).toContain('skills/cso');
    expect(text).toContain('ccccccc adopted 2026-05-12 (reconstructed)');
    expect(text).toContain('code-search · confidence 0.92 · user');
    expect(text).toContain('matched 14 consecutive lines of SKILL.md');
  });

  it('says unconfirmed when nothing confirmed the detection', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: '' },
      base: { commit: 'd'.repeat(40), adoptedAt: '2026-06-01', reconstructed: false },
      detection: { method: 'cluster', confidence: 0.7, confirmedBy: null, evidence: '11 siblings' },
    };

    const text = renderItemDetail(item, entry, plain);

    expect(text).toContain('unconfirmed');
    expect(text).not.toContain('(reconstructed)');
  });
});
