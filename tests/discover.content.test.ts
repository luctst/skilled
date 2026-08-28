import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discover, readItemContent } from '../src/discover.js';
import { SkilledError } from '../src/errors.js';
import { copyManagedFixture, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

describe('readItemContent', () => {
  it('keys a multi-file skill by relative path', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const marketing = items.find((item) => item.id === 'skills/marketing-ads');
    if (marketing === undefined) throw new Error('fixture is missing skills/marketing-ads');

    const content = await readItemContent(marketing);

    expect([...content.keys()]).toEqual([
      'SKILL.md',
      'evals/basic.md',
      'references/ad-copy-patterns.md',
      'references/channel-benchmarks.md',
    ]);
    expect(content.get('SKILL.md')).toContain('version: 2.2.0');
    expect(content.get('references/channel-benchmarks.md')).toContain('LinkedIn');
  });

  it('keys a flat agent file with the empty string', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const ponytail = items.find((item) => item.id === 'agents/ponytail.md');
    if (ponytail === undefined) throw new Error('fixture is missing agents/ponytail.md');

    const content = await readItemContent(ponytail);

    expect([...content.keys()]).toEqual(['']);
    expect(content.get('')).toContain('Adapted from github.com/DietrichGebert/ponytail');
  });

  it('throws a SkilledError naming a file that vanished', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const cso = items.find((item) => item.id === 'skills/cso');
    if (cso === undefined) throw new Error('fixture is missing skills/cso');
    await fs.rm(path.join(cso.absPath, 'SKILL.md'));

    try {
      await readItemContent(cso);
      throw new Error('expected readItemContent to reject');
    } catch (err) {
      if (!(err instanceof SkilledError)) throw err;
      expect(err.problem).toContain('SKILL.md');
      expect(err.cause).toContain('No managed file was modified.');
    }
  });
});
