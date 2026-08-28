import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { manifestPath, stateDir } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { readManifest, upsertEntry, writeManifest } from '../src/manifest.js';
import type { Entry, Manifest } from '../src/types.js';
import { makeManagedDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

function makeEntry(id: string): Entry {
  return {
    id,
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: id },
    base: { commit: 'b'.repeat(40), adoptedAt: '2026-05-12', reconstructed: true },
    detection: {
      method: 'code-search',
      confidence: 0.92,
      confirmedBy: 'user',
      evidence: 'matched 14 consecutive lines of SKILL.md',
    },
  };
}

async function writeRaw(dir: string, contents: string): Promise<void> {
  await fs.mkdir(stateDir(dir), { recursive: true });
  await fs.writeFile(manifestPath(dir), contents, 'utf8');
}

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected the manifest call to reject');
}

describe('readManifest', () => {
  it('returns an empty manifest when the file is absent', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    expect(await readManifest(dir)).toEqual({ version: 1, entries: [], unknown: [] });
  });

  it('round-trips a written manifest', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    const manifest = upsertEntry({ version: 1, entries: [], unknown: [] }, makeEntry('skills/cso'));

    await writeManifest(dir, manifest);

    expect(await readManifest(dir)).toEqual(manifest);
  });

  it('rejects a file that is not JSON, naming the file', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    await writeRaw(dir, '{ this is not json');

    const err = await captureError(() => readManifest(dir));
    expect(err.code).toBe('BAD_MANIFEST');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain(manifestPath(dir));
    expect(err.cause).toContain('No managed file was modified.');
  });

  it('names the offending field when a commit sha is malformed', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    const broken = {
      version: 1,
      entries: [
        {
          ...makeEntry('skills/cso'),
          base: { commit: 'abc123', adoptedAt: '2026-05-12', reconstructed: false },
        },
      ],
      unknown: [],
    };
    await writeRaw(dir, JSON.stringify(broken));

    const err = await captureError(() => readManifest(dir));
    expect(err.code).toBe('BAD_MANIFEST');
    expect(err.cause).toContain('entries.0.base.commit');
  });

  it('names the offending field when the version is wrong', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    await writeRaw(dir, JSON.stringify({ version: 2, entries: [], unknown: [] }));

    const err = await captureError(() => readManifest(dir));
    expect(err.cause).toContain('version');
  });
});

describe('writeManifest', () => {
  it('creates .skilled/ and writes formatted JSON with a trailing newline', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    await writeManifest(dir, { version: 1, entries: [], unknown: ['skills/qa-only'] });

    const raw = await fs.readFile(manifestPath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('\n  "unknown": [');
    expect(await fs.readdir(stateDir(dir))).toEqual(['manifest.json']);
  });

  it('refuses to write an invalid manifest', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    const invalid = {
      version: 1,
      entries: [
        {
          ...makeEntry('skills/cso'),
          detection: { method: 'telepathy', confidence: 0.5, confirmedBy: null, evidence: '' },
        },
      ],
      unknown: [],
    } as unknown as Manifest;

    const err = await captureError(() => writeManifest(dir, invalid));
    expect(err.code).toBe('BAD_MANIFEST');
    expect(err.cause).toContain('entries.0.detection.method');
    await expect(fs.stat(manifestPath(dir))).rejects.toThrow();
  });

  it('writes into the managed dir it was given, not anywhere else', async () => {
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['skills']);
    created.push(first, second);

    await writeManifest(first, { version: 1, entries: [], unknown: [] });

    expect(await fs.readdir(second)).toEqual(['skills']);
    expect(path.dirname(manifestPath(first))).toBe(stateDir(first));
  });
});
