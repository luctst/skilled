import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { manifestPath, writeJsonAtomic } from './config.js';
import { SkilledError } from './errors.js';
import type { Entry, Manifest } from './types.js';

/** Code-unit ordering, so a manifest written on one machine matches another. */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findEntry(m: Manifest, id: string): Entry | undefined {
  return m.entries.find((entry) => entry.id === id);
}

/** Adds or replaces an entry. The id stops being unknown once it has a source. */
export function upsertEntry(m: Manifest, e: Entry): Manifest {
  const entries = [...m.entries.filter((entry) => entry.id !== e.id), e].sort((a, b) =>
    byId(a.id, b.id),
  );
  return { version: 1, entries, unknown: m.unknown.filter((id) => id !== e.id) };
}

/** Stops tracking an id. It is still on disk, so it goes back on the unknown list. */
export function removeEntry(m: Manifest, id: string): Manifest {
  const tracked = m.entries.some((entry) => entry.id === id);
  const unknown =
    tracked && !m.unknown.includes(id) ? [...m.unknown, id].sort(byId) : [...m.unknown];
  return { version: 1, entries: m.entries.filter((entry) => entry.id !== id), unknown };
}

const sourceSchema = z.object({
  type: z.literal('github'),
  repo: z.string().min(1),
  ref: z.string().min(1),
  subpath: z.string(),
});

const baseSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/, 'expected a full 40-character commit sha'),
  adoptedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO 8601 date, YYYY-MM-DD'),
  reconstructed: z.boolean(),
});

const detectionSchema = z.object({
  method: z.enum([
    'inline-url',
    'plugin-cache',
    'known-index',
    'code-search',
    'cluster',
    'claude',
    'manual',
  ]),
  confidence: z.number().min(0).max(1),
  confirmedBy: z.union([z.literal('user'), z.literal('auto'), z.null()]),
  evidence: z.string(),
});

const entrySchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  base: baseSchema,
  detection: detectionSchema,
});

export const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema),
  unknown: z.array(z.string()),
});

function badManifest(file: string, field: string, detail: string): SkilledError {
  const managedDir = path.dirname(path.dirname(file));
  return new SkilledError({
    code: 'BAD_MANIFEST',
    problem: `${file} is not a valid skilled manifest.`,
    cause: `Field \`${field}\`: ${detail} No managed file was modified.`,
    fixes: [
      `cat ${file}`,
      `git -C ${managedDir} checkout .skilled/manifest.json   restore the last committed copy`,
      `rm ${file}   start over; skilled will re-detect`,
    ],
    exitCode: 2,
  });
}

/** An absent manifest is the normal first-run state, not an error. */
export async function readManifest(managedDir: string): Promise<Manifest> {
  const file = manifestPath(managedDir);

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return { version: 1, entries: [], unknown: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw badManifest(file, '(whole file)', `it is not valid JSON: ${message}.`);
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw badManifest(file, field, `${issue.message}.`);
  }

  const manifest: Manifest = result.data;
  return manifest;
}

export async function writeManifest(managedDir: string, m: Manifest): Promise<void> {
  const file = manifestPath(managedDir);

  const result = manifestSchema.safeParse(m);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw badManifest(file, field, `${issue.message}. skilled refused to write it.`);
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeJsonAtomic(file, result.data);
}
