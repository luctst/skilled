import { describe, it, expect } from 'vitest';
import {
  ORIGIN_LABELS,
  countItems,
  formatCounts,
  plural,
  renderNextSteps,
  renderScanHeader,
  renderStatusReport,
  renderStatusRow,
  renderTotals,
  shortName,
  statusLineSummary,
  tildify,
} from '../../src/render/status.js';
import type { LocalItem, StatusReport, StatusRow } from '../../src/types.js';

const plain = { color: false };

const items: LocalItem[] = [
  { id: 'agents/ponytail.md', absPath: '/m/agents/ponytail.md', kind: 'agent', files: [''] },
  { id: 'agents/thomas.md', absPath: '/m/agents/thomas.md', kind: 'agent', files: [''] },
  { id: 'skills/cso', absPath: '/m/skills/cso', kind: 'skill', files: ['SKILL.md'] },
  { id: 'skills/qa-only', absPath: '/m/skills/qa-only', kind: 'skill', files: ['SKILL.md'] },
];

function report(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    dir: '/m',
    rows: [],
    identified: 0,
    total: 0,
    behind: 0,
    unknown: 0,
    fetchedAt: null,
    ...overrides,
  };
}

describe('counting and formatting', () => {
  it('counts skills and agents', () => {
    expect(countItems(items)).toEqual({ skills: 2, agents: 2, total: 4 });
    expect(countItems([])).toEqual({ skills: 0, agents: 0, total: 0 });
  });

  it('pluralises', () => {
    expect(plural(1, 'skill')).toBe('1 skill');
    expect(plural(2, 'skill')).toBe('2 skills');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('formats counts, dropping the empty half', () => {
    expect(formatCounts({ skills: 8, agents: 2, total: 10 })).toBe('8 skills, 2 agents');
    expect(formatCounts({ skills: 3, agents: 0, total: 3 })).toBe('3 skills');
    expect(formatCounts({ skills: 0, agents: 1, total: 1 })).toBe('1 agent');
    expect(formatCounts({ skills: 0, agents: 0, total: 0 })).toBe('no skills or agents');
  });

  it('shortens a path against home and an id to a name', () => {
    expect(tildify('/home/u/.claude', '/home/u')).toBe('~/.claude');
    expect(tildify('/home/u', '/home/u')).toBe('~');
    expect(tildify('/elsewhere/.claude', '/home/u')).toBe('/elsewhere/.claude');
    expect(shortName('skills/marketing-ads')).toBe('marketing-ads');
    expect(shortName('agents/ponytail.md')).toBe('ponytail');
  });

  it('labels every config origin', () => {
    expect(ORIGIN_LABELS.flag).toBe('--dir flag');
    expect(ORIGIN_LABELS.env).toBe('SKILLED_DIR env var');
    expect(ORIGIN_LABELS.file).toBe('config file');
    expect(ORIGIN_LABELS.autodetect).toBe('auto-detected');
  });
});

describe('renderScanHeader', () => {
  it('names the directory and the counts', () => {
    expect(renderScanHeader('/home/u/.claude', countItems(items), plain)).toBe(
      'Scanning /home/u/.claude … 2 skills, 2 agents',
    );
  });

  it('emits color when asked', () => {
    const colored = renderScanHeader('/m', countItems(items), { color: true });
    expect(colored).toContain('[');
  });
});

describe('renderStatusRow', () => {
  it('marks an item with no known source', () => {
    const row: StatusRow = { id: 'skills/qa-only', status: 'unknown', localEdits: false };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('?');
    expect(line).toContain('skills/qa-only');
    expect(line).toContain('no known source');
  });

  it('marks a known but unchecked item differently', () => {
    const row: StatusRow = {
      id: 'skills/cso',
      status: 'unknown',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      localEdits: false,
    };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('owner/repo');
    expect(line).toContain('not checked yet');
    expect(line).not.toContain('no known source');
  });

  it('reports how far behind an entry is, and local edits', () => {
    const row: StatusRow = {
      id: 'skills/git',
      status: 'behind',
      source: { type: 'github', repo: 'owner/git', ref: 'main', subpath: 'skills/git' },
      behindBy: 3,
      localEdits: true,
    };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('3 commits behind');
    expect(line).toContain('local edits');
  });

  it('reports current and unreachable entries', () => {
    const current = renderStatusRow(
      {
        id: 'skills/retro',
        status: 'current',
        source: { type: 'github', repo: 'owner/retro', ref: 'main', subpath: '' },
        localEdits: false,
      },
      plain,
    );
    const gone = renderStatusRow(
      {
        id: 'skills/dead',
        status: 'unreachable',
        source: { type: 'github', repo: 'owner/dead', ref: 'main', subpath: '' },
        localEdits: false,
      },
      plain,
    );

    expect(current).toContain('✓');
    expect(gone).toContain('✗');
    expect(gone).toContain('upstream unreachable');
  });
});

describe('renderTotals and renderStatusReport', () => {
  it('renders the totals line', () => {
    const totals = renderTotals(
      report({ identified: 43, total: 51, behind: 12, unknown: 8 }),
      plain,
    );

    expect(totals.trim()).toBe('43 of 51 identified · 12 behind upstream · 8 unknown origin');
  });

  it('renders one line per row then the totals', () => {
    const rows: StatusRow[] = [
      { id: 'skills/cso', status: 'unknown', localEdits: false },
      { id: 'skills/qa-only', status: 'unknown', localEdits: false },
    ];
    const text = renderStatusReport(report({ rows, total: 2, unknown: 2 }), plain);
    const lines = text.split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('skills/cso');
    expect(lines[1]).toContain('skills/qa-only');
    expect(lines[2]).toBe('');
    expect(lines[3].trim()).toBe('0 of 2 identified · 0 behind upstream · 2 unknown origin');
  });
});

describe('renderNextSteps', () => {
  it('offers update only when something is behind', () => {
    const behind = renderNextSteps([report({ behind: 12, unknown: 8, total: 51 })], plain);
    expect(behind).toContain('Next:');
    expect(behind).toContain('skilled update');
    expect(behind).toContain('skilled add <url> <name>');

    const clean = renderNextSteps([report({ behind: 0, unknown: 0, total: 3 })], plain);
    expect(clean).not.toContain('skilled update');
    expect(clean).toContain('skilled config');
  });
});

describe('statusLineSummary', () => {
  it('is null when nothing is behind', () => {
    expect(statusLineSummary(report({ total: 6, unknown: 6 }))).toBeNull();
  });

  it('names the entries that are behind', () => {
    const rows: StatusRow[] = [
      { id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false },
      { id: 'skills/git', status: 'behind', behindBy: 3, localEdits: true },
      { id: 'skills/marketing-ads', status: 'behind', behindBy: 1, localEdits: false },
      { id: 'agents/ponytail.md', status: 'current', localEdits: false },
    ];

    expect(statusLineSummary(report({ rows, behind: 3, total: 4, identified: 4 }))).toBe(
      'skilled: 3 entries behind upstream (cso, git, marketing-ads) · run `skilled update`',
    );
  });

  it('caps the names it lists', () => {
    const rows: StatusRow[] = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      id: `skills/${name}`,
      status: 'behind' as const,
      behindBy: 1,
      localEdits: false,
    }));

    expect(statusLineSummary(report({ rows, behind: 5, total: 5 }))).toBe(
      'skilled: 5 entries behind upstream (a, b, c, +2 more) · run `skilled update`',
    );
  });
});
