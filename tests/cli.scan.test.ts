import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLocalReport, run } from '../src/cli.js';
import { discover } from '../src/discover.js';
import { upsertEntry, writeManifest } from '../src/manifest.js';
import type { Entry, Manifest, StatusReport } from '../src/types.js';
import { copyManagedFixture, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

async function capture(): Promise<{
  out: string[];
  err: string[];
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}> {
  const home = await makeTempDir();
  created.push(home);
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    },
  };
}

function makeEntry(id: string): Entry {
  return {
    id,
    source: { type: 'github', repo: 'DietrichGebert/ponytail', ref: 'main', subpath: '' },
    base: { commit: 'e'.repeat(40), adoptedAt: '2026-06-01', reconstructed: true },
    detection: {
      method: 'inline-url',
      confidence: 1,
      confirmedBy: 'auto',
      evidence: 'the file names its own upstream',
    },
  };
}

describe('buildLocalReport', () => {
  it('counts every item as unknown until upstream is checked', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const empty: Manifest = { version: 1, entries: [], unknown: [] };

    const report = buildLocalReport(dir, items, empty);

    expect(report.dir).toBe(dir);
    expect(report.total).toBe(6);
    expect(report.identified).toBe(0);
    expect(report.unknown).toBe(6);
    expect(report.behind).toBe(0);
    expect(report.fetchedAt).toBeNull();
    expect(report.rows.every((row) => row.status === 'unknown')).toBe(true);
    expect(report.rows.every((row) => row.localEdits === false)).toBe(true);
  });

  it('counts an item the manifest already tracks as identified', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const manifest = upsertEntry(
      { version: 1, entries: [], unknown: [] },
      makeEntry('agents/ponytail.md'),
    );

    const report = buildLocalReport(dir, items, manifest);

    expect(report.identified).toBe(1);
    expect(report.unknown).toBe(5);
    expect(report.rows.find((row) => row.id === 'agents/ponytail.md')?.source?.repo).toBe(
      'DietrichGebert/ponytail',
    );
  });
});

describe('skilled (bare)', () => {
  it('reports the totals for the managed directory and exits 0', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('4 skills, 2 agents');
    expect(text).toContain('0 of 6 identified · 0 behind upstream · 6 unknown origin');
    expect(text).toContain('skills/marketing-ads');
    expect(text).toContain('no known source');
    expect(text).toContain('Next:');
  });

  it('emits exactly a StatusReport with --json', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['--dir', managed, '--json'], c.io);
    const report = JSON.parse(c.out.join('\n')) as StatusReport;

    expect(code).toBe(0);
    expect(report.dir).toBe(managed);
    expect(report.rows).toHaveLength(6);
    expect(report.total).toBe(6);
    expect(report.unknown).toBe(6);
    expect(report.fetchedAt).toBeNull();
    expect(c.out.join('\n')).not.toContain('Scanning');
  });

  it('reads the manifest it finds in the managed directory', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    await writeManifest(
      managed,
      upsertEntry({ version: 1, entries: [], unknown: [] }, makeEntry('agents/ponytail.md')),
    );
    const c = await capture();

    await run(['--dir', managed, '--json'], c.io);
    const report = JSON.parse(c.out.join('\n')) as StatusReport;

    expect(report.identified).toBe(1);
    expect(report.unknown).toBe(5);
  });

  it('writes nothing into the managed directory', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const before = (await fs.readdir(managed)).sort();
    const c = await capture();

    await run(['--dir', managed], c.io);

    expect((await fs.readdir(managed)).sort()).toEqual(before);
  });
});

describe('skilled <name>', () => {
  it('shows the detail for an untracked item', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['cso', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('skills/cso');
    expect(text).toContain('SKILL.md');
    expect(text).toContain('unknown — not tracked yet');
  });

  it('shows source and evidence for a tracked item', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    await writeManifest(
      managed,
      upsertEntry({ version: 1, entries: [], unknown: [] }, makeEntry('agents/ponytail.md')),
    );
    const c = await capture();

    const code = await run(['ponytail', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('github.com/DietrichGebert/ponytail (main)');
    expect(text).toContain('the file names its own upstream');
    expect(text).toContain('(reconstructed)');
  });

  it('exits 2 for a name it cannot find', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['nope', '--dir', managed], c.io);

    expect(code).toBe(2);
    expect(c.err.join('\n')).toContain('No skill or agent named "nope"');
  });
});
