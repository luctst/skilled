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
