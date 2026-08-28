import fs from 'node:fs/promises';
import path from 'node:path';
import type { ItemKind, LocalItem } from './types.js';

/** The two directories skilled manages, in the order they are walked. */
const ROOTS: ReadonlyArray<{ dir: string; kind: ItemKind }> = [
  { dir: 'agents', kind: 'agent' },
  { dir: 'skills', kind: 'skill' },
];

/** Code-unit ordering: deterministic on every machine, unlike localeCompare. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every file under dir, POSIX-relative to it, recursively, dotfiles excluded. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const stat = await fs.stat(abs).catch(() => null);
    if (stat === null) continue;
    if (stat.isDirectory()) {
      out.push(...(await listFiles(abs, rel)));
    } else if (stat.isFile()) {
      out.push(rel);
    }
  }
  return out.sort(byText);
}

/**
 * Walks a managed dir. A skill is usually a directory containing SKILL.md plus
 * nested references/ and evals/; an agent is usually a flat .md file. Both
 * shapes are supported in both directories.
 */
export async function discover(managedDir: string): Promise<LocalItem[]> {
  const items: LocalItem[] = [];

  for (const root of ROOTS) {
    const rootPath = path.join(managedDir, root.dir);
    let entries;
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(rootPath, entry.name);
      const stat = await fs.stat(absPath).catch(() => null);
      if (stat === null) continue;

      if (stat.isDirectory()) {
        items.push({
          id: `${root.dir}/${entry.name}`,
          absPath,
          kind: root.kind,
          files: await listFiles(absPath),
        });
      } else if (stat.isFile() && entry.name.endsWith('.md')) {
        items.push({ id: `${root.dir}/${entry.name}`, absPath, kind: root.kind, files: [''] });
      }
    }
  }

  return items.sort((a, b) => byText(a.id, b.id));
}
