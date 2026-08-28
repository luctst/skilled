# Update and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `skilled update` fetch the current upstream, three-way merge it against the pristine BASE and the user's edited LOCAL copy, and write the result only after the user approves that specific change.

**Architecture:** `fetch.ts` implements the real `GitHubClient` over the GitHub REST API with global `fetch`; `merge.ts` shells out to `git merge-file` for the three-way merge; `plan.ts` turns (BASE, LOCAL, UPSTREAM) trees into a per-file plan; `apply.ts` writes LOCAL atomically and advances BASE in the same operation; `update.ts` drives the interactive review loop and registers the `update` command through `cli.ts`'s registry. Nothing outside `<managed-dir>/.skilled/` is written until the user presses `a`.

**Tech Stack:** Node.js ≥ 20 (ESM), TypeScript 5 strict, Vitest, global `fetch`, `git merge-file` via `node:child_process`, `gh auth token` for credentials, `claude -p` for LLM conflict resolution.

**Spec:** `skilled_registry/specs/00-CONTRACT.md` and `skilled_registry/specs/DESIGN.md`

## Global Constraints

- **Runtime:** Node.js ≥ 20.0.0. ESM only (`"type": "module"` in package.json).
- **Language:** TypeScript 5.x, `strict: true`. No `any` in exported signatures.
- **Test framework:** Vitest. Tests live in `tests/`, mirroring `src/` structure.
- **Package manager:** npm. Binary name `skilled`, exposed via `"bin"`.
- **No network in tests.** All network calls go through injected interfaces; tests use fakes. A test that hits github.com is a broken test.
- **No dependency added without justification in the task.** Available and expected: `node:fs/promises`, `node:path`, `node:os`, `node:child_process`. Third-party allowed: `zod` (schema validation), `picocolors` (terminal color). Do not add a CLI framework, an HTTP client, or a git library.
- **Never write to a managed file without explicit user approval.** Writing to `<managed-dir>/.skilled/` is always allowed. Writing to a skill or agent file requires the user to have said yes to that specific change.
- **Dates** are ISO 8601 `YYYY-MM-DD` strings. Timestamps are full ISO 8601 UTC.
- **All user-facing strings** state problem, cause, and fix.
- **Every thrown error is a `SkilledError`.** A bare `throw new Error(...)` anywhere in `src/` is a defect. (Test helpers under `tests/` may throw plain errors.)
- **Required reassurance:** any error raised during a scan, detect, or update must state that no managed file was modified, when that is true.
- **Exit codes are fixed:** `0` success; `1` stale (bare `skilled` only); `2` user error; `3` operational failure (network, auth, rate limit); `4` merge conflict left unresolved.
- **Temp dirs in tests:** `fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'))`, removed in `afterEach`. Never touch the real `~/.claude` in a test.
- **Commits:** conventional commits — `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
- **One justified deviation:** `merge.ts` uses the synchronous `node:fs` and `spawnSync` APIs, because the contract fixes `mergeFile` as a synchronous function. No other module uses sync I/O.

---

## Why three versions, and why a two-way diff cannot substitute

Read this before writing code. It is the reason the whole spec exists.

| | What it is | Where it lives |
|---|---|---|
| **BASE** | Pristine upstream copy as of the moment the user adopted it | `<managed-dir>/.skilled/base/<id>` |
| **LOCAL** | What is on disk now, including the user's edits | `<managed-dir>/skills/…`, `<managed-dir>/agents/…` |
| **UPSTREAM** | Current state of the remote | fetched on demand |

Updating is `mergeFile(BASE, LOCAL, UPSTREAM)` per file. A two-way `diff LOCAL UPSTREAM` **cannot** replace this: a line present in LOCAL and absent from UPSTREAM is either *the user added it* or *the author deleted it*, and those need opposite outcomes. Only BASE tells them apart. Do not shortcut the merge to a two-way diff, do not hand-roll a merge algorithm, and do not add a merge dependency — `git merge-file` is already installed and already correct.

49 of the user's 51 real files were adopted before `skilled` existed and have no BASE. Task 14 reconstructs one by finding the recent upstream commit whose content best matches LOCAL. That is what makes the tool usable on day one.

---

## File Structure

Files created by this spec, each with one responsibility.

| File | Single responsibility |
|---|---|
| `src/merge.ts` | Three-way merge of one file's text via `git merge-file`. |
| `src/fetch.ts` | Real `GitHubClient` over the GitHub REST API, plus GitHub token resolution. |
| `src/claude.ts` | Real `ClaudeClient` over the `claude` CLI. |
| `src/render/diff.ts` | Line diffing and terminal rendering of diffs and conflict regions. |
| `src/render/update.ts` | Terminal rendering of the three update-review screens and their menus. |
| `src/tree.ts` | Reading a BASE tree from disk and writing files/trees atomically. |
| `src/plan.ts` | Pure computation of a per-file update plan from (BASE, LOCAL, UPSTREAM). |
| `src/reconstruct.ts` | Inferring a missing BASE commit by content similarity. |
| `src/apply.ts` | Committing an approved plan: LOCAL files, then BASE tree, then manifest. |
| `src/update.ts` | The `skilled update` command and its interactive review loop. |
| `tests/helpers/update-fixture.ts` | Temp managed dirs, fake `GitHubClient`, fake `fetch` for this spec's tests. |

Files consumed and never modified: `src/types.ts`, `src/errors.ts`, `src/config.ts`, `src/manifest.ts`, `src/discover.ts`, `src/clients.ts`, `src/render/status.ts`, `src/render/prompt.ts`, `src/status.ts`, `src/detect/**`. `src/cli.ts` receives exactly two added lines in Task 22 and is otherwise untouched.

**Path and shape conventions used throughout:**

- An item's content is a `Map<string, string>` from POSIX-relative path to text. For a single-file item (`LocalItem.files === ['']`) the only key is `''`.
- `basePath(managedDir, id)` is a **file** when the item is single-file, and a **directory** otherwise. `readBase` decides by `fs.stat`.
- `GitHubClient.readTree(source, sha)` returns keys relative to `source.subpath`. When `subpath` names a blob rather than a directory, the map has exactly one entry keyed `''`.

---

### Task 1: Test fixtures and fakes

**Files:**
- Create: `tests/helpers/update-fixture.ts`
- Test: `tests/helpers/update-fixture.test.ts`

**Interfaces:**
- Consumes: `basePath(managedDir: string, id: string): string` and `manifestPath(managedDir: string): string` from `src/config.ts`; `writeManifest(managedDir: string, m: Manifest): Promise<void>` from `src/manifest.ts`; types `Entry`, `Manifest`, `RepoMeta`, `Source` from `src/types.ts`; `GitHubClient` from `src/clients.ts`.
- Produces: `makeManagedDir(): Promise<Fixture>`, `writeItem(dir: string, id: string, files: Record<string, string>): Promise<void>`, `writeBaseTree(dir: string, id: string, files: Record<string, string>): Promise<void>`, `writeEntry(dir: string, entry: Entry): Promise<void>`, `readItemFile(dir: string, id: string, rel: string): Promise<string>`, `pathExists(p: string): Promise<boolean>`, `fakeGitHub(upstreams: Record<string, FakeUpstream>): GitHubClient`, `fakeFetch(routes: FakeRoute[], calls?: string[]): typeof globalThis.fetch`, `failingFetch(message: string): typeof globalThis.fetch`, types `Fixture`, `FakeUpstream`, `FakeRoute`, and `entryFor(id: string, source: Source, commit: string): Entry`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers/update-fixture.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../../src/config.js';
import {
  makeManagedDir,
  writeItem,
  writeBaseTree,
  writeEntry,
  entryFor,
  readItemFile,
  pathExists,
  fakeGitHub,
  fakeFetch,
  type Fixture,
} from './update-fixture.js';
import { readManifest } from '../../src/manifest.js';
import type { Source } from '../../src/types.js';

let fixture: Fixture | null = null;

afterEach(async () => {
  if (fixture) await fixture.cleanup();
  fixture = null;
});

describe('update fixture helpers', () => {
  it('creates a managed dir with skills, agents, base copies and a manifest entry', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;

    await writeItem(dir, 'skills/demo', { 'SKILL.md': '# Demo\n' });
    await writeItem(dir, 'agents/solo.md', { '': '# Solo\n' });
    await writeBaseTree(dir, 'skills/demo', { 'SKILL.md': '# Demo base\n' });
    await writeBaseTree(dir, 'agents/solo.md', { '': '# Solo base\n' });
    await writeEntry(
      dir,
      entryFor('skills/demo', { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' }, 'a'.repeat(40)),
    );

    expect(await readItemFile(dir, 'skills/demo', 'SKILL.md')).toBe('# Demo\n');
    expect(await readItemFile(dir, 'agents/solo.md', '')).toBe('# Solo\n');
    expect(await fs.readFile(path.join(basePath(dir, 'skills/demo'), 'SKILL.md'), 'utf8')).toBe('# Demo base\n');
    expect(await fs.readFile(basePath(dir, 'agents/solo.md'), 'utf8')).toBe('# Solo base\n');
    expect(await pathExists(path.join(dir, 'skills'))).toBe(true);

    const manifest = await readManifest(dir);
    expect(manifest.entries.map((e) => e.id)).toEqual(['skills/demo']);
  });

  it('fakeGitHub answers listCommits, readTree and cuts at sinceSha', async () => {
    const source: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' };
    const github = fakeGitHub({
      'acme/skills#main#skills/demo': {
        commits: [
          { sha: 'b'.repeat(40), date: '2026-08-09T10:00:00Z', message: 'tighten wording' },
          { sha: 'a'.repeat(40), date: '2026-05-12T10:00:00Z', message: 'initial' },
        ],
        trees: {
          ['b'.repeat(40)]: { 'SKILL.md': '# Demo new\n' },
          ['a'.repeat(40)]: { 'SKILL.md': '# Demo base\n' },
        },
      },
    });

    expect(await github.listCommits(source)).toHaveLength(2);
    expect(await github.listCommits(source, 'a'.repeat(40))).toHaveLength(1);
    expect((await github.readTree(source, 'b'.repeat(40))).get('SKILL.md')).toBe('# Demo new\n');
  });

  it('fakeFetch matches routes by substring and records calls', async () => {
    const calls: string[] = [];
    const doFetch = fakeFetch([{ match: '/repos/acme/skills', body: { stargazers_count: 7 } }], calls);
    const res = await doFetch('https://api.github.com/repos/acme/skills');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stargazers_count: 7 });
    expect(calls).toEqual(['https://api.github.com/repos/acme/skills']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/helpers/update-fixture.test.ts`
Expected: FAIL with "Failed to resolve import ./update-fixture.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// tests/helpers/update-fixture.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { basePath } from '../../src/config.js';
import { readManifest, upsertEntry, writeManifest } from '../../src/manifest.js';
import type { GitHubClient } from '../../src/clients.js';
import type { Entry, Manifest, RepoMeta, Source } from '../../src/types.js';

export interface Fixture {
  dir: string;
  cleanup(): Promise<void>;
}

/** A temp managed dir with the two subdirectories that make it qualify as managed. */
export async function makeManagedDir(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(dir, 'agents'), { recursive: true });
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** `''` as a key means the item is a single file: `<dir>/<id>` is the file itself. */
export async function writeItem(dir: string, id: string, files: Record<string, string>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const target = rel === '' ? path.join(dir, id) : path.join(dir, id, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, 'utf8');
  }
}

export async function writeBaseTree(dir: string, id: string, files: Record<string, string>): Promise<void> {
  const root = basePath(dir, id);
  for (const [rel, text] of Object.entries(files)) {
    const target = rel === '' ? root : path.join(root, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, 'utf8');
  }
}

export function entryFor(id: string, source: Source, commit: string): Entry {
  return {
    id,
    source,
    base: { commit, adoptedAt: '2026-05-12', reconstructed: false },
    detection: { method: 'inline-url', confidence: 1, confirmedBy: 'user', evidence: 'named in file' },
  };
}

export async function writeEntry(dir: string, entry: Entry): Promise<void> {
  const current: Manifest = await readManifest(dir);
  await writeManifest(dir, upsertEntry(current, entry));
}

export async function readItemFile(dir: string, id: string, rel: string): Promise<string> {
  const target = rel === '' ? path.join(dir, id) : path.join(dir, id, rel);
  return fs.readFile(target, 'utf8');
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface FakeUpstream {
  /** newest first, exactly as the real client returns them */
  commits: Array<{ sha: string; date: string; message: string }>;
  /** commit sha -> (relpath -> text) */
  trees: Record<string, Record<string, string>>;
  repoMeta?: RepoMeta;
}

/** Keyed `${repo}#${ref}#${subpath}`. */
export function fakeGitHub(upstreams: Record<string, FakeUpstream>): GitHubClient {
  const key = (s: Source): string => `${s.repo}#${s.ref}#${s.subpath}`;
  const pick = (s: Source): FakeUpstream => {
    const found = upstreams[key(s)];
    if (!found) throw new Error(`fakeGitHub: no upstream registered for ${key(s)}`);
    return found;
  };
  return {
    async searchCode() {
      return [];
    },
    async getRepoMeta(_repo) {
      for (const upstream of Object.values(upstreams)) {
        if (upstream.repoMeta !== undefined) return upstream.repoMeta;
      }
      return { createdAt: '2026-02-11', stars: 340, pushedAt: '2026-08-09' };
    },
    async listCommits(source, sinceSha) {
      const upstream = pick(source);
      if (sinceSha === undefined) return upstream.commits;
      const index = upstream.commits.findIndex((c) => c.sha === sinceSha);
      return index === -1 ? upstream.commits : upstream.commits.slice(0, index);
    },
    async readTree(source, sha) {
      const upstream = pick(source);
      const tree = upstream.trees[sha];
      if (!tree) throw new Error(`fakeGitHub: no tree registered for ${key(source)}@${sha}`);
      return new Map(Object.entries(tree));
    },
  };
}

export interface FakeRoute {
  /** first route whose `match` is a substring of the request URL wins */
  match: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function fakeFetch(routes: FakeRoute[], calls?: string[]): typeof globalThis.fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls?.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`fakeFetch: no route matches ${url}`);
    return new Response(route.body === undefined ? '{}' : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...(route.headers ?? {}) },
    });
  };
  return impl as unknown as typeof globalThis.fetch;
}

export function failingFetch(message: string): typeof globalThis.fetch {
  const impl = async (): Promise<Response> => {
    throw new TypeError(message);
  };
  return impl as unknown as typeof globalThis.fetch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/helpers/update-fixture.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/update-fixture.ts tests/helpers/update-fixture.test.ts
git commit -m "test(fixtures): temp managed dirs and fake GitHub/fetch for spec 03"
```

---

### Task 2: `mergeFile` — the clean case

**Files:**
- Create: `src/merge.ts`
- Test: `tests/merge.test.ts`

**Interfaces:**
- Consumes: `MergeOutcome` from `src/types.ts`; `SkilledError` from `src/errors.ts`.
- Produces: `mergeFile(base: string, local: string, upstream: string): MergeOutcome` — synchronous, exactly as the contract fixes it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/merge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeFile } from '../src/merge.js';

const BASE = ['# Demo', '', '## Section A', 'a1', '', '## Section B', 'b1', ''].join('\n');
const LOCAL = ['# Demo', '', '## Section A', 'a1 local', '', '## Section B', 'b1', ''].join('\n');
const UPSTREAM = ['# Demo', '', '## Section A', 'a1', '', '## Section B', 'b1 upstream', ''].join('\n');

describe('mergeFile', () => {
  it('combines non-overlapping local and upstream changes without conflict', () => {
    const outcome = mergeFile(BASE, LOCAL, UPSTREAM);
    expect(outcome.kind).toBe('clean');
    expect(outcome.content).toBe(
      ['# Demo', '', '## Section A', 'a1 local', '', '## Section B', 'b1 upstream', ''].join('\n'),
    );
  });

  it('returns local unchanged when upstream is identical to base', () => {
    const outcome = mergeFile(BASE, LOCAL, BASE);
    expect(outcome.kind).toBe('clean');
    expect(outcome.content).toBe(LOCAL);
  });

  it('returns upstream when local is identical to base', () => {
    const outcome = mergeFile(BASE, BASE, UPSTREAM);
    expect(outcome.kind).toBe('clean');
    expect(outcome.content).toBe(UPSTREAM);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/merge.test.ts`
Expected: FAIL with "Failed to resolve import ../src/merge.js"

- [ ] **Step 3: Write minimal implementation**

`git merge-file` argv, fixed: `git merge-file -p -q -L <local-label> -L <base-label> -L <upstream-label> <local-file> <base-file> <upstream-file>`. The **first** file is "ours" (LOCAL), the **second** is the merge base, the **third** is "theirs" (UPSTREAM). `-p` writes the merged result to stdout and leaves all three files untouched. `-q` suppresses git's own conflict warnings. Exit status is the **number of conflicts** (0 = clean, truncated to 127), and negative — i.e. > 127 as a process status — on internal error.

```ts
// src/merge.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SkilledError } from './errors.js';
import type { MergeOutcome } from './types.js';

const CONFLICT_START = '<<<<<<<';
const LOCAL_LABEL = 'LOCAL (your copy)';
const BASE_LABEL = 'BASE (adopted)';
const UPSTREAM_LABEL = 'UPSTREAM';

/**
 * Three-way merge of one file's text. Synchronous because the contract fixes it
 * that way; this is the only module in src/ that uses sync I/O.
 */
export function mergeFile(base: string, local: string, upstream: string): MergeOutcome {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'skilled-merge-'));
  try {
    const baseFile = path.join(workDir, 'base');
    const localFile = path.join(workDir, 'local');
    const upstreamFile = path.join(workDir, 'upstream');
    writeFileSync(baseFile, base, 'utf8');
    writeFileSync(localFile, local, 'utf8');
    writeFileSync(upstreamFile, upstream, 'utf8');

    const result = spawnSync(
      'git',
      [
        'merge-file',
        '-p',
        '-q',
        '-L',
        LOCAL_LABEL,
        '-L',
        BASE_LABEL,
        '-L',
        UPSTREAM_LABEL,
        localFile,
        baseFile,
        upstreamFile,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    if (result.error !== undefined || result.status === null || result.status > 127) {
      throw new SkilledError({
        code: 'MERGE_CONFLICT',
        problem: 'Cannot run the three-way merge.',
        cause:
          `\`git merge-file\` ${
            result.error !== undefined
              ? `could not start (${result.error.message})`
              : `exited with status ${String(result.status)}`
          }. skilled merges with git and does not ship its own merge engine.\n` +
          'No managed file was modified.',
        fixes: [
          'git --version              confirm git is installed and on PATH',
          'skilled update             retry once git is available',
        ],
        exitCode: 3,
      });
    }

    const content = result.stdout ?? '';
    if (result.status === 0) return { kind: 'clean', content };

    const markers = content.split('\n').filter((line) => line.startsWith(CONFLICT_START)).length;
    return { kind: 'conflict', content, conflictCount: markers > 0 ? markers : result.status };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/merge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/merge.ts tests/merge.test.ts
git commit -m "feat(merge): three-way merge via git merge-file"
```

---

### Task 3: `mergeFile` — conflicts and conflict counting

**Files:**
- Modify: `src/merge.ts` (no code change expected; this task proves the conflict branch)
- Test: `tests/merge.test.ts`

**Interfaces:**
- Consumes: `mergeFile` from Task 2.
- Produces: verified `{ kind: 'conflict'; content: string; conflictCount: number }` behaviour, including the exact marker labels other modules parse.

- [ ] **Step 1: Write the failing test**

Append to `tests/merge.test.ts`:

```ts
describe('mergeFile conflicts', () => {
  const base = ['# Demo', '', '## Notes', 'be careful', ''].join('\n');
  const local = ['# Demo', '', '## Notes', 'be careful, always', ''].join('\n');
  const upstream = ['# Demo', '', '## Notes', 'be very careful', ''].join('\n');

  it('reports one conflict when both sides rewrite the same line', () => {
    const outcome = mergeFile(base, local, upstream);
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') throw new Error('expected a conflict');
    expect(outcome.conflictCount).toBe(1);
    expect(outcome.content).toContain('<<<<<<< LOCAL (your copy)');
    expect(outcome.content).toContain('be careful, always');
    expect(outcome.content).toContain('=======');
    expect(outcome.content).toContain('be very careful');
    expect(outcome.content).toContain('>>>>>>> UPSTREAM');
  });

  it('counts each conflicted region separately', () => {
    const wideBase = ['one', '', 'x1', '', 'two', '', 'x2', '', 'three', ''].join('\n');
    const wideLocal = ['one', '', 'mine1', '', 'two', '', 'mine2', '', 'three', ''].join('\n');
    const wideUpstream = ['one', '', 'theirs1', '', 'two', '', 'theirs2', '', 'three', ''].join('\n');
    const outcome = mergeFile(wideBase, wideLocal, wideUpstream);
    expect(outcome.kind).toBe('conflict');
    if (outcome.kind !== 'conflict') throw new Error('expected a conflict');
    expect(outcome.conflictCount).toBe(2);
  });

  it('treats two independent additions to an empty base as a merge, not a crash', () => {
    const outcome = mergeFile('', 'only mine\n', 'only mine\n');
    expect(outcome.kind).toBe('clean');
    expect(outcome.content).toBe('only mine\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/merge.test.ts -t 'reports one conflict'`
Expected: PASS if Task 2's implementation is correct. If it FAILS, the marker labels or the status handling are wrong — fix `src/merge.ts` until it passes; do not change the test's expected labels, because `src/render/diff.ts` and `src/update.ts` parse them.

- [ ] **Step 3: Write minimal implementation**

No new code if Task 2 passes. If `conflictCount` came back as `0` for a conflicted merge, the marker count fell through to `result.status`; verify this exact block is present in `src/merge.ts`:

```ts
    const markers = content.split('\n').filter((line) => line.startsWith(CONFLICT_START)).length;
    return { kind: 'conflict', content, conflictCount: markers > 0 ? markers : result.status };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/merge.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/merge.test.ts
git commit -m "test(merge): pin conflict markers and conflict counting"
```

---

### Task 4: Line diffing core

**Files:**
- Create: `src/render/diff.ts`
- Test: `tests/render/diff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `splitLines(text: string): string[]`, `diffLines(before: string, after: string): DiffOp[]`, `diffStat(before: string, after: string): DiffStat`, types `DiffOpKind = 'equal' | 'add' | 'del'`, `DiffOp { kind: DiffOpKind; line: string }`, `DiffStat { added: number; removed: number }`, and the colour helpers `ANSI` and `paint(s: string, code: string, color: boolean): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffLines, diffStat, splitLines } from '../../src/render/diff.js';

describe('splitLines', () => {
  it('drops a single trailing newline and returns [] for empty text', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
  });
});

describe('diffLines', () => {
  it('marks a replaced line as one deletion and one addition', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'equal', line: 'a' },
      { kind: 'del', line: 'b' },
      { kind: 'add', line: 'B' },
      { kind: 'equal', line: 'c' },
    ]);
  });

  it('reports every line as equal when the texts match', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([
      { kind: 'equal', line: 'a' },
      { kind: 'equal', line: 'b' },
    ]);
  });

  it('keeps unchanged surroundings when a line is inserted', () => {
    expect(diffLines('a\nc\n', 'a\nb\nc\n')).toEqual([
      { kind: 'equal', line: 'a' },
      { kind: 'add', line: 'b' },
      { kind: 'equal', line: 'c' },
    ]);
  });
});

describe('diffStat', () => {
  it('counts additions and removals', () => {
    expect(diffStat('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 });
    expect(diffStat('a\n', 'a\nb\nc\n')).toEqual({ added: 2, removed: 0 });
    expect(diffStat('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/diff.test.ts`
Expected: FAIL with "Failed to resolve import ../../src/render/diff.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/diff.ts

export type DiffOpKind = 'equal' | 'add' | 'del';
export interface DiffOp {
  kind: DiffOpKind;
  line: string;
}
export interface DiffStat {
  added: number;
  removed: number;
}
export interface RenderDiffOptions {
  color?: boolean;
  context?: number;
}

/**
 * Above this many DP cells the LCS is skipped and the changed span is rendered
 * as a wholesale delete-then-add. Keeps the table under ~16 MB.
 */
const MAX_DP_CELLS = 4_000_000;

/** ESC built from its code point so no invisible control byte lives in source. */
const ESC = String.fromCharCode(27);

export const ANSI = {
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
  dim: `${ESC}[2m`,
  reset: `${ESC}[0m`,
} as const;

export function paint(s: string, code: string, color: boolean): string {
  return color ? `${code}${s}${ANSI.reset}` : s;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'equal', line: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if ((midA.length + 1) * (midB.length + 1) > MAX_DP_CELLS) {
    for (const line of midA) ops.push({ kind: 'del', line });
    for (const line of midB) ops.push({ kind: 'add', line });
  } else {
    for (const op of lcsDiff(midA, midB)) ops.push(op);
  }

  for (let i = endA; i < a.length; i++) ops.push({ kind: 'equal', line: a[i] });
  return ops;
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', line: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ kind: 'del', line: a[i] });
      i++;
    } else {
      ops.push({ kind: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', line: a[i] });
    i++;
  }
  while (j < m) {
    ops.push({ kind: 'add', line: b[j] });
    j++;
  }
  return ops;
}

export function diffStat(before: string, after: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(before, after)) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'del') removed++;
  }
  return { added, removed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/diff.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/render/diff.ts tests/render/diff.test.ts
git commit -m "feat(render): LCS line diff and diff stats"
```

---

### Task 5: Unified diff rendering

**Files:**
- Modify: `src/render/diff.ts`
- Test: `tests/render/diff.test.ts`

**Interfaces:**
- Consumes: `diffLines`, `paint`, `ANSI`, `RenderDiffOptions` from Task 4.
- Produces: `renderUnifiedDiff(relPath: string, before: string, after: string, opts?: RenderDiffOptions): string` — returns `''` when the texts are identical.

- [ ] **Step 1: Write the failing test**

Append to `tests/render/diff.test.ts`. **The two colour assertions in the last test below contain literal ESC (U+001B) bytes that will not survive copy-paste — write them as `` expect(out).toContain(`${ANSI.red}-a${ANSI.reset}`) `` and `` expect(out).toContain(`${ANSI.green}+b${ANSI.reset}`) `` instead.**

```ts
import { ANSI, renderUnifiedDiff } from '../../src/render/diff.js';

describe('renderUnifiedDiff', () => {
  it('renders a unified hunk with line numbers and no colour by default', () => {
    const out = renderUnifiedDiff('SKILL.md', 'a\nb\nc\n', 'a\nB\nc\n');
    expect(out).toBe(
      [
        '--- SKILL.md  (your copy)',
        '+++ SKILL.md  (upstream)',
        '@@ -1,3 +1,3 @@',
        ' a',
        '-b',
        '+B',
        ' c',
      ].join('\n'),
    );
  });

  it('returns an empty string when nothing changed', () => {
    expect(renderUnifiedDiff('SKILL.md', 'a\nb\n', 'a\nb\n')).toBe('');
  });

  it('labels a single-file item whose relative path is empty', () => {
    const out = renderUnifiedDiff('', 'a\n', 'b\n');
    expect(out.startsWith('--- (this file)  (your copy)')).toBe(true);
  });

  it('splits distant changes into separate hunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const after = before.replace('line 1\n', 'LINE 1\n').replace('line 18\n', 'LINE 18\n');
    const out = renderUnifiedDiff('SKILL.md', before, after);
    expect(out.split('\n').filter((l) => l.startsWith('@@'))).toHaveLength(2);
  });

  it('wraps added and removed lines in colour when asked', () => {
    const out = renderUnifiedDiff('SKILL.md', 'a\n', 'b\n', { color: true });
    expect(out).toContain('[31m-a[0m');
    expect(out).toContain('[32m+b[0m');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/diff.test.ts -t 'renders a unified hunk'`
Expected: FAIL with "renderUnifiedDiff is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `src/render/diff.ts`:

```ts
interface DiffRow {
  op: DiffOp;
  a: number;
  b: number;
}

export function renderUnifiedDiff(
  relPath: string,
  before: string,
  after: string,
  opts: RenderDiffOptions = {},
): string {
  const context = opts.context ?? 3;
  const color = opts.color ?? false;
  const ops = diffLines(before, after);
  if (!ops.some((op) => op.kind !== 'equal')) return '';

  const rows: DiffRow[] = [];
  let a = 1;
  let b = 1;
  for (const op of ops) {
    rows.push({ op, a, b });
    if (op.kind !== 'add') a++;
    if (op.kind !== 'del') b++;
  }

  const keep = rows.map(() => false);
  rows.forEach((row, index) => {
    if (row.op.kind === 'equal') return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  });

  const label = relPath === '' ? '(this file)' : relPath;
  const out: string[] = [
    paint(`--- ${label}  (your copy)`, ANSI.dim, color),
    paint(`+++ ${label}  (upstream)`, ANSI.dim, color),
  ];

  let i = 0;
  while (i < rows.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && keep[j]) j++;
    const hunk = rows.slice(i, j);

    let aCount = 0;
    let bCount = 0;
    for (const row of hunk) {
      if (row.op.kind !== 'add') aCount++;
      if (row.op.kind !== 'del') bCount++;
    }
    const aFirst = hunk.find((row) => row.op.kind !== 'add');
    const bFirst = hunk.find((row) => row.op.kind !== 'del');
    const aStart = aCount === 0 || aFirst === undefined ? 0 : aFirst.a;
    const bStart = bCount === 0 || bFirst === undefined ? 0 : bFirst.b;
    out.push(paint(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`, ANSI.cyan, color));

    for (const row of hunk) {
      if (row.op.kind === 'equal') out.push(` ${row.op.line}`);
      else if (row.op.kind === 'del') out.push(paint(`-${row.op.line}`, ANSI.red, color));
      else out.push(paint(`+${row.op.line}`, ANSI.green, color));
    }
    i = j;
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/diff.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/render/diff.ts tests/render/diff.test.ts
git commit -m "feat(render): unified diff output with hunk headers"
```

---

### Task 6: Conflict marker detection and conflict-region rendering

**Files:**
- Modify: `src/render/diff.ts`
- Test: `tests/render/diff.test.ts`

**Interfaces:**
- Consumes: `splitLines`, `paint`, `ANSI`, `RenderDiffOptions` from Task 4.
- Produces: `hasConflictMarkers(content: string): boolean`, `renderConflictRegions(content: string, opts?: RenderDiffOptions): string`. Both understand the exact labels emitted by `mergeFile` in Task 2.

- [ ] **Step 1: Write the failing test**

Append to `tests/render/diff.test.ts`. **The colour assertion in the last test below contains literal ESC (U+001B) bytes that will not survive copy-paste — write it as `` expect(out).toContain(`${ANSI.red}<<<<<<< LOCAL (your copy)${ANSI.reset}`) `` instead.**

```ts
import { hasConflictMarkers, renderConflictRegions } from '../../src/render/diff.js';

const CONFLICTED = [
  '# Demo',
  '',
  '## Notes',
  '<<<<<<< LOCAL (your copy)',
  'be careful, always',
  '=======',
  'be very careful',
  '>>>>>>> UPSTREAM',
  '',
  '## Tail',
  '',
].join('\n');

describe('hasConflictMarkers', () => {
  it('detects git merge-file markers', () => {
    expect(hasConflictMarkers(CONFLICTED)).toBe(true);
  });

  it('is false for ordinary text, including markdown heading underlines', () => {
    expect(hasConflictMarkers('# Demo\n\nTitle\n=======\n')).toBe(false);
  });
});

describe('renderConflictRegions', () => {
  it('shows the conflicted block with surrounding context', () => {
    const out = renderConflictRegions(CONFLICTED, { context: 1 });
    expect(out).toBe(
      [
        '## Notes',
        '<<<<<<< LOCAL (your copy)',
        'be careful, always',
        '=======',
        'be very careful',
        '>>>>>>> UPSTREAM',
        '',
      ].join('\n'),
    );
  });

  it('separates two distant conflicts with an ellipsis', () => {
    const filler = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const twice = [CONFLICTED, filler, CONFLICTED].join('\n');
    const out = renderConflictRegions(twice, { context: 1 });
    expect(out.split('\n').filter((l) => l === '  …')).toHaveLength(1);
  });

  it('colours the marker lines when asked', () => {
    const out = renderConflictRegions(CONFLICTED, { context: 0, color: true });
    expect(out).toContain('[31m<<<<<<< LOCAL (your copy)[0m');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/diff.test.ts -t 'detects git merge-file markers'`
Expected: FAIL with "hasConflictMarkers is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `src/render/diff.ts`:

```ts
const MARKER_LOCAL = '<<<<<<<';
const MARKER_BASE = '|||||||';
const MARKER_SPLIT = '=======';
const MARKER_UPSTREAM = '>>>>>>>';

export function hasConflictMarkers(content: string): boolean {
  return splitLines(content).some(
    (line) => line.startsWith(MARKER_LOCAL) || line.startsWith(MARKER_UPSTREAM),
  );
}

/** Prints only the conflicted regions, with `context` lines around each. */
export function renderConflictRegions(content: string, opts: RenderDiffOptions = {}): string {
  const color = opts.color ?? false;
  const context = opts.context ?? 2;
  const lines = splitLines(content);

  const inside = lines.map(() => false);
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(MARKER_LOCAL)) open = true;
    if (open) inside[i] = true;
    if (lines[i].startsWith(MARKER_UPSTREAM)) open = false;
  }
  if (!inside.some(Boolean)) return '';

  const keep = inside.slice();
  for (let i = 0; i < lines.length; i++) {
    if (!inside[i]) continue;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  }

  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < lines.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    if (!first) out.push('  …');
    first = false;
    while (i < lines.length && keep[i]) {
      const line = lines[i];
      const isMarker =
        inside[i] &&
        (line.startsWith(MARKER_LOCAL) ||
          line.startsWith(MARKER_BASE) ||
          line.startsWith(MARKER_SPLIT) ||
          line.startsWith(MARKER_UPSTREAM));
      out.push(isMarker ? paint(line, ANSI.red, color) : line);
      i++;
    }
  }
  return out.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/diff.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add src/render/diff.ts tests/render/diff.test.ts
git commit -m "feat(render): conflict marker detection and region rendering"
```

---

### Task 7: GitHub request layer, error catalogue, and `getRepoMeta`

**Files:**
- Create: `src/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Consumes: `GitHubClient` from `src/clients.ts`; `RepoMeta`, `Source` from `src/types.ts`; `SkilledError` from `src/errors.ts`.
- Produces: `createGitHubClient(token: string | null, deps?: Partial<FetchDeps>): GitHubClient` (contract signature preserved — the second parameter is optional and exists only so tests can inject a fake `fetch`), `FetchDeps { fetch: typeof globalThis.fetch }`, and a working `getRepoMeta`. The internal `ghRequest` maps every HTTP outcome onto the error catalogue: 404 → `UPSTREAM_GONE`, rate-limited 403/429 → `RATE_LIMIT`, 401/403 → `NO_AUTH`, anything else → `NETWORK`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/fetch.test.ts
import { describe, it, expect } from 'vitest';
import { createGitHubClient } from '../src/fetch.js';
import { SkilledError } from '../src/errors.js';

const REPO_BODY = {
  created_at: '2026-02-11T00:00:00Z',
  stargazers_count: 340,
  pushed_at: '2026-08-09T12:00:00Z',
};

interface SeenRequest {
  url: string;
  headers: Record<string, string>;
}

function respondWith(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
  seen?: SeenRequest[],
): typeof globalThis.fetch {
  const impl = async (input: unknown, requestInit?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    seen?.push({
      url,
      headers: Object.fromEntries(new Headers(requestInit?.headers).entries()),
    });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  };
  return impl as unknown as typeof globalThis.fetch;
}

async function caught(promise: Promise<unknown>): Promise<SkilledError> {
  let error: unknown;
  try {
    await promise;
  } catch (thrown) {
    error = thrown;
  }
  if (error instanceof SkilledError) return error;
  throw new Error(`expected a SkilledError, got ${String(error)}`);
}

describe('createGitHubClient.getRepoMeta', () => {
  it('maps the REST payload onto RepoMeta with date-only fields', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith(REPO_BODY) });
    expect(await client.getRepoMeta('acme/skills')).toEqual({
      createdAt: '2026-02-11',
      stars: 340,
      pushedAt: '2026-08-09',
    });
  });

  it('sends the api version, user agent and bearer token', async () => {
    const seen: SeenRequest[] = [];
    const client = createGitHubClient('tok', { fetch: respondWith(REPO_BODY, {}, seen) });
    await client.getRepoMeta('acme/skills');
    expect(seen[0].url).toBe('https://api.github.com/repos/acme/skills');
    expect(seen[0].headers.authorization).toBe('Bearer tok');
    expect(seen[0].headers['x-github-api-version']).toBe('2022-11-28');
    expect(seen[0].headers['user-agent']).toBe('skilled');
  });

  it('omits the authorization header when there is no token', async () => {
    const seen: SeenRequest[] = [];
    const client = createGitHubClient(null, { fetch: respondWith(REPO_BODY, {}, seen) });
    await client.getRepoMeta('acme/skills');
    expect(seen[0].headers.authorization).toBeUndefined();
  });
});

describe('createGitHubClient error mapping', () => {
  it('turns 404 into UPSTREAM_GONE and says the local file is untouched', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith({}, { status: 404 }) });
    const error = await caught(client.getRepoMeta('acme/gone'));
    expect(error.code).toBe('UPSTREAM_GONE');
    expect(error.exitCode).toBe(3);
    expect(error.problem).toContain('github.com/acme/gone');
    expect(error.problem).toContain('404');
    expect(error.cause).toContain('no longer exists');
    expect(error.cause).toContain('Your file is untouched');
    expect(error.fixes.join('\n')).toContain('skilled remove');
  });

  it('turns a rate-limited 403 into RATE_LIMIT with seconds and a progress promise', async () => {
    const client = createGitHubClient('tok', {
      fetch: respondWith({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '47' } }),
    });
    const error = await caught(client.getRepoMeta('acme/skills'));
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.exitCode).toBe(3);
    expect(error.cause).toContain('47s');
    expect(error.cause).toContain('progress is saved');
    expect(error.fixes.join('\n')).toContain('gh auth login');
  });

  it('derives the wait from x-ratelimit-reset when there is no retry-after', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 30);
    const client = createGitHubClient('tok', {
      fetch: respondWith({}, { status: 429, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }),
    });
    const error = await caught(client.getRepoMeta('acme/skills'));
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.cause).toMatch(/in (29|30)s/);
  });

  it('turns 401 into NO_AUTH', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith({}, { status: 401 }) });
    const error = await caught(client.getRepoMeta('acme/skills'));
    expect(error.code).toBe('NO_AUTH');
    expect(error.exitCode).toBe(3);
    expect(error.cause).toContain('No managed file was modified.');
  });

  it('turns any other status into NETWORK', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith({}, { status: 500 }) });
    const error = await caught(client.getRepoMeta('acme/skills'));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toContain('500');
  });

  it('turns a thrown fetch into NETWORK', async () => {
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const client = createGitHubClient('tok', { fetch: boom });
    const error = await caught(client.getRepoMeta('acme/skills'));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toContain('fetch failed');
    expect(error.cause).toContain('No managed file was modified.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch.test.ts`
Expected: FAIL with "Failed to resolve import ../src/fetch.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/fetch.ts
import { SkilledError } from './errors.js';
import type { GitHubClient } from './clients.js';
import type { RepoMeta, Source } from './types.js';

const API = 'https://api.github.com';

export interface FetchDeps {
  fetch: typeof globalThis.fetch;
}

interface GhRequest {
  path: string;
  token: string | null;
  doFetch: typeof globalThis.fetch;
  /** printed in the problem line, e.g. "github.com/acme/skills" */
  subject: string;
}

async function ghRequest<T>(request: GhRequest): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'skilled',
  };
  if (request.token !== null) headers.authorization = `Bearer ${request.token}`;

  let response: Response;
  try {
    response = await request.doFetch(`${API}${request.path}`, { headers });
  } catch (thrown) {
    throw new SkilledError({
      code: 'NETWORK',
      problem: `Can't reach api.github.com.`,
      cause:
        `The request for ${request.subject} failed before a response arrived: ` +
        `${thrown instanceof Error ? thrown.message : String(thrown)}\n` +
        'No managed file was modified.',
      fixes: [
        'Check your connection, then run `skilled update` again.',
        'skilled                    read the last cached scan instead of the network',
      ],
      exitCode: 3,
    });
  }

  if (response.ok) return (await response.json()) as T;
  throw httpError(response, request);
}

function httpError(response: Response, request: GhRequest): SkilledError {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const retryAfter = response.headers.get('retry-after');

  if (response.status === 404) {
    return new SkilledError({
      code: 'UPSTREAM_GONE',
      problem: `Can't reach ${request.subject} (404).`,
      cause:
        `The repository or path no longer exists, or it went private. The request was GET ${request.path}.\n` +
        'Your file is untouched — nothing was changed.',
      fixes: [
        'skilled <name>                       see how this source was identified',
        'skilled remove <name>                stop tracking it',
        'skilled add <new-url> <name>         point it somewhere new',
      ],
      exitCode: 3,
    });
  }

  if ((response.status === 403 || response.status === 429) && (remaining === '0' || retryAfter !== null)) {
    const seconds = secondsUntilReset(reset, retryAfter);
    return new SkilledError({
      code: 'RATE_LIMIT',
      problem: 'GitHub rate limit reached.',
      cause:
        `${request.subject} answered ${response.status} for GET ${request.path}. The limit resets in ${seconds}s.\n` +
        'Everything already applied stays applied — progress is saved, and no file was left half-written.',
      fixes: [
        `Wait ${seconds}s, then run \`skilled update\` again — it resumes where it stopped.`,
        'gh auth login                        raises the limit from 60/hr to 5000/hr',
      ],
      exitCode: 3,
    });
  }

  if (response.status === 401 || response.status === 403) {
    return new SkilledError({
      code: 'NO_AUTH',
      problem: 'GitHub refused the request as unauthenticated.',
      cause:
        `${request.subject} answered ${response.status} for GET ${request.path}. skilled borrows a token from the gh CLI, and either found none or the one it found is not valid.\n` +
        'No managed file was modified.',
      fixes: [
        'gh auth login                        authenticate once; skilled borrows the token',
        'export GITHUB_TOKEN=<token>          or supply a token directly',
      ],
      exitCode: 3,
    });
  }

  return new SkilledError({
    code: 'NETWORK',
    problem: `GitHub answered ${response.status} for ${request.subject}.`,
    cause:
      `GET ${request.path} returned ${response.status} ${response.statusText}, which skilled does not know how to interpret.\n` +
      'No managed file was modified.',
    fixes: [
      'Run `skilled update` again — GitHub 5xx responses are usually transient.',
      'https://www.githubstatus.com         check whether GitHub is degraded',
    ],
    exitCode: 3,
  });
}

function secondsUntilReset(reset: string | null, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  if (reset !== null) {
    const epoch = Number(reset);
    if (Number.isFinite(epoch)) return Math.max(0, Math.round(epoch - Date.now() / 1000));
  }
  return 60;
}

export function createGitHubClient(token: string | null, deps: Partial<FetchDeps> = {}): GitHubClient {
  const doFetch = deps.fetch ?? globalThis.fetch;

  return {
    async searchCode(): Promise<Array<{ repo: string; path: string }>> {
      return [];
    },

    async getRepoMeta(repo: string): Promise<RepoMeta> {
      const body = await ghRequest<{
        created_at: string;
        stargazers_count: number;
        pushed_at: string;
      }>({ path: `/repos/${repo}`, token, doFetch, subject: `github.com/${repo}` });
      return {
        createdAt: body.created_at.slice(0, 10),
        stars: body.stargazers_count,
        pushedAt: body.pushed_at.slice(0, 10),
      };
    },

    async listCommits(): Promise<Array<{ sha: string; date: string; message: string }>> {
      return [];
    },

    async readTree(): Promise<Map<string, string>> {
      return new Map();
    },
  };
}
```

`searchCode`, `listCommits` and `readTree` are stubs here so the module type-checks against `GitHubClient`; Tasks 8, 9 and 10 replace each one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts tests/fetch.test.ts
git commit -m "feat(fetch): GitHub request layer with the full error catalogue"
```

---

### Task 8: `searchCode`

**Files:**
- Modify: `src/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Consumes: `ghRequest`, `createGitHubClient` from Task 7.
- Produces: `GitHubClient.searchCode(query: string): Promise<Array<{ repo: string; path: string }>>`, which raises `NO_AUTH` when the client has no token because GitHub refuses unauthenticated code search.

- [ ] **Step 1: Write the failing test**

Append to `tests/fetch.test.ts`:

```ts
describe('createGitHubClient.searchCode', () => {
  it('maps items to repo/path pairs and url-encodes the query', async () => {
    const seen: SeenRequest[] = [];
    const client = createGitHubClient(
      'tok',
      {
        fetch: respondWith(
          {
            items: [
              { path: 'skills/cso/SKILL.md', repository: { full_name: 'acme/skills' } },
              { path: 'agents/ponytail.md', repository: { full_name: 'other/agents' } },
            ],
          },
          {},
          seen,
        ),
      },
    );
    expect(await client.searchCode('"a rare phrase" in:file')).toEqual([
      { repo: 'acme/skills', path: 'skills/cso/SKILL.md' },
      { repo: 'other/agents', path: 'agents/ponytail.md' },
    ]);
    expect(seen[0].url).toContain('/search/code?per_page=30&q=');
    expect(seen[0].url).toContain('%22a%20rare%20phrase%22%20in%3Afile');
  });

  it('returns an empty list when GitHub reports no items', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith({}) });
    expect(await client.searchCode('nothing')).toEqual([]);
  });

  it('raises NO_AUTH without a token instead of calling the API', async () => {
    let called = false;
    const never = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof globalThis.fetch;
    const client = createGitHubClient(null, { fetch: never });
    const error = await caught(client.searchCode('anything'));
    expect(error.code).toBe('NO_AUTH');
    expect(error.exitCode).toBe(3);
    expect(error.cause).toContain('code search');
    expect(error.fixes.join('\n')).toContain('gh auth login');
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch.test.ts -t 'maps items to repo/path pairs'`
Expected: FAIL — received `[]` instead of the two pairs

- [ ] **Step 3: Write minimal implementation**

Replace the `searchCode` stub in `src/fetch.ts` with:

```ts
    async searchCode(query: string): Promise<Array<{ repo: string; path: string }>> {
      if (token === null) {
        throw new SkilledError({
          code: 'NO_AUTH',
          problem: 'GitHub code search needs a token.',
          cause:
            'GitHub does not allow unauthenticated code search, and no token was found from GITHUB_TOKEN, GH_TOKEN or `gh auth token`.\n' +
            'No managed file was modified.',
          fixes: [
            'gh auth login                        authenticate once; skilled borrows the token',
            'export GITHUB_TOKEN=<token>          or supply a token directly',
            'skilled                              detection still runs with the offline strategies',
          ],
          exitCode: 3,
        });
      }
      const body = await ghRequest<{
        items?: Array<{ path: string; repository: { full_name: string } }>;
      }>({
        path: `/search/code?per_page=30&q=${encodeURIComponent(query)}`,
        token,
        doFetch,
        subject: 'github.com code search',
      });
      return (body.items ?? []).map((item) => ({ repo: item.repository.full_name, path: item.path }));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts tests/fetch.test.ts
git commit -m "feat(fetch): authenticated code search"
```

---

### Task 9: `listCommits`

**Files:**
- Modify: `src/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Consumes: `ghRequest` from Task 7; `Source` from `src/types.ts`.
- Produces: `GitHubClient.listCommits(source: Source, sinceSha?: string): Promise<Array<{ sha: string; date: string; message: string }>>` — **newest first**, at most 100 entries, filtered to `source.subpath` when it is not `''`. With `sinceSha`, returns only the commits newer than it; when `sinceSha` is not in the page, returns the whole page. Every other module in this spec relies on the newest-first order.

- [ ] **Step 1: Write the failing test**

Append to `tests/fetch.test.ts`:

```ts
import type { Source } from '../src/types.js';

const COMMITS_BODY = [
  {
    sha: 'b'.repeat(40),
    commit: { committer: { date: '2026-08-09T10:00:00Z' }, author: { date: '2026-08-08T10:00:00Z' }, message: 'tighten wording' },
  },
  {
    sha: 'a'.repeat(40),
    commit: { committer: { date: '2026-05-12T10:00:00Z' }, author: { date: '2026-05-12T10:00:00Z' }, message: 'initial' },
  },
];

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/cso' };

describe('createGitHubClient.listCommits', () => {
  it('returns newest-first commits with the committer date and asks for the subpath', async () => {
    const seen: SeenRequest[] = [];
    const client = createGitHubClient('tok', { fetch: respondWith(COMMITS_BODY, {}, seen) });
    expect(await client.listCommits(SOURCE)).toEqual([
      { sha: 'b'.repeat(40), date: '2026-08-09T10:00:00Z', message: 'tighten wording' },
      { sha: 'a'.repeat(40), date: '2026-05-12T10:00:00Z', message: 'initial' },
    ]);
    expect(seen[0].url).toContain('/repos/acme/skills/commits?');
    expect(seen[0].url).toContain('sha=main');
    expect(seen[0].url).toContain('per_page=100');
    expect(seen[0].url).toContain('path=skills%2Fcso');
  });

  it('omits the path parameter for a repo-root source', async () => {
    const seen: SeenRequest[] = [];
    const client = createGitHubClient('tok', { fetch: respondWith(COMMITS_BODY, {}, seen) });
    await client.listCommits({ ...SOURCE, subpath: '' });
    expect(seen[0].url).not.toContain('path=');
  });

  it('returns only the commits newer than sinceSha', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith(COMMITS_BODY) });
    expect(await client.listCommits(SOURCE, 'a'.repeat(40))).toEqual([
      { sha: 'b'.repeat(40), date: '2026-08-09T10:00:00Z', message: 'tighten wording' },
    ]);
    expect(await client.listCommits(SOURCE, 'b'.repeat(40))).toEqual([]);
  });

  it('returns the whole page when sinceSha is not in it', async () => {
    const client = createGitHubClient('tok', { fetch: respondWith(COMMITS_BODY) });
    expect(await client.listCommits(SOURCE, 'c'.repeat(40))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch.test.ts -t 'returns newest-first commits'`
Expected: FAIL — received `[]` instead of the two commits

- [ ] **Step 3: Write minimal implementation**

Replace the `listCommits` stub in `src/fetch.ts` with:

```ts
    async listCommits(
      source: Source,
      sinceSha?: string,
    ): Promise<Array<{ sha: string; date: string; message: string }>> {
      const params = new URLSearchParams({ sha: source.ref, per_page: '100' });
      if (source.subpath !== '') params.set('path', source.subpath);
      const body = await ghRequest<
        Array<{
          sha: string;
          commit: {
            committer: { date: string } | null;
            author: { date: string } | null;
            message: string;
          };
        }>
      >({
        path: `/repos/${source.repo}/commits?${params.toString()}`,
        token,
        doFetch,
        subject: `github.com/${source.repo}`,
      });

      const commits = body.map((entry) => ({
        sha: entry.sha,
        date: entry.commit.committer?.date ?? entry.commit.author?.date ?? '',
        message: entry.commit.message,
      }));
      if (sinceSha === undefined) return commits;
      const index = commits.findIndex((commit) => commit.sha === sinceSha);
      return index === -1 ? commits : commits.slice(0, index);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts tests/fetch.test.ts
git commit -m "feat(fetch): commit history for a source subpath"
```

---

### Task 10: `readTree` — subpath extraction

**Files:**
- Modify: `src/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Consumes: `ghRequest` from Task 7; `fakeFetch` from `tests/helpers/update-fixture.ts`.
- Produces: `GitHubClient.readTree(source: Source, sha: string): Promise<Map<string, string>>`. Keys are POSIX paths **relative to `source.subpath`**; when `subpath` names a blob the single key is `''`; when `subpath` is `''` the keys are the repo-root-relative paths. Binary blobs are skipped. A truncated tree raises `NETWORK` rather than silently returning a partial item.

- [ ] **Step 1: Write the failing test**

Append to `tests/fetch.test.ts`:

```ts
import { fakeFetch } from './helpers/update-fixture.js';

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

const TREE_BODY = {
  truncated: false,
  tree: [
    { path: 'skills/cso', type: 'tree', sha: 'tree1' },
    { path: 'skills/cso/SKILL.md', type: 'blob', sha: 'blob1' },
    { path: 'skills/cso/references', type: 'tree', sha: 'tree2' },
    { path: 'skills/cso/references/tone.md', type: 'blob', sha: 'blob2' },
    { path: 'skills/other/SKILL.md', type: 'blob', sha: 'blob3' },
    { path: 'agents/ponytail.md', type: 'blob', sha: 'blob4' },
  ],
};

describe('createGitHubClient.readTree', () => {
  it('returns paths relative to a directory subpath and ignores siblings', async () => {
    const calls: string[] = [];
    const client = createGitHubClient('tok', {
      fetch: fakeFetch(
        [
          { match: '/git/trees/', body: TREE_BODY },
          { match: '/git/blobs/blob1', body: { encoding: 'base64', content: b64('# CSO\n') } },
          { match: '/git/blobs/blob2', body: { encoding: 'base64', content: b64('tone rules\n') } },
        ],
        calls,
      ),
    });
    const tree = await client.readTree(SOURCE, 'b'.repeat(40));
    expect([...tree.entries()]).toEqual([
      ['SKILL.md', '# CSO\n'],
      ['references/tone.md', 'tone rules\n'],
    ]);
    expect(calls[0]).toBe(`https://api.github.com/repos/acme/skills/git/trees/${'b'.repeat(40)}?recursive=1`);
    expect(calls).toHaveLength(3);
  });

  it('keys a blob subpath as the empty string', async () => {
    const client = createGitHubClient('tok', {
      fetch: fakeFetch([
        { match: '/git/trees/', body: TREE_BODY },
        { match: '/git/blobs/blob4', body: { encoding: 'base64', content: b64('# Ponytail\n') } },
      ]),
    });
    const tree = await client.readTree(
      { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'agents/ponytail.md' },
      'b'.repeat(40),
    );
    expect([...tree.entries()]).toEqual([['', '# Ponytail\n']]);
  });

  it('uses repo-root-relative paths when the subpath is empty', async () => {
    const client = createGitHubClient('tok', {
      fetch: fakeFetch([
        { match: '/git/trees/', body: { truncated: false, tree: [{ path: 'README.md', type: 'blob', sha: 'blob9' }] } },
        { match: '/git/blobs/blob9', body: { encoding: 'base64', content: b64('# Root\n') } },
      ]),
    });
    const tree = await client.readTree({ ...SOURCE, subpath: '' }, 'b'.repeat(40));
    expect([...tree.keys()]).toEqual(['README.md']);
  });

  it('skips binary blobs instead of corrupting them', async () => {
    const client = createGitHubClient('tok', {
      fetch: fakeFetch([
        { match: '/git/trees/', body: TREE_BODY },
        { match: '/git/blobs/blob1', body: { encoding: 'base64', content: b64('# CSO\n') } },
        { match: '/git/blobs/blob2', body: { encoding: 'base64', content: Buffer.from([0x00, 0x01, 0x02]).toString('base64') } },
      ]),
    });
    const tree = await client.readTree(SOURCE, 'b'.repeat(40));
    expect([...tree.keys()]).toEqual(['SKILL.md']);
  });

  it('raises NETWORK when GitHub truncates the tree', async () => {
    const client = createGitHubClient('tok', {
      fetch: fakeFetch([{ match: '/git/trees/', body: { truncated: true, tree: [] } }]),
    });
    const error = await caught(client.readTree(SOURCE, 'b'.repeat(40)));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toContain('too large');
    expect(error.cause).toContain('No managed file was modified.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch.test.ts -t 'returns paths relative to a directory subpath'`
Expected: FAIL — received an empty Map

- [ ] **Step 3: Write minimal implementation**

Replace the `readTree` stub in `src/fetch.ts` with:

```ts
    async readTree(source: Source, sha: string): Promise<Map<string, string>> {
      const tree = await ghRequest<{
        truncated?: boolean;
        tree: Array<{ path: string; type: string; sha: string }>;
      }>({
        path: `/repos/${source.repo}/git/trees/${sha}?recursive=1`,
        token,
        doFetch,
        subject: `github.com/${source.repo}`,
      });

      if (tree.truncated === true) {
        throw new SkilledError({
          code: 'NETWORK',
          problem: `The file listing for github.com/${source.repo} came back truncated.`,
          cause:
            `The repository tree at ${sha} is too large for one request, so skilled cannot be sure it read every file under "${source.subpath}".\n` +
            'No managed file was modified.',
          fixes: [
            'skilled add <url> <path>             point the entry at a narrower subpath',
            'skilled remove <name>                stop tracking this entry',
          ],
          exitCode: 3,
        });
      }

      const prefix = source.subpath === '' ? '' : `${source.subpath.replace(/\/+$/, '')}/`;
      const wanted: Array<{ rel: string; sha: string }> = [];
      for (const node of tree.tree) {
        if (node.type !== 'blob') continue;
        if (source.subpath !== '' && node.path === source.subpath) {
          wanted.push({ rel: '', sha: node.sha });
          continue;
        }
        if (prefix === '' || node.path.startsWith(prefix)) {
          wanted.push({ rel: node.path.slice(prefix.length), sha: node.sha });
        }
      }

      const contents = new Map<string, string>();
      for (const blob of wanted) {
        const body = await ghRequest<{ content: string; encoding: string }>({
          path: `/repos/${source.repo}/git/blobs/${blob.sha}`,
          token,
          doFetch,
          subject: `github.com/${source.repo}`,
        });
        if (body.encoding !== 'base64') continue;
        const text = Buffer.from(body.content, 'base64').toString('utf8');
        // Binary blobs are skipped rather than corrupted by a utf8 round-trip.
        if (text.indexOf(String.fromCharCode(0)) !== -1) continue;
        contents.set(blob.rel, text);
      }
      return contents;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch.test.ts`
Expected: PASS (21 tests)

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts tests/fetch.test.ts
git commit -m "feat(fetch): read an item tree at a commit, subpath-relative"
```

---

### Task 11: `resolveToken` — borrowing credentials from `gh`

**Files:**
- Modify: `src/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Consumes: `node:child_process` `execFile`, `node:util` `promisify`.
- Produces: `resolveToken(deps?: Partial<ResolveTokenDeps>): Promise<string | null>` (contract's `resolveToken()` call form preserved), `ResolveTokenDeps { env: NodeJS.ProcessEnv; exec: (file: string, args: string[]) => Promise<{ stdout: string }> }`. Precedence: `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`, then `null`. It never throws — callers turn `null` into `NO_AUTH` at the point of use, so offline detection still works.

- [ ] **Step 1: Write the failing test**

Append to `tests/fetch.test.ts`:

```ts
import { resolveToken } from '../src/fetch.js';

describe('resolveToken', () => {
  const neverRun = async (): Promise<{ stdout: string }> => {
    throw new Error('exec should not have been called');
  };

  it('prefers GITHUB_TOKEN', async () => {
    expect(await resolveToken({ env: { GITHUB_TOKEN: 'from-env' }, exec: neverRun })).toBe('from-env');
  });

  it('falls back to GH_TOKEN', async () => {
    expect(await resolveToken({ env: { GH_TOKEN: 'gh-env' }, exec: neverRun })).toBe('gh-env');
  });

  it('borrows the token from `gh auth token`', async () => {
    const seen: Array<{ file: string; args: string[] }> = [];
    const token = await resolveToken({
      env: {},
      exec: async (file, args) => {
        seen.push({ file, args });
        return { stdout: 'gho_borrowed\n' };
      },
    });
    expect(token).toBe('gho_borrowed');
    expect(seen).toEqual([{ file: 'gh', args: ['auth', 'token'] }]);
  });

  it('returns null when gh is missing or unauthenticated', async () => {
    const token = await resolveToken({
      env: {},
      exec: async () => {
        throw new Error('spawn gh ENOENT');
      },
    });
    expect(token).toBeNull();
  });

  it('returns null when gh prints nothing', async () => {
    expect(await resolveToken({ env: {}, exec: async () => ({ stdout: '  \n' }) })).toBeNull();
  });

  it('ignores an empty environment variable and still asks gh', async () => {
    const token = await resolveToken({ env: { GITHUB_TOKEN: '' }, exec: async () => ({ stdout: 'gho_x\n' }) });
    expect(token).toBe('gho_x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch.test.ts -t 'prefers GITHUB_TOKEN'`
Expected: FAIL with "resolveToken is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `src/fetch.ts`, and add `import { execFile } from 'node:child_process';` and `import { promisify } from 'node:util';` at the top of the file:

```ts
export interface ResolveTokenDeps {
  env: NodeJS.ProcessEnv;
  exec: (file: string, args: string[]) => Promise<{ stdout: string }>;
}

const execFileAsync = promisify(execFile);

async function defaultExec(file: string, args: string[]): Promise<{ stdout: string }> {
  const { stdout } = await execFileAsync(file, args, { encoding: 'utf8', timeout: 5000 });
  return { stdout };
}

/**
 * Borrows a GitHub token so this persona needs zero setup. Never throws:
 * callers raise NO_AUTH at the point where a token is actually required, which
 * keeps the offline detection strategies working.
 */
export async function resolveToken(deps: Partial<ResolveTokenDeps> = {}): Promise<string | null> {
  const env = deps.env ?? process.env;
  const fromEnv = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();

  const exec = deps.exec ?? defaultExec;
  try {
    const { stdout } = await exec('gh', ['auth', 'token']);
    const token = stdout.trim();
    return token === '' ? null : token;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch.test.ts`
Expected: PASS (27 tests)

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts tests/fetch.test.ts
git commit -m "feat(fetch): borrow a GitHub token from the gh CLI"
```

---

### Task 12: Reading BASE and writing trees atomically

**Files:**
- Create: `src/tree.ts`
- Test: `tests/tree.test.ts`

**Interfaces:**
- Consumes: `basePath(managedDir: string, id: string): string` from `src/config.ts`; `makeManagedDir`, `writeBaseTree`, `pathExists` from `tests/helpers/update-fixture.ts`.
- Produces:
  - `readBase(managedDir: string, id: string): Promise<Map<string, string> | null>` — `null` when no BASE has been recorded. A single-file BASE yields the single key `''`.
  - `writeFileAtomic(target: string, text: string): Promise<void>` — temp file in the same directory, then `rename`, so a reader never sees a half-written file.
  - `writeTreeAtomic(target: string, files: Map<string, string>, stagingRoot: string): Promise<void>` — stages the whole tree under `stagingRoot`, then swaps it in with `rename`. Used for BASE only, which skilled owns entirely.
  - `removeIfPresent(target: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tree.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath, stateDir } from '../src/config.js';
import { readBase, removeIfPresent, writeFileAtomic, writeTreeAtomic } from '../src/tree.js';
import { makeManagedDir, pathExists, writeBaseTree, type Fixture } from './helpers/update-fixture.js';

let fixture: Fixture | null = null;

afterEach(async () => {
  if (fixture) await fixture.cleanup();
  fixture = null;
});

describe('readBase', () => {
  it('returns null when no base was ever recorded', async () => {
    fixture = await makeManagedDir();
    expect(await readBase(fixture.dir, 'skills/demo')).toBeNull();
  });

  it('reads a multi-file base tree with POSIX relative keys', async () => {
    fixture = await makeManagedDir();
    await writeBaseTree(fixture.dir, 'skills/demo', {
      'SKILL.md': '# Demo\n',
      'references/tone.md': 'tone\n',
    });
    const base = await readBase(fixture.dir, 'skills/demo');
    expect(base).not.toBeNull();
    expect([...(base as Map<string, string>).entries()].sort()).toEqual([
      ['SKILL.md', '# Demo\n'],
      ['references/tone.md', 'tone\n'],
    ]);
  });

  it('reads a single-file base under the empty key', async () => {
    fixture = await makeManagedDir();
    await writeBaseTree(fixture.dir, 'agents/solo.md', { '': '# Solo\n' });
    const base = await readBase(fixture.dir, 'agents/solo.md');
    expect([...(base as Map<string, string>).entries()]).toEqual([['', '# Solo\n']]);
  });
});

describe('writeFileAtomic', () => {
  it('creates missing parents and leaves no temp file behind', async () => {
    fixture = await makeManagedDir();
    const target = path.join(fixture.dir, 'skills/demo/references/tone.md');
    await writeFileAtomic(target, 'tone\n');
    expect(await fs.readFile(target, 'utf8')).toBe('tone\n');
    expect(await fs.readdir(path.dirname(target))).toEqual(['tone.md']);
  });

  it('replaces existing content', async () => {
    fixture = await makeManagedDir();
    const target = path.join(fixture.dir, 'skills/demo/SKILL.md');
    await writeFileAtomic(target, 'first\n');
    await writeFileAtomic(target, 'second\n');
    expect(await fs.readFile(target, 'utf8')).toBe('second\n');
  });
});

describe('writeTreeAtomic', () => {
  it('replaces a whole tree and drops files that are no longer present', async () => {
    fixture = await makeManagedDir();
    const target = basePath(fixture.dir, 'skills/demo');
    const staging = path.join(stateDir(fixture.dir), 'tmp');
    await writeTreeAtomic(
      target,
      new Map([
        ['SKILL.md', 'one\n'],
        ['evals/old.md', 'old\n'],
      ]),
      staging,
    );
    await writeTreeAtomic(target, new Map([['SKILL.md', 'two\n']]), staging);
    expect(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('two\n');
    expect(await pathExists(path.join(target, 'evals/old.md'))).toBe(false);
  });

  it('writes a single-file tree as a file, replacing a directory if one was there', async () => {
    fixture = await makeManagedDir();
    const target = basePath(fixture.dir, 'agents/solo.md');
    const staging = path.join(stateDir(fixture.dir), 'tmp');
    await writeTreeAtomic(target, new Map([['nested.md', 'nested\n']]), staging);
    await writeTreeAtomic(target, new Map([['', '# Solo\n']]), staging);
    expect(await fs.readFile(target, 'utf8')).toBe('# Solo\n');
  });

  it('leaves no staging directories behind', async () => {
    fixture = await makeManagedDir();
    const staging = path.join(stateDir(fixture.dir), 'tmp');
    await writeTreeAtomic(basePath(fixture.dir, 'skills/demo'), new Map([['SKILL.md', 'x\n']]), staging);
    expect(await fs.readdir(staging)).toEqual([]);
  });
});

describe('removeIfPresent', () => {
  it('removes a file and tolerates a missing one', async () => {
    fixture = await makeManagedDir();
    const target = path.join(fixture.dir, 'skills/demo/SKILL.md');
    await writeFileAtomic(target, 'x\n');
    await removeIfPresent(target);
    expect(await pathExists(target)).toBe(false);
    await removeIfPresent(target);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tree.test.ts`
Expected: FAIL with "Failed to resolve import ../src/tree.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tree.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from './config.js';

/**
 * BASE for a single-file item is a file at `<dir>/.skilled/base/<id>`; for a
 * directory item it is a directory. The shape on disk decides how it is read.
 */
export async function readBase(managedDir: string, id: string): Promise<Map<string, string> | null> {
  const root = basePath(managedDir, id);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    return null;
  }

  const contents = new Map<string, string>();
  if (stat.isFile()) {
    contents.set('', await fs.readFile(root, 'utf8'));
    return contents;
  }
  await collect(root, '', contents);
  return contents.size === 0 ? null : contents;
}

async function collect(dir: string, prefix: string, out: Map<string, string>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(abs, rel, out);
    else if (entry.isFile()) out.set(rel, await fs.readFile(abs, 'utf8'));
  }
}

/** Same-directory temp file plus rename: a reader sees the old or new file, never a partial one. */
export async function writeFileAtomic(target: string, text: string): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(target)}.skilled-${process.pid}-${Date.now()}`);
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, target);
}

export async function removeIfPresent(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Stages the complete tree, then swaps it in. `stagingRoot` must be on the same
 * filesystem as `target` — always pass `<managed-dir>/.skilled/tmp`.
 */
export async function writeTreeAtomic(
  target: string,
  files: Map<string, string>,
  stagingRoot: string,
): Promise<void> {
  await fs.mkdir(stagingRoot, { recursive: true });
  const staged = await fs.mkdtemp(path.join(stagingRoot, 'stage-'));
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });

    if (files.size === 1 && files.has('')) {
      const temp = path.join(staged, 'content');
      await fs.writeFile(temp, files.get('') as string, 'utf8');
      const existing = await statKind(target);
      if (existing === 'dir') await fs.rename(target, path.join(staged, 'previous'));
      await fs.rename(temp, target);
      return;
    }

    const tree = path.join(staged, 'tree');
    await fs.mkdir(tree, { recursive: true });
    for (const [rel, text] of files) {
      const dest = path.join(tree, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, text, 'utf8');
    }

    const previous = path.join(staged, 'previous');
    const existing = await statKind(target);
    if (existing !== 'missing') await fs.rename(target, previous);
    await fs.rename(tree, target);
  } finally {
    await fs.rm(staged, { recursive: true, force: true });
  }
}

async function statKind(target: string): Promise<'file' | 'dir' | 'missing'> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? 'dir' : 'file';
  } catch {
    return 'missing';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tree.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tree.ts tests/tree.test.ts
git commit -m "feat(tree): read BASE trees and write files and trees atomically"
```

---

### Task 13: The per-file update plan

**Files:**
- Create: `src/plan.ts`
- Test: `tests/plan.test.ts`

**Interfaces:**
- Consumes: `mergeFile` from `src/merge.ts`; `diffStat`, `splitLines` from `src/render/diff.ts`; `Source` from `src/types.ts`.
- Produces: `planItem(input: PlanInput): ItemPlan`, plus the types `FilePlanKind`, `FilePlan`, `ItemPlan`, `PlanInput`. `planItem` is pure and does no I/O beyond the `git merge-file` calls inside `mergeFile`.

**A skill is a directory, so every file is decided independently.** This is the complete case table the implementation must follow — one row per combination of presence in BASE, LOCAL and UPSTREAM:

| in BASE | in LOCAL | in UPSTREAM | `kind` | LOCAL becomes | BASE becomes |
|---|---|---|---|---|---|
| yes | yes | yes | `unchanged`, `merged-clean` or `conflict` | merged text | upstream text |
| no | yes | yes | `merged-clean` or `conflict` (merged against an empty base) | merged text | upstream text |
| no | no | yes | `added-upstream` | upstream text | upstream text |
| no | yes | no | `local-only` | untouched | absent |
| yes | yes (= BASE) | no | `deleted-upstream` | removed | absent |
| yes | yes (≠ BASE) | no | `kept-local-deleted-upstream` | untouched | absent |
| yes | no | yes | `deleted-locally` | stays absent | upstream text |
| yes | no | no | `deleted-upstream` | stays absent | absent |

Two rules follow from "never lose a local edit": a file the user edited is never deleted because upstream deleted it, and a file the user deleted is never resurrected.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plan.test.ts
import { describe, it, expect } from 'vitest';
import { planItem } from '../src/plan.js';
import type { Source } from '../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' };

const BASE_TEXT = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be careful', ''].join('\n');
const LOCAL_EDITED = ['# Demo', '', '## Usage', 'run it', 'run it twice', '', '## Notes', 'be careful', ''].join('\n');
const UPSTREAM_TEXT = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be very careful', ''].join('\n');

function plan(base: Record<string, string>, local: Record<string, string>, upstream: Record<string, string>) {
  return planItem({
    id: 'skills/demo',
    source: SOURCE,
    upstreamSha: 'b'.repeat(40),
    upstreamDate: '2026-08-09',
    behindBy: 3,
    base: new Map(Object.entries(base)),
    local: new Map(Object.entries(local)),
    upstream: new Map(Object.entries(upstream)),
  });
}

describe('planItem', () => {
  it('reports no local edits and takes upstream wholesale', () => {
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': BASE_TEXT }, { 'SKILL.md': UPSTREAM_TEXT });
    expect(result.localEdits).toBe(false);
    expect(result.editedFiles).toBe(0);
    expect(result.conflicts).toBe(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].kind).toBe('merged-clean');
    expect(result.files[0].local).toBe(UPSTREAM_TEXT);
    expect(result.files[0].base).toBe(UPSTREAM_TEXT);
    expect(result.files[0].added).toBe(1);
    expect(result.files[0].removed).toBe(1);
  });

  it('merges local and upstream edits and keeps both', () => {
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': LOCAL_EDITED }, { 'SKILL.md': UPSTREAM_TEXT });
    expect(result.localEdits).toBe(true);
    expect(result.editedFiles).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(result.files[0].kind).toBe('merged-clean');
    expect(result.files[0].local).toContain('run it twice');
    expect(result.files[0].local).toContain('be very careful');
    expect(result.files[0].base).toBe(UPSTREAM_TEXT);
  });

  it('marks a file unchanged when the merge produces exactly what is on disk', () => {
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': LOCAL_EDITED }, { 'SKILL.md': BASE_TEXT });
    expect(result.files[0].kind).toBe('unchanged');
    expect(result.files[0].local).toBe(LOCAL_EDITED);
    expect(result.files[0].added).toBe(0);
    expect(result.files[0].removed).toBe(0);
  });

  it('reports a conflict without deciding anything', () => {
    const localConflict = BASE_TEXT.replace('be careful', 'be careful, always');
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': localConflict }, { 'SKILL.md': UPSTREAM_TEXT });
    expect(result.conflicts).toBe(1);
    expect(result.files[0].kind).toBe('conflict');
    expect(result.files[0].conflictCount).toBe(1);
    expect(result.files[0].local).toContain('<<<<<<< LOCAL (your copy)');
  });

  it('creates a file added upstream', () => {
    const result = plan(
      { 'SKILL.md': BASE_TEXT },
      { 'SKILL.md': BASE_TEXT },
      { 'SKILL.md': BASE_TEXT, 'references/tone.md': 'tone\nrules\n' },
    );
    const added = result.files.find((f) => f.relPath === 'references/tone.md');
    expect(added?.kind).toBe('added-upstream');
    expect(added?.local).toBe('tone\nrules\n');
    expect(added?.added).toBe(2);
  });

  it('removes a file deleted upstream that the user never touched', () => {
    const result = plan(
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\n' },
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\n' },
      { 'SKILL.md': BASE_TEXT },
    );
    const gone = result.files.find((f) => f.relPath === 'evals/old.md');
    expect(gone?.kind).toBe('deleted-upstream');
    expect(gone?.local).toBeNull();
    expect(gone?.base).toBeNull();
    expect(gone?.removed).toBe(1);
  });

  it('keeps a file deleted upstream that the user had edited', () => {
    const result = plan(
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\n' },
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\nmine\n' },
      { 'SKILL.md': BASE_TEXT },
    );
    const kept = result.files.find((f) => f.relPath === 'evals/old.md');
    expect(kept?.kind).toBe('kept-local-deleted-upstream');
    expect(kept?.local).toBe('old\nmine\n');
    expect(kept?.base).toBeNull();
    expect(result.localEdits).toBe(true);
  });

  it('leaves a purely local file alone', () => {
    const result = plan(
      { 'SKILL.md': BASE_TEXT },
      { 'SKILL.md': BASE_TEXT, 'notes.md': 'mine\n' },
      { 'SKILL.md': BASE_TEXT },
    );
    const mine = result.files.find((f) => f.relPath === 'notes.md');
    expect(mine?.kind).toBe('local-only');
    expect(mine?.local).toBe('mine\n');
    expect(mine?.base).toBeNull();
    expect(result.localEdits).toBe(true);
  });

  it('does not resurrect a file the user deleted', () => {
    const result = plan(
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\n' },
      { 'SKILL.md': BASE_TEXT },
      { 'SKILL.md': BASE_TEXT, 'evals/old.md': 'old\nnew upstream line\n' },
    );
    const dropped = result.files.find((f) => f.relPath === 'evals/old.md');
    expect(dropped?.kind).toBe('deleted-locally');
    expect(dropped?.local).toBeNull();
    expect(dropped?.base).toBe('old\nnew upstream line\n');
  });

  it('merges a file that both sides added independently', () => {
    const result = plan({}, { 'SKILL.md': 'shared\nmine\n' }, { 'SKILL.md': 'shared\nmine\n' });
    expect(result.files[0].kind).toBe('unchanged');
    expect(result.conflicts).toBe(0);
  });

  it('handles a single-file item under the empty key', () => {
    const result = plan({ '': BASE_TEXT }, { '': BASE_TEXT }, { '': UPSTREAM_TEXT });
    expect(result.files[0].relPath).toBe('');
    expect(result.files[0].local).toBe(UPSTREAM_TEXT);
  });

  it('flags an item whose upstream no longer has any file', () => {
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': BASE_TEXT }, {});
    expect(result.blocked).toBe('upstream-empty');
  });

  it('carries the identifying fields through unchanged', () => {
    const result = plan({ 'SKILL.md': BASE_TEXT }, { 'SKILL.md': BASE_TEXT }, { 'SKILL.md': UPSTREAM_TEXT });
    expect(result.id).toBe('skills/demo');
    expect(result.source).toEqual(SOURCE);
    expect(result.upstreamSha).toBe('b'.repeat(40));
    expect(result.upstreamDate).toBe('2026-08-09');
    expect(result.behindBy).toBe(3);
    expect(result.blocked).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plan.test.ts`
Expected: FAIL with "Failed to resolve import ../src/plan.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/plan.ts
import { mergeFile } from './merge.js';
import { diffStat, splitLines } from './render/diff.js';
import type { Source } from './types.js';

export type FilePlanKind =
  | 'unchanged'
  | 'merged-clean'
  | 'conflict'
  | 'added-upstream'
  | 'deleted-upstream'
  | 'kept-local-deleted-upstream'
  | 'deleted-locally'
  | 'local-only';

export interface FilePlan {
  /** relative to the item; '' for a single-file item */
  relPath: string;
  kind: FilePlanKind;
  /** what LOCAL becomes; null means the file is removed or stays absent */
  local: string | null;
  /** what BASE becomes; null means the base entry is dropped */
  base: string | null;
  conflictCount: number;
  /** lines this plan adds to the copy on disk */
  added: number;
  /** lines this plan removes from the copy on disk */
  removed: number;
}

export interface ItemPlan {
  id: string;
  source: Source;
  upstreamSha: string;
  /** YYYY-MM-DD of the upstream head commit */
  upstreamDate: string;
  behindBy: number;
  localEdits: boolean;
  /** how many files differ between BASE and LOCAL */
  editedFiles: number;
  files: FilePlan[];
  conflicts: number;
  /** set when upstream no longer contains a single file for this item */
  blocked: 'upstream-empty' | null;
}

export interface PlanInput {
  id: string;
  source: Source;
  upstreamSha: string;
  upstreamDate: string;
  behindBy: number;
  base: Map<string, string>;
  local: Map<string, string>;
  upstream: Map<string, string>;
}

export function planItem(input: PlanInput): ItemPlan {
  const paths = [
    ...new Set([...input.base.keys(), ...input.local.keys(), ...input.upstream.keys()]),
  ].sort();

  const files: FilePlan[] = [];
  let conflicts = 0;
  let editedFiles = 0;

  for (const relPath of paths) {
    const base = input.base.get(relPath);
    const local = input.local.get(relPath);
    const upstream = input.upstream.get(relPath);

    if ((base !== undefined || local !== undefined) && base !== local) editedFiles++;

    if (local !== undefined && base === undefined && upstream === undefined) {
      files.push({ relPath, kind: 'local-only', local, base: null, conflictCount: 0, added: 0, removed: 0 });
      continue;
    }

    if (upstream !== undefined && local === undefined && base === undefined) {
      files.push({
        relPath,
        kind: 'added-upstream',
        local: upstream,
        base: upstream,
        conflictCount: 0,
        added: splitLines(upstream).length,
        removed: 0,
      });
      continue;
    }

    if (upstream === undefined && local !== undefined) {
      if (base !== undefined && local === base) {
        files.push({
          relPath,
          kind: 'deleted-upstream',
          local: null,
          base: null,
          conflictCount: 0,
          added: 0,
          removed: splitLines(local).length,
        });
      } else {
        files.push({
          relPath,
          kind: 'kept-local-deleted-upstream',
          local,
          base: null,
          conflictCount: 0,
          added: 0,
          removed: 0,
        });
      }
      continue;
    }

    if (local === undefined && upstream !== undefined) {
      files.push({
        relPath,
        kind: 'deleted-locally',
        local: null,
        base: upstream,
        conflictCount: 0,
        added: 0,
        removed: 0,
      });
      continue;
    }

    if (local === undefined && upstream === undefined) {
      files.push({
        relPath,
        kind: 'deleted-upstream',
        local: null,
        base: null,
        conflictCount: 0,
        added: 0,
        removed: 0,
      });
      continue;
    }

    // Present in LOCAL and UPSTREAM. An absent BASE merges against empty text,
    // which is what "both sides added this file" means.
    const outcome = mergeFile(base ?? '', local, upstream);
    const stat = diffStat(local, outcome.content);
    if (outcome.kind === 'clean') {
      files.push({
        relPath,
        kind: outcome.content === local ? 'unchanged' : 'merged-clean',
        local: outcome.content,
        base: upstream,
        conflictCount: 0,
        added: stat.added,
        removed: stat.removed,
      });
    } else {
      conflicts += outcome.conflictCount;
      files.push({
        relPath,
        kind: 'conflict',
        local: outcome.content,
        base: upstream,
        conflictCount: outcome.conflictCount,
        added: stat.added,
        removed: stat.removed,
      });
    }
  }

  return {
    id: input.id,
    source: input.source,
    upstreamSha: input.upstreamSha,
    upstreamDate: input.upstreamDate,
    behindBy: input.behindBy,
    localEdits: editedFiles > 0,
    editedFiles,
    files,
    conflicts,
    blocked: files.some((file) => file.local !== null) ? null : 'upstream-empty',
  };
}
```

TypeScript note: inside the merge branch, `local` and `upstream` are both narrowed to `string` by the preceding `continue`s, so no non-null assertions are needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plan.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "feat(plan): per-file three-way update plan for a whole item"
```

---

### Task 14: BASE reconstruction for items adopted before skilled existed

**Files:**
- Create: `src/reconstruct.ts`
- Test: `tests/reconstruct.test.ts`

**Interfaces:**
- Consumes: `GitHubClient` from `src/clients.ts`; `Source` from `src/types.ts`; `splitLines` from `src/render/diff.ts`; `fakeGitHub` from `tests/helpers/update-fixture.ts`.
- Produces: `lineSimilarity(a: string, b: string): number`, `treeSimilarity(local: Map<string, string>, candidate: Map<string, string>): number`, `reconstructBase(args: { source: Source; local: Map<string, string>; github: GitHubClient }): Promise<ReconstructResult | null>`, `ReconstructResult { commit: string; adoptedAt: string; score: number; tree: Map<string, string>; evidence: string }`, and the constants `MAX_BASE_CANDIDATES = 10`, `MIN_BASE_SCORE = 0.5`.

**The algorithm, exactly.** 49 of 51 real items have no BASE, so this runs constantly and must be deterministic:

1. `commits = await github.listCommits(source)` — newest first.
2. Take the newest `MAX_BASE_CANDIDATES` (10) commits. Ten bounds the request budget: each candidate costs one tree request plus one request per file, and an unauthenticated caller only has 60 requests per hour.
3. For each candidate, newest first: `tree = await github.readTree(source, commit.sha)`, then `score = treeSimilarity(local, tree)`.
4. Keep the best score, replacing only on a **strictly greater** score. Iterating newest-first with a strict comparison means **the newest commit wins any tie** — which reports the smallest honest "commits behind" number for content that several commits share.
5. Stop immediately when a score of exactly `1` is found. That is the common case: the user downloaded the file and barely touched it.
6. If the best score is below `MIN_BASE_SCORE` (0.5), return `null`. The caller then skips the item and tells the user to correct the source — guessing a BASE that far from LOCAL would turn the user's own text into fake "upstream deletions".

`treeSimilarity` is the mean per-file score over the union of both file lists, so a file missing from either side scores 0 and drags the average down. `lineSimilarity` is multiset line overlap divided by the longer file's line count — cheap, order-insensitive, and good enough to separate "this is the commit I downloaded" from "this is a different version".

- [ ] **Step 1: Write the failing test**

```ts
// tests/reconstruct.test.ts
import { describe, it, expect } from 'vitest';
import {
  MAX_BASE_CANDIDATES,
  MIN_BASE_SCORE,
  lineSimilarity,
  reconstructBase,
  treeSimilarity,
} from '../src/reconstruct.js';
import { fakeGitHub } from './helpers/update-fixture.js';
import type { Source } from '../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' };
const KEY = 'acme/skills#main#skills/demo';

describe('lineSimilarity', () => {
  it('is 1 for identical text and 0 for nothing in common', () => {
    expect(lineSimilarity('a\nb\n', 'a\nb\n')).toBe(1);
    expect(lineSimilarity('a\nb\n', 'c\nd\n')).toBe(0);
  });

  it('is the shared line count over the longer file', () => {
    expect(lineSimilarity('a\nb\nc\nd\n', 'a\nb\n')).toBe(0.5);
  });
});

describe('treeSimilarity', () => {
  it('averages per-file scores over the union of both file lists', () => {
    const local = new Map([['SKILL.md', 'a\nb\n'], ['notes.md', 'x\n']]);
    const candidate = new Map([['SKILL.md', 'a\nb\n']]);
    expect(treeSimilarity(local, candidate)).toBe(0.5);
  });

  it('is 1 when both trees are identical', () => {
    const tree = new Map([['SKILL.md', 'a\nb\n']]);
    expect(treeSimilarity(tree, new Map(tree))).toBe(1);
  });
});

describe('reconstructBase', () => {
  it('picks the newest commit that matches the local copy exactly and stops there', () => {
    const local = new Map([['SKILL.md', 'v2\n']]);
    const github = fakeGitHub({
      [KEY]: {
        commits: [
          { sha: 'c'.repeat(40), date: '2026-08-09T10:00:00Z', message: 'v3' },
          { sha: 'b'.repeat(40), date: '2026-06-01T10:00:00Z', message: 'v2 again' },
          { sha: 'a'.repeat(40), date: '2026-05-12T10:00:00Z', message: 'v2' },
        ],
        trees: {
          ['c'.repeat(40)]: { 'SKILL.md': 'v3\n' },
          ['b'.repeat(40)]: { 'SKILL.md': 'v2\n' },
          ['a'.repeat(40)]: { 'SKILL.md': 'v2\n' },
        },
      },
    });
    return reconstructBase({ source: SOURCE, local, github }).then((result) => {
      expect(result).not.toBeNull();
      expect(result?.commit).toBe('b'.repeat(40));
      expect(result?.adoptedAt).toBe('2026-06-01');
      expect(result?.score).toBe(1);
      expect(result?.tree.get('SKILL.md')).toBe('v2\n');
      expect(result?.evidence).toContain('bbbbbbb');
      expect(result?.evidence).toContain('100%');
    });
  });

  it('falls back to the closest partial match', async () => {
    const local = new Map([['SKILL.md', 'a\nb\nmine\n']]);
    const github = fakeGitHub({
      [KEY]: {
        commits: [
          { sha: 'c'.repeat(40), date: '2026-08-09T10:00:00Z', message: 'rewrite' },
          { sha: 'a'.repeat(40), date: '2026-05-12T10:00:00Z', message: 'original' },
        ],
        trees: {
          ['c'.repeat(40)]: { 'SKILL.md': 'totally\ndifferent\ntext\n' },
          ['a'.repeat(40)]: { 'SKILL.md': 'a\nb\n' },
        },
      },
    });
    const result = await reconstructBase({ source: SOURCE, local, github });
    expect(result?.commit).toBe('a'.repeat(40));
    expect(result?.score).toBeGreaterThan(MIN_BASE_SCORE);
  });

  it('returns null when nothing upstream resembles the local copy', async () => {
    const local = new Map([['SKILL.md', 'nothing\nin\ncommon\nat\nall\n']]);
    const github = fakeGitHub({
      [KEY]: {
        commits: [{ sha: 'a'.repeat(40), date: '2026-05-12T10:00:00Z', message: 'original' }],
        trees: { ['a'.repeat(40)]: { 'SKILL.md': 'completely\nunrelated\nlines\nhere\nnow\n' } },
      },
    });
    expect(await reconstructBase({ source: SOURCE, local, github })).toBeNull();
  });

  it('returns null when the source has no commits at all', async () => {
    const github = fakeGitHub({ [KEY]: { commits: [], trees: {} } });
    expect(await reconstructBase({ source: SOURCE, local: new Map(), github })).toBeNull();
  });

  it('reads at most MAX_BASE_CANDIDATES trees', async () => {
    const commits = Array.from({ length: 25 }, (_, i) => ({
      sha: String(i).padStart(40, '0'),
      date: '2026-05-12T10:00:00Z',
      message: `commit ${i}`,
    }));
    const trees: Record<string, Record<string, string>> = {};
    for (const commit of commits) trees[commit.sha] = { 'SKILL.md': `content ${commit.sha}\n` };
    const inner = fakeGitHub({ [KEY]: { commits, trees } });
    let treeReads = 0;
    const counting = {
      ...inner,
      readTree: async (source: Source, sha: string) => {
        treeReads++;
        return inner.readTree(source, sha);
      },
    };
    await reconstructBase({ source: SOURCE, local: new Map([['SKILL.md', 'unrelated\n']]), github: counting });
    expect(treeReads).toBe(MAX_BASE_CANDIDATES);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconstruct.test.ts`
Expected: FAIL with "Failed to resolve import ../src/reconstruct.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reconstruct.ts
import { splitLines } from './render/diff.js';
import type { GitHubClient } from './clients.js';
import type { Source } from './types.js';

/** Bounded so an unauthenticated caller (60 req/hr) can still reconstruct a base. */
export const MAX_BASE_CANDIDATES = 10;
/** Below this, guessing a base would invent upstream deletions from the user's own text. */
export const MIN_BASE_SCORE = 0.5;

export interface ReconstructResult {
  commit: string;
  /** YYYY-MM-DD, the date of the chosen commit */
  adoptedAt: string;
  /** 0..1 */
  score: number;
  tree: Map<string, string>;
  evidence: string;
}

export function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const linesA = splitLines(a);
  const linesB = splitLines(b);
  if (linesA.length === 0 && linesB.length === 0) return 1;
  if (linesA.length === 0 || linesB.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const line of linesA) counts.set(line, (counts.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of linesB) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) {
      shared++;
      counts.set(line, remaining - 1);
    }
  }
  return shared / Math.max(linesA.length, linesB.length);
}

export function treeSimilarity(local: Map<string, string>, candidate: Map<string, string>): number {
  const paths = new Set([...local.keys(), ...candidate.keys()]);
  if (paths.size === 0) return 1;
  let total = 0;
  for (const relPath of paths) {
    const mine = local.get(relPath);
    const theirs = candidate.get(relPath);
    if (mine === undefined || theirs === undefined) continue; // scores 0
    total += lineSimilarity(mine, theirs);
  }
  return total / paths.size;
}

/**
 * Finds the upstream commit whose content best matches LOCAL and returns it as
 * the merge base. Newest-first iteration with a strict `>` means the newest
 * commit wins a tie.
 */
export async function reconstructBase(args: {
  source: Source;
  local: Map<string, string>;
  github: GitHubClient;
}): Promise<ReconstructResult | null> {
  const commits = await args.github.listCommits(args.source);
  let best: ReconstructResult | null = null;

  for (const commit of commits.slice(0, MAX_BASE_CANDIDATES)) {
    const tree = await args.github.readTree(args.source, commit.sha);
    const score = treeSimilarity(args.local, tree);
    if (best === null || score > best.score) {
      best = {
        commit: commit.sha,
        adoptedAt: commit.date.slice(0, 10),
        score,
        tree,
        evidence: `reconstructed base from commit ${commit.sha.slice(0, 7)} — ${Math.round(score * 100)}% of your copy matches it`,
      };
    }
    if (score === 1) break;
  }

  if (best === null || best.score < MIN_BASE_SCORE) return null;
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reconstruct.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/reconstruct.ts tests/reconstruct.test.ts
git commit -m "feat(reconstruct): infer a missing merge base by content similarity"
```

---

### Task 15: Applying an approved plan

**Files:**
- Create: `src/apply.ts`
- Test: `tests/apply.test.ts`

**Interfaces:**
- Consumes: `basePath`, `stateDir` from `src/config.ts`; `readManifest`, `writeManifest`, `upsertEntry` from `src/manifest.ts`; `writeFileAtomic`, `writeTreeAtomic`, `removeIfPresent` from `src/tree.ts`; `ItemPlan`, `FilePlan` from `src/plan.ts`; `Entry`, `LocalItem` from `src/types.ts`.
- Produces: `applyPlan(args: ApplyArgs): Promise<ApplyResult>`, `ApplyArgs`, `ApplyResult { written: string[]; removed: string[] }`.

**This is the only function in the spec that touches a managed file, and it runs only after the user pressed `a`.** Write order is fixed:

1. **LOCAL**, one file at a time, each through `writeFileAtomic` (same-directory temp file + `rename`). Per-file atomicity, not a whole-directory swap, so a file skilled never read — a binary asset, something `discover` ignored — cannot be lost.
2. **BASE**, as one `writeTreeAtomic` swap, because skilled owns `.skilled/base/<id>` completely.
3. **The manifest**, last: `base.commit` is what makes the update official, so it advances only once the bytes are in place.

If the process dies between 1 and 3, LOCAL already contains the upstream changes and BASE still points at the old commit; the next `skilled update` re-merges, finds the changes already present, and produces an empty diff. `~/.claude` is a git repo with auto-commit hooks, so every write is revertible.

- [ ] **Step 1: Write the failing test**

```ts
// tests/apply.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../src/config.js';
import { readManifest } from '../src/manifest.js';
import { applyPlan } from '../src/apply.js';
import { planItem } from '../src/plan.js';
import {
  entryFor,
  makeManagedDir,
  pathExists,
  readItemFile,
  writeBaseTree,
  writeEntry,
  writeItem,
  type Fixture,
} from './helpers/update-fixture.js';
import type { LocalItem, Source } from '../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' };
const NEW_SHA = 'b'.repeat(40);

let fixture: Fixture | null = null;

afterEach(async () => {
  if (fixture) await fixture.cleanup();
  fixture = null;
});

describe('applyPlan', () => {
  it('writes changed files, creates added ones, removes deleted ones and advances BASE', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    const baseFiles = { 'SKILL.md': '# Demo\nold\n', 'evals/old.md': 'old\n' };
    const localFiles = { 'SKILL.md': '# Demo\nold\n', 'evals/old.md': 'old\n', 'notes.md': 'mine\n' };
    const upstreamFiles = { 'SKILL.md': '# Demo\nnew\n', 'references/tone.md': 'tone\n' };

    await writeItem(dir, 'skills/demo', localFiles);
    await writeBaseTree(dir, 'skills/demo', baseFiles);
    const entry = entryFor('skills/demo', SOURCE, 'a'.repeat(40));
    await writeEntry(dir, entry);

    const item: LocalItem = {
      id: 'skills/demo',
      absPath: path.join(dir, 'skills/demo'),
      kind: 'skill',
      files: ['SKILL.md', 'evals/old.md', 'notes.md'],
    };
    const local = new Map(Object.entries(localFiles));
    const base = new Map(Object.entries(baseFiles));
    const plan = planItem({
      id: 'skills/demo',
      source: SOURCE,
      upstreamSha: NEW_SHA,
      upstreamDate: '2026-08-09',
      behindBy: 2,
      base,
      local,
      upstream: new Map(Object.entries(upstreamFiles)),
    });

    const result = await applyPlan({ managedDir: dir, item, entry, plan, local, base, today: '2026-08-27' });

    expect(await readItemFile(dir, 'skills/demo', 'SKILL.md')).toBe('# Demo\nnew\n');
    expect(await readItemFile(dir, 'skills/demo', 'references/tone.md')).toBe('tone\n');
    expect(await readItemFile(dir, 'skills/demo', 'notes.md')).toBe('mine\n');
    expect(await pathExists(path.join(dir, 'skills/demo/evals/old.md'))).toBe(false);

    expect(result.written.sort()).toEqual(['SKILL.md', 'references/tone.md']);
    expect(result.removed).toEqual(['evals/old.md']);

    const baseRoot = basePath(dir, 'skills/demo');
    expect(await fs.readFile(path.join(baseRoot, 'SKILL.md'), 'utf8')).toBe('# Demo\nnew\n');
    expect(await fs.readFile(path.join(baseRoot, 'references/tone.md'), 'utf8')).toBe('tone\n');
    expect(await pathExists(path.join(baseRoot, 'evals/old.md'))).toBe(false);
    expect(await pathExists(path.join(baseRoot, 'notes.md'))).toBe(false);

    const manifest = await readManifest(dir);
    expect(manifest.entries[0].base).toEqual({
      commit: NEW_SHA,
      adoptedAt: '2026-08-27',
      reconstructed: false,
    });
    expect(manifest.entries[0].source).toEqual(SOURCE);
    expect(manifest.entries[0].detection).toEqual(entry.detection);
  });

  it('preserves a local edit while taking the upstream change', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    const baseText = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be careful', ''].join('\n');
    const localText = ['# Demo', '', '## Usage', 'run it', 'run it twice', '', '## Notes', 'be careful', ''].join('\n');
    const upstreamText = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be very careful', ''].join('\n');

    await writeItem(dir, 'skills/demo', { 'SKILL.md': localText });
    await writeBaseTree(dir, 'skills/demo', { 'SKILL.md': baseText });
    const entry = entryFor('skills/demo', SOURCE, 'a'.repeat(40));
    await writeEntry(dir, entry);

    const item: LocalItem = {
      id: 'skills/demo',
      absPath: path.join(dir, 'skills/demo'),
      kind: 'skill',
      files: ['SKILL.md'],
    };
    const local = new Map([['SKILL.md', localText]]);
    const base = new Map([['SKILL.md', baseText]]);
    const plan = planItem({
      id: 'skills/demo',
      source: SOURCE,
      upstreamSha: NEW_SHA,
      upstreamDate: '2026-08-09',
      behindBy: 1,
      base,
      local,
      upstream: new Map([['SKILL.md', upstreamText]]),
    });

    await applyPlan({ managedDir: dir, item, entry, plan, local, base, today: '2026-08-27' });

    const merged = await readItemFile(dir, 'skills/demo', 'SKILL.md');
    expect(merged).toContain('run it twice');
    expect(merged).toContain('be very careful');
    expect(await fs.readFile(path.join(basePath(dir, 'skills/demo'), 'SKILL.md'), 'utf8')).toBe(upstreamText);
  });

  it('writes a single-file item to the file itself', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    await writeItem(dir, 'agents/solo.md', { '': '# Solo\n' });
    await writeBaseTree(dir, 'agents/solo.md', { '': '# Solo\n' });
    const source: Source = { type: 'github', repo: 'acme/agents', ref: 'main', subpath: 'agents/solo.md' };
    const entry = entryFor('agents/solo.md', source, 'a'.repeat(40));
    await writeEntry(dir, entry);

    const item: LocalItem = {
      id: 'agents/solo.md',
      absPath: path.join(dir, 'agents/solo.md'),
      kind: 'agent',
      files: [''],
    };
    const local = new Map([['', '# Solo\n']]);
    const base = new Map([['', '# Solo\n']]);
    const plan = planItem({
      id: 'agents/solo.md',
      source,
      upstreamSha: NEW_SHA,
      upstreamDate: '2026-08-09',
      behindBy: 1,
      base,
      local,
      upstream: new Map([['', '# Solo v2\n']]),
    });

    const result = await applyPlan({ managedDir: dir, item, entry, plan, local, base, today: '2026-08-27' });

    expect(await readItemFile(dir, 'agents/solo.md', '')).toBe('# Solo v2\n');
    expect(await fs.readFile(basePath(dir, 'agents/solo.md'), 'utf8')).toBe('# Solo v2\n');
    expect(result.written).toEqual(['']);
  });

  it('leaves no staging directory behind', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    await writeItem(dir, 'skills/demo', { 'SKILL.md': 'a\n' });
    await writeBaseTree(dir, 'skills/demo', { 'SKILL.md': 'a\n' });
    const entry = entryFor('skills/demo', SOURCE, 'a'.repeat(40));
    await writeEntry(dir, entry);
    const item: LocalItem = {
      id: 'skills/demo',
      absPath: path.join(dir, 'skills/demo'),
      kind: 'skill',
      files: ['SKILL.md'],
    };
    const local = new Map([['SKILL.md', 'a\n']]);
    const base = new Map([['SKILL.md', 'a\n']]);
    const plan = planItem({
      id: 'skills/demo',
      source: SOURCE,
      upstreamSha: NEW_SHA,
      upstreamDate: '2026-08-09',
      behindBy: 1,
      base,
      local,
      upstream: new Map([['SKILL.md', 'b\n']]),
    });
    await applyPlan({ managedDir: dir, item, entry, plan, local, base, today: '2026-08-27' });
    expect(await fs.readdir(path.join(dir, '.skilled', 'tmp'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/apply.test.ts`
Expected: FAIL with "Failed to resolve import ../src/apply.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/apply.ts
import path from 'node:path';
import { basePath, stateDir } from './config.js';
import { readManifest, upsertEntry, writeManifest } from './manifest.js';
import { removeIfPresent, writeFileAtomic, writeTreeAtomic } from './tree.js';
import type { ItemPlan } from './plan.js';
import type { Entry, LocalItem } from './types.js';

export interface ApplyArgs {
  managedDir: string;
  item: LocalItem;
  entry: Entry;
  plan: ItemPlan;
  /** LOCAL as it was read before the plan was computed */
  local: Map<string, string>;
  /** BASE as it was read before the plan was computed */
  base: Map<string, string>;
  /** ISO 8601 date, YYYY-MM-DD */
  today: string;
}

export interface ApplyResult {
  /** relative paths written to LOCAL */
  written: string[];
  /** relative paths removed from LOCAL */
  removed: string[];
}

export async function applyPlan(args: ApplyArgs): Promise<ApplyResult> {
  const written: string[] = [];
  const removed: string[] = [];
  const nextBase = new Map(args.base);

  // 1. LOCAL, file by file, each write atomic on its own.
  for (const file of args.plan.files) {
    const target =
      file.relPath === '' ? args.item.absPath : path.join(args.item.absPath, file.relPath);

    if (file.local === null) {
      if (args.local.has(file.relPath)) {
        await removeIfPresent(target);
        removed.push(file.relPath);
      }
    } else if (args.local.get(file.relPath) !== file.local) {
      await writeFileAtomic(target, file.local);
      written.push(file.relPath);
    }

    if (file.base === null) nextBase.delete(file.relPath);
    else nextBase.set(file.relPath, file.base);
  }

  // 2. BASE, as one swap. skilled owns this directory outright.
  await writeTreeAtomic(
    basePath(args.managedDir, args.item.id),
    nextBase,
    path.join(stateDir(args.managedDir), 'tmp'),
  );

  // 3. The manifest last: base.commit is what makes the update official.
  const manifest = await readManifest(args.managedDir);
  const advanced: Entry = {
    ...args.entry,
    base: { commit: args.plan.upstreamSha, adoptedAt: args.today, reconstructed: false },
  };
  await writeManifest(args.managedDir, upsertEntry(manifest, advanced));

  return { written, removed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/apply.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/apply.ts tests/apply.test.ts
git commit -m "feat(apply): write LOCAL and advance BASE for an approved plan"
```

---

### Task 16: The real `ClaudeClient`

**Files:**
- Create: `src/claude.ts`
- Test: `tests/claude.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient` from `src/clients.ts`; `spawn` from `node:child_process`.
- Produces: `createClaudeClient(deps?: Partial<ClaudeExecDeps>): ClaudeClient`, `ClaudeExecDeps { exec: (file: string, args: string[], input: string) => Promise<{ stdout: string }> }`.

Both methods return `null` rather than throwing — that is what the interface means by "cannot identify" and "gives up", and it covers the `claude` CLI being absent. The caller prints the fix line. `resolveConflict` returns `null` if the answer still contains conflict markers, so a lazy answer can never be written to disk.

- [ ] **Step 1: Write the failing test**

````ts
// tests/claude.test.ts
import { describe, it, expect } from 'vitest';
import { createClaudeClient } from '../src/claude.js';

const FENCE = '```';

describe('createClaudeClient.identify', () => {
  it('returns the owner/name it was given', async () => {
    const client = createClaudeClient({ exec: async () => ({ stdout: 'DietrichGebert/ponytail\n' }) });
    expect(await client.identify('# Ponytail\n')).toBe('DietrichGebert/ponytail');
  });

  it('returns null for NONE', async () => {
    const client = createClaudeClient({ exec: async () => ({ stdout: 'NONE\n' }) });
    expect(await client.identify('# Mystery\n')).toBeNull();
  });

  it('returns null when the claude CLI is unavailable', async () => {
    const client = createClaudeClient({
      exec: async () => {
        throw new Error('spawn claude ENOENT');
      },
    });
    expect(await client.identify('# Mystery\n')).toBeNull();
  });

  it('passes the excerpt on stdin, not as an argument', async () => {
    const seen: Array<{ file: string; args: string[]; input: string }> = [];
    const client = createClaudeClient({
      exec: async (file, args, input) => {
        seen.push({ file, args, input });
        return { stdout: 'acme/skills\n' };
      },
    });
    await client.identify('a rare phrase from the file');
    expect(seen[0].file).toBe('claude');
    expect(seen[0].args).toEqual(['-p', '--output-format', 'text']);
    expect(seen[0].input).toContain('a rare phrase from the file');
  });
});

describe('createClaudeClient.resolveConflict', () => {
  const conflicted = [
    '# Demo',
    '<<<<<<< LOCAL (your copy)',
    'mine',
    '=======',
    'theirs',
    '>>>>>>> UPSTREAM',
    '',
  ].join('\n');

  it('returns the content inside a fenced block', async () => {
    const client = createClaudeClient({
      exec: async () => ({ stdout: `Here you go:\n${FENCE}markdown\n# Demo\nmine and theirs\n${FENCE}\n` }),
    });
    const merged = await client.resolveConflict({
      base: '# Demo\nbase\n',
      local: '# Demo\nmine\n',
      upstream: '# Demo\ntheirs\n',
      conflicted,
    });
    expect(merged).toBe('# Demo\nmine and theirs\n');
  });

  it('accepts an unfenced answer', async () => {
    const client = createClaudeClient({ exec: async () => ({ stdout: '# Demo\nmine and theirs\n' }) });
    const merged = await client.resolveConflict({ base: '', local: '', upstream: '', conflicted });
    expect(merged).toBe('# Demo\nmine and theirs\n');
  });

  it('refuses an answer that still contains conflict markers', async () => {
    const client = createClaudeClient({ exec: async () => ({ stdout: conflicted }) });
    expect(await client.resolveConflict({ base: '', local: '', upstream: '', conflicted })).toBeNull();
  });

  it('returns null for an empty answer or a failed call', async () => {
    const empty = createClaudeClient({ exec: async () => ({ stdout: '   \n' }) });
    expect(await empty.resolveConflict({ base: '', local: '', upstream: '', conflicted })).toBeNull();
    const broken = createClaudeClient({
      exec: async () => {
        throw new Error('spawn claude ENOENT');
      },
    });
    expect(await broken.resolveConflict({ base: '', local: '', upstream: '', conflicted })).toBeNull();
  });

  it('sends all three versions and the conflicted file', async () => {
    let input = '';
    const client = createClaudeClient({
      exec: async (_file, _args, stdin) => {
        input = stdin;
        return { stdout: 'ok\n' };
      },
    });
    await client.resolveConflict({
      base: 'BASE TEXT',
      local: 'LOCAL TEXT',
      upstream: 'UPSTREAM TEXT',
      conflicted,
    });
    expect(input).toContain('BASE TEXT');
    expect(input).toContain('LOCAL TEXT');
    expect(input).toContain('UPSTREAM TEXT');
    expect(input).toContain('<<<<<<< LOCAL (your copy)');
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/claude.test.ts`
Expected: FAIL with "Failed to resolve import ../src/claude.js"

- [ ] **Step 3: Write minimal implementation**

````ts
// src/claude.ts
import { spawn } from 'node:child_process';
import type { ClaudeClient } from './clients.js';

export interface ClaudeExecDeps {
  exec: (file: string, args: string[], input: string) => Promise<{ stdout: string }>;
}

const CLI_ARGS = ['-p', '--output-format', 'text'];
const FENCE = '```';
const MAX_EXCERPT = 4000;

export function createClaudeClient(deps: Partial<ClaudeExecDeps> = {}): ClaudeClient {
  const exec = deps.exec ?? spawnClaude;

  return {
    async identify(excerpt: string): Promise<string | null> {
      const prompt = [
        'You are identifying where an AI agent instruction file came from.',
        'Answer with exactly one GitHub repository as "owner/name", or the single word NONE.',
        'No prose, no punctuation, no explanation.',
        '--- file excerpt ---',
        excerpt.slice(0, MAX_EXCERPT),
      ].join('\n');

      let stdout: string;
      try {
        ({ stdout } = await exec('claude', CLI_ARGS, prompt));
      } catch {
        return null;
      }
      const match = stdout.match(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/m);
      return match === null ? null : match[0];
    },

    async resolveConflict(args: {
      base: string;
      local: string;
      upstream: string;
      conflicted: string;
    }): Promise<string | null> {
      const prompt = [
        'Resolve a three-way merge conflict in an AI agent instruction file.',
        'BASE is what the user originally adopted. LOCAL is their edited copy.',
        'UPSTREAM is the current version from the author.',
        'Keep the intent of the local edit and the substance of the upstream change.',
        `Reply with the merged file only, inside one ${FENCE} fenced block. No commentary.`,
        'If you cannot preserve both, reply with the single word GIVEUP.',
        '--- BASE ---',
        args.base,
        '--- LOCAL ---',
        args.local,
        '--- UPSTREAM ---',
        args.upstream,
        '--- CONFLICTED MERGE ---',
        args.conflicted,
      ].join('\n');

      let stdout: string;
      try {
        ({ stdout } = await exec('claude', CLI_ARGS, prompt));
      } catch {
        return null;
      }
      if (stdout.includes('GIVEUP')) return null;

      const merged = extractContent(stdout);
      if (merged === null) return null;
      if (merged.includes('<<<<<<<') || merged.includes('>>>>>>>')) return null;
      return merged;
    },
  };
}

function extractContent(raw: string): string | null {
  const lines = raw.split('\n');
  const openIndex = lines.findIndex((line) => line.trimStart().startsWith(FENCE));
  if (openIndex !== -1) {
    const rest = lines.slice(openIndex + 1);
    const closeIndex = rest.findIndex((line) => line.trimStart().startsWith(FENCE));
    const body = closeIndex === -1 ? rest : rest.slice(0, closeIndex);
    const text = body.join('\n');
    return text.trim() === '' ? null : withTrailingNewline(text);
  }
  return raw.trim() === '' ? null : withTrailingNewline(raw.trim());
}

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

async function spawnClaude(
  file: string,
  args: string[],
  input: string,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`claude exited with code ${String(code)}`));
    });
    child.stdin.end(input, 'utf8');
  });
}
````

The fenced-block test expects `'# Demo\nmine and theirs\n'`: the body between the fences is `# Demo\nmine and theirs`, and `withTrailingNewline` restores the final newline that the fence consumed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/claude.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/claude.ts tests/claude.test.ts
git commit -m "feat(claude): real ClaudeClient over the claude CLI"
```

---

### Task 17: The three review screens

**Files:**
- Create: `src/render/update.ts`
- Test: `tests/render/update.test.ts`

**Interfaces:**
- Consumes: `ANSI`, `paint`, `RenderDiffOptions` from `src/render/diff.ts`; `ItemPlan` from `src/plan.ts`; `Entry` from `src/types.ts`.
- Produces: `planCase(plan: ItemPlan): UpdateCase` where `UpdateCase = 'clean' | 'merged' | 'conflict'`, `renderItemHeader(plan: ItemPlan, entry: Entry): string`, `renderPlanSummary(plan: ItemPlan, opts?: RenderDiffOptions): string`, `renderMenu(kind: UpdateCase): Array<{ key: string; label: string }>`, `renderMenuLine(keys: Array<{ key: string; label: string }>): string`.

The three cases come straight from the design doc's Update journey. `q` appears in every menu so the user can always leave a review loop.

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/update.test.ts
import { describe, it, expect } from 'vitest';
import {
  planCase,
  renderItemHeader,
  renderMenu,
  renderMenuLine,
  renderPlanSummary,
} from '../../src/render/update.js';
import type { FilePlan, ItemPlan } from '../../src/plan.js';
import type { Entry, Source } from '../../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/cso' };

function file(overrides: Partial<FilePlan>): FilePlan {
  return {
    relPath: 'SKILL.md',
    kind: 'merged-clean',
    local: 'x',
    base: 'x',
    conflictCount: 0,
    added: 0,
    removed: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<ItemPlan>): ItemPlan {
  return {
    id: 'skills/cso',
    source: SOURCE,
    upstreamSha: 'b'.repeat(40),
    upstreamDate: '2026-08-09',
    behindBy: 6,
    localEdits: false,
    editedFiles: 0,
    files: [file({ added: 142, removed: 18 })],
    conflicts: 0,
    blocked: null,
    ...overrides,
  };
}

const ENTRY: Entry = {
  id: 'skills/cso',
  source: SOURCE,
  base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: false },
  detection: { method: 'code-search', confidence: 0.92, confirmedBy: 'user', evidence: 'matched 14 lines' },
};

describe('planCase', () => {
  it('is clean with no edits, merged with edits, conflict when conflicts exist', () => {
    expect(planCase(plan({}))).toBe('clean');
    expect(planCase(plan({ localEdits: true, editedFiles: 1 }))).toBe('merged');
    expect(planCase(plan({ localEdits: true, editedFiles: 1, conflicts: 1 }))).toBe('conflict');
    expect(planCase(plan({ conflicts: 2 }))).toBe('conflict');
  });
});

describe('renderItemHeader', () => {
  it('names the entry, the distance and both dates', () => {
    expect(renderItemHeader(plan({}), ENTRY)).toBe(
      'skills/cso — 6 commits behind (adopted 2026-05-12, upstream now 2026-08-09)',
    );
  });

  it('uses the singular for one commit', () => {
    expect(renderItemHeader(plan({ behindBy: 1 }), ENTRY)).toContain('1 commit behind');
  });

  it('marks a reconstructed base', () => {
    const entry: Entry = { ...ENTRY, base: { ...ENTRY.base, reconstructed: true } };
    expect(renderItemHeader(plan({}), entry)).toContain('[base reconstructed]');
  });
});

describe('renderPlanSummary', () => {
  it('renders the no-local-edits case', () => {
    expect(renderPlanSummary(plan({}))).toBe(
      ['  Your edits:  none', '  Upstream:    +142 −18 lines across 1 file'].join('\n'),
    );
  });

  it('renders the clean-merge case and says the edits are preserved', () => {
    const out = renderPlanSummary(
      plan({ localEdits: true, editedFiles: 2, files: [file({ added: 4, removed: 1 })] }),
    );
    expect(out).toContain('⚠ You edited this item. Merging your 2 changed files with upstream\'s 1 change.');
    expect(out).toContain('Merged cleanly — your edits are preserved.');
    expect(out).toContain('  Result:      +4 −1 lines across 1 file');
  });

  it('renders the conflict case and states that nothing was written', () => {
    const out = renderPlanSummary(
      plan({
        localEdits: true,
        editedFiles: 1,
        conflicts: 1,
        files: [file({ kind: 'conflict', conflictCount: 1, added: 3, removed: 1 })],
      }),
    );
    expect(out).toContain('✗ Conflict in SKILL.md: upstream and your edits changed the same 1 region.');
    expect(out).toContain('Nothing has been written to disk.');
  });

  it('lists files added, removed and kept', () => {
    const out = renderPlanSummary(
      plan({
        localEdits: true,
        editedFiles: 1,
        files: [
          file({ relPath: 'references/tone.md', kind: 'added-upstream', added: 2 }),
          file({ relPath: 'evals/old.md', kind: 'deleted-upstream', local: null, base: null, removed: 3 }),
          file({ relPath: 'evals/mine.md', kind: 'kept-local-deleted-upstream', base: null }),
        ],
      }),
    );
    expect(out).toContain('+ Upstream added references/tone.md — it will be created.');
    expect(out).toContain('− Upstream deleted evals/old.md (you never edited it) — it will be removed.');
    expect(out).toContain('⚠ Upstream deleted evals/mine.md, but you had edited it — your copy is kept.');
  });
});

describe('renderMenu', () => {
  it('offers diff/apply/skip/quit with no local edits', () => {
    expect(renderMenu('clean').map((k) => k.key)).toEqual(['d', 'a', 's', 'q']);
    expect(renderMenu('clean')[0].label).toBe('diff');
    expect(renderMenu('clean')[1].label).toBe('apply');
  });

  it('offers review/accept/skip/quit after a clean merge', () => {
    expect(renderMenu('merged').map((k) => k.key)).toEqual(['d', 'a', 's', 'q']);
    expect(renderMenu('merged')[0].label).toBe('review merged result');
    expect(renderMenu('merged')[1].label).toBe('accept');
  });

  it('offers claude/editor/skip/quit on a conflict', () => {
    expect(renderMenu('conflict').map((k) => k.key)).toEqual(['c', 'e', 's', 'q']);
    expect(renderMenu('conflict')[0].label).toBe('let Claude resolve it');
    expect(renderMenu('conflict')[1].label).toBe('open in $EDITOR with conflict markers');
  });

  it('formats the menu line', () => {
    expect(renderMenuLine(renderMenu('clean'))).toBe('  [d] diff   [a] apply   [s] skip   [q] quit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/update.test.ts`
Expected: FAIL with "Failed to resolve import ../../src/render/update.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/update.ts
import { ANSI, paint, type RenderDiffOptions } from './diff.js';
import type { FilePlan, ItemPlan } from '../plan.js';
import type { Entry } from '../types.js';

export type UpdateCase = 'clean' | 'merged' | 'conflict';

export function planCase(plan: ItemPlan): UpdateCase {
  if (plan.conflicts > 0) return 'conflict';
  return plan.localEdits ? 'merged' : 'clean';
}

export function renderItemHeader(plan: ItemPlan, entry: Entry): string {
  const distance = plural(plan.behindBy, 'commit', 'commits');
  const reconstructed = entry.base.reconstructed ? '  [base reconstructed]' : '';
  return `${plan.id} — ${distance} behind (adopted ${entry.base.adoptedAt}, upstream now ${plan.upstreamDate})${reconstructed}`;
}

export function renderPlanSummary(plan: ItemPlan, opts: RenderDiffOptions = {}): string {
  const color = opts.color ?? false;
  const added = plan.files.reduce((total, file) => total + file.added, 0);
  const removed = plan.files.reduce((total, file) => total + file.removed, 0);
  const touched = plan.files.filter(isTouched).length;
  const lines: string[] = [];

  const kind = planCase(plan);
  if (kind === 'clean') {
    lines.push('  Your edits:  none');
    lines.push(`  Upstream:    +${added} −${removed} lines across ${plural(touched, 'file', 'files')}`);
  } else if (kind === 'merged') {
    lines.push(
      paint(
        `  ⚠ You edited this item. Merging your ${plural(plan.editedFiles, 'changed file', 'changed files')} with upstream's ${plural(touched, 'change', 'changes')}.`,
        ANSI.yellow,
        color,
      ),
    );
    lines.push('  Merged cleanly — your edits are preserved.');
    lines.push(`  Result:      +${added} −${removed} lines across ${plural(touched, 'file', 'files')}`);
  } else {
    for (const file of plan.files.filter((candidate) => candidate.kind === 'conflict')) {
      const where = file.relPath === '' ? 'this file' : file.relPath;
      lines.push(
        paint(
          `  ✗ Conflict in ${where}: upstream and your edits changed the same ${plural(file.conflictCount, 'region', 'regions')}.`,
          ANSI.red,
          color,
        ),
      );
    }
    lines.push('  Nothing has been written to disk.');
  }

  for (const file of plan.files) {
    if (file.kind === 'added-upstream') {
      lines.push(`  + Upstream added ${file.relPath} — it will be created.`);
    } else if (file.kind === 'deleted-upstream' && file.removed > 0) {
      lines.push(`  − Upstream deleted ${file.relPath} (you never edited it) — it will be removed.`);
    } else if (file.kind === 'kept-local-deleted-upstream') {
      lines.push(
        paint(
          `  ⚠ Upstream deleted ${file.relPath}, but you had edited it — your copy is kept.`,
          ANSI.yellow,
          color,
        ),
      );
    }
  }

  return lines.join('\n');
}

export function renderMenu(kind: UpdateCase): Array<{ key: string; label: string }> {
  if (kind === 'clean') {
    return [
      { key: 'd', label: 'diff' },
      { key: 'a', label: 'apply' },
      { key: 's', label: 'skip' },
      { key: 'q', label: 'quit' },
    ];
  }
  if (kind === 'merged') {
    return [
      { key: 'd', label: 'review merged result' },
      { key: 'a', label: 'accept' },
      { key: 's', label: 'skip' },
      { key: 'q', label: 'quit' },
    ];
  }
  return [
    { key: 'c', label: 'let Claude resolve it' },
    { key: 'e', label: 'open in $EDITOR with conflict markers' },
    { key: 's', label: 'skip' },
    { key: 'q', label: 'quit' },
  ];
}

export function renderMenuLine(keys: Array<{ key: string; label: string }>): string {
  return `  ${keys.map((entry) => `[${entry.key}] ${entry.label}`).join('   ')}`;
}

function isTouched(file: FilePlan): boolean {
  return file.added > 0 || file.removed > 0 || file.local === null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/update.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/render/update.ts tests/render/update.test.ts
git commit -m "feat(render): the three update review screens and their menus"
```

---

### Task 18: Collecting plans, and the non-interactive report

**Files:**
- Create: `src/update.ts`
- Test: `tests/update.test.ts`

**Interfaces:**
- Consumes: `discover`, `readItemContent` from `src/discover.ts`; `readManifest`, `writeManifest`, `upsertEntry`, `findEntry` from `src/manifest.ts`; `resolveName` from `src/cli.ts`; `basePath`, `stateDir` from `src/config.ts`; `readBase`, `writeTreeAtomic` from `src/tree.ts`; `planItem` from `src/plan.ts`; `reconstructBase` from `src/reconstruct.ts`; `renderItemHeader`, `renderPlanSummary` from `src/render/update.ts`; `SkilledError` from `src/errors.ts`; `GitHubClient`, `ClaudeClient` from `src/clients.ts`.
- Produces: `UpdateDeps`, `PlannedItem`, `collectPlans(managedDir: string, name: string | undefined, deps: UpdateDeps): Promise<PlannedItem[]>`, `updateReportJson(managedDir: string, plans: PlannedItem[]): string`, `renderDryRun(plans: PlannedItem[], deps: UpdateDeps): void`.

**Non-interactive rule:** with `--json` or a non-TTY stdin, nothing prompts and nothing is written — not even a reconstructed BASE, so a dry run stays a dry run.

- [ ] **Step 1: Write the failing test**

```ts
// tests/update.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../src/config.js';
import { readManifest } from '../src/manifest.js';
import { SkilledError } from '../src/errors.js';
import {
  collectPlans,
  renderDryRun,
  updateReportJson,
  type UpdateDeps,
} from '../src/update.js';
import {
  entryFor,
  fakeGitHub,
  makeManagedDir,
  pathExists,
  writeBaseTree,
  writeEntry,
  writeItem,
  type Fixture,
} from './helpers/update-fixture.js';
import type { GitHubClient } from '../src/clients.js';
import type { Source } from '../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/skills', ref: 'main', subpath: 'skills/demo' };
const KEY = 'acme/skills#main#skills/demo';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

const BASE_TEXT = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be careful', ''].join('\n');
const LOCAL_EDITED = ['# Demo', '', '## Usage', 'run it', 'run it twice', '', '## Notes', 'be careful', ''].join('\n');
const UPSTREAM_TEXT = ['# Demo', '', '## Usage', 'run it', '', '## Notes', 'be very careful', ''].join('\n');

let fixture: Fixture | null = null;

afterEach(async () => {
  if (fixture) await fixture.cleanup();
  fixture = null;
});

function twoCommitUpstream(treeAtNew: Record<string, string>): GitHubClient {
  return fakeGitHub({
    [KEY]: {
      commits: [
        { sha: NEW, date: '2026-08-09T10:00:00Z', message: 'tighten wording' },
        { sha: OLD, date: '2026-05-12T10:00:00Z', message: 'initial' },
      ],
      trees: { [NEW]: treeAtNew, [OLD]: { 'SKILL.md': BASE_TEXT } },
    },
  });
}

interface Harness {
  deps: UpdateDeps;
  out: string[];
}

function harness(overrides: Partial<UpdateDeps> = {}): Harness {
  const out: string[] = [];
  const deps: UpdateDeps = {
    github: twoCommitUpstream({ 'SKILL.md': UPSTREAM_TEXT }),
    claude: {
      identify: async () => null,
      resolveConflict: async () => null,
    },
    prompt: async () => {
      throw new Error('prompt must not be called');
    },
    openEditor: async () => {
      throw new Error('editor must not be called');
    },
    interactive: false,
    json: false,
    color: false,
    today: '2026-08-27',
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => out.push(line),
    ...overrides,
  };
  return { deps, out };
}

async function seedTrackedItem(dir: string, localText: string): Promise<void> {
  await writeItem(dir, 'skills/demo', { 'SKILL.md': localText });
  await writeBaseTree(dir, 'skills/demo', { 'SKILL.md': BASE_TEXT });
  await writeEntry(dir, entryFor('skills/demo', SOURCE, OLD));
}

describe('collectPlans', () => {
  it('plans a stale item and counts how far behind it is', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps } = harness();
    const plans = await collectPlans(fixture.dir, undefined, deps);
    expect(plans).toHaveLength(1);
    expect(plans[0].plan.behindBy).toBe(1);
    expect(plans[0].plan.upstreamSha).toBe(NEW);
    expect(plans[0].plan.upstreamDate).toBe('2026-08-09');
    expect(plans[0].plan.localEdits).toBe(false);
    expect(plans[0].reconstructed).toBeNull();
  });

  it('sees local edits without losing them', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, LOCAL_EDITED);
    const { deps } = harness();
    const plans = await collectPlans(fixture.dir, undefined, deps);
    expect(plans[0].plan.localEdits).toBe(true);
    expect(plans[0].plan.conflicts).toBe(0);
    expect(plans[0].plan.files[0].local).toContain('run it twice');
    expect(plans[0].plan.files[0].local).toContain('be very careful');
  });

  it('returns nothing for an item already at the upstream head', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/demo', { 'SKILL.md': UPSTREAM_TEXT });
    await writeBaseTree(fixture.dir, 'skills/demo', { 'SKILL.md': UPSTREAM_TEXT });
    await writeEntry(fixture.dir, entryFor('skills/demo', SOURCE, NEW));
    const { deps } = harness();
    expect(await collectPlans(fixture.dir, undefined, deps)).toEqual([]);
  });

  it('ignores items with no manifest entry when no name was given', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    await writeItem(fixture.dir, 'skills/mystery', { 'SKILL.md': '# Mystery\n' });
    const { deps } = harness();
    const plans = await collectPlans(fixture.dir, undefined, deps);
    expect(plans.map((p) => p.item.id)).toEqual(['skills/demo']);
  });

  it('raises UNKNOWN_ENTRY with exit code 2 for a named item with no source', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/mystery', { 'SKILL.md': '# Mystery\n' });
    const { deps } = harness();
    let error: unknown;
    try {
      await collectPlans(fixture.dir, 'mystery', deps);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SkilledError);
    expect((error as SkilledError).code).toBe('UNKNOWN_ENTRY');
    expect((error as SkilledError).exitCode).toBe(2);
    expect((error as SkilledError).cause).toContain('No managed file was modified.');
  });

  it('reconstructs a missing base and records it when interactive', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/demo', { 'SKILL.md': BASE_TEXT });
    await writeEntry(fixture.dir, entryFor('skills/demo', SOURCE, ''));
    const { deps } = harness({ interactive: true });
    const plans = await collectPlans(fixture.dir, undefined, deps);

    expect(plans).toHaveLength(1);
    expect(plans[0].reconstructed).toContain('reconstructed base from commit');
    expect(plans[0].plan.behindBy).toBe(1);
    expect(await fs.readFile(path.join(basePath(fixture.dir, 'skills/demo'), 'SKILL.md'), 'utf8')).toBe(BASE_TEXT);
    const manifest = await readManifest(fixture.dir);
    expect(manifest.entries[0].base.commit).toBe(OLD);
    expect(manifest.entries[0].base.reconstructed).toBe(true);
    expect(manifest.entries[0].base.adoptedAt).toBe('2026-05-12');
  });

  it('does not persist a reconstructed base in a dry run', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/demo', { 'SKILL.md': BASE_TEXT });
    await writeEntry(fixture.dir, entryFor('skills/demo', SOURCE, ''));
    const { deps } = harness({ interactive: false });
    const plans = await collectPlans(fixture.dir, undefined, deps);
    expect(plans).toHaveLength(1);
    expect(await pathExists(basePath(fixture.dir, 'skills/demo'))).toBe(false);
    const manifest = await readManifest(fixture.dir);
    expect(manifest.entries[0].base.commit).toBe('');
  });

  it('skips an item whose local copy matches nothing upstream', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/demo', { 'SKILL.md': 'nothing\nlike\nupstream\nat\nall\n' });
    await writeEntry(fixture.dir, entryFor('skills/demo', SOURCE, ''));
    const { deps, out } = harness({ interactive: true });
    expect(await collectPlans(fixture.dir, undefined, deps)).toEqual([]);
    expect(out.join('\n')).toContain('no recorded base');
    expect(out.join('\n')).toContain('skilled add');
  });
});

describe('updateReportJson', () => {
  it('serialises what would change without writing anything', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, LOCAL_EDITED);
    const { deps } = harness();
    const plans = await collectPlans(fixture.dir, undefined, deps);
    const report = JSON.parse(updateReportJson(fixture.dir, plans)) as {
      dir: string;
      written: boolean;
      conflicts: number;
      items: Array<{
        id: string;
        behindBy: number;
        localEdits: boolean;
        upstreamSha: string;
        baseReconstructed: boolean;
        files: Array<{ relPath: string; kind: string; added: number; removed: number; conflictCount: number }>;
      }>;
    };
    expect(report.dir).toBe(fixture.dir);
    expect(report.written).toBe(false);
    expect(report.conflicts).toBe(0);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].id).toBe('skills/demo');
    expect(report.items[0].behindBy).toBe(1);
    expect(report.items[0].localEdits).toBe(true);
    expect(report.items[0].upstreamSha).toBe(NEW);
    expect(report.items[0].baseReconstructed).toBe(false);
    expect(report.items[0].files[0]).toEqual({
      relPath: 'SKILL.md',
      kind: 'merged-clean',
      added: 1,
      removed: 1,
      conflictCount: 0,
    });
  });
});

describe('renderDryRun', () => {
  it('prints each item and states that nothing was written', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps, out } = harness();
    const plans = await collectPlans(fixture.dir, undefined, deps);
    renderDryRun(plans, deps);
    const text = out.join('\n');
    expect(text).toContain('skills/demo — 1 commit behind');
    expect(text).toContain('Your edits:  none');
    expect(text).toContain('Nothing was written.');
    expect(text).toContain('skilled update');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.test.ts`
Expected: FAIL with "Failed to resolve import ../src/update.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/update.ts
import path from 'node:path';
import { basePath, stateDir } from './config.js';
import { discover, readItemContent } from './discover.js';
import { SkilledError } from './errors.js';
import { findEntry, readManifest, upsertEntry, writeManifest } from './manifest.js';
import { planItem, type ItemPlan } from './plan.js';
import { reconstructBase } from './reconstruct.js';
import { readBase, writeTreeAtomic } from './tree.js';
import { renderItemHeader, renderPlanSummary } from './render/update.js';
import { resolveName } from './cli.js';
import type { ClaudeClient, GitHubClient } from './clients.js';
import type { Entry, LocalItem } from './types.js';

export interface UpdateDeps {
  github: GitHubClient;
  claude: ClaudeClient;
  /** injected so tests never touch a TTY */
  prompt: (message: string, keys: Array<{ key: string; label: string }>) => Promise<string>;
  openEditor: (filePath: string) => Promise<void>;
  /** false when stdin is not a TTY or --json was passed: never prompt, never write */
  interactive: boolean;
  json: boolean;
  color: boolean;
  /** ISO 8601 date, YYYY-MM-DD */
  today: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface PlannedItem {
  item: LocalItem;
  /** the entry as it will be used, including a reconstructed base */
  entry: Entry;
  plan: ItemPlan;
  local: Map<string, string>;
  base: Map<string, string>;
  upstream: Map<string, string>;
  /** one evidence line when BASE had to be inferred, else null */
  reconstructed: string | null;
}

export async function collectPlans(
  managedDir: string,
  name: string | undefined,
  deps: UpdateDeps,
): Promise<PlannedItem[]> {
  const items = await discover(managedDir);
  const manifest = await readManifest(managedDir);
  const targets = name === undefined ? items : [resolveName(name, items)];
  const planned: PlannedItem[] = [];

  for (const item of targets) {
    const found = findEntry(manifest, item.id);
    if (found === undefined) {
      if (name !== undefined) throw unknownEntry(item.id);
      continue;
    }

    let entry = found;
    const local = await readItemContent(item);
    let base = await readBase(managedDir, item.id);
    let reconstructed: string | null = null;

    if (base === null) {
      const inferred = await reconstructBase({ source: entry.source, local, github: deps.github });
      if (inferred === null) {
        deps.stdout(
          `${item.id} — skipped: there is no recorded base, and no recent upstream commit matches your copy closely enough to infer one.`,
        );
        deps.stdout(`  → skilled add <url> ${item.id}   point it at the right source`);
        continue;
      }
      base = inferred.tree;
      reconstructed = inferred.evidence;
      entry = {
        ...entry,
        base: { commit: inferred.commit, adoptedAt: inferred.adoptedAt, reconstructed: true },
      };
      if (deps.interactive && !deps.json) {
        // Writing inside .skilled/ needs no approval, and it makes the next run cheap.
        await writeTreeAtomic(
          basePath(managedDir, item.id),
          base,
          path.join(stateDir(managedDir), 'tmp'),
        );
        await writeManifest(managedDir, upsertEntry(await readManifest(managedDir), entry));
      }
    }

    const commits = await deps.github.listCommits(entry.source);
    if (commits.length === 0) continue;
    const index = commits.findIndex((commit) => commit.sha === entry.base.commit);
    const behindBy = index === -1 ? commits.length : index;
    if (behindBy === 0) continue;

    const head = commits[0];
    const upstream = await deps.github.readTree(entry.source, head.sha);
    const plan = planItem({
      id: item.id,
      source: entry.source,
      upstreamSha: head.sha,
      upstreamDate: head.date.slice(0, 10),
      behindBy,
      base,
      local,
      upstream,
    });
    planned.push({ item, entry, plan, local, base, upstream, reconstructed });
  }

  return planned;
}

export function updateReportJson(managedDir: string, plans: PlannedItem[]): string {
  return JSON.stringify(
    {
      dir: managedDir,
      written: false,
      conflicts: plans.reduce((total, planned) => total + planned.plan.conflicts, 0),
      items: plans.map((planned) => ({
        id: planned.plan.id,
        source: planned.plan.source,
        behindBy: planned.plan.behindBy,
        upstreamSha: planned.plan.upstreamSha,
        localEdits: planned.plan.localEdits,
        conflicts: planned.plan.conflicts,
        baseReconstructed: planned.entry.base.reconstructed,
        files: planned.plan.files.map((file) => ({
          relPath: file.relPath,
          kind: file.kind,
          added: file.added,
          removed: file.removed,
          conflictCount: file.conflictCount,
        })),
      })),
    },
    null,
    2,
  );
}

export function renderDryRun(plans: PlannedItem[], deps: UpdateDeps): void {
  for (const planned of plans) {
    deps.stdout('');
    deps.stdout(renderItemHeader(planned.plan, planned.entry));
    if (planned.reconstructed !== null) deps.stdout(`  ${planned.reconstructed}`);
    deps.stdout(renderPlanSummary(planned.plan, { color: deps.color }));
  }
  deps.stdout('');
  deps.stdout('Nothing was written. Run `skilled update` in a terminal to review and apply each change.');
}

function unknownEntry(id: string): SkilledError {
  return new SkilledError({
    code: 'UNKNOWN_ENTRY',
    problem: `${id}: skilled does not know where it came from.`,
    cause:
      `No manifest entry names a source for "${id}", so there is nothing to compare it against.\n` +
      'No managed file was modified.',
    fixes: [
      `skilled add <url> ${id}      record where it came from`,
      'skilled                                run detection again',
    ],
    exitCode: 2,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/update.ts tests/update.test.ts
git commit -m "feat(update): collect update plans and report them non-interactively"
```

---

### Task 19: The review loop — no local edits, and clean merges

**Files:**
- Modify: `src/update.ts`
- Test: `tests/update.test.ts`

**Interfaces:**
- Consumes: `collectPlans`, `updateReportJson`, `renderDryRun`, `PlannedItem`, `UpdateDeps` from Task 18; `applyPlan` from `src/apply.ts`; `planCase`, `renderMenu`, `renderMenuLine`, `renderItemHeader`, `renderPlanSummary` from `src/render/update.ts`; `renderUnifiedDiff` from `src/render/diff.ts`.
- Produces: `runUpdate(managedDir: string, name: string | undefined, deps: UpdateDeps): Promise<number>` — the exit code for one managed directory. `0` when everything was applied or skipped cleanly, `4` when a conflict was left unresolved.

- [ ] **Step 1: Write the failing test**

Append to `tests/update.test.ts`:

```ts
import { runUpdate } from '../src/update.js';

function queuedPrompt(answers: string[]): UpdateDeps['prompt'] {
  return async () => {
    const next = answers.shift();
    if (next === undefined) throw new Error('prompt was called more times than expected');
    return next;
  };
}

describe('runUpdate — no local edits', () => {
  it('applies the upstream change on [a] and advances the base', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt(['a']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(UPSTREAM_TEXT);
    expect(await fs.readFile(path.join(basePath(fixture.dir, 'skills/demo'), 'SKILL.md'), 'utf8')).toBe(UPSTREAM_TEXT);

    const manifest = await readManifest(fixture.dir);
    expect(manifest.entries[0].base).toEqual({ commit: NEW, adoptedAt: '2026-08-27', reconstructed: false });
    expect(out.join('\n')).toContain('applied');
    expect(out.join('\n')).toContain('1 applied');
  });

  it('shows a diff on [d] and still waits for a decision', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt(['d', 's']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('--- SKILL.md  (your copy)');
    expect(text).toContain('-be careful');
    expect(text).toContain('+be very careful');
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(BASE_TEXT);
  });

  it('writes nothing on [s]', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps } = harness({ interactive: true, prompt: queuedPrompt(['s']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(BASE_TEXT);
    expect((await readManifest(fixture.dir)).entries[0].base.commit).toBe(OLD);
  });

  it('stops immediately on [q]', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps } = harness({ interactive: true, prompt: queuedPrompt(['q']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(BASE_TEXT);
  });
});

describe('runUpdate — local edits, clean merge', () => {
  it('preserves the local edit and takes the upstream change on [a]', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, LOCAL_EDITED);
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt(['a']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    const merged = await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8');
    expect(merged).toContain('run it twice');
    expect(merged).toContain('be very careful');

    const text = out.join('\n');
    expect(text).toContain('You edited this item');
    expect(text).toContain('Merged cleanly — your edits are preserved.');
  });

  it('offers "review merged result" rather than a plain diff', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, LOCAL_EDITED);
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt(['s']) });

    await runUpdate(fixture.dir, undefined, deps);
    expect(out.join('\n')).toContain('[d] review merged result   [a] accept');
  });
});

describe('runUpdate — non-interactive', () => {
  it('prints JSON and writes nothing', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps, out } = harness({ interactive: false, json: true });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    const report = JSON.parse(out.join('\n')) as { written: boolean; items: unknown[] };
    expect(report.written).toBe(false);
    expect(report.items).toHaveLength(1);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(BASE_TEXT);
  });

  it('reports what would change on a non-TTY without prompting', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const { deps, out } = harness({ interactive: false, json: false });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(out.join('\n')).toContain('Nothing was written.');
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(BASE_TEXT);
  });

  it('says everything is current when nothing is stale', async () => {
    fixture = await makeManagedDir();
    await writeItem(fixture.dir, 'skills/demo', { 'SKILL.md': UPSTREAM_TEXT });
    await writeBaseTree(fixture.dir, 'skills/demo', { 'SKILL.md': UPSTREAM_TEXT });
    await writeEntry(fixture.dir, entryFor('skills/demo', SOURCE, NEW));
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt([]) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(out.join('\n')).toContain('Everything is current.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.test.ts -t 'applies the upstream change on'`
Expected: FAIL with "runUpdate is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `src/update.ts`, and extend its imports with `import { applyPlan, type ApplyResult } from './apply.js';` and `import { renderUnifiedDiff } from './render/diff.js';`, and add `planCase`, `renderMenu` and `renderMenuLine` to the **existing** `./render/update.js` import rather than writing a second import from that module:

```ts
type ReviewOutcome = 'applied' | 'skipped' | 'quit' | 'unresolved';

export async function runUpdate(
  managedDir: string,
  name: string | undefined,
  deps: UpdateDeps,
): Promise<number> {
  const plans = await collectPlans(managedDir, name, deps);
  const conflicted = plans.some((planned) => planned.plan.conflicts > 0);

  if (deps.json) {
    deps.stdout(updateReportJson(managedDir, plans));
    return conflicted ? 4 : 0;
  }
  if (plans.length === 0) {
    deps.stdout('Everything is current.');
    return 0;
  }
  if (!deps.interactive) {
    renderDryRun(plans, deps);
    return conflicted ? 4 : 0;
  }
  return reviewPlans(managedDir, plans, deps);
}

async function reviewPlans(
  managedDir: string,
  plans: PlannedItem[],
  deps: UpdateDeps,
): Promise<number> {
  let applied = 0;
  let unresolved = 0;
  let reviewed = 0;

  for (const target of plans) {
    if (target.plan.blocked === 'upstream-empty') {
      deps.stdout('');
      deps.stdout(`${target.plan.id} — skipped: upstream no longer contains any file for this item.`);
      deps.stdout(`  → skilled remove ${target.plan.id}   stop tracking it`);
      continue;
    }
    reviewed++;
    const outcome = await reviewItem(managedDir, target, deps);
    if (outcome === 'applied') applied++;
    else if (outcome === 'unresolved') unresolved++;
    else if (outcome === 'quit') break;
  }

  deps.stdout('');
  deps.stdout(`${applied} applied · ${Math.max(0, reviewed - applied)} left alone`);
  if (unresolved > 0) {
    deps.stdout(
      `${unresolved} still ${unresolved === 1 ? 'has' : 'have'} an unresolved conflict — nothing was written for ${unresolved === 1 ? 'it' : 'them'}.`,
    );
  }
  return unresolved > 0 ? 4 : 0;
}

async function reviewItem(
  managedDir: string,
  target: PlannedItem,
  deps: UpdateDeps,
): Promise<ReviewOutcome> {
  const plan = target.plan;
  deps.stdout('');
  deps.stdout(renderItemHeader(plan, target.entry));
  if (target.reconstructed !== null) deps.stdout(`  ${target.reconstructed}`);

  if (planCase(plan) === 'conflict') {
    deps.stdout('');
    deps.stdout(renderPlanSummary(plan, { color: deps.color }));
    return 'unresolved';
  }

  for (;;) {
    const keys = renderMenu(planCase(plan));
    deps.stdout('');
    deps.stdout(renderPlanSummary(plan, { color: deps.color }));
    deps.stdout('');
    const choice = await deps.prompt(renderMenuLine(keys), keys);

    if (choice === 'q') return 'quit';
    if (choice === 's') return 'skipped';
    if (choice === 'd') {
      showDiff(target, plan, deps);
      continue;
    }
    if (choice === 'a') {
      const result = await applyPlan({
        managedDir,
        item: target.item,
        entry: target.entry,
        plan,
        local: target.local,
        base: target.base,
        today: deps.today,
      });
      deps.stdout(
        `  ✓ applied — base advanced to ${plan.upstreamSha.slice(0, 7)}${summariseWrites(result)}`,
      );
      return 'applied';
    }
  }
}

function showDiff(target: PlannedItem, plan: ItemPlan, deps: UpdateDeps): void {
  let printed = false;
  for (const file of plan.files) {
    if (file.local === null) {
      deps.stdout(`  − ${file.relPath === '' ? 'this file' : file.relPath} will be removed`);
      printed = true;
      continue;
    }
    const before = target.local.get(file.relPath) ?? '';
    const rendered = renderUnifiedDiff(file.relPath, before, file.local, { color: deps.color });
    if (rendered !== '') {
      deps.stdout(rendered);
      printed = true;
    }
  }
  if (!printed) deps.stdout('  No line-level changes.');
}

function summariseWrites(result: ApplyResult): string {
  const parts: string[] = [];
  if (result.written.length > 0) parts.push(`${result.written.length} written`);
  if (result.removed.length > 0) parts.push(`${result.removed.length} removed`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.test.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add src/update.ts tests/update.test.ts
git commit -m "feat(update): interactive review for clean updates and clean merges"
```

---

### Task 20: The conflict path — Claude, `$EDITOR`, or leave it alone

**Files:**
- Modify: `src/update.ts`
- Test: `tests/update.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 18 and 19; `hasConflictMarkers`, `renderConflictRegions`, `diffStat` from `src/render/diff.ts`.
- Produces: the conflict-capable `reviewItem`, plus `ReviewOutcome` extended with `'quit-unresolved'`. Exit code `4` whenever an item is left with a conflict, whether the user skipped it or quit.

Nothing is written on this path unless a resolution turns the plan back into a clean merge and the user then presses `a`.

- [ ] **Step 1: Write the failing test**

Append to `tests/update.test.ts`:

```ts
const LOCAL_CONFLICTING = BASE_TEXT.replace('be careful', 'be careful, always');
const RESOLVED_TEXT = BASE_TEXT.replace('be careful', 'be very careful, always');

async function seedConflict(dir: string): Promise<void> {
  await writeItem(dir, 'skills/demo', { 'SKILL.md': LOCAL_CONFLICTING });
  await writeBaseTree(dir, 'skills/demo', { 'SKILL.md': BASE_TEXT });
  await writeEntry(dir, entryFor('skills/demo', SOURCE, OLD));
}

describe('runUpdate — conflict', () => {
  it('exits 4 on [s] and writes nothing', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps, out } = harness({ interactive: true, prompt: queuedPrompt(['s']) });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
    expect((await readManifest(fixture.dir)).entries[0].base.commit).toBe(OLD);

    const text = out.join('\n');
    expect(text).toContain('✗ Conflict in SKILL.md');
    expect(text).toContain('Nothing has been written to disk.');
    expect(text).toContain('<<<<<<< LOCAL (your copy)');
    expect(text).toContain('[c] let Claude resolve it');
    expect(text).toContain('[e] open in $EDITOR with conflict markers');
  });

  it('exits 4 on [q] as well', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps } = harness({ interactive: true, prompt: queuedPrompt(['q']) });
    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
  });

  it('lets Claude resolve it, then applies once accepted', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps, out } = harness({
      interactive: true,
      prompt: queuedPrompt(['c', 'a']),
      claude: {
        identify: async () => null,
        resolveConflict: async (args) => {
          expect(args.conflicted).toContain('<<<<<<< LOCAL (your copy)');
          expect(args.base).toBe(BASE_TEXT);
          expect(args.local).toBe(LOCAL_CONFLICTING);
          expect(args.upstream).toBe(UPSTREAM_TEXT);
          return RESOLVED_TEXT;
        },
      },
    });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(RESOLVED_TEXT);
    expect(await fs.readFile(path.join(basePath(fixture.dir, 'skills/demo'), 'SKILL.md'), 'utf8')).toBe(UPSTREAM_TEXT);
    expect((await readManifest(fixture.dir)).entries[0].base.commit).toBe(NEW);
    expect(out.join('\n')).toContain('Claude resolved SKILL.md');
  });

  it('keeps the conflict when Claude gives up', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps, out } = harness({
      interactive: true,
      prompt: queuedPrompt(['c', 's']),
      claude: { identify: async () => null, resolveConflict: async () => null },
    });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
    expect(out.join('\n')).toContain('Claude could not resolve SKILL.md');
  });

  it('refuses a Claude answer that still has markers', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps } = harness({
      interactive: true,
      prompt: queuedPrompt(['c', 's']),
      claude: {
        identify: async () => null,
        resolveConflict: async (args) => args.conflicted,
      },
    });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
  });

  it('opens $EDITOR with conflict markers and accepts the edited file', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    let openedPath = '';
    const { deps } = harness({
      interactive: true,
      prompt: queuedPrompt(['e', 'a']),
      openEditor: async (filePath: string) => {
        openedPath = filePath;
        const handed = await fs.readFile(filePath, 'utf8');
        expect(handed).toContain('<<<<<<< LOCAL (your copy)');
        expect(handed).toContain('>>>>>>> UPSTREAM');
        await fs.writeFile(filePath, RESOLVED_TEXT, 'utf8');
      },
    });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(0);
    expect(openedPath.endsWith('.md')).toBe(true);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(RESOLVED_TEXT);
    expect(await pathExists(openedPath)).toBe(false);
  });

  it('refuses an edited file that still has markers', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps, out } = harness({
      interactive: true,
      prompt: queuedPrompt(['e', 's']),
      openEditor: async () => {
        /* the user saved without resolving anything */
      },
    });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
    expect(out.join('\n')).toContain('still contains conflict markers');
  });

  it('reports a conflict without prompting in a dry run and exits 4', async () => {
    fixture = await makeManagedDir();
    await seedConflict(fixture.dir);
    const { deps, out } = harness({ interactive: false, json: false });

    expect(await runUpdate(fixture.dir, undefined, deps)).toBe(4);
    expect(out.join('\n')).toContain('Nothing has been written to disk.');
    expect(await fs.readFile(path.join(fixture.dir, 'skills/demo/SKILL.md'), 'utf8')).toBe(LOCAL_CONFLICTING);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.test.ts -t 'lets Claude resolve it'`
Expected: FAIL — the run returns 4 and the file is unchanged, because `reviewItem` returns `'unresolved'` before offering `[c]`

- [ ] **Step 3: Write minimal implementation**

Extend the imports of `src/update.ts` with `import fs from 'node:fs/promises';`, `import os from 'node:os';` and `import { diffStat, hasConflictMarkers, renderConflictRegions, renderUnifiedDiff } from './render/diff.js';` (replacing the earlier `renderUnifiedDiff`-only import). Then replace the `ReviewOutcome` type, `reviewPlans` and `reviewItem` with these, and add the three new helpers:

```ts
type ReviewOutcome = 'applied' | 'skipped' | 'quit' | 'unresolved' | 'quit-unresolved';

async function reviewPlans(
  managedDir: string,
  plans: PlannedItem[],
  deps: UpdateDeps,
): Promise<number> {
  let applied = 0;
  let unresolved = 0;
  let reviewed = 0;

  for (const target of plans) {
    if (target.plan.blocked === 'upstream-empty') {
      deps.stdout('');
      deps.stdout(`${target.plan.id} — skipped: upstream no longer contains any file for this item.`);
      deps.stdout(`  → skilled remove ${target.plan.id}   stop tracking it`);
      continue;
    }
    reviewed++;
    const outcome = await reviewItem(managedDir, target, deps);
    if (outcome === 'applied') applied++;
    if (outcome === 'unresolved' || outcome === 'quit-unresolved') unresolved++;
    if (outcome === 'quit' || outcome === 'quit-unresolved') break;
  }

  deps.stdout('');
  deps.stdout(`${applied} applied · ${Math.max(0, reviewed - applied)} left alone`);
  if (unresolved > 0) {
    deps.stdout(
      `${unresolved} still ${unresolved === 1 ? 'has' : 'have'} an unresolved conflict — nothing was written for ${unresolved === 1 ? 'it' : 'them'}.`,
    );
  }
  return unresolved > 0 ? 4 : 0;
}

async function reviewItem(
  managedDir: string,
  target: PlannedItem,
  deps: UpdateDeps,
): Promise<ReviewOutcome> {
  let plan = target.plan;
  deps.stdout('');
  deps.stdout(renderItemHeader(plan, target.entry));
  if (target.reconstructed !== null) deps.stdout(`  ${target.reconstructed}`);

  for (;;) {
    const kind = planCase(plan);
    const keys = renderMenu(kind);
    deps.stdout('');
    deps.stdout(renderPlanSummary(plan, { color: deps.color }));
    if (kind === 'conflict') {
      for (const file of plan.files) {
        if (file.kind !== 'conflict' || file.local === null) continue;
        deps.stdout('');
        deps.stdout(renderConflictRegions(file.local, { color: deps.color }));
      }
    }
    deps.stdout('');
    const choice = await deps.prompt(renderMenuLine(keys), keys);

    if (choice === 'q') return kind === 'conflict' ? 'quit-unresolved' : 'quit';
    if (choice === 's') return kind === 'conflict' ? 'unresolved' : 'skipped';
    if (choice === 'd' && kind !== 'conflict') {
      showDiff(target, plan, deps);
      continue;
    }
    if (choice === 'c' && kind === 'conflict') {
      plan = await resolveWithClaude(target, plan, deps);
      continue;
    }
    if (choice === 'e' && kind === 'conflict') {
      plan = await resolveInEditor(target, plan, deps);
      continue;
    }
    if (choice === 'a' && kind !== 'conflict') {
      const result = await applyPlan({
        managedDir,
        item: target.item,
        entry: target.entry,
        plan,
        local: target.local,
        base: target.base,
        today: deps.today,
      });
      deps.stdout(
        `  ✓ applied — base advanced to ${plan.upstreamSha.slice(0, 7)}${summariseWrites(result)}`,
      );
      return 'applied';
    }
  }
}

async function resolveWithClaude(
  target: PlannedItem,
  plan: ItemPlan,
  deps: UpdateDeps,
): Promise<ItemPlan> {
  let next = plan;
  let failed = false;
  for (const file of plan.files.filter((candidate) => candidate.kind === 'conflict')) {
    const where = file.relPath === '' ? target.item.id : file.relPath;
    const resolved = await deps.claude.resolveConflict({
      base: target.base.get(file.relPath) ?? '',
      local: target.local.get(file.relPath) ?? '',
      upstream: target.upstream.get(file.relPath) ?? '',
      conflicted: file.local ?? '',
    });
    if (resolved === null || hasConflictMarkers(resolved)) {
      failed = true;
      deps.stdout(`  Claude could not resolve ${where}. Is the \`claude\` CLI on PATH?`);
      continue;
    }
    next = withResolvedFile(next, file.relPath, resolved, target.local.get(file.relPath) ?? '');
    deps.stdout(`  ✓ Claude resolved ${where}. Review it before accepting.`);
  }
  if (failed) deps.stdout('  Nothing has been written to disk.');
  return next;
}

async function resolveInEditor(
  target: PlannedItem,
  plan: ItemPlan,
  deps: UpdateDeps,
): Promise<ItemPlan> {
  let next = plan;
  for (const file of plan.files.filter((candidate) => candidate.kind === 'conflict')) {
    const where = file.relPath === '' ? target.item.id : file.relPath;
    const extension =
      path.extname(file.relPath === '' ? target.item.absPath : file.relPath) || '.txt';
    const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-conflict-'));
    const scratch = path.join(scratchDir, `conflict${extension}`);
    try {
      await fs.writeFile(scratch, file.local ?? '', 'utf8');
      await deps.openEditor(scratch);
      const edited = await fs.readFile(scratch, 'utf8');
      if (hasConflictMarkers(edited)) {
        deps.stdout(`  ${where} still contains conflict markers. Nothing has been written to disk.`);
        continue;
      }
      next = withResolvedFile(next, file.relPath, edited, target.local.get(file.relPath) ?? '');
      deps.stdout(`  ✓ resolved ${where} in your editor. Review it before accepting.`);
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }
  return next;
}

function withResolvedFile(
  plan: ItemPlan,
  relPath: string,
  resolved: string,
  localText: string,
): ItemPlan {
  const stat = diffStat(localText, resolved);
  const files = plan.files.map((file) =>
    file.relPath === relPath
      ? {
          ...file,
          kind: 'merged-clean' as const,
          local: resolved,
          conflictCount: 0,
          added: stat.added,
          removed: stat.removed,
        }
      : file,
  );
  return {
    ...plan,
    files,
    conflicts: files.reduce((total, file) => total + file.conflictCount, 0),
    localEdits: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.test.ts`
Expected: PASS (27 tests)

- [ ] **Step 5: Commit**

```bash
git add src/update.ts tests/update.test.ts
git commit -m "feat(update): resolve conflicts with Claude or an editor, exit 4 otherwise"
```

---

### Task 21: The `skilled update` command object

**Files:**
- Modify: `src/update.ts`
- Test: `tests/update.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `registerCommand`, `resolveName` from `src/cli.ts`; `promptKey`, `isInteractive` from `src/render/prompt.ts`; `createGitHubClient`, `resolveToken` from `src/fetch.ts`; `createClaudeClient` from `src/claude.ts`; `discover` from `src/discover.ts`.
- Produces: `updateCommand: Command`, `registerUpdateCommand(): void`, `commandTargetName(args: string[]): string | undefined`, `editorCommand(env: NodeJS.ProcessEnv): { command: string; args: string[] }`, `openInEditor(filePath: string): Promise<void>`.

Two details that matter:

- **Registration is a function, not a module side effect.** `src/cli.ts` will import this module, so a top-level `registerCommand(...)` call would run while `cli.ts`'s own module body — including the registry array — is still initialising, and hit a temporal-dead-zone error. `registerUpdateCommand()` is called from inside `cli.ts`'s dispatch instead, when everything is constructed.
- **`ctx.args` may or may not include the verb.** `commandTargetName` accepts both shapes so the command works whichever way spec 01's dispatcher slices the argv.

With several managed directories: no name walks every directory in order; a name acts on the first directory that contains a match, and misses everywhere raise `UNKNOWN_ENTRY` (exit 2) before any network call.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/update.test.ts
import { commandTargetName, editorCommand, updateCommand } from '../src/update.js';
import type { CommandContext } from '../src/cli.js';
import type { ResolvedConfig } from '../src/types.js';

describe('commandTargetName', () => {
  it('accepts args with or without the verb', () => {
    expect(commandTargetName(['update', 'cso'])).toBe('cso');
    expect(commandTargetName(['cso'])).toBe('cso');
    expect(commandTargetName(['update'])).toBeUndefined();
    expect(commandTargetName([])).toBeUndefined();
  });
});

describe('editorCommand', () => {
  it('prefers VISUAL, then EDITOR, then vi, and splits arguments', () => {
    expect(editorCommand({ VISUAL: 'code -w', EDITOR: 'nano' })).toEqual({ command: 'code', args: ['-w'] });
    expect(editorCommand({ EDITOR: 'nano' })).toEqual({ command: 'nano', args: [] });
    expect(editorCommand({})).toEqual({ command: 'vi', args: [] });
  });
});

describe('updateCommand', () => {
  it('is registered under the name the CLI dispatches on', () => {
    expect(updateCommand.name).toBe('update');
    expect(updateCommand.summary.length).toBeGreaterThan(0);
  });

  it('raises UNKNOWN_ENTRY with exit code 2 for a name that exists nowhere', async () => {
    fixture = await makeManagedDir();
    await seedTrackedItem(fixture.dir, BASE_TEXT);
    const config: ResolvedConfig = {
      dirs: [fixture.dir],
      origin: 'flag',
      configPath: path.join(fixture.dir, 'config.json'),
      configExists: false,
    };
    const ctx: CommandContext = {
      args: ['update', 'not-a-real-skill'],
      flags: { json: true },
      config,
      stdout: () => undefined,
      stderr: () => undefined,
    };

    let error: unknown;
    try {
      await updateCommand.run(ctx);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(SkilledError);
    expect((error as SkilledError).code).toBe('UNKNOWN_ENTRY');
    expect((error as SkilledError).exitCode).toBe(2);
    expect((error as SkilledError).cause).toContain('not-a-real-skill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.test.ts -t 'accepts args with or without the verb'`
Expected: FAIL with "commandTargetName is not a function"

- [ ] **Step 3: Write minimal implementation**

Append to `src/update.ts`, and extend its imports with `import { spawn } from 'node:child_process';`, `import { registerCommand, resolveName, type Command, type CommandContext } from './cli.js';`, `import { isInteractive, promptKey } from './render/prompt.js';`, `import { createGitHubClient, resolveToken } from './fetch.js';` and `import { createClaudeClient } from './claude.js';`:

```ts
/** `skilled update cso` may arrive as ['update','cso'] or ['cso']. Accept both. */
export function commandTargetName(args: string[]): string | undefined {
  const rest = args[0] === 'update' ? args.slice(1) : args;
  return rest.length === 0 ? undefined : rest[0];
}

export function editorCommand(env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const raw = env.VISUAL ?? env.EDITOR ?? 'vi';
  const parts = raw.trim().split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

export async function openInEditor(filePath: string): Promise<void> {
  const { command, args } = editorCommand(process.env);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, filePath], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', () => resolve());
  });
}

export const updateCommand: Command = {
  name: 'update',
  summary: 'review and apply upstream changes, one entry at a time',

  async run(ctx: CommandContext): Promise<number> {
    const name = commandTargetName(ctx.args);
    const json = ctx.flags.json === true;

    // Resolve the name before touching the network so a typo costs nothing.
    let chosenDir: string | null = null;
    if (name !== undefined) {
      for (const dir of ctx.config.dirs) {
        const items = await discover(dir);
        try {
          resolveName(name, items);
          chosenDir = dir;
          break;
        } catch (thrown) {
          if (thrown instanceof SkilledError && thrown.code === 'UNKNOWN_ENTRY') continue;
          throw thrown;
        }
      }
      if (chosenDir === null) {
        throw new SkilledError({
          code: 'UNKNOWN_ENTRY',
          problem: `No tracked skill or agent matches "${name}".`,
          cause:
            `skilled looked in ${ctx.config.dirs.join(', ')} and found nothing named "${name}".\n` +
            'No managed file was modified.',
          fixes: [
            'skilled                              list what is tracked',
            'skilled add <url> <path>             register a new source',
          ],
          exitCode: 2,
        });
      }
    }

    const deps: UpdateDeps = {
      github: createGitHubClient(await resolveToken()),
      claude: createClaudeClient(),
      prompt: promptKey,
      openEditor: openInEditor,
      interactive: isInteractive() && !json,
      json,
      color: ctx.flags['no-color'] !== true && process.env.NO_COLOR === undefined,
      today: new Date().toISOString().slice(0, 10),
      stdout: ctx.stdout,
      stderr: ctx.stderr,
    };

    if (chosenDir !== null) return runUpdate(chosenDir, name, deps);

    let worst = 0;
    for (const dir of ctx.config.dirs) {
      worst = Math.max(worst, await runUpdate(dir, undefined, deps));
    }
    return worst;
  },
};

/** Called from cli.ts's dispatch, not at import time — see the note in the plan. */
export function registerUpdateCommand(): void {
  registerCommand(updateCommand);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.test.ts`
Expected: PASS (31 tests)

- [ ] **Step 5: Commit**

```bash
git add src/update.ts tests/update.test.ts
git commit -m "feat(update): the skilled update command object"
```

---

### Task 22: Wire the command and the live client into the CLI

**Files:**
- Modify: `src/cli.ts` (two added lines only — do not restructure it)
- Modify: the single module that calls `buildStatus` (spec 02's default command)
- Test: `npx tsc --noEmit` plus the existing suites

**Interfaces:**
- Consumes: `registerUpdateCommand` from `src/update.ts`; `createGitHubClient`, `resolveToken` from `src/fetch.ts`; `buildStatus(managedDir, deps: { github: GitHubClient }, opts: { refresh: boolean })` from `src/status.ts`.
- Produces: `skilled update` reachable from the binary, and `--refresh` backed by real network fetching instead of the null client.

- [ ] **Step 1: Find the two wiring points**

Run:

```bash
grep -rn "registerCommand(" src/cli.ts
grep -rn "buildStatus(" src/ --include=*.ts
grep -rn "nullGitHubClient(" src/ --include=*.ts
```

Write down the file and line for each. Expect one `buildStatus(` definition in `src/status.ts` and one call site elsewhere (spec 02's default command). If the only `buildStatus(` hit is the definition in `src/status.ts`, spec 02 has not wired a default command yet: do Step 2 and Step 3, skip Step 4, and say so in the commit message.

- [ ] **Step 2: Register the command from cli.ts**

Add to `src/cli.ts`'s import block:

```ts
import { registerUpdateCommand } from './update.js';
```

and call it as the first statement of the function that dispatches commands (the one that reads `process.argv` or takes an argv array), immediately after any built-in `registerCommand(...)` calls:

```ts
  registerUpdateCommand();
```

Do not call it at module scope: `src/update.ts` imports `src/cli.ts`, so the two modules form a cycle and a module-scope call would run before `cli.ts`'s registry exists.

- [ ] **Step 3: Verify the command is reachable**

Run: `npx tsc --noEmit`
Expected: no output (exit 0). A `Cannot find module './update.js'` error means the import path is wrong; an "used before declaration" error means the call is at module scope rather than inside dispatch.

- [ ] **Step 4: Give the default scan a real client**

In the module found in Step 1 that calls `buildStatus`, add:

```ts
import { createGitHubClient, resolveToken } from './fetch.js';
```

(adjust the relative path if that module is in a subdirectory) and replace the `github:` value in the `buildStatus` deps argument with a live client:

```ts
  const report = await buildStatus(dir, { github: createGitHubClient(await resolveToken()) }, { refresh });
```

Keep the surrounding code — the `refresh` flag, the renderer call, the exit code — exactly as spec 02 wrote it. `createGitHubClient(null)` still works for unauthenticated reads, so a user with no `gh` auth keeps a working scan and only loses code search.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, every suite green. Then `npx tsc --noEmit` with no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git add <the module you edited in Step 4>
git commit -m "feat(cli): register skilled update and wire --refresh to the live GitHub client"
```

---

### Task 23: End-to-end verification on a multi-file skill

**Files:**
- Test: `tests/update.e2e.test.ts`

**Interfaces:**
- Consumes: `runUpdate`, `UpdateDeps` from `src/update.ts`; the fixture helpers from `tests/helpers/update-fixture.ts`; `basePath` from `src/config.ts`; `readManifest` from `src/manifest.ts`.
- Produces: nothing — this task proves the design doc's Verification criteria 3 and 6 on an item shaped like the real `marketing-ads/` (12 files across `references/` and `evals/`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/update.e2e.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../src/config.js';
import { readManifest } from '../src/manifest.js';
import { runUpdate, type UpdateDeps } from '../src/update.js';
import {
  entryFor,
  fakeGitHub,
  makeManagedDir,
  pathExists,
  writeBaseTree,
  writeEntry,
  writeItem,
  type Fixture,
} from './helpers/update-fixture.js';
import type { Source } from '../src/types.js';

const SOURCE: Source = { type: 'github', repo: 'acme/marketing', ref: 'main', subpath: 'skills/marketing-ads' };
const KEY = 'acme/marketing#main#skills/marketing-ads';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

const SKILL_BASE = [
  '---',
  'name: marketing-ads',
  'allowed-tools: Bash',
  '---',
  '',
  '# Marketing ads',
  '',
  '## Brief',
  'write the brief first',
  '',
  '## Tone',
  'keep it plain',
  '',
].join('\n');

const SKILL_LOCAL = SKILL_BASE.replace('write the brief first', 'write the brief first\nand name the audience');
const SKILL_UPSTREAM = SKILL_BASE.replace('keep it plain', 'keep it plain and specific');

let fixture: Fixture | null = null;

afterEach(async () => {
  if (fixture) await fixture.cleanup();
  fixture = null;
});

function deps(overrides: Partial<UpdateDeps>, out: string[]): UpdateDeps {
  return {
    github: fakeGitHub({
      [KEY]: {
        commits: [
          { sha: NEW, date: '2026-08-09T10:00:00Z', message: 'sharpen tone guidance' },
          { sha: OLD, date: '2026-05-12T10:00:00Z', message: 'initial' },
        ],
        trees: {
          [NEW]: {
            'SKILL.md': SKILL_UPSTREAM,
            'references/tone.md': 'tone reference\nupdated line\n',
            'references/new-channel.md': 'a channel upstream added\n',
          },
          [OLD]: {
            'SKILL.md': SKILL_BASE,
            'references/tone.md': 'tone reference\n',
            'evals/legacy.md': 'legacy eval\n',
          },
        },
      },
    }),
    claude: { identify: async () => null, resolveConflict: async () => null },
    prompt: async () => 'a',
    openEditor: async () => {
      throw new Error('editor must not be called');
    },
    interactive: true,
    json: false,
    color: false,
    today: '2026-08-27',
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => out.push(line),
    ...overrides,
  };
}

describe('skilled update end to end', () => {
  it('preserves local edits, adds, updates and removes files, and advances BASE', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    const id = 'skills/marketing-ads';

    const baseFiles = {
      'SKILL.md': SKILL_BASE,
      'references/tone.md': 'tone reference\n',
      'evals/legacy.md': 'legacy eval\n',
    };
    await writeItem(dir, id, {
      ...baseFiles,
      'SKILL.md': SKILL_LOCAL,
      'notes.md': 'my own scratch notes\n',
    });
    await writeBaseTree(dir, id, baseFiles);
    await writeEntry(dir, entryFor(id, SOURCE, OLD));

    const out: string[] = [];
    const code = await runUpdate(dir, undefined, deps({}, out));
    expect(code).toBe(0);

    // The local edit survived and the upstream change landed.
    const skill = await fs.readFile(path.join(dir, id, 'SKILL.md'), 'utf8');
    expect(skill).toContain('and name the audience');
    expect(skill).toContain('keep it plain and specific');
    expect(skill).toContain('allowed-tools: Bash');

    // Upstream edits, additions and deletions all applied.
    expect(await fs.readFile(path.join(dir, id, 'references/tone.md'), 'utf8')).toBe('tone reference\nupdated line\n');
    expect(await fs.readFile(path.join(dir, id, 'references/new-channel.md'), 'utf8')).toBe('a channel upstream added\n');
    expect(await pathExists(path.join(dir, id, 'evals/legacy.md'))).toBe(false);

    // A purely local file is untouched and never enters BASE.
    expect(await fs.readFile(path.join(dir, id, 'notes.md'), 'utf8')).toBe('my own scratch notes\n');
    expect(await pathExists(path.join(basePath(dir, id), 'notes.md'))).toBe(false);

    // BASE now mirrors upstream exactly.
    expect(await fs.readFile(path.join(basePath(dir, id), 'SKILL.md'), 'utf8')).toBe(SKILL_UPSTREAM);
    expect(await fs.readFile(path.join(basePath(dir, id), 'references/new-channel.md'), 'utf8')).toBe(
      'a channel upstream added\n',
    );
    expect(await pathExists(path.join(basePath(dir, id), 'evals/legacy.md'))).toBe(false);

    const manifest = await readManifest(dir);
    expect(manifest.entries[0].base).toEqual({ commit: NEW, adoptedAt: '2026-08-27', reconstructed: false });

    expect(out.join('\n')).toContain('Merged cleanly — your edits are preserved.');
    expect(out.join('\n')).toContain('+ Upstream added references/new-channel.md');
  });

  it('is a no-op the second time', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    const id = 'skills/marketing-ads';
    await writeItem(dir, id, {
      'SKILL.md': SKILL_LOCAL,
      'references/tone.md': 'tone reference\n',
      'evals/legacy.md': 'legacy eval\n',
    });
    await writeBaseTree(dir, id, {
      'SKILL.md': SKILL_BASE,
      'references/tone.md': 'tone reference\n',
      'evals/legacy.md': 'legacy eval\n',
    });
    await writeEntry(dir, entryFor(id, SOURCE, OLD));

    const first: string[] = [];
    expect(await runUpdate(dir, undefined, deps({}, first))).toBe(0);
    const snapshot = await fs.readFile(path.join(dir, id, 'SKILL.md'), 'utf8');

    const second: string[] = [];
    expect(
      await runUpdate(
        dir,
        undefined,
        deps(
          {
            prompt: async () => {
              throw new Error('prompt must not be called on a current item');
            },
          },
          second,
        ),
      ),
    ).toBe(0);
    expect(second.join('\n')).toContain('Everything is current.');
    expect(await fs.readFile(path.join(dir, id, 'SKILL.md'), 'utf8')).toBe(snapshot);
  });

  it('writes nothing at all when the only outcome is a conflict', async () => {
    fixture = await makeManagedDir();
    const dir = fixture.dir;
    const id = 'skills/marketing-ads';
    const localConflicting = SKILL_BASE.replace('keep it plain', 'keep it plain and friendly');

    await writeItem(dir, id, { 'SKILL.md': localConflicting, 'references/tone.md': 'tone reference\n' });
    await writeBaseTree(dir, id, { 'SKILL.md': SKILL_BASE, 'references/tone.md': 'tone reference\n' });
    await writeEntry(dir, entryFor(id, SOURCE, OLD));

    const before = await snapshotDir(path.join(dir, id));
    const out: string[] = [];
    const code = await runUpdate(dir, undefined, deps({ prompt: async () => 's' }, out));

    expect(code).toBe(4);
    expect(await snapshotDir(path.join(dir, id))).toEqual(before);
    expect((await readManifest(dir)).entries[0].base.commit).toBe(OLD);
    expect(await pathExists(path.join(dir, id, 'references/new-channel.md'))).toBe(false);
    expect(out.join('\n')).toContain('Nothing has been written to disk.');
  });
});

async function snapshotDir(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs, rel);
      else result[rel] = await fs.readFile(abs, 'utf8');
    }
  }
  await walk(root, '');
  return result;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.e2e.test.ts`
Expected: FAIL on the first assertion that the whole item merged — for example `references/new-channel.md` missing — if any of Tasks 13, 15, 19 or 20 handled a multi-file case wrongly. If all three tests pass immediately, the earlier tasks were correct; keep the file, it is the regression guard for the design doc's verification criteria.

- [ ] **Step 3: Fix whatever the test exposed**

No new module. If a test fails, the defect is in `src/plan.ts` (the case table), `src/apply.ts` (write order or the BASE map), or `src/update.ts` (the loop). Fix it there and re-run — do not weaken the test. The three assertions this task exists to protect:

1. A local edit survives an update that also takes an upstream change.
2. A file the user added locally is never written into BASE and never touched.
3. A conflict leaves the item byte-identical and the manifest unchanged, and exits 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.e2e.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/update.e2e.test.ts
git commit -m "test(update): end-to-end merge safety on a multi-file skill"
```

---

### Task 24: Audit every command this spec suggests

**Files:**
- Test: `tests/update.surface.test.ts`

**Interfaces:**
- Consumes: nothing but the filesystem.
- Produces: a regression guard that no user-facing string in `src/` suggests a command outside the contract's six.

The contract fixes the surface at `skilled`, `skilled <name>`, `skilled update`, `skilled add`, `skilled remove`, `skilled config`. The design doc predates that and suggests verbs that do not exist — its session-start hook runs `skilled refresh` (refreshing is the `--refresh` flag), and its error catalogue offers `skilled diff git`, `skilled update git --claude` and `skilled update git --editor` (diffing and resolution are the `[d]`, `[c]` and `[e]` keys inside the review loop). Every error message in this spec was re-derived against the contract rather than copied; this test keeps it that way.

- [ ] **Step 1: Write the failing test**

```ts
// tests/update.surface.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

/** The contract's six commands. `skilled <name>` needs no verb. */
const ALLOWED_VERBS = new Set(['update', 'add', 'remove', 'config']);

/**
 * Matches a command *suggestion*: "skilled <verb>" at the start of a string
 * literal, inside backticks, or after an arrow. Prose like "…, so skilled
 * cannot be sure…" is preceded by a plain space and is not a suggestion.
 */
const SUGGESTION = /(?:['"`]|→ )skilled ([a-z][a-z-]+)/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(abs)));
    else if (entry.name.endsWith('.ts')) found.push(abs);
  }
  return found;
}

describe('the six-command CLI surface', () => {
  it('never suggests a command that does not exist', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(path.resolve(process.cwd(), 'src'))) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(SUGGESTION)) {
        if (!ALLOWED_VERBS.has(match[1])) {
          offenders.push(`${path.relative(process.cwd(), file)}: skilled ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches the design doc's dead verbs if they ever come back", () => {
    const dead = ['`skilled refresh`', '`skilled diff foo`', '"skilled scan"', '→ skilled why foo'];
    for (const sample of dead) {
      const matches = [...sample.matchAll(SUGGESTION)].map((match) => match[1]);
      expect(matches.some((verb) => !ALLOWED_VERBS.has(verb))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update.surface.test.ts`
Expected: FAIL with "Cannot find module ... tests/update.surface.test.ts" before the file exists; once written, it either passes or names an offending file and verb.

- [ ] **Step 3: Fix any offender**

No new module. If the offender is in a file this spec owns, correct the string to a real command. If it is in a file owned by spec 01 or 02, correct that one string in place — it is user-facing text with no behavioural risk — and name the file and the old verb in the commit message so the owning spec knows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/update.surface.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/update.surface.test.ts
git commit -m "test(cli): guard the six-command surface against invented verbs"
```

---

## Additions to the contract's file list

The contract names `fetch.ts`, `merge.ts` and `render/diff.ts` for this spec and gives no home for the update command itself. These files are new and owned by spec 03; nothing in the contract changes:

| New file | Why it is not in the contract's layout |
|---|---|
| `src/update.ts` | The contract says specs 02–04 "add their own subcommand wiring by importing from cli.ts's registry" but never names the file that holds a spec's command. |
| `src/plan.ts` | The per-file case table is pure logic and is the part most worth testing in isolation. |
| `src/apply.ts` | The only writer of managed files; kept separate so the write path is one short, auditable file. |
| `src/tree.ts` | BASE reading and atomic writing, shared by `apply.ts` and `update.ts`. |
| `src/reconstruct.ts` | BASE inference is network archaeology, not merging. |
| `src/claude.ts` | The contract assigns spec 03 the real clients but only names `fetch.ts`, which is GitHub-specific. |
| `src/render/update.ts` | The three review screens are not diff rendering. |

Two signatures gained an **optional** trailing parameter so tests stay hermetic. Both original call forms from the contract still compile and behave identically:

- `createGitHubClient(token: string | null, deps?: Partial<FetchDeps>)`
- `resolveToken(deps?: Partial<ResolveTokenDeps>)`

---

## Definition of Done

Run these in order from the repository root. Every one must pass.

- [ ] **1. The whole suite is green.**

```bash
npm test
```

Expected: all suites pass, including `tests/merge.test.ts`, `tests/render/diff.test.ts`, `tests/render/update.test.ts`, `tests/fetch.test.ts`, `tests/tree.test.ts`, `tests/plan.test.ts`, `tests/reconstruct.test.ts`, `tests/apply.test.ts`, `tests/claude.test.ts`, `tests/update.test.ts`, `tests/update.e2e.test.ts`, `tests/update.surface.test.ts`, plus every suite from specs 01 and 02. No test output mentions `api.github.com` as a real request.

- [ ] **2. Types are sound.**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **3. No test touches the network or the real managed directory.**

```bash
grep -rn "https://api.github.com" tests/ | grep -v "fakeFetch\|respondWith\|expect\|toBe\|toContain"
grep -rn "\.claude" tests/
```

Expected: the first command prints nothing outside test expectations; the second prints nothing at all.

- [ ] **4. Local edits survive an update (design doc Verification 3).**

```bash
npx vitest run tests/update.e2e.test.ts -t 'preserves local edits'
```

Expected: PASS. This is the criterion the whole spec exists for — the merged `SKILL.md` contains both `and name the audience` (the user's line) and `keep it plain and specific` (the author's line).

- [ ] **5. A conflict writes nothing and exits 4.**

```bash
npx vitest run tests/update.e2e.test.ts -t 'writes nothing at all when the only outcome is a conflict'
npx vitest run tests/update.test.ts -t 'exits 4 on'
```

Expected: PASS. The item is byte-identical before and after, the manifest still points at the old commit, and the exit code is 4.

- [ ] **6. Nothing is written without approval (design doc Verification 6).**

```bash
npx vitest run tests/update.test.ts -t 'writes nothing on'
npx vitest run tests/update.test.ts -t 'does not persist a reconstructed base in a dry run'
```

Expected: PASS. `[s]` and `[q]` leave both the file and the manifest untouched, and a dry run persists nothing at all.

- [ ] **7. Non-interactive mode never prompts.**

```bash
npx vitest run tests/update.test.ts -t 'prints JSON and writes nothing'
npx vitest run tests/update.test.ts -t 'reports what would change on a non-TTY without prompting'
```

Expected: PASS. Both harnesses supply a `prompt` that throws if called.

- [ ] **8. Real data, read-only (design doc Verification 5 and 6).**

Only after spec 01's binary is installable. Run against the real managed directory in the mode that cannot write:

```bash
skilled update --json --dir ~/.claude | head -40; echo "exit=$?"
git -C ~/.claude status --porcelain
```

Expected: a JSON document whose `written` field is `false`, exit `0` (or `4` if a real conflict is pending, or `3` with a `NO_AUTH`/`RATE_LIMIT` message that ends in concrete `gh auth login` guidance). `git status` shows nothing outside `.skilled/`. Then confirm graceful degradation with no credentials:

```bash
env -u GITHUB_TOKEN -u GH_TOKEN PATH=/usr/bin:/bin skilled update --json --dir ~/.claude; echo "exit=$?"
```

Expected: exit `3` with a `NO_AUTH` or `NETWORK` message that states the problem, the cause, that no managed file was modified, and `gh auth login` as the fix.

- [ ] **9. `git merge-file` is the merge engine, and no dependency was added.**

```bash
grep -rn "merge-file" src/
git diff --stat HEAD~24 -- package.json
```

Expected: exactly one `merge-file` call site, in `src/merge.ts`; no new entry in `package.json` dependencies.

- [ ] **10. Every command this spec suggests exists.**

```bash
npx vitest run tests/update.surface.test.ts
```

Expected: PASS. No string in `src/` suggests `skilled refresh`, `skilled diff`, `skilled scan`, `skilled why` or any other verb outside the contract's six commands.
