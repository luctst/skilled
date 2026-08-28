import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FIXTURE_IDS,
  FIXTURE_MANAGED_DIR,
  copyManagedFixture,
  makeManagedDir,
  makeTempDir,
  removeTempDir,
} from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

describe('managed-directory fixture', () => {
  it('mirrors the real ~/.claude shapes', async () => {
    const marketing = path.join(FIXTURE_MANAGED_DIR, 'skills', 'marketing-ads');
    expect((await fs.readdir(marketing)).sort()).toEqual(['SKILL.md', 'evals', 'references']);
    expect((await fs.readdir(path.join(marketing, 'references'))).sort()).toEqual([
      'ad-copy-patterns.md',
      'channel-benchmarks.md',
    ]);

    const cso = await fs.readFile(
      path.join(FIXTURE_MANAGED_DIR, 'skills', 'cso', 'SKILL.md'),
      'utf8',
    );
    expect(cso).toContain('allowed-tools: Bash');

    const marketingSkill = await fs.readFile(path.join(marketing, 'SKILL.md'), 'utf8');
    expect(marketingSkill).toContain('version: 2.2.0');

    const explain = await fs.readFile(
      path.join(FIXTURE_MANAGED_DIR, 'skills', 'explain-code', 'SKILL.md'),
      'utf8',
    );
    expect(explain).toContain('https://github.com/anthropics/claude-plugins-official');
  });

  it('keeps the ponytail provenance line on line 13', async () => {
    const ponytail = await fs.readFile(
      path.join(FIXTURE_MANAGED_DIR, 'agents', 'ponytail.md'),
      'utf8',
    );
    const lines = ponytail.split('\n');

    expect(lines[12]).toBe('Adapted from github.com/DietrichGebert/ponytail.');
  });

  it('lists the fixture ids in sorted order', () => {
    expect([...FIXTURE_IDS]).toEqual([
      'agents/ponytail.md',
      'agents/thomas.md',
      'skills/cso',
      'skills/explain-code',
      'skills/marketing-ads',
      'skills/qa-only',
    ]);
  });

  it('copies the fixture into an independent temp dir', async () => {
    const copy = await copyManagedFixture();
    created.push(copy);

    expect(copy.startsWith(os.tmpdir())).toBe(true);
    expect(copy).not.toBe(FIXTURE_MANAGED_DIR);

    const csoCopy = path.join(copy, 'skills', 'cso', 'SKILL.md');
    await fs.writeFile(csoCopy, 'edited locally\n', 'utf8');

    const original = await fs.readFile(
      path.join(FIXTURE_MANAGED_DIR, 'skills', 'cso', 'SKILL.md'),
      'utf8',
    );
    expect(original).toContain('allowed-tools: Bash');
  });

  it('makes an empty managed dir on demand', async () => {
    const dir = await makeManagedDir(['skills', 'agents']);
    created.push(dir);

    expect((await fs.readdir(dir)).sort()).toEqual(['agents', 'skills']);
  });

  it('makes and removes bare temp dirs', async () => {
    const dir = await makeTempDir();
    expect(path.basename(dir).startsWith('skilled-')).toBe(true);

    await removeTempDir(dir);
    await expect(fs.stat(dir)).rejects.toThrow();
  });
});
