import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateManagedDir } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected validateManagedDir to reject');
}

describe('validateManagedDir', () => {
  it('accepts a directory with skills/', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    await expect(validateManagedDir(dir)).resolves.toBeUndefined();
  });

  it('accepts a directory with only agents/', async () => {
    const dir = await makeManagedDir(['agents']);
    created.push(dir);

    await expect(validateManagedDir(dir)).resolves.toBeUndefined();
  });

  it('rejects a path that does not exist', async () => {
    const dir = await makeTempDir();
    created.push(dir);
    const missing = path.join(dir, 'nope');

    const err = await captureError(() => validateManagedDir(missing));
    expect(err.code).toBe('BAD_DIR');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain(missing);
    expect(err.problem).toContain('not found');
  });

  it('rejects a file', async () => {
    const dir = await makeTempDir();
    created.push(dir);
    const file = path.join(dir, 'notes.md');
    await fs.writeFile(file, 'hello\n', 'utf8');

    const err = await captureError(() => validateManagedDir(file));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain('Not a directory');
  });

  it('says what it expected and what it found', async () => {
    const dir = await makeTempDir();
    created.push(dir);
    await fs.mkdir(path.join(dir, 'notes'));
    await fs.writeFile(path.join(dir, 'README.md'), '# hi\n', 'utf8');

    const err = await captureError(() => validateManagedDir(dir));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain('is not a managed directory');
    expect(err.cause).toContain('Expected a skills/ or agents/ subdirectory');
    expect(err.cause).toContain('README.md');
    expect(err.cause).toContain('notes');
  });

  it('reports an empty directory as empty', async () => {
    const dir = await makeTempDir();
    created.push(dir);

    const err = await captureError(() => validateManagedDir(dir));
    expect(err.cause).toContain('(empty)');
  });
});
