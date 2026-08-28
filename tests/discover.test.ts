import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discover } from '../src/discover.js';
import {
  FIXTURE_IDS,
  copyManagedFixture,
  makeManagedDir,
  removeTempDir,
} from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

describe('discover', () => {
  it('finds every skill and agent in the fixture, sorted by id', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual([...FIXTURE_IDS]);
  });

  it('lists every file of a multi-file skill, relative to the item', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const marketing = items.find((item) => item.id === 'skills/marketing-ads');

    expect(marketing).toBeDefined();
    expect(marketing?.kind).toBe('skill');
    expect(marketing?.absPath).toBe(path.join(dir, 'skills', 'marketing-ads'));
    expect(marketing?.files).toEqual([
      'SKILL.md',
      'evals/basic.md',
      'references/ad-copy-patterns.md',
      'references/channel-benchmarks.md',
    ]);
  });

  it('represents a single-file skill directory as one file', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const cso = items.find((item) => item.id === 'skills/cso');

    expect(cso?.files).toEqual(['SKILL.md']);
  });

  it('represents a flat agent file with files [""]', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const ponytail = items.find((item) => item.id === 'agents/ponytail.md');

    expect(ponytail?.kind).toBe('agent');
    expect(ponytail?.files).toEqual(['']);
    expect(ponytail?.absPath).toBe(path.join(dir, 'agents', 'ponytail.md'));
  });

  it('handles a flat .md file directly under skills/', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'skills', 'retro.md'), '# retro\n', 'utf8');

    const items = await discover(dir);

    expect(items).toEqual([
      {
        id: 'skills/retro.md',
        absPath: path.join(dir, 'skills', 'retro.md'),
        kind: 'skill',
        files: [''],
      },
    ]);
  });

  it('ignores dotfiles, dot-directories, and skilled state', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    await fs.mkdir(path.join(dir, '.skilled', 'base'), { recursive: true });
    await fs.writeFile(path.join(dir, '.skilled', 'manifest.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'skills', '.DS_Store'), 'junk', 'utf8');
    await fs.writeFile(path.join(dir, 'skills', 'cso', '.DS_Store'), 'junk', 'utf8');
    await fs.mkdir(path.join(dir, 'agents', '.cache'), { recursive: true });

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual([...FIXTURE_IDS]);
    expect(items.find((item) => item.id === 'skills/cso')?.files).toEqual(['SKILL.md']);
  });

  it('skips a missing skills/ or agents/ directory', async () => {
    const dir = await makeManagedDir(['agents']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'agents', 'thomas.md'), '# thomas\n', 'utf8');

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual(['agents/thomas.md']);
  });

  it('returns an empty list for a managed dir with nothing in it', async () => {
    const dir = await makeManagedDir(['skills', 'agents']);
    created.push(dir);

    expect(await discover(dir)).toEqual([]);
  });

  it('ignores non-markdown flat files', async () => {
    const dir = await makeManagedDir(['agents']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'agents', 'notes.txt'), 'not an agent\n', 'utf8');

    expect(await discover(dir)).toEqual([]);
  });
});
