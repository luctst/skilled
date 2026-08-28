import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the read-only fixture managed directory. Never write inside it. */
export const FIXTURE_MANAGED_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'managed',
);

/** Every LocalItem id in the fixture, in the order discover() returns them. */
export const FIXTURE_IDS: readonly string[] = [
  'agents/ponytail.md',
  'agents/thomas.md',
  'skills/cso',
  'skills/explain-code',
  'skills/marketing-ads',
  'skills/qa-only',
];

export async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
}

export async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

/** A writable copy of the fixture managed dir, in a fresh temp dir. */
export async function copyManagedFixture(): Promise<string> {
  const dir = await makeTempDir();
  await copyDir(FIXTURE_MANAGED_DIR, dir);
  return dir;
}

/** A temp dir that validates as managed, with the given empty subdirectories. */
export async function makeManagedDir(subdirs: string[] = ['skills']): Promise<string> {
  const dir = await makeTempDir();
  for (const sub of subdirs) {
    await fs.mkdir(path.join(dir, sub), { recursive: true });
  }
  return dir;
}
