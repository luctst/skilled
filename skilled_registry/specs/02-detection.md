# Provenance Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work backwards from 51 agent-instruction files that record nothing about their origin to a confirmed, honest map of where each one came from — streaming the first true fact in under a second.

**Architecture:** Six detection strategies, each a pure-ish function over already-read file content, are sequenced cheapest-first by an `AsyncGenerator` orchestrator that yields every free-strategy candidate before it opens a socket. Cluster inference runs as a free pass before any network work and again immediately after every code-search hit, which is what shrinks 51 files to roughly 8-12 lookups. Nothing is written to the manifest until the user answers `y` to a specific candidate, and every confirmation is flushed to disk immediately so Ctrl-C cannot lose work.

**Tech Stack:** TypeScript 5.x (`strict: true`), Node.js ≥ 20, ESM, Vitest, `node:fs/promises`, `node:path`, `node:os`, `node:crypto`. No new third-party dependency.

**Spec:** `skilled_registry/specs/00-CONTRACT.md` and `skilled_registry/specs/DESIGN.md`

## Global Constraints

- **Runtime:** Node.js ≥ 20.0.0. ESM only (`"type": "module"` in package.json).
- **Language:** TypeScript 5.x, `strict: true`. No `any` in exported signatures.
- **Test framework:** Vitest. Tests live in `tests/`, mirroring `src/` structure.
- **Package manager:** npm. Binary name `skilled`, exposed via `"bin"`.
- **No network in tests.** All network calls go through injected interfaces; tests use fakes. A test that hits github.com is a broken test.
- **No dependency added without justification in the task.** Available and expected: `node:fs/promises`, `node:path`, `node:os`, `node:child_process`. Third-party allowed: `zod` (schema validation), `picocolors` (terminal color). Do not add a CLI framework, an HTTP client, or a git library.
- **This spec adds no dependency at all.** It uses `node:crypto` (a Node builtin, not a package) for content hashing and hand-written type guards instead of `zod`, so spec 02 compiles even if spec 01 has not installed `zod`.
- **Never write to a managed file without explicit user approval.** Writing to `<managed-dir>/.skilled/` is always allowed. Writing to a skill or agent file requires the user to have said yes to that specific change. **Spec 02 never writes a skill or agent file at all.**
- **Dates** are ISO 8601 `YYYY-MM-DD` strings. Timestamps are full ISO 8601 UTC.
- **All user-facing strings** state problem, cause, and fix. Every thrown error is a `SkilledError`; a bare `throw new Error(...)` in `src/` is a defect.
- **Any error raised during a scan or detect must state that no managed file was modified.** This is a trust requirement, not a nicety.
- **Exit codes are fixed:** 0 success/all current · 1 something stale (bare `skilled` only) · 2 user error · 3 operational failure (network, auth, rate limit) · 4 unresolved merge conflict.
- **`--json` output for bare `skilled` is exactly a serialized `StatusReport`.** No prompts, no extra lines.
- **Tests use** `fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'))` and clean up in `afterEach`. Never touch the real `~/.claude` in a test.
- **Commit convention:** conventional commits, one per task step where the plan says commit.

---

## What spec 01 ships that this spec depends on

Every statement below was read out of `skilled_registry/specs/01-foundation.md`. Citations are **section headings, not line numbers** — sibling specs get edited and line numbers go stale, which has already caused one wrong-name incident on this document (see the closing section). Verify by grep, not by trusting a summary, including this one.

1. **`RESERVED_COMMANDS` is `['scan', 'show', 'update', 'add', 'remove', 'config']`** — spec 01 § "Command registry and name resolution". These are real names in the registry; there are no magic keys.
2. **Bare `skilled` dispatches to the command named `'scan'`, with `ctx.args === []`. A first argument matching no registered command dispatches to the command named `'show'`, with the full positional list unchanged.** That is how `skilled cso` reaches the detail command. Known tradeoff spec 01 accepts: an entry literally called `scan` or `show` is shadowed by the command and needs its full id (`skilled skills/scan`).
3. **Every other command is keyed by its verb and receives `ctx.args` with its own name removed.** `skilled add <url> skills/cso` gives `args === ['<url>', 'skills/cso']`. Each command body here still drops a leading token equal to its own name; harmless, and it survives a change of convention.
4. **`registerCommand` replaces any earlier command with the same name**, last registration wins. Spec 02's `'scan'` and `'show'` overwrite spec 01's minimal built-ins.
5. **`cli.ts` already imports and calls this spec's registrar, so no `cli.ts` edit is needed** — spec 01 § "Command dispatch" (`OPTIONAL_COMMAND_MODULES`, `registerOptionalCommands`, `ensureCommands`). It lists `{ specifier: './commands/index.js', registrar: 'registerCommands' }` alongside spec 03's `./update.js`, loads each through a dynamic import guarded on module-not-found (any other import error propagates, so a syntax error here is not swallowed), and `run()` awaits the idempotent `ensureCommands()` before dispatch. Three hard requirements follow: `registerCommands` must be a **named export** of `src/commands/index.ts`, must be **synchronous** (`() => void`), and must register nothing at module scope.
6. **`CommandContext` has an optional sixth field, `env?: NodeJS.ProcessEnv`, which `run()` always supplies.** Commands read `ctx.env ?? process.env`, never `process.env` directly, so a test never touches the real environment. Nothing in spec 02 reads the environment today; the test helper populates `env` anyway so that stays true if it ever does.
7. **`run()` normalizes `flags.color`, `flags.json`, and `flags.refresh` to booleans before dispatch.** This spec reads them as `ctx.flags.json === true` and `ctx.flags.refresh === true`, which is correct whether or not the normalization is present. **`flags` are whitelisted** — see the `--confirm-each` blocker noted in Task 20.
8. **`promptKey` rejects with `SkilledError` `BAD_FLAG` (exit 2) when `isInteractive()` is false**, rather than hanging or guessing, and **Ctrl-C or Escape resolves to the exported constant `PROMPT_CANCEL` (`'cancel'`)** — spec 01 § "Interactive prompts". Both take an optional trailing `io` parameter for tests. Two consequences this spec honors: never call `promptKey` without checking `isInteractive()` first, and treat `PROMPT_CANCEL` as "stop the confirmation loop", never as "skip this one".
9. **`resolveName` is case-insensitive and tolerates a trailing `/`, a leading `./`, and a trailing `.md`, matching either a full id or the last segment; a miss throws `UNKNOWN_ENTRY` and ambiguity throws `AMBIGUOUS_NAME`, both exit 2.** Do not reimplement any of it.

Consumed from spec 01, nothing else: `src/types.ts` (all types), `src/errors.ts` (`SkilledError`), `src/clients.ts` (`GitHubClient`, `ClaudeClient`, `nullGitHubClient`, `nullClaudeClient`), `src/config.ts` (`stateDir`, `basePath`, `cachePath`, `statusLinePath`), `src/manifest.ts` (`readManifest`, `writeManifest`, `upsertEntry`, `removeEntry`, `findEntry`), `src/discover.ts` (`discover`, `readItemContent`), `src/cli.ts` (`registerCommand`, `resolveName`, `Command`, `CommandContext`), `src/render/prompt.ts` (`promptKey`, `isInteractive`, `PROMPT_CANCEL`).

Spec 02 deliberately does **not** import from `src/render/status.ts` — it formats its own output lines through `ctx.stdout` — so spec 01 is free to shape that file however it likes.

---

## File Structure

| File | Single responsibility |
|---|---|
| `src/detect/hash.ts` | Normalize file text and hash it; pick an item's primary file. |
| `src/detect/inline-url.ts` | Strategy 1 — scrape GitHub URLs out of file bodies. Free, no network. |
| `src/detect/plugin-cache.ts` | Strategy 2 — match content against `installed_plugins.json` installs, which already pin `gitCommitSha`. Free. |
| `src/detect/known-index.ts` | Strategy 3 — content-hash match against a bundled index of popular skill repos. Defines and exports `KnownIndex`. |
| `src/detect/code-search.ts` | Strategy 4 — n-gram extraction, self-imposed rate limiting, GitHub code search, competing-candidate scoring. |
| `src/detect/cluster.ts` | Strategy 5 — propagate one confirmed hit to its sibling family. Free, and the reason 51 files cost ~8-12 lookups. |
| `src/detect/ask-claude.ts` | Strategy 6 — last-resort identification through `ClaudeClient.identify`. |
| `src/detect/index.ts` | The cascade orchestrator: `detectAll`, streaming, strict cheapest-first order. Never writes to disk. |
| `src/status.ts` | `buildStatus`, `readCachedStatus`, `writeCachedStatus`. |
| `src/commands/args.ts` | Positional-argument normalization shared by the four commands. |
| `src/commands/entries.ts` | Turn a `Candidate` into an `Entry`; flush confirmations to the manifest. |
| `src/commands/add.ts` | `skilled add <url> [<path>]` — register or correct a source by hand. Owns `parseSourceUrl`. |
| `src/commands/remove.ts` | `skilled remove <name>` — stop tracking; leave the file alone. |
| `src/commands/detail.ts` | `skilled <name>` — source, adopted date, method, confidence, evidence. |
| `src/commands/confirm.ts` | The y/n/other/skip flow. Nothing is tracked without a keypress. |
| `src/commands/scan.ts` | Bare `skilled` — run the cascade, stream it, confirm candidates, report status. |
| `src/commands/index.ts` | Register spec 02's four commands. |
| `tests/helpers/fakes.ts` | Fake `GitHubClient` / `ClaudeClient` satisfying the interfaces. |
| `tests/helpers/managed-dir.ts` | Copy the detection fixture into a temp dir; remove it. |
| `tests/helpers/context.ts` | A `CommandContext` whose output is captured instead of printed. |
| `tests/fixtures/detect/managed/**` | A realistic managed directory: attributed agent, multi-file skill family, `allowed-tools: Bash` skill, a genuinely unidentifiable skill. |

**Contract gaps this spec fills** (all flagged at the end of the document): `KnownIndex` is referenced by `DetectDeps` but never defined — it is defined here. `Candidate` has nowhere to carry a pinned commit — a 40-hex `Source.ref` is used, which is a legal git ref. `DetectDeps` has no progress channel — a `GitHubClient` decorator supplies one instead of changing the interface.

---

### Task 1: Fixtures and test helpers

**Files:**
- Create: `tests/fixtures/detect/managed/agents/ponytail.md`
- Create: `tests/fixtures/detect/managed/agents/thomas.md`
- Create: `tests/fixtures/detect/managed/skills/cso/SKILL.md`
- Create: `tests/fixtures/detect/managed/skills/explain-code/SKILL.md`
- Create: `tests/fixtures/detect/managed/skills/marketing-ads/SKILL.md`
- Create: `tests/fixtures/detect/managed/skills/marketing-ads/references/tone.md`
- Create: `tests/fixtures/detect/managed/skills/marketing-brand/SKILL.md`
- Create: `tests/fixtures/detect/managed/skills/marketing-seo/SKILL.md`
- Create: `tests/fixtures/detect/managed/skills/qa-only/SKILL.md`
- Create: `tests/helpers/managed-dir.ts`
- Create: `tests/helpers/fakes.ts`
- Test: `tests/helpers/managed-dir.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeTempManagedDir(): Promise<string>`, `cleanupTempDir(dir: string): Promise<void>`, `fakeGitHub(overrides?): GitHubClient & { calls: string[] }`, `fakeClaude(overrides?): ClaudeClient & { calls: string[] }`, and the fixture tree under `tests/fixtures/detect/managed/`.

The fixture is a new subtree (`tests/fixtures/detect/`) so it cannot collide with or break spec 01's fixtures. `agents/ponytail.md` must keep its attribution on **line 13** — a later test asserts that exact line number.

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers/managed-dir.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupTempDir, makeTempManagedDir } from './managed-dir.js';

describe('makeTempManagedDir', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await cleanupTempDir(dir);
  });

  it('copies the detection fixture into a fresh temp dir', async () => {
    const dir = await makeTempManagedDir();
    dirs.push(dir);

    expect(dir).toContain('skilled-');
    const ponytail = await fs.readFile(path.join(dir, 'agents', 'ponytail.md'), 'utf8');
    expect(ponytail.split('\n')[12]).toBe('Adapted from github.com/DietrichGebert/ponytail.');

    const skills = await fs.readdir(path.join(dir, 'skills'));
    expect(skills.sort()).toEqual([
      'cso',
      'explain-code',
      'marketing-ads',
      'marketing-brand',
      'marketing-seo',
      'qa-only',
    ]);

    const refs = await fs.readdir(path.join(dir, 'skills', 'marketing-ads', 'references'));
    expect(refs).toEqual(['tone.md']);
  });

  it('gives each call an independent copy', async () => {
    const a = await makeTempManagedDir();
    const b = await makeTempManagedDir();
    dirs.push(a, b);
    expect(a).not.toBe(b);
    await fs.writeFile(path.join(a, 'agents', 'thomas.md'), 'changed', 'utf8');
    const untouched = await fs.readFile(path.join(b, 'agents', 'thomas.md'), 'utf8');
    expect(untouched).not.toBe('changed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/helpers/managed-dir.test.ts`
Expected: FAIL with "Failed to load url ./managed-dir.js" (the helper does not exist yet).

- [ ] **Step 3: Write the fixture files and the helpers**

`tests/fixtures/detect/managed/agents/ponytail.md` — the attribution is on line 13, count the blank lines exactly:

```markdown
---
name: ponytail
description: Reviews a pull request the way a senior engineer would.
---

# Ponytail

You review pull requests. You are direct, you cite line numbers, and you never
approve a change you do not understand.

## Provenance

Adapted from github.com/DietrichGebert/ponytail.

## Review checklist

Read the diff twice before you write anything, because the second pass is where
the missing error handling becomes obvious.
```

`tests/fixtures/detect/managed/agents/thomas.md`:

```markdown
---
name: thomas
description: Turns a rambling meeting transcript into decisions and owners.
---

# Thomas

Extract every decision that was actually made and attach a named owner to it,
then list the questions that were raised and left unanswered.
```

`tests/fixtures/detect/managed/skills/cso/SKILL.md`:

```markdown
---
name: cso
description: Chief security officer review for infrastructure changes.
allowed-tools: Bash
---

# Chief Security Officer

Treat every infrastructure change as a potential blast radius expansion and
enumerate the identities that gain new privileges because of it.

## Procedure

1. List every credential the change touches.
2. Name the humans who can read those credentials afterwards.
```

`tests/fixtures/detect/managed/skills/explain-code/SKILL.md`:

```markdown
---
name: explain-code
description: Explains an unfamiliar codebase to a new joiner.
---

# Explain code

Source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-review/skills/explain-code

Start from the entry point and follow the data, not the directory listing,
because folder names lie and call graphs do not.
```

`tests/fixtures/detect/managed/skills/marketing-ads/SKILL.md`:

```markdown
---
name: marketing-ads
description: Writes paid social ad copy that survives a legal review.
metadata:
  version: 2.2.0
---

# Marketing — Ads

Write three headline variants before you write a single line of body copy, and
score each variant against the campaign brief instead of your own taste.
```

`tests/fixtures/detect/managed/skills/marketing-ads/references/tone.md`:

```markdown
# Tone reference

Plain, specific, no exclamation marks.
```

`tests/fixtures/detect/managed/skills/marketing-brand/SKILL.md`:

```markdown
---
name: marketing-brand
description: Keeps brand voice consistent across every channel.
metadata:
  version: 2.2.0
---

# Marketing — Brand

Describe the brand as a person before you describe it as a palette, because
every downstream decision is easier once the person exists.
```

`tests/fixtures/detect/managed/skills/marketing-seo/SKILL.md`:

```markdown
---
name: marketing-seo
description: Plans organic search coverage for a product launch.
metadata:
  version: 2.2.0
---

# Marketing — SEO

Group the target queries by the intent behind them and write one page per
intent, rather than one page per keyword you happened to find.
```

`tests/fixtures/detect/managed/skills/qa-only/SKILL.md` — deliberately too boilerplate to yield an n-gram:

```markdown
---
name: qa-only
description: Runs the QA pass.
---

# QA

Run the tests.
Report failures.
```

`tests/helpers/managed-dir.ts`:

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/detect/managed', import.meta.url));

/** Copies the detection fixture into a fresh temp dir. Never touches the real ~/.claude. */
export async function makeTempManagedDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  await fs.cp(FIXTURE_ROOT, dir, { recursive: true });
  return dir;
}

/** Creates an empty temp dir with no fixture content. */
export async function makeEmptyTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
```

`tests/helpers/fakes.ts`:

```ts
import type { GitHubClient, ClaudeClient } from '../../src/clients.js';
import { SkilledError } from '../../src/errors.js';

export interface RecordingGitHubClient extends GitHubClient {
  calls: string[];
}

export interface RecordingClaudeClient extends ClaudeClient {
  calls: string[];
}

function noAuth(): SkilledError {
  return new SkilledError({
    code: 'NO_AUTH',
    problem: 'GitHub is not authenticated.',
    cause: 'No token was available from `gh auth token` and GITHUB_TOKEN is unset.',
    fixes: ['gh auth login', 'skilled --refresh'],
    exitCode: 3,
  });
}

/** A GitHubClient whose methods throw NO_AUTH unless overridden. Records method names. */
export function fakeGitHub(overrides: Partial<GitHubClient> = {}): RecordingGitHubClient {
  const calls: string[] = [];
  return {
    calls,
    async searchCode(query) {
      calls.push(`searchCode:${query}`);
      if (overrides.searchCode === undefined) throw noAuth();
      return overrides.searchCode(query);
    },
    async getRepoMeta(repo) {
      calls.push(`getRepoMeta:${repo}`);
      if (overrides.getRepoMeta === undefined) throw noAuth();
      return overrides.getRepoMeta(repo);
    },
    async listCommits(source, sinceSha) {
      calls.push(`listCommits:${source.repo}`);
      if (overrides.listCommits === undefined) throw noAuth();
      return overrides.listCommits(source, sinceSha);
    },
    async readTree(source, sha) {
      calls.push(`readTree:${source.repo}@${sha}`);
      if (overrides.readTree === undefined) throw noAuth();
      return overrides.readTree(source, sha);
    },
  };
}

/** A ClaudeClient whose methods throw NO_AUTH unless overridden. Records method names. */
export function fakeClaude(overrides: Partial<ClaudeClient> = {}): RecordingClaudeClient {
  const calls: string[] = [];
  return {
    calls,
    async identify(excerpt) {
      calls.push('identify');
      if (overrides.identify === undefined) throw noAuth();
      return overrides.identify(excerpt);
    },
    async resolveConflict(args) {
      calls.push('resolveConflict');
      if (overrides.resolveConflict === undefined) throw noAuth();
      return overrides.resolveConflict(args);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/helpers/managed-dir.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/detect tests/helpers
git commit -m "test(detect): add detection fixture tree and client fakes"
```

---

### Task 2: Content hashing and primary-file selection

**Files:**
- Create: `src/detect/hash.ts`
- Test: `tests/detect/hash.test.ts`

**Interfaces:**
- Consumes: `ItemKind` from `src/types.ts`.
- Produces: `normalizeContent(text: string): string`, `hashContent(text: string): string`, `primaryFile(kind: ItemKind, contents: Map<string, string>): { relpath: string; text: string } | null`.

`node:crypto` is a Node builtin, not a package — no dependency is added.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/hash.test.ts
import { describe, expect, it } from 'vitest';
import { hashContent, normalizeContent, primaryFile } from '../../src/detect/hash.js';

describe('normalizeContent', () => {
  it('ignores line endings, trailing spaces, and surrounding blank lines', () => {
    expect(normalizeContent('\r\na\t \nb  \n\n')).toBe('a\nb');
  });

  it('keeps interior blank lines', () => {
    expect(normalizeContent('a\n\nb')).toBe('a\n\nb');
  });
});

describe('hashContent', () => {
  it('is stable across CRLF and trailing whitespace', () => {
    expect(hashContent('# Title\r\nbody  \r\n')).toBe(hashContent('# Title\nbody'));
  });

  it('differs for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('is a 64-char hex digest', () => {
    expect(hashContent('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('primaryFile', () => {
  it('prefers SKILL.md for a skill', () => {
    const contents = new Map([
      ['references/tone.md', 'tone'],
      ['SKILL.md', 'skill'],
    ]);
    expect(primaryFile('skill', contents)).toEqual({ relpath: 'SKILL.md', text: 'skill' });
  });

  it('falls back to the first path in sort order', () => {
    const contents = new Map([
      ['b.md', 'bee'],
      ['a.md', 'ay'],
    ]);
    expect(primaryFile('skill', contents)).toEqual({ relpath: 'a.md', text: 'ay' });
  });

  it('uses the empty relpath for a single-file agent', () => {
    expect(primaryFile('agent', new Map([['', 'agent body']]))).toEqual({
      relpath: '',
      text: 'agent body',
    });
  });

  it('returns null for an empty map', () => {
    expect(primaryFile('skill', new Map())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/hash.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/hash.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/hash.ts
import { createHash } from 'node:crypto';
import type { ItemKind } from '../types.js';

/**
 * Strips the differences that are not content: CRLF, trailing whitespace on a
 * line, and blank lines at the start or end of the file. Two copies of the same
 * skill that differ only in line endings must hash identically.
 */
export function normalizeContent(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export function hashContent(text: string): string {
  return createHash('sha256').update(normalizeContent(text), 'utf8').digest('hex');
}

/**
 * The one file that best represents an item: SKILL.md for a skill, the file
 * itself for a single-file agent (which discover() keys as "").
 */
export function primaryFile(
  kind: ItemKind,
  contents: Map<string, string>,
): { relpath: string; text: string } | null {
  if (contents.size === 0) return null;
  const skillEntry = contents.get('SKILL.md');
  if (kind === 'skill' && skillEntry !== undefined) return { relpath: 'SKILL.md', text: skillEntry };
  const agentEntry = contents.get('');
  if (kind === 'agent' && agentEntry !== undefined) return { relpath: '', text: agentEntry };
  const keys = [...contents.keys()].sort();
  const first = keys[0] ?? '';
  return { relpath: first, text: contents.get(first) ?? '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/hash.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/hash.ts tests/detect/hash.test.ts
git commit -m "feat(detect): add content normalization, hashing, and primary-file selection"
```

---

### Task 3: Strategy 1 — inline URL scraping

**Files:**
- Create: `src/detect/inline-url.ts`
- Test: `tests/detect/inline-url.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `ItemKind`, `Source` from `src/types.ts`.
- Produces: `detectInlineUrl(id: string, kind: ItemKind, contents: Map<string, string>): Candidate[]`.

Rules, exactly:
1. Scan every file in `contents`, in sorted relpath order, line by line.
2. A match is a GitHub URL with or without scheme, with an optional `/tree/<ref>/<subpath>` or `/blob/<ref>/<subpath>` tail. Strip a `.git` suffix and any trailing `.`, `-`, `_` from the repo name (sentence punctuation, as in `github.com/owner/repo.`).
3. Discard matches whose owner segment is a GitHub reserved word (`orgs`, `settings`, `features`, …) — those are site links, not repos.
4. A match is **attributed** when its line matches the provenance vocabulary (`adapted from`, `source`, `based on`, `from`, `upstream`, `fork of`, `credit`, `via`, …).
5. If any attributed match exists, emit only attributed matches at confidence `0.95`. Otherwise emit the single bare match at `0.55` — and emit nothing at all when bare matches point at more than one distinct repo, because a pile of unrelated links is not provenance.
6. `ref` defaults to `main`, `subpath` defaults to `''`. For a `/blob/` URL ending in `.md` on a **skill**, drop the filename so the subpath names the skill directory; for an **agent**, keep the file path.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/inline-url.test.ts
import { describe, expect, it } from 'vitest';
import { detectInlineUrl } from '../../src/detect/inline-url.js';

describe('detectInlineUrl', () => {
  it('finds an "Adapted from" line in a single-file agent, with the line number', () => {
    const body = [
      '---',
      'name: ponytail',
      '---',
      '',
      '# Ponytail',
      '',
      'Adapted from github.com/DietrichGebert/ponytail.',
    ].join('\n');

    const [candidate, ...rest] = detectInlineUrl('agents/ponytail.md', 'agent', new Map([['', body]]));

    expect(rest).toEqual([]);
    expect(candidate?.id).toBe('agents/ponytail.md');
    expect(candidate?.method).toBe('inline-url');
    expect(candidate?.confidence).toBe(0.95);
    expect(candidate?.source).toEqual({
      type: 'github',
      repo: 'DietrichGebert/ponytail',
      ref: 'main',
      subpath: '',
    });
    expect(candidate?.evidence).toBe(
      'named in agents/ponytail.md line 7: "Adapted from github.com/DietrichGebert/ponytail."',
    );
  });

  it('reads ref and subpath out of a /tree/ URL', () => {
    const body = 'Source: https://github.com/anthropics/claude-plugins-official/tree/v2/plugins/code-review/skills/explain-code';
    const [candidate] = detectInlineUrl('skills/explain-code', 'skill', new Map([['SKILL.md', body]]));

    expect(candidate?.source).toEqual({
      type: 'github',
      repo: 'anthropics/claude-plugins-official',
      ref: 'v2',
      subpath: 'plugins/code-review/skills/explain-code',
    });
  });

  it('drops the filename from a /blob/ URL for a skill', () => {
    const body = 'Based on https://github.com/owner/repo/blob/main/skills/cso/SKILL.md';
    const [candidate] = detectInlineUrl('skills/cso', 'skill', new Map([['SKILL.md', body]]));
    expect(candidate?.source.subpath).toBe('skills/cso');
  });

  it('keeps the filename from a /blob/ URL for an agent', () => {
    const body = 'Based on https://github.com/owner/repo/blob/main/agents/ponytail.md';
    const [candidate] = detectInlineUrl('agents/ponytail.md', 'agent', new Map([['', body]]));
    expect(candidate?.source.subpath).toBe('agents/ponytail.md');
  });

  it('scores an unattributed lone link lower', () => {
    const body = 'See https://github.com/owner/repo for background.';
    const [candidate] = detectInlineUrl('skills/x', 'skill', new Map([['SKILL.md', body]]));
    expect(candidate?.confidence).toBe(0.55);
  });

  it('emits nothing when several unattributed repos are linked', () => {
    const body = 'See https://github.com/a/one and https://github.com/b/two.';
    expect(detectInlineUrl('skills/x', 'skill', new Map([['SKILL.md', body]]))).toEqual([]);
  });

  it('prefers the attributed link when both kinds are present', () => {
    const body = [
      'Related reading: https://github.com/unrelated/blogpost',
      'Adapted from https://github.com/real/source',
    ].join('\n');
    const candidates = detectInlineUrl('skills/x', 'skill', new Map([['SKILL.md', body]]));
    expect(candidates.map((c) => c.source.repo)).toEqual(['real/source']);
  });

  it('ignores GitHub site links that are not repos', () => {
    const body = 'Adapted from https://github.com/features/copilot for inspiration.';
    expect(detectInlineUrl('skills/x', 'skill', new Map([['SKILL.md', body]]))).toEqual([]);
  });

  it('names the file inside a multi-file skill in its evidence', () => {
    const contents = new Map([
      ['SKILL.md', '# nothing here'],
      ['references/tone.md', 'Adapted from github.com/owner/tone'],
    ]);
    const [candidate] = detectInlineUrl('skills/marketing-ads', 'skill', contents);
    expect(candidate?.evidence).toBe(
      'named in skills/marketing-ads/references/tone.md line 1: "Adapted from github.com/owner/tone"',
    );
  });

  it('returns an empty array when there is no GitHub URL at all', () => {
    expect(detectInlineUrl('skills/qa-only', 'skill', new Map([['SKILL.md', '# QA\n\nRun the tests.']]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/inline-url.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/inline-url.js" (`detectInlineUrl` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/inline-url.ts
import path from 'node:path';
import type { Candidate, ItemKind } from '../types.js';

const GITHUB_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)((?:\/(?:tree|blob)\/)([^\s/)\]"'>]+)((?:\/[^\s)\]"'>]+)?))?/g;

/** github.com paths that are site features, not repositories. */
const RESERVED_OWNERS = new Set([
  'about', 'apps', 'blog', 'contact', 'customer-stories', 'enterprise', 'explore',
  'features', 'issues', 'join', 'login', 'marketplace', 'notifications', 'orgs',
  'pricing', 'pulls', 'search', 'security', 'settings', 'sponsors', 'topics', 'trending',
]);

const ATTRIBUTION_RE =
  /\b(adapted from|adapted|based on|borrowed from|copied from|credit|credits|fork of|forked from|from|origin|original|originally|source|sourced from|taken from|upstream|via)\b/i;

interface Hit {
  repo: string;
  ref: string;
  subpath: string;
  where: string;
  line: number;
  text: string;
  attributed: boolean;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function subpathFor(raw: string, urlKind: 'tree' | 'blob' | 'none', kind: ItemKind): string {
  if (raw === '') return '';
  if (urlKind === 'blob' && kind === 'skill' && raw.toLowerCase().endsWith('.md')) {
    const parent = path.posix.dirname(raw);
    return parent === '.' ? '' : parent;
  }
  return raw;
}

export function detectInlineUrl(
  id: string,
  kind: ItemKind,
  contents: Map<string, string>,
): Candidate[] {
  const hits: Hit[] = [];

  for (const relpath of [...contents.keys()].sort()) {
    const where = relpath === '' ? id : path.posix.join(id, relpath);
    const lines = (contents.get(relpath) ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const attributed = ATTRIBUTION_RE.test(line);
      GITHUB_URL_RE.lastIndex = 0;
      let match: RegExpExecArray | null = GITHUB_URL_RE.exec(line);
      while (match !== null) {
        const owner = match[1] ?? '';
        const repoName = (match[2] ?? '').replace(/\.git$/, '').replace(/[.\-_]+$/, '');
        if (!RESERVED_OWNERS.has(owner.toLowerCase()) && repoName !== '') {
          const tail = match[3] ?? '';
          const urlKind = tail === '' ? 'none' : tail.startsWith('/blob/') ? 'blob' : 'tree';
          const rawSub = (match[5] ?? '')
            .replace(/^\//, '')
            .replace(/[).,;:'"\]]+$/, '')
            .replace(/\/$/, '');
          hits.push({
            repo: `${owner}/${repoName}`,
            ref: match[4] ?? 'main',
            subpath: subpathFor(rawSub, urlKind, kind),
            where,
            line: i + 1,
            text: line.trim(),
            attributed,
          });
        }
        match = GITHUB_URL_RE.exec(line);
      }
    }
  }

  if (hits.length === 0) return [];

  const attributedHits = hits.filter((hit) => hit.attributed);
  const pool = attributedHits.length > 0 ? attributedHits : hits;
  const confidence = attributedHits.length > 0 ? 0.95 : 0.55;

  const bySource = new Map<string, Hit>();
  for (const hit of pool) {
    const key = `${hit.repo}@${hit.ref}#${hit.subpath}`;
    if (!bySource.has(key)) bySource.set(key, hit);
  }

  // A single unattributed link is weak evidence; several are no evidence at all.
  if (attributedHits.length === 0 && bySource.size > 1) return [];

  return [...bySource.values()].map((hit) => ({
    id,
    source: { type: 'github' as const, repo: hit.repo, ref: hit.ref, subpath: hit.subpath },
    method: 'inline-url' as const,
    confidence,
    evidence: `named in ${hit.where} line ${hit.line}: "${truncate(hit.text, 96)}"`,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/inline-url.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/inline-url.ts tests/detect/inline-url.test.ts
git commit -m "feat(detect): scrape inline upstream URLs from file bodies"
```

---

### Task 4: Strategy 2 — local plugin cache

**Files:**
- Create: `src/detect/plugin-cache.ts`
- Test: `tests/detect/plugin-cache.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `LocalItem` from `src/types.ts`; `hashContent` from `src/detect/hash.ts`.
- Produces: `detectPluginCache(items: LocalItem[], contentsById: Map<string, Map<string, string>>, pluginCacheDir: string): Promise<Candidate[]>`.

Claude Code already solved provenance for anything installed as a plugin. `<pluginCacheDir>/installed_plugins.json` maps `"<plugin>@<marketplace>"` to install records that pin `gitCommitSha`, and `known_marketplaces.json` maps a marketplace to `{ source: { source, repo }, installLocation }`. Real shapes, taken from a live install:

```json
// installed_plugins.json
{ "version": 2, "plugins": { "figma@claude-plugins-official": [
  { "scope": "user", "installPath": "/…/plugins/cache/claude-plugins-official/figma/2.2.96",
    "version": "2.2.96", "installedAt": "…", "lastUpdated": "…",
    "gitCommitSha": "9680714bad40503ef37a9f815fd1d2cd15150af4" } ] } }

// known_marketplaces.json
{ "claude-plugins-official": {
  "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
  "installLocation": "/…/plugins/marketplaces/claude-plugins-official",
  "lastUpdated": "…" } }
```

Rules, exactly:
1. Missing or malformed JSON → return `[]`. This strategy is opportunistic and must never fail a scan.
2. Per plugin key, use the install record with the greatest `lastUpdated` (ISO strings sort correctly); ties take the first.
3. Index every `.md` file under each `installPath` by content hash. Index every `.md` file under each marketplace `installLocation` the same way — the marketplace checkout mirrors the repo, so a hit there yields a **repo-relative** path.
4. A local file whose hash matches the plugin index is a hit. The repo path is the marketplace-index path when available, otherwise `plugins/<plugin>/<path-inside-installPath>`.
5. The `subpath` is the repo path with the item-relative path stripped from its tail — that turns `plugins/p/skills/foo/references/x.md` plus `references/x.md` into `plugins/p/skills/foo`, and works unchanged for a single-file agent (item-relative path `""`).
6. `ref` is the pinned `gitCommitSha`. A 40-hex ref is a legal git ref and is how spec 02 carries an exact commit through `Candidate`, which has no commit field of its own. Confidence `0.99`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/plugin-cache.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupTempDir, makeEmptyTempDir } from '../helpers/managed-dir.js';
import { detectPluginCache } from '../../src/detect/plugin-cache.js';
import type { LocalItem } from '../../src/types.js';

const SHA = '9680714bad40503ef37a9f815fd1d2cd15150af4';
const SKILL_BODY = '# Figma power\n\nRead the selected frame before you write any CSS.\n';
const AGENT_BODY = '# Reviewer\n\nCite line numbers or say nothing at all.\n';

describe('detectPluginCache', () => {
  let root: string;
  let cacheDir: string;

  beforeEach(async () => {
    root = await makeEmptyTempDir();
    cacheDir = path.join(root, 'plugins');
    const installPath = path.join(cacheDir, 'cache', 'mkt', 'figma', '2.2.96');
    const marketDir = path.join(cacheDir, 'marketplaces', 'mkt');

    await fs.mkdir(path.join(installPath, 'skills', 'figma-power'), { recursive: true });
    await fs.writeFile(path.join(installPath, 'skills', 'figma-power', 'SKILL.md'), SKILL_BODY, 'utf8');
    await fs.mkdir(path.join(installPath, 'agents'), { recursive: true });
    await fs.writeFile(path.join(installPath, 'agents', 'reviewer.md'), AGENT_BODY, 'utf8');

    await fs.mkdir(path.join(marketDir, 'plugins', 'figma', 'skills', 'figma-power'), { recursive: true });
    await fs.writeFile(
      path.join(marketDir, 'plugins', 'figma', 'skills', 'figma-power', 'SKILL.md'),
      SKILL_BODY,
      'utf8',
    );

    await fs.writeFile(
      path.join(cacheDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'figma@mkt': [
            {
              scope: 'user',
              installPath,
              version: '2.2.96',
              installedAt: '2026-04-14T13:52:34.648Z',
              lastUpdated: '2026-08-21T13:06:06.145Z',
              gitCommitSha: SHA,
            },
          ],
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(cacheDir, 'known_marketplaces.json'),
      JSON.stringify({
        mkt: {
          source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
          installLocation: marketDir,
          lastUpdated: '2026-08-27T14:32:28.286Z',
        },
      }),
      'utf8',
    );
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  function item(id: string, kind: 'skill' | 'agent', files: string[]): LocalItem {
    return { id, absPath: path.join(root, id), kind, files };
  }

  it('matches a skill against the plugin cache and pins the commit as the ref', async () => {
    const items = [item('skills/figma-power', 'skill', ['SKILL.md'])];
    const contents = new Map([['skills/figma-power', new Map([['SKILL.md', SKILL_BODY]])]]);

    const [candidate, ...rest] = await detectPluginCache(items, contents, cacheDir);

    expect(rest).toEqual([]);
    expect(candidate?.method).toBe('plugin-cache');
    expect(candidate?.confidence).toBe(0.99);
    expect(candidate?.source).toEqual({
      type: 'github',
      repo: 'anthropics/claude-plugins-official',
      ref: SHA,
      subpath: 'plugins/figma/skills/figma-power',
    });
    expect(candidate?.evidence).toContain('figma@mkt');
    expect(candidate?.evidence).toContain('9680714');
  });

  it('keeps the file path as the subpath for a single-file agent', async () => {
    const items = [item('agents/reviewer.md', 'agent', [''])];
    const contents = new Map([['agents/reviewer.md', new Map([['', AGENT_BODY]])]]);

    const [candidate] = await detectPluginCache(items, contents, cacheDir);

    // Not present in the marketplace checkout, so the plugin-relative fallback applies.
    expect(candidate?.source.subpath).toBe('plugins/figma/agents/reviewer.md');
    expect(candidate?.source.ref).toBe(SHA);
  });

  it('ignores whitespace-only differences', async () => {
    const items = [item('skills/figma-power', 'skill', ['SKILL.md'])];
    const edited = SKILL_BODY.replace(/\n/g, '\r\n').concat('\n\n');
    const contents = new Map([['skills/figma-power', new Map([['SKILL.md', edited]])]]);

    expect(await detectPluginCache(items, contents, cacheDir)).toHaveLength(1);
  });

  it('returns nothing for content the cache does not contain', async () => {
    const items = [item('skills/cso', 'skill', ['SKILL.md'])];
    const contents = new Map([['skills/cso', new Map([['SKILL.md', '# CSO\n\nDifferent.\n']])]]);

    expect(await detectPluginCache(items, contents, cacheDir)).toEqual([]);
  });

  it('returns an empty array when the cache directory does not exist', async () => {
    const items = [item('skills/figma-power', 'skill', ['SKILL.md'])];
    const contents = new Map([['skills/figma-power', new Map([['SKILL.md', SKILL_BODY]])]]);

    expect(await detectPluginCache(items, contents, path.join(root, 'nope'))).toEqual([]);
  });

  it('returns an empty array when installed_plugins.json is malformed', async () => {
    await fs.writeFile(path.join(cacheDir, 'installed_plugins.json'), '{ not json', 'utf8');
    const items = [item('skills/figma-power', 'skill', ['SKILL.md'])];
    const contents = new Map([['skills/figma-power', new Map([['SKILL.md', SKILL_BODY]])]]);

    expect(await detectPluginCache(items, contents, cacheDir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/plugin-cache.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/plugin-cache.js" (`detectPluginCache` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/plugin-cache.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Candidate, LocalItem } from '../types.js';
import { hashContent } from './hash.js';

const MAX_DEPTH = 8;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);

interface InstallRecord {
  installPath: string;
  version: string;
  gitCommitSha: string;
  lastUpdated: string;
}

interface PluginHit {
  pluginKey: string;
  pluginName: string;
  marketplace: string;
  sha: string;
  /** path relative to the install directory, POSIX separators */
  relPath: string;
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseInstallRecords(value: unknown): InstallRecord[] {
  if (!Array.isArray(value)) return [];
  const records: InstallRecord[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const installPath = asString(record.installPath);
    const sha = asString(record.gitCommitSha);
    if (installPath === null || sha === null) continue;
    records.push({
      installPath,
      version: asString(record.version) ?? '',
      gitCommitSha: sha,
      lastUpdated: asString(record.lastUpdated) ?? '',
    });
  }
  return records;
}

/** Every .md file under root, keyed by relative POSIX path. */
async function walkMarkdown(root: string, depth = 0): Promise<Array<{ rel: string; text: string }>> {
  if (depth > MAX_DEPTH) return [];
  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Array<{ rel: string; text: string }> = [];
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(dirent.name)) continue;
    const abs = path.join(root, dirent.name);
    if (dirent.isDirectory()) {
      for (const nested of await walkMarkdown(abs, depth + 1)) {
        found.push({ rel: path.posix.join(dirent.name, nested.rel), text: nested.text });
      }
    } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.md')) {
      try {
        found.push({ rel: dirent.name, text: await fs.readFile(abs, 'utf8') });
      } catch {
        continue;
      }
    }
  }
  return found;
}

/** Removes the item-relative tail from a repo path, leaving the item's root. */
function stripItemTail(repoPath: string, itemRelPath: string): string {
  if (itemRelPath === '') return repoPath;
  if (repoPath === itemRelPath) return '';
  if (repoPath.endsWith(`/${itemRelPath}`)) return repoPath.slice(0, -(itemRelPath.length + 1));
  const parent = path.posix.dirname(repoPath);
  return parent === '.' ? '' : parent;
}

export async function detectPluginCache(
  items: LocalItem[],
  contentsById: Map<string, Map<string, string>>,
  pluginCacheDir: string,
): Promise<Candidate[]> {
  const installed = await readJsonObject(path.join(pluginCacheDir, 'installed_plugins.json'));
  if (installed === null) return [];
  const plugins = installed.plugins;
  if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) return [];

  const marketplaces = (await readJsonObject(path.join(pluginCacheDir, 'known_marketplaces.json'))) ?? {};
  const repoByMarketplace = new Map<string, string>();
  const locationByMarketplace = new Map<string, string>();
  for (const [name, raw] of Object.entries(marketplaces)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const source = record.source;
    if (typeof source === 'object' && source !== null) {
      const repo = asString((source as Record<string, unknown>).repo);
      if (repo !== null) repoByMarketplace.set(name, repo);
    }
    const location = asString(record.installLocation);
    if (location !== null) locationByMarketplace.set(name, location);
  }

  // hash -> first plugin file with that content
  const pluginIndex = new Map<string, PluginHit>();
  const marketplacesToIndex = new Set<string>();

  for (const [pluginKey, rawRecords] of Object.entries(plugins as Record<string, unknown>)) {
    const records = parseInstallRecords(rawRecords);
    if (records.length === 0) continue;
    const newest = records.reduce((best, next) => (next.lastUpdated > best.lastUpdated ? next : best));
    const atIndex = pluginKey.lastIndexOf('@');
    const pluginName = atIndex === -1 ? pluginKey : pluginKey.slice(0, atIndex);
    const marketplace = atIndex === -1 ? '' : pluginKey.slice(atIndex + 1);
    marketplacesToIndex.add(marketplace);

    for (const file of await walkMarkdown(newest.installPath)) {
      const hash = hashContent(file.text);
      if (pluginIndex.has(hash)) continue;
      pluginIndex.set(hash, {
        pluginKey,
        pluginName,
        marketplace,
        sha: newest.gitCommitSha,
        relPath: file.rel,
      });
    }
  }

  if (pluginIndex.size === 0) return [];

  // hash -> repo-relative path, per marketplace checkout
  const marketIndex = new Map<string, Map<string, string>>();
  for (const marketplace of marketplacesToIndex) {
    const location = locationByMarketplace.get(marketplace);
    if (location === undefined) continue;
    const byHash = new Map<string, string>();
    for (const file of await walkMarkdown(location)) {
      const hash = hashContent(file.text);
      if (!byHash.has(hash)) byHash.set(hash, file.rel);
    }
    marketIndex.set(marketplace, byHash);
  }

  const candidates: Candidate[] = [];
  for (const item of items) {
    const contents = contentsById.get(item.id);
    if (contents === undefined) continue;
    let matched = false;
    for (const relpath of [...contents.keys()].sort()) {
      if (matched) break;
      const hit = pluginIndex.get(hashContent(contents.get(relpath) ?? ''));
      if (hit === undefined) continue;
      const repo = repoByMarketplace.get(hit.marketplace);
      if (repo === undefined) continue;

      const fromMarketplace = marketIndex.get(hit.marketplace)?.get(hashContent(contents.get(relpath) ?? ''));
      const repoPath =
        fromMarketplace ?? path.posix.join('plugins', hit.pluginName, hit.relPath);

      candidates.push({
        id: item.id,
        source: {
          type: 'github',
          repo,
          ref: hit.sha,
          subpath: stripItemTail(repoPath, relpath),
        },
        method: 'plugin-cache',
        confidence: 0.99,
        evidence: `plugin ${hit.pluginKey} pins ${hit.sha.slice(0, 7)} · identical content at ${repoPath}`,
      });
      matched = true;
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/plugin-cache.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/plugin-cache.ts tests/detect/plugin-cache.test.ts
git commit -m "feat(detect): resolve provenance from the local plugin cache"
```

---

### Task 5: Strategy 3 — known-sources index

**Files:**
- Create: `src/detect/known-index.ts`
- Test: `tests/detect/known-index.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `ItemKind`, `Source` from `src/types.ts`; `SkilledError` from `src/errors.ts`; `hashContent`, `primaryFile` from `src/detect/hash.ts`.
- Produces: `interface KnownIndexEntry { hash: string; source: Source; label: string }`, `interface KnownIndex { version: 1; entries: KnownIndexEntry[] }`, `emptyKnownIndex(): KnownIndex`, `loadKnownIndex(overridePath?: string): Promise<KnownIndex>`, `detectKnownIndex(id: string, kind: ItemKind, contents: Map<string, string>, index: KnownIndex): Candidate[]`.

`KnownIndex` is named by the contract's `DetectDeps` but never defined there; this file is its definition, and `src/detect/index.ts` re-exports it.

The bundled index ships **empty**. Fabricating hashes for repos nobody has read would be a lie, and a wrong hash is worse than no hash. The matcher, the loader, and the override path are complete, so entries can be appended without touching code — that is design TODO 2. The override lives at `<managed-dir>/.skilled/known-index.json`; a malformed override is a `BAD_MANIFEST` error rather than a silent fallback, because a user who wrote that file wants to know it is broken.

The index is keyed on the **primary** file only (`SKILL.md` for a skill, the file itself for an agent). Indexing every reference file would make the index enormous for no gain.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/known-index.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupTempDir, makeEmptyTempDir } from '../helpers/managed-dir.js';
import { hashContent } from '../../src/detect/hash.js';
import {
  detectKnownIndex,
  emptyKnownIndex,
  loadKnownIndex,
  type KnownIndex,
} from '../../src/detect/known-index.js';
import { SkilledError } from '../../src/errors.js';

const BODY = '# Explain code\n\nStart from the entry point and follow the data.\n';

function indexWith(hash: string): KnownIndex {
  return {
    version: 1,
    entries: [
      {
        hash,
        source: {
          type: 'github',
          repo: 'anthropics/claude-plugins-official',
          ref: 'main',
          subpath: 'plugins/code-review/skills/explain-code',
        },
        label: 'anthropics/claude-plugins-official plugins/code-review/skills/explain-code',
      },
    ],
  };
}

describe('emptyKnownIndex', () => {
  it('is a version-1 index with no entries', () => {
    expect(emptyKnownIndex()).toEqual({ version: 1, entries: [] });
  });
});

describe('detectKnownIndex', () => {
  it('matches a skill on its primary file', () => {
    const contents = new Map([
      ['SKILL.md', BODY],
      ['references/x.md', 'unrelated'],
    ]);

    const [candidate, ...rest] = detectKnownIndex(
      'skills/explain-code',
      'skill',
      contents,
      indexWith(hashContent(BODY)),
    );

    expect(rest).toEqual([]);
    expect(candidate?.method).toBe('known-index');
    expect(candidate?.confidence).toBe(0.9);
    expect(candidate?.source.repo).toBe('anthropics/claude-plugins-official');
    expect(candidate?.evidence).toBe(
      'content-identical to anthropics/claude-plugins-official plugins/code-review/skills/explain-code (known-sources index)',
    );
  });

  it('ignores a reference file that happens to be indexed', () => {
    const contents = new Map([
      ['SKILL.md', 'something else entirely'],
      ['references/x.md', BODY],
    ]);
    expect(detectKnownIndex('skills/x', 'skill', contents, indexWith(hashContent(BODY)))).toEqual([]);
  });

  it('returns nothing for an empty index', () => {
    const contents = new Map([['SKILL.md', BODY]]);
    expect(detectKnownIndex('skills/x', 'skill', contents, emptyKnownIndex())).toEqual([]);
  });

  it('returns nothing for an item with no files', () => {
    expect(detectKnownIndex('skills/x', 'skill', new Map(), indexWith(hashContent(BODY)))).toEqual([]);
  });
});

describe('loadKnownIndex', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await cleanupTempDir(dir);
  });

  it('returns the bundled index when no override is given', async () => {
    const index = await loadKnownIndex();
    expect(index.version).toBe(1);
    expect(Array.isArray(index.entries)).toBe(true);
  });

  it('returns the bundled index when the override file is absent', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    const index = await loadKnownIndex(path.join(dir, 'known-index.json'));
    expect(index.entries).toEqual([]);
  });

  it('reads a valid override file', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    const file = path.join(dir, 'known-index.json');
    await fs.writeFile(file, JSON.stringify(indexWith('deadbeef')), 'utf8');

    const index = await loadKnownIndex(file);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]?.hash).toBe('deadbeef');
  });

  it('throws BAD_MANIFEST for a malformed override file', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    const file = path.join(dir, 'known-index.json');
    await fs.writeFile(file, '{ "version": 1, "entries": "nope" }', 'utf8');

    await expect(loadKnownIndex(file)).rejects.toMatchObject({ code: 'BAD_MANIFEST' });
    await expect(loadKnownIndex(file)).rejects.toBeInstanceOf(SkilledError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/known-index.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/known-index.js".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/known-index.ts
import fs from 'node:fs/promises';
import { SkilledError } from '../errors.js';
import type { Candidate, ItemKind, Source } from '../types.js';
import { hashContent, primaryFile } from './hash.js';

export interface KnownIndexEntry {
  /** sha256 of the normalized primary file */
  hash: string;
  source: Source;
  /** human-readable origin, shown as evidence */
  label: string;
}

export interface KnownIndex {
  version: 1;
  entries: KnownIndexEntry[];
}

/**
 * The bundled head of the distribution. Ships empty on purpose: an entry is only
 * worth having if its hash was computed from the real upstream file. Append
 * entries here, or point users at <managed-dir>/.skilled/known-index.json.
 */
const BUNDLED_ENTRIES: KnownIndexEntry[] = [];

export function emptyKnownIndex(): KnownIndex {
  return { version: 1, entries: [] };
}

function badIndex(file: string, why: string): SkilledError {
  return new SkilledError({
    code: 'BAD_MANIFEST',
    problem: `The known-sources index at ${file} could not be read.`,
    cause: `${why} An index must look like {"version":1,"entries":[{"hash":"…","source":{…},"label":"…"}]}.`,
    fixes: [
      `Fix the JSON in ${file}`,
      `Delete ${file} to fall back to the bundled index`,
    ],
    exitCode: 2,
  });
}

function parseIndex(file: string, raw: string): KnownIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badIndex(file, 'It is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw badIndex(file, 'The top level is not an object.');
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) throw badIndex(file, `version was ${JSON.stringify(record.version)}, expected 1.`);
  if (!Array.isArray(record.entries)) throw badIndex(file, 'entries is not an array.');

  const entries: KnownIndexEntry[] = [];
  for (const rawEntry of record.entries) {
    if (typeof rawEntry !== 'object' || rawEntry === null) throw badIndex(file, 'An entry is not an object.');
    const entry = rawEntry as Record<string, unknown>;
    const source = entry.source;
    if (typeof entry.hash !== 'string' || typeof entry.label !== 'string') {
      throw badIndex(file, 'An entry is missing a string hash or label.');
    }
    if (typeof source !== 'object' || source === null) throw badIndex(file, 'An entry is missing its source.');
    const sourceRecord = source as Record<string, unknown>;
    if (
      sourceRecord.type !== 'github' ||
      typeof sourceRecord.repo !== 'string' ||
      typeof sourceRecord.ref !== 'string' ||
      typeof sourceRecord.subpath !== 'string'
    ) {
      throw badIndex(file, 'An entry source must be {type:"github",repo,ref,subpath}.');
    }
    entries.push({
      hash: entry.hash,
      label: entry.label,
      source: {
        type: 'github',
        repo: sourceRecord.repo,
        ref: sourceRecord.ref,
        subpath: sourceRecord.subpath,
      },
    });
  }
  return { version: 1, entries };
}

/**
 * Loads the bundled index, or the user's override at
 * <managed-dir>/.skilled/known-index.json when that file exists.
 */
export async function loadKnownIndex(overridePath?: string): Promise<KnownIndex> {
  const bundled: KnownIndex = { version: 1, entries: [...BUNDLED_ENTRIES] };
  if (overridePath === undefined) return bundled;
  let raw: string;
  try {
    raw = await fs.readFile(overridePath, 'utf8');
  } catch {
    return bundled;
  }
  return parseIndex(overridePath, raw);
}

export function detectKnownIndex(
  id: string,
  kind: ItemKind,
  contents: Map<string, string>,
  index: KnownIndex,
): Candidate[] {
  if (index.entries.length === 0) return [];
  const primary = primaryFile(kind, contents);
  if (primary === null) return [];
  const hash = hashContent(primary.text);
  const match = index.entries.find((entry) => entry.hash === hash);
  if (match === undefined) return [];
  return [
    {
      id,
      source: { ...match.source },
      method: 'known-index',
      confidence: 0.9,
      evidence: `content-identical to ${match.label} (known-sources index)`,
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/known-index.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/known-index.ts tests/detect/known-index.test.ts
git commit -m "feat(detect): match content against the known-sources index"
```

---

### Task 6: n-gram extraction for code search

**Files:**
- Create: `src/detect/code-search.ts`
- Test: `tests/detect/code-search.ngram.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractNgram(text: string): string | null`.

The query must be a sentence rare enough to be near-unique and boring enough to survive reformatting. The algorithm is fixed, not a judgment call:

1. Normalize CRLF to LF. Strip YAML frontmatter (`---` on the first line through the next line that starts with `---`) — frontmatter is metadata everyone rewrites.
2. Walk the remaining lines, toggling on fenced code blocks (a line whose first non-space characters are ` ``` `) and skipping everything inside them.
3. Per line: strip a leading heading marker (`#` × 1-6 plus space), bullet marker (`-`, `*`, `+`, `>` plus space) or ordered marker (digits, `.`, space); collapse whitespace runs to one space; trim.
4. Reject the line when its length is outside `[40, 300]`, or it contains `http`, `|`, or a backtick — URLs, table rows, and inline code are unstable.
5. Reject the line when it has fewer than 6 words, or when no word has 8+ alphanumeric characters. The long word is the rarity proxy.
6. Among survivors pick the highest word count; tie-break on longer, then on earlier line.
7. Truncate the winner to 160 characters at a word boundary (GitHub rejects very long phrase queries).
8. No survivor → `null`, and the caller skips the item rather than searching for boilerplate.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/code-search.ngram.test.ts
import { describe, expect, it } from 'vitest';
import { extractNgram } from '../../src/detect/code-search.js';

describe('extractNgram', () => {
  it('picks the wordiest prose line and ignores frontmatter', () => {
    const text = [
      '---',
      'name: cso',
      'description: Chief security officer review for infrastructure changes with many words.',
      'allowed-tools: Bash',
      '---',
      '',
      '# Chief Security Officer',
      '',
      'Treat every infrastructure change as a potential blast radius expansion and',
      'enumerate the identities that gain new privileges because of it.',
    ].join('\n');

    expect(extractNgram(text)).toBe(
      'Treat every infrastructure change as a potential blast radius expansion and',
    );
  });

  it('skips fenced code blocks', () => {
    const text = [
      'Short intro.',
      '',
      '```bash',
      'run the deployment script with every environment variable exported first',
      '```',
      '',
      'Describe the rollback procedure before you describe the deployment procedure.',
    ].join('\n');

    expect(extractNgram(text)).toBe(
      'Describe the rollback procedure before you describe the deployment procedure.',
    );
  });

  it('strips bullet and heading markers', () => {
    const text = '- Enumerate the credentials that this particular change happens to touch\n';
    expect(extractNgram(text)).toBe(
      'Enumerate the credentials that this particular change happens to touch',
    );
  });

  it('rejects lines with URLs, tables, or inline code', () => {
    const text = [
      'See https://example.com/a/very/long/documentation/url/for/this/topic/here',
      '| column one heading | column two heading | column three heading value |',
      'Use the `--refresh` flag whenever the cached status has gone stale on you',
      'Prefer the deterministic pathway whenever both alternatives are available.',
    ].join('\n');

    expect(extractNgram(text)).toBe(
      'Prefer the deterministic pathway whenever both alternatives are available.',
    );
  });

  it('requires a long word so generic short sentences are skipped', () => {
    const text = 'the cat sat on the mat and then the dog sat on the mat as well too\n';
    expect(extractNgram(text)).toBeNull();
  });

  it('returns null for boilerplate with no qualifying line', () => {
    const text = '---\nname: qa-only\n---\n\n# QA\n\nRun the tests.\nReport failures.\n';
    expect(extractNgram(text)).toBeNull();
  });

  it('truncates a very long line at a word boundary', () => {
    const long = `Enumerate ${'reproducible '.repeat(20)}outcomes`;
    const ngram = extractNgram(long);
    expect(ngram).not.toBeNull();
    expect((ngram ?? '').length).toBeLessThanOrEqual(160);
    expect(ngram).not.toMatch(/\s$/);
    expect(long.startsWith(ngram ?? 'x')).toBe(true);
  });

  it('handles CRLF input', () => {
    const text = '---\r\nname: x\r\n---\r\n\r\nDescribe the rollback procedure before the deployment procedure.\r\n';
    expect(extractNgram(text)).toBe(
      'Describe the rollback procedure before the deployment procedure.',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/code-search.ngram.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/code-search.js" (`extractNgram` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/code-search.ts
const MIN_LINE_LENGTH = 40;
const MAX_LINE_LENGTH = 300;
const MIN_WORDS = 6;
const LONG_WORD_LENGTH = 8;
const MAX_QUERY_LENGTH = 160;

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) return text;
  const close = text.indexOf('\n---', 4);
  if (close === -1) return text;
  const lineEnd = text.indexOf('\n', close + 1);
  return lineEnd === -1 ? '' : text.slice(lineEnd + 1);
}

function truncateToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Picks the sentence most likely to be unique to this file's upstream, or null
 * when the file is all boilerplate. Deterministic: same input, same query.
 */
export function extractNgram(text: string): string | null {
  const body = stripFrontmatter(text.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  let inFence = false;
  let best: { line: string; words: number } | null = null;

  for (const rawLine of lines) {
    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const cleaned = rawLine
      .replace(/^\s*(?:#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < MIN_LINE_LENGTH || cleaned.length > MAX_LINE_LENGTH) continue;
    if (cleaned.includes('http') || cleaned.includes('|') || cleaned.includes('`')) continue;

    const words = cleaned.split(' ').filter((word) => word.length > 0);
    if (words.length < MIN_WORDS) continue;
    if (!words.some((word) => word.replace(/[^A-Za-z0-9]/g, '').length >= LONG_WORD_LENGTH)) continue;

    const better =
      best === null ||
      words.length > best.words ||
      (words.length === best.words && cleaned.length > best.line.length);
    if (better) best = { line: cleaned, words: words.length };
  }

  return best === null ? null : truncateToWord(best.line, MAX_QUERY_LENGTH);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/code-search.ngram.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/code-search.ts tests/detect/code-search.ngram.test.ts
git commit -m "feat(detect): extract a rare n-gram for GitHub code search"
```

---

### Task 7: Rate limiting and the instrumented GitHub client

**Files:**
- Extend: `src/detect/code-search.ts`
- Test: `tests/detect/code-search.throttle.test.ts`

**Interfaces:**
- Consumes: `GitHubClient` from `src/clients.ts`; `SkilledError` from `src/errors.ts`; `extractNgram` from Task 6.
- Produces: `interface RateLimiterOptions { maxPerMinute: number; now?: () => number; sleep?: (ms: number) => Promise<void> }`, `class RateLimiter` with `waitMs(): number` and `acquire(): Promise<void>`, `type SearchEvent`, `throttledGitHubClient(inner: GitHubClient, limiter: RateLimiter, onEvent: (event: SearchEvent) => void): GitHubClient`.

`DetectDeps` has no progress channel, and the contract fixes its four fields. The decorator solves it without touching the interface: a `GitHubClient` that paces itself, announces the wait **before** sleeping, and reports `NO_AUTH` / `RATE_LIMIT` to whoever is rendering. The renderer owns the counts, so it can produce the design's exact wording ("Identified 38 of 51 so far. 13 still unknown. Resuming automatically in 47s, or press Ctrl-C — progress is saved.").

The clock and the sleep are injected, so the tests are instant and deterministic.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/code-search.throttle.test.ts
import { describe, expect, it } from 'vitest';
import { RateLimiter, throttledGitHubClient, type SearchEvent } from '../../src/detect/code-search.js';
import { fakeGitHub } from '../helpers/fakes.js';
import { SkilledError } from '../../src/errors.js';

function fakeClock() {
  let now = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => now,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows the first maxPerMinute acquisitions without waiting', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 3, now: clock.now, sleep: clock.sleep });

    for (let i = 0; i < 3; i++) {
      expect(limiter.waitMs()).toBe(0);
      await limiter.acquire();
    }
    expect(clock.slept).toEqual([]);
  });

  it('waits out the remainder of the window on the next acquisition', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 2, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    clock.advance(10_000);
    await limiter.acquire();

    expect(limiter.waitMs()).toBe(50_000);
    await limiter.acquire();
    expect(clock.slept).toEqual([50_000]);
    expect(limiter.waitMs()).toBe(10_000);
  });

  it('does not wait once the window has fully passed', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 1, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    clock.advance(60_001);
    expect(limiter.waitMs()).toBe(0);
  });
});

describe('throttledGitHubClient', () => {
  it('announces the wait before sleeping', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 1, now: clock.now, sleep: clock.sleep });
    const events: SearchEvent[] = [];
    const inner = fakeGitHub({ searchCode: async () => [{ repo: 'a/b', path: 'skills/x/SKILL.md' }] });
    const client = throttledGitHubClient(inner, limiter, (event) => events.push(event));

    await client.searchCode('one');
    await client.searchCode('two');

    expect(events).toEqual([
      { kind: 'search-start', query: 'one' },
      { kind: 'rate-limit-wait', waitMs: 60_000 },
      { kind: 'search-start', query: 'two' },
    ]);
  });

  it('reports NO_AUTH and rethrows so the cascade can stop trying', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 10, now: clock.now, sleep: clock.sleep });
    const events: SearchEvent[] = [];
    const client = throttledGitHubClient(fakeGitHub(), limiter, (event) => events.push(event));

    await expect(client.searchCode('anything')).rejects.toBeInstanceOf(SkilledError);
    expect(events).toEqual([
      { kind: 'search-start', query: 'anything' },
      { kind: 'no-auth', message: 'GitHub is not authenticated.' },
    ]);
  });

  it('reports a server-side rate limit', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 10, now: clock.now, sleep: clock.sleep });
    const events: SearchEvent[] = [];
    const inner = fakeGitHub({
      searchCode: async () => {
        throw new SkilledError({
          code: 'RATE_LIMIT',
          problem: 'GitHub search rate limit reached (10/min)',
          cause: 'The search API refused the request.',
          fixes: ['Wait and run `skilled --refresh` again'],
          exitCode: 3,
        });
      },
    });
    const client = throttledGitHubClient(inner, limiter, (event) => events.push(event));

    await expect(client.searchCode('q')).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(events).toContainEqual({ kind: 'rate-limited', retryAfterSeconds: 60 });
  });

  it('passes through the other client methods', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ maxPerMinute: 10, now: clock.now, sleep: clock.sleep });
    const inner = fakeGitHub({
      getRepoMeta: async () => ({ createdAt: '2026-02-11', stars: 340, pushedAt: '2026-08-09' }),
    });
    const client = throttledGitHubClient(inner, limiter, () => undefined);

    expect(await client.getRepoMeta('a/b')).toEqual({
      createdAt: '2026-02-11',
      stars: 340,
      pushedAt: '2026-08-09',
    });
    expect(inner.calls).toEqual(['getRepoMeta:a/b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/code-search.throttle.test.ts`
Expected: FAIL with "RateLimiter is not a constructor" / "throttledGitHubClient is not a function".

- [ ] **Step 3: Write minimal implementation — append to `src/detect/code-search.ts`**

```ts
// src/detect/code-search.ts — append below extractNgram
import type { GitHubClient } from '../clients.js';
import { SkilledError } from '../errors.js';

const WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  maxPerMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** A sliding-window pacer. GitHub code search allows roughly 10 requests a minute. */
export class RateLimiter {
  private readonly max: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private stamps: number[] = [];

  constructor(options: RateLimiterOptions) {
    this.max = Math.max(1, options.maxPerMinute);
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  /** Milliseconds the next acquire() would block for. 0 when a slot is free. */
  waitMs(): number {
    const cutoff = this.now() - WINDOW_MS;
    this.stamps = this.stamps.filter((stamp) => stamp > cutoff);
    if (this.stamps.length < this.max) return 0;
    const oldest = this.stamps[this.stamps.length - this.max] ?? this.now();
    return Math.max(0, oldest + WINDOW_MS - this.now());
  }

  async acquire(): Promise<void> {
    const wait = this.waitMs();
    if (wait > 0) await this.sleep(wait);
    this.stamps.push(this.now());
    if (this.stamps.length > this.max) this.stamps = this.stamps.slice(-this.max);
  }
}

export type SearchEvent =
  | { kind: 'search-start'; query: string }
  | { kind: 'rate-limit-wait'; waitMs: number }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'no-auth'; message: string }
  | { kind: 'error'; message: string };

/**
 * Paces every call and reports what happened. DetectDeps has no progress
 * channel, so the channel is the client itself — a GitHubClient wrapping a
 * GitHubClient, which keeps the contract's interface untouched.
 */
export function throttledGitHubClient(
  inner: GitHubClient,
  limiter: RateLimiter,
  onEvent: (event: SearchEvent) => void,
): GitHubClient {
  async function paced<T>(run: () => Promise<T>, announce?: SearchEvent): Promise<T> {
    const wait = limiter.waitMs();
    if (wait > 0) onEvent({ kind: 'rate-limit-wait', waitMs: wait });
    await limiter.acquire();
    if (announce !== undefined) onEvent(announce);
    try {
      return await run();
    } catch (error) {
      if (error instanceof SkilledError) {
        if (error.code === 'NO_AUTH') onEvent({ kind: 'no-auth', message: error.problem });
        else if (error.code === 'RATE_LIMIT') onEvent({ kind: 'rate-limited', retryAfterSeconds: 60 });
        else onEvent({ kind: 'error', message: error.problem });
      } else {
        onEvent({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  return {
    searchCode(query) {
      // Announced after pacing, so a rate-limit wait is reported before the
      // "searching GitHub" line rather than after it.
      return paced(() => inner.searchCode(query), { kind: 'search-start', query });
    },
    getRepoMeta(repo) {
      return paced(() => inner.getRepoMeta(repo));
    },
    listCommits(source, sinceSha) {
      return paced(() => inner.listCommits(source, sinceSha));
    },
    readTree(source, sha) {
      return paced(() => inner.readTree(source, sha));
    },
  };
}
```

Move the two `import` lines to the top of the file, above `MIN_LINE_LENGTH` — ESM requires imports at module scope, and `extractNgram` needs none of them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/code-search.throttle.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/code-search.ts tests/detect/code-search.throttle.test.ts
git commit -m "feat(detect): pace GitHub calls and surface rate-limit progress"
```

---

### Task 8: Strategy 4 — GitHub code search with copy-direction scoring

**Files:**
- Extend: `src/detect/code-search.ts`
- Test: `tests/detect/code-search.detect.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `LocalItem`, `RepoMeta` from `src/types.ts`; `GitHubClient` from `src/clients.ts`; `SkilledError` from `src/errors.ts`; `primaryFile` from `src/detect/hash.ts`; `extractNgram` from Task 6.
- Produces: `detectCodeSearch(item: LocalItem, contents: Map<string, string>, github: GitHubClient, options?: { maxRepos?: number }): Promise<Candidate[]>`.

Code search finds *a* repo containing your text, not necessarily *the* source. It may be a fork, or a repo that copied from the same origin you did, or one that copied from you. Mitigation, exactly as the design requires:

- Query is the extracted n-gram as an exact phrase, restricted to markdown: `"<ngram>" path:*.md`.
- Dedupe hits by repo in hit order, keeping the first path per repo, and cap at `maxRepos` (default 5) so one item cannot eat the whole rate limit.
- Order candidates by **earliest `createdAt` first** — the origin predates its copies — then by stars descending, then by repo name.
- Confidence: one repo → `0.9`; the earliest repo predates the runner-up by 30+ days → `0.85`; otherwise the leader gets `0.7`. Every other candidate gets `0.5`.
- Return **all** scored candidates. Competing candidates are surfaced to the user, never silently narrowed to one. `repoMeta` is attached to each so the confirmation prompt can print age, stars, and last push as judgment aids.
- A repo whose metadata is `UPSTREAM_GONE` is dropped; `NO_AUTH`, `RATE_LIMIT`, `NETWORK` propagate so the orchestrator can stop all network work.
- `subpath` is the hit path with the item's primary-file relpath stripped from the tail, so a `SKILL.md` hit names the skill directory.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/code-search.detect.test.ts
import { describe, expect, it } from 'vitest';
import { detectCodeSearch } from '../../src/detect/code-search.js';
import { fakeGitHub } from '../helpers/fakes.js';
import { SkilledError } from '../../src/errors.js';
import type { LocalItem, RepoMeta } from '../../src/types.js';

const BODY = [
  '---',
  'name: cso',
  '---',
  '',
  '# Chief Security Officer',
  '',
  'Treat every infrastructure change as a potential blast radius expansion and',
  'enumerate the identities that gain new privileges because of it.',
].join('\n');

const ITEM: LocalItem = {
  id: 'skills/cso',
  absPath: '/tmp/nowhere/skills/cso',
  kind: 'skill',
  files: ['SKILL.md'],
};

const AGENT: LocalItem = {
  id: 'agents/ponytail.md',
  absPath: '/tmp/nowhere/agents/ponytail.md',
  kind: 'agent',
  files: [''],
};

const ORIGIN: RepoMeta = { createdAt: '2026-02-11', stars: 340, pushedAt: '2026-08-09' };

const METAS: Record<string, RepoMeta> = {
  'origin/repo': ORIGIN,
  'copier/repo': { createdAt: '2026-07-30', stars: 1200, pushedAt: '2026-08-20' },
  'sameweek/repo': { createdAt: '2026-02-14', stars: 5, pushedAt: '2026-03-01' },
};

function metaFor(repo: string): RepoMeta {
  return METAS[repo] ?? ORIGIN;
}

describe('detectCodeSearch', () => {
  it('queries the exact n-gram restricted to markdown', async () => {
    const github = fakeGitHub({
      searchCode: async () => [{ repo: 'origin/repo', path: 'skills/cso/SKILL.md' }],
      getRepoMeta: async (repo) => metaFor(repo),
    });

    await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github);

    expect(github.calls[0]).toBe(
      'searchCode:"Treat every infrastructure change as a potential blast radius expansion and" path:*.md',
    );
  });

  it('scores a single hit at 0.9 and strips the filename from the subpath', async () => {
    const github = fakeGitHub({
      searchCode: async () => [{ repo: 'origin/repo', path: 'skills/cso/SKILL.md' }],
      getRepoMeta: async (repo) => metaFor(repo),
    });

    const [candidate, ...rest] = await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github);

    expect(rest).toEqual([]);
    expect(candidate?.method).toBe('code-search');
    expect(candidate?.confidence).toBe(0.9);
    expect(candidate?.source).toEqual({
      type: 'github',
      repo: 'origin/repo',
      ref: 'main',
      subpath: 'skills/cso',
    });
    expect(candidate?.repoMeta).toEqual(ORIGIN);
    expect(candidate?.evidence).toContain('origin/repo/skills/cso/SKILL.md');
    expect(candidate?.evidence).toContain('created 2026-02-11');
    expect(candidate?.evidence).toContain('340 stars');
    expect(candidate?.evidence).toContain('last push 2026-08-09');
  });

  it('prefers the oldest repo over the most popular one and surfaces both', async () => {
    const github = fakeGitHub({
      searchCode: async () => [
        { repo: 'copier/repo', path: 'skills/cso/SKILL.md' },
        { repo: 'origin/repo', path: 'skills/security/cso/SKILL.md' },
      ],
      getRepoMeta: async (repo) => metaFor(repo),
    });

    const candidates = await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github);

    expect(candidates.map((c) => c.source.repo)).toEqual(['origin/repo', 'copier/repo']);
    expect(candidates[0]?.confidence).toBe(0.85);
    expect(candidates[1]?.confidence).toBe(0.5);
    expect(candidates[0]?.source.subpath).toBe('skills/security/cso');
  });

  it('drops the leader to 0.7 when the ages are too close to call', async () => {
    const github = fakeGitHub({
      searchCode: async () => [
        { repo: 'origin/repo', path: 'skills/cso/SKILL.md' },
        { repo: 'sameweek/repo', path: 'skills/cso/SKILL.md' },
      ],
      getRepoMeta: async (repo) => metaFor(repo),
    });

    const candidates = await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github);

    expect(candidates.map((c) => c.source.repo)).toEqual(['origin/repo', 'sameweek/repo']);
    expect(candidates[0]?.confidence).toBe(0.7);
  });

  it('keeps the full file path as the subpath for an agent', async () => {
    const github = fakeGitHub({
      searchCode: async () => [{ repo: 'origin/repo', path: 'agents/ponytail.md' }],
      getRepoMeta: async (repo) => metaFor(repo),
    });

    const [candidate] = await detectCodeSearch(AGENT, new Map([['', BODY]]), github);

    expect(candidate?.source.subpath).toBe('agents/ponytail.md');
  });

  it('caps how many repos it looks up', async () => {
    const hits = ['a/1', 'b/2', 'c/3', 'd/4', 'e/5', 'f/6'].map((repo) => ({
      repo,
      path: 'skills/cso/SKILL.md',
    }));
    const github = fakeGitHub({
      searchCode: async () => hits,
      getRepoMeta: async () => ORIGIN,
    });

    const candidates = await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github, {
      maxRepos: 2,
    });

    expect(candidates).toHaveLength(2);
    expect(github.calls.filter((call) => call.startsWith('getRepoMeta'))).toHaveLength(2);
  });

  it('skips a repo whose metadata is gone', async () => {
    const github = fakeGitHub({
      searchCode: async () => [
        { repo: 'gone/repo', path: 'skills/cso/SKILL.md' },
        { repo: 'origin/repo', path: 'skills/cso/SKILL.md' },
      ],
      getRepoMeta: async (repo) => {
        if (repo === 'gone/repo') {
          throw new SkilledError({
            code: 'UPSTREAM_GONE',
            problem: 'Can\'t reach github.com/gone/repo (404)',
            cause: 'The repo no longer exists or went private.',
            fixes: ['skilled remove cso'],
            exitCode: 3,
          });
        }
        return metaFor(repo);
      },
    });

    const candidates = await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github);

    expect(candidates.map((c) => c.source.repo)).toEqual(['origin/repo']);
  });

  it('propagates NO_AUTH so the cascade can stop all network work', async () => {
    const github = fakeGitHub();
    await expect(detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github)).rejects.toMatchObject({
      code: 'NO_AUTH',
    });
  });

  it('never searches when no n-gram can be extracted', async () => {
    const github = fakeGitHub({ searchCode: async () => [] });
    const boilerplate = '---\nname: qa-only\n---\n\n# QA\n\nRun the tests.\n';

    expect(await detectCodeSearch(ITEM, new Map([['SKILL.md', boilerplate]]), github)).toEqual([]);
    expect(github.calls).toEqual([]);
  });

  it('returns nothing when the search has no hits', async () => {
    const github = fakeGitHub({ searchCode: async () => [] });
    expect(await detectCodeSearch(ITEM, new Map([['SKILL.md', BODY]]), github)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/code-search.detect.test.ts`
Expected: FAIL with "detectCodeSearch is not a function".

- [ ] **Step 3: Write minimal implementation — append to `src/detect/code-search.ts`**

Add these imports to the top of the file, beside the existing ones:

```ts
import path from 'node:path';
import type { Candidate, LocalItem, RepoMeta } from '../types.js';
import { primaryFile } from './hash.js';
```

Then append:

```ts
const DEFAULT_MAX_REPOS = 5;
const CLEAR_ORIGIN_DAYS = 30;

export interface CodeSearchOptions {
  /** how many distinct repos to fetch metadata for */
  maxRepos?: number;
}

interface ScoredRepo {
  repo: string;
  hitPath: string;
  meta: RepoMeta;
}

function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function stripPrimaryTail(hitPath: string, primaryRelPath: string): string {
  if (primaryRelPath === '') return hitPath;
  if (hitPath === primaryRelPath) return '';
  if (hitPath.endsWith(`/${primaryRelPath}`)) return hitPath.slice(0, -(primaryRelPath.length + 1));
  const parent = path.posix.dirname(hitPath);
  return parent === '.' ? '' : parent;
}

function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Searches GitHub for a rare sentence from the file and scores the repos that
 * contain it. Prefers the oldest repo, because the origin predates its copies,
 * and returns every competing candidate rather than guessing between them.
 */
export async function detectCodeSearch(
  item: LocalItem,
  contents: Map<string, string>,
  github: GitHubClient,
  options: CodeSearchOptions = {},
): Promise<Candidate[]> {
  const primary = primaryFile(item.kind, contents);
  if (primary === null) return [];
  const ngram = extractNgram(primary.text);
  if (ngram === null) return [];

  const hits = await github.searchCode(`"${ngram}" path:*.md`);
  const firstPathByRepo = new Map<string, string>();
  for (const hit of hits) {
    if (!firstPathByRepo.has(hit.repo)) firstPathByRepo.set(hit.repo, hit.path);
  }

  const maxRepos = options.maxRepos ?? DEFAULT_MAX_REPOS;
  const scored: ScoredRepo[] = [];
  for (const [repo, hitPath] of [...firstPathByRepo.entries()].slice(0, maxRepos)) {
    try {
      scored.push({ repo, hitPath, meta: await github.getRepoMeta(repo) });
    } catch (error) {
      if (error instanceof SkilledError && error.code === 'UPSTREAM_GONE') continue;
      throw error;
    }
  }
  if (scored.length === 0) return [];

  scored.sort((a, b) => {
    if (a.meta.createdAt !== b.meta.createdAt) return a.meta.createdAt < b.meta.createdAt ? -1 : 1;
    if (a.meta.stars !== b.meta.stars) return b.meta.stars - a.meta.stars;
    return a.repo.localeCompare(b.repo);
  });

  const leader = scored[0];
  const runnerUp = scored[1];
  let leadConfidence = 0.7;
  if (runnerUp === undefined) leadConfidence = 0.9;
  else if (daysBetween(leader?.meta.createdAt ?? '', runnerUp.meta.createdAt) >= CLEAR_ORIGIN_DAYS) {
    leadConfidence = 0.85;
  }

  return scored.map((entry, index) => ({
    id: item.id,
    source: {
      type: 'github' as const,
      repo: entry.repo,
      ref: 'main',
      subpath: stripPrimaryTail(entry.hitPath, primary.relpath),
    },
    method: 'code-search' as const,
    confidence: index === 0 ? leadConfidence : 0.5,
    evidence:
      `matched "${excerpt(ngram, 48)}" in ${entry.repo}/${entry.hitPath} · ` +
      `created ${entry.meta.createdAt} · ${entry.meta.stars} stars · last push ${entry.meta.pushedAt}`,
    repoMeta: entry.meta,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/code-search.detect.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/code-search.ts tests/detect/code-search.detect.test.ts
git commit -m "feat(detect): search GitHub and score competing candidates by repo age"
```

---

### Task 9: Strategy 5 — cluster inference across siblings

**Files:**
- Create: `src/detect/cluster.ts`
- Test: `tests/detect/cluster.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `LocalItem` from `src/types.ts`; `primaryFile` from `src/detect/hash.ts`.
- Produces: `familyKeys(id: string): string[]`, `inferCluster(items: LocalItem[], known: Map<string, Candidate>, contentsById: Map<string, Map<string, string>>): Candidate[]`, `clusterAnchorId(candidate: Candidate): string | null`.

**This is load-bearing, not an optimization.** One confirmed hit in a directory family propagates to its siblings, which is what turns 51 files into roughly 8-12 network lookups and is the only reason the sub-2-minute target is reachable inside a 10-request-per-minute budget. If this is weak, the whole product target fails.

Rules, exactly:
1. Two family notions, both computed per id: a **prefix family** (`prefix:<dirname>:<first name segment>`, where the basename minus `.md` splits on `-`/`_` into 2+ segments and the first segment is 3+ characters — this is what unites the twelve `marketing-*` skills) and a **directory family** (`dir:<dirname>` when the dirname has 2+ path segments, for nested layouts). One id can belong to both.
2. A family propagates when it has 2+ members and at least one member already has a candidate. The anchor is the family's highest-confidence known candidate.
3. Each unknown member gets one candidate. Families are processed in sorted key order and an id is only ever assigned once, so the result is deterministic.
4. `subpath` is the anchor's subpath with the anchor's basename swapped for the sibling's basename — `plugins/p/skills/marketing-ads` becomes `plugins/p/skills/marketing-brand`, and `agents/foo-a.md` becomes `agents/foo-b.md`.
5. Confidence is `anchor.confidence × 0.8`, plus `0.05` when the anchor's and sibling's primary files **both** declare a frontmatter `version:` — the design calls `metadata.version` a cheap corroborating signal for exactly this family. Round to two decimals once, after the bonus, then cap at `0.8` (`0.85` with the bonus) and floor at `0.4`.
6. No network, no filesystem access beyond the content already in memory.
7. The evidence line names the anchor id in a fixed format, and `clusterAnchorId` parses it back out. `Candidate` has no anchor field and the contract fixes its shape, so the evidence string is the only carrier — which is why the formatter and the parser live in this one file, with a round-trip test. The auto-accept rule needs it: a `cluster` candidate inherits its anchor's confirmation status, so the scan has to know which id it came from.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/cluster.test.ts
import { describe, expect, it } from 'vitest';
import { clusterAnchorId, familyKeys, inferCluster } from '../../src/detect/cluster.js';
import type { Candidate, LocalItem } from '../../src/types.js';

function skill(id: string): LocalItem {
  return { id, absPath: `/tmp/nowhere/${id}`, kind: 'skill', files: ['SKILL.md'] };
}

function agent(id: string): LocalItem {
  return { id, absPath: `/tmp/nowhere/${id}`, kind: 'agent', files: [''] };
}

function anchorCandidate(id: string, subpath: string, confidence = 0.9): Candidate {
  return {
    id,
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath },
    method: 'code-search',
    confidence,
    evidence: 'matched a rare sentence',
  };
}

const VERSIONED = '---\nname: x\nmetadata:\n  version: 2.2.0\n---\n\nbody\n';
const PLAIN = '---\nname: x\n---\n\nbody\n';

describe('familyKeys', () => {
  it('derives a prefix family from a hyphenated basename', () => {
    expect(familyKeys('skills/marketing-ads')).toEqual(['prefix:skills:marketing']);
  });

  it('derives a prefix family from an agent filename', () => {
    expect(familyKeys('agents/review-fast.md')).toEqual(['prefix:agents:review']);
  });

  it('adds a directory family for nested layouts', () => {
    expect(familyKeys('skills/marketing/ads')).toEqual(['dir:skills/marketing']);
  });

  it('gives a single-word basename at the top level no family', () => {
    expect(familyKeys('skills/cso')).toEqual([]);
  });

  it('ignores a too-short first segment', () => {
    expect(familyKeys('skills/a-b')).toEqual([]);
  });
});

describe('inferCluster', () => {
  it('propagates one hit to its siblings and rewrites the subpath', () => {
    const items = [
      skill('skills/marketing-ads'),
      skill('skills/marketing-brand'),
      skill('skills/marketing-seo'),
    ];
    const known = new Map([
      ['skills/marketing-ads', anchorCandidate('skills/marketing-ads', 'skills/marketing-ads')],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-brand', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-seo', new Map([['SKILL.md', PLAIN]])],
    ]);

    const candidates = inferCluster(items, known, contents);

    expect(candidates.map((c) => c.id)).toEqual(['skills/marketing-brand', 'skills/marketing-seo']);
    expect(candidates[0]?.method).toBe('cluster');
    expect(candidates[0]?.confidence).toBe(0.72);
    expect(candidates[0]?.source).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: 'skills/marketing-brand',
    });
    expect(candidates[0]?.evidence).toBe(
      'sibling of skills/marketing-ads, which resolved to owner/repo (family "marketing", 3 members)',
    );
  });

  it('rewrites only the last segment of a deep subpath', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/marketing-seo')];
    const known = new Map([
      [
        'skills/marketing-ads',
        anchorCandidate('skills/marketing-ads', 'plugins/growth/skills/marketing-ads'),
      ],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-seo', new Map([['SKILL.md', PLAIN]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);
    expect(candidate?.source.subpath).toBe('plugins/growth/skills/marketing-seo');
  });

  it('adds the metadata.version corroboration bonus', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/marketing-seo')];
    const known = new Map([
      ['skills/marketing-ads', anchorCandidate('skills/marketing-ads', 'skills/marketing-ads')],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', VERSIONED]])],
      ['skills/marketing-seo', new Map([['SKILL.md', VERSIONED]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);
    expect(candidate?.confidence).toBe(0.77);
    expect(candidate?.evidence).toContain('both pin metadata.version');
  });

  it('caps confidence at 0.8 for a near-certain anchor', () => {
    const items = [skill('skills/figma-power'), skill('skills/figma-mcp')];
    const known = new Map([
      ['skills/figma-power', anchorCandidate('skills/figma-power', 'skills/figma-power', 0.99)],
    ]);
    const contents = new Map([
      ['skills/figma-power', new Map([['SKILL.md', PLAIN]])],
      ['skills/figma-mcp', new Map([['SKILL.md', PLAIN]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);
    expect(candidate?.confidence).toBe(0.79);
  });

  it('propagates between sibling agent files', () => {
    const items = [agent('agents/review-fast.md'), agent('agents/review-deep.md')];
    const known = new Map([
      ['agents/review-fast.md', anchorCandidate('agents/review-fast.md', 'agents/review-fast.md')],
    ]);
    const contents = new Map([
      ['agents/review-fast.md', new Map([['', PLAIN]])],
      ['agents/review-deep.md', new Map([['', PLAIN]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);
    expect(candidate?.id).toBe('agents/review-deep.md');
    expect(candidate?.source.subpath).toBe('agents/review-deep.md');
  });

  it('never overwrites an id that already has a candidate', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/marketing-seo')];
    const known = new Map([
      ['skills/marketing-ads', anchorCandidate('skills/marketing-ads', 'skills/marketing-ads')],
      ['skills/marketing-seo', anchorCandidate('skills/marketing-seo', 'skills/marketing-seo', 0.6)],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-seo', new Map([['SKILL.md', PLAIN]])],
    ]);

    expect(inferCluster(items, known, contents)).toEqual([]);
  });

  it('does nothing without an anchor', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/marketing-seo')];
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-seo', new Map([['SKILL.md', PLAIN]])],
    ]);

    expect(inferCluster(items, new Map(), contents)).toEqual([]);
  });

  it('round-trips the anchor id through the evidence line', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/marketing-seo')];
    const known = new Map([
      ['skills/marketing-ads', anchorCandidate('skills/marketing-ads', 'skills/marketing-ads')],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/marketing-seo', new Map([['SKILL.md', PLAIN]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);

    expect(candidate).toBeDefined();
    expect(clusterAnchorId(candidate as Candidate)).toBe('skills/marketing-ads');
  });

  it('recovers an anchor id containing a comma', () => {
    const items = [skill('skills/odd-name,thing'), skill('skills/odd-other')];
    const known = new Map([
      ['skills/odd-name,thing', anchorCandidate('skills/odd-name,thing', 'skills/odd-name,thing')],
    ]);
    const contents = new Map([
      ['skills/odd-name,thing', new Map([['SKILL.md', PLAIN]])],
      ['skills/odd-other', new Map([['SKILL.md', PLAIN]])],
    ]);

    const [candidate] = inferCluster(items, known, contents);
    expect(clusterAnchorId(candidate as Candidate)).toBe('skills/odd-name,thing');
  });

  it('returns null for a candidate that is not a cluster propagation', () => {
    expect(clusterAnchorId(anchorCandidate('skills/cso', 'skills/cso'))).toBeNull();
  });

  it('does not propagate to an unrelated family', () => {
    const items = [skill('skills/marketing-ads'), skill('skills/cso'), skill('skills/qa-only')];
    const known = new Map([
      ['skills/marketing-ads', anchorCandidate('skills/marketing-ads', 'skills/marketing-ads')],
    ]);
    const contents = new Map([
      ['skills/marketing-ads', new Map([['SKILL.md', PLAIN]])],
      ['skills/cso', new Map([['SKILL.md', PLAIN]])],
      ['skills/qa-only', new Map([['SKILL.md', PLAIN]])],
    ]);

    expect(inferCluster(items, known, contents)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/cluster.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/cluster.js" (`familyKeys` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/cluster.ts
import path from 'node:path';
import type { Candidate, LocalItem } from '../types.js';
import { primaryFile } from './hash.js';

const MIN_SEGMENT_LENGTH = 3;
const DECAY = 0.8;
const MAX_CONFIDENCE = 0.8;
const MAX_CONFIDENCE_WITH_BONUS = 0.85;
const MIN_CONFIDENCE = 0.4;
const VERSION_BONUS = 0.05;
const VERSION_RE = /^[ \t]{0,6}version:/m;
const ANCHOR_RE = /^sibling of (.+?), which resolved to /;

/**
 * The id a cluster candidate was propagated from. Candidate has no anchor field
 * and the contract fixes its shape, so the evidence line is the only carrier —
 * formatter and parser therefore live in this one file. The lazy group handles an
 * id that itself contains a comma.
 */
export function clusterAnchorId(candidate: Candidate): string | null {
  if (candidate.method !== 'cluster') return null;
  return ANCHOR_RE.exec(candidate.evidence)?.[1] ?? null;
}

/**
 * The families an id belongs to. A prefix family unites skills/marketing-ads
 * with skills/marketing-seo; a directory family unites items nested under the
 * same subdirectory.
 */
export function familyKeys(id: string): string[] {
  const keys: string[] = [];
  const dir = path.posix.dirname(id);
  const base = path.posix.basename(id).replace(/\.md$/i, '');
  const segments = base.split(/[-_]/).filter((segment) => segment.length > 0);
  const first = segments[0] ?? '';
  if (segments.length >= 2 && first.length >= MIN_SEGMENT_LENGTH) {
    keys.push(`prefix:${dir}:${first.toLowerCase()}`);
  }
  if (dir !== '.' && dir.split('/').length >= 2) keys.push(`dir:${dir}`);
  return keys;
}

function familyLabel(key: string): string {
  const parts = key.split(':');
  return parts[parts.length - 1] ?? key;
}

/** Swaps the anchor's basename for the sibling's in the anchor's subpath. */
function siblingSubpath(anchorSubpath: string, anchorId: string, siblingId: string): string {
  const anchorBase = path.posix.basename(anchorId);
  const siblingBase = path.posix.basename(siblingId);
  if (anchorSubpath === '') return siblingBase;
  if (anchorSubpath === anchorBase) return siblingBase;
  if (anchorSubpath.endsWith(`/${anchorBase}`)) {
    return anchorSubpath.slice(0, -anchorBase.length) + siblingBase;
  }
  return path.posix.join(anchorSubpath, siblingBase);
}

function declaresVersion(contents: Map<string, string> | undefined, kind: LocalItem['kind']): boolean {
  if (contents === undefined) return false;
  const primary = primaryFile(kind, contents);
  return primary !== null && VERSION_RE.test(primary.text);
}

export function inferCluster(
  items: LocalItem[],
  known: Map<string, Candidate>,
  contentsById: Map<string, Map<string, string>>,
): Candidate[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const families = new Map<string, string[]>();
  for (const item of items) {
    for (const key of familyKeys(item.id)) {
      const members = families.get(key) ?? [];
      members.push(item.id);
      families.set(key, members);
    }
  }

  const produced = new Map<string, Candidate>();
  for (const key of [...families.keys()].sort()) {
    const members = families.get(key) ?? [];
    if (members.length < 2) continue;

    let anchor: Candidate | undefined;
    for (const id of members) {
      const candidate = known.get(id);
      if (candidate === undefined) continue;
      if (anchor === undefined || candidate.confidence > anchor.confidence) anchor = candidate;
    }
    if (anchor === undefined) continue;

    const anchorItem = itemsById.get(anchor.id);
    const anchorVersioned =
      anchorItem !== undefined && declaresVersion(contentsById.get(anchor.id), anchorItem.kind);

    for (const id of members) {
      if (known.has(id) || produced.has(id)) continue;
      const item = itemsById.get(id);
      if (item === undefined) continue;

      const bonus = anchorVersioned && declaresVersion(contentsById.get(id), item.kind);
      // Round once, after the bonus, so the value is exact rather than 0.7600000000000001.
      const raw = anchor.confidence * DECAY + (bonus ? VERSION_BONUS : 0);
      let confidence = Math.round(raw * 100) / 100;
      confidence = Math.min(bonus ? MAX_CONFIDENCE_WITH_BONUS : MAX_CONFIDENCE, confidence);
      confidence = Math.max(MIN_CONFIDENCE, confidence);

      produced.set(id, {
        id,
        source: {
          type: 'github',
          repo: anchor.source.repo,
          ref: anchor.source.ref,
          subpath: siblingSubpath(anchor.source.subpath, anchor.id, id),
        },
        method: 'cluster',
        confidence,
        evidence:
          `sibling of ${anchor.id}, which resolved to ${anchor.source.repo} ` +
          `(family "${familyLabel(key)}", ${members.length} members)` +
          (bonus ? ' · both pin metadata.version' : ''),
      });
    }
  }

  return [...produced.values()].sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/cluster.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/cluster.ts tests/detect/cluster.test.ts
git commit -m "feat(detect): infer sibling provenance from one confirmed hit"
```

---

### Task 10: Strategy 6 — ask Claude

**Files:**
- Create: `src/detect/ask-claude.ts`
- Test: `tests/detect/ask-claude.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `ItemKind`, `LocalItem` from `src/types.ts`; `ClaudeClient` from `src/clients.ts`; `SkilledError` from `src/errors.ts`; `primaryFile` from `src/detect/hash.ts`.
- Produces: `type ClaudeEvent = { kind: 'no-auth'; message: string } | { kind: 'error'; message: string }`, `instrumentedClaudeClient(inner: ClaudeClient, onEvent: (event: ClaudeEvent) => void): ClaudeClient`, `buildExcerpt(kind: ItemKind, contents: Map<string, string>): string | null`, `detectAskClaude(item: LocalItem, contents: Map<string, string>, claude: ClaudeClient): Promise<Candidate[]>`.

Last resort, so it is deliberately modest: confidence `0.45`, and the evidence says out loud that the subpath is a guess. `identify` returns `"owner/name"` and nothing more, so the subpath is assumed to mirror the local id — which is right often enough to be worth offering and wrong often enough to admit. Anything that is not a plausible `owner/name` is discarded rather than trusted. `SkilledError`s propagate so the orchestrator stops asking after the first failure; the instrumented client is the symmetric counterpart of `throttledGitHubClient` and reports why.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/ask-claude.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildExcerpt,
  detectAskClaude,
  instrumentedClaudeClient,
  type ClaudeEvent,
} from '../../src/detect/ask-claude.js';
import { fakeClaude } from '../helpers/fakes.js';
import type { LocalItem } from '../../src/types.js';

const ITEM: LocalItem = {
  id: 'skills/cso',
  absPath: '/tmp/nowhere/skills/cso',
  kind: 'skill',
  files: ['SKILL.md'],
};

const BODY = '---\nname: cso\n---\n\n# Chief Security Officer\n\nEnumerate the identities.\n';

describe('buildExcerpt', () => {
  it('keeps the frontmatter, which is the most identifying part', () => {
    const excerpt = buildExcerpt('skill', new Map([['SKILL.md', BODY]]));
    expect(excerpt?.startsWith('---\nname: cso')).toBe(true);
  });

  it('caps the excerpt at a line boundary', () => {
    const long = `${'a repeated line of prose\n'.repeat(500)}`;
    const excerpt = buildExcerpt('skill', new Map([['SKILL.md', long]]));
    expect((excerpt ?? '').length).toBeLessThanOrEqual(4000);
    expect(excerpt?.endsWith('a repeated line of prose')).toBe(true);
  });

  it('returns null when there is no content', () => {
    expect(buildExcerpt('skill', new Map())).toBeNull();
  });
});

describe('detectAskClaude', () => {
  it('turns an identification into a low-confidence candidate', async () => {
    const claude = fakeClaude({ identify: async () => 'owner/repo' });

    const [candidate, ...rest] = await detectAskClaude(ITEM, new Map([['SKILL.md', BODY]]), claude);

    expect(rest).toEqual([]);
    expect(candidate?.method).toBe('claude');
    expect(candidate?.confidence).toBe(0.45);
    expect(candidate?.source).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: 'skills/cso',
    });
    expect(candidate?.evidence).toBe(
      'Claude identified this content as owner/repo; the subpath skills/cso is a guess — correct it with `skilled add`',
    );
  });

  it('returns nothing when Claude cannot identify the content', async () => {
    const claude = fakeClaude({ identify: async () => null });
    expect(await detectAskClaude(ITEM, new Map([['SKILL.md', BODY]]), claude)).toEqual([]);
  });

  it('discards an answer that is not a plausible owner/name', async () => {
    const claude = fakeClaude({ identify: async () => 'I think it might be from GitHub somewhere' });
    expect(await detectAskClaude(ITEM, new Map([['SKILL.md', BODY]]), claude)).toEqual([]);
  });

  it('never calls Claude for an item with no content', async () => {
    const claude = fakeClaude({ identify: async () => 'owner/repo' });
    expect(await detectAskClaude(ITEM, new Map(), claude)).toEqual([]);
    expect(claude.calls).toEqual([]);
  });

  it('propagates NO_AUTH so the cascade stops asking', async () => {
    const claude = fakeClaude();
    await expect(detectAskClaude(ITEM, new Map([['SKILL.md', BODY]]), claude)).rejects.toMatchObject({
      code: 'NO_AUTH',
    });
  });
});

describe('instrumentedClaudeClient', () => {
  it('reports NO_AUTH and rethrows', async () => {
    const events: ClaudeEvent[] = [];
    const client = instrumentedClaudeClient(fakeClaude(), (event) => events.push(event));

    await expect(client.identify('anything')).rejects.toMatchObject({ code: 'NO_AUTH' });
    expect(events).toEqual([{ kind: 'no-auth', message: 'GitHub is not authenticated.' }]);
  });

  it('passes a successful answer through untouched', async () => {
    const events: ClaudeEvent[] = [];
    const client = instrumentedClaudeClient(
      fakeClaude({ identify: async () => 'owner/repo' }),
      (event) => events.push(event),
    );

    expect(await client.identify('x')).toBe('owner/repo');
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/ask-claude.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/ask-claude.js" (`buildExcerpt` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/ask-claude.ts
import type { ClaudeClient } from '../clients.js';
import { SkilledError } from '../errors.js';
import type { Candidate, ItemKind, LocalItem } from '../types.js';
import { primaryFile } from './hash.js';

const MAX_EXCERPT = 4000;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

export type ClaudeEvent =
  | { kind: 'no-auth'; message: string }
  | { kind: 'error'; message: string };

/** Symmetric counterpart of throttledGitHubClient: reports why Claude declined. */
export function instrumentedClaudeClient(
  inner: ClaudeClient,
  onEvent: (event: ClaudeEvent) => void,
): ClaudeClient {
  async function watched<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SkilledError && error.code === 'NO_AUTH') {
        onEvent({ kind: 'no-auth', message: error.problem });
      } else if (error instanceof SkilledError) {
        onEvent({ kind: 'error', message: error.problem });
      } else {
        onEvent({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  return {
    identify(excerpt) {
      return watched(() => inner.identify(excerpt));
    },
    resolveConflict(args) {
      return watched(() => inner.resolveConflict(args));
    },
  };
}

/** The primary file, truncated at a line boundary. Frontmatter is kept on purpose. */
export function buildExcerpt(kind: ItemKind, contents: Map<string, string>): string | null {
  const primary = primaryFile(kind, contents);
  if (primary === null) return null;
  const text = primary.text.replace(/\r\n/g, '\n');
  if (text.length <= MAX_EXCERPT) return text.replace(/\n+$/, '');
  const cut = text.slice(0, MAX_EXCERPT);
  const lastNewline = cut.lastIndexOf('\n');
  return (lastNewline > 0 ? cut.slice(0, lastNewline) : cut).replace(/\n+$/, '');
}

export async function detectAskClaude(
  item: LocalItem,
  contents: Map<string, string>,
  claude: ClaudeClient,
): Promise<Candidate[]> {
  const excerpt = buildExcerpt(item.kind, contents);
  if (excerpt === null) return [];

  const answer = await claude.identify(excerpt);
  if (answer === null) return [];
  const repo = answer.trim();
  if (!REPO_RE.test(repo)) return [];

  return [
    {
      id: item.id,
      source: { type: 'github', repo, ref: 'main', subpath: item.id },
      method: 'claude',
      confidence: 0.45,
      evidence:
        `Claude identified this content as ${repo}; the subpath ${item.id} is a guess — ` +
        'correct it with `skilled add`',
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/ask-claude.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/ask-claude.ts tests/detect/ask-claude.test.ts
git commit -m "feat(detect): ask Claude to identify the stragglers"
```

---

### Task 11: The cascade orchestrator

**Files:**
- Create: `src/detect/index.ts`
- Test: `tests/detect/index.test.ts`

**Interfaces:**
- Consumes: every strategy from Tasks 3-10; `readItemContent` from `src/discover.ts`; `GitHubClient`, `ClaudeClient` from `src/clients.ts`; `SkilledError` from `src/errors.ts`.
- Produces (signature copied verbatim from the contract):

```ts
export interface DetectDeps {
  github: GitHubClient;
  claude: ClaudeClient;
  knownIndex: KnownIndex;
  pluginCacheDir: string;
}
/** Streams candidates as they are found. Never writes to disk. */
export function detectAll(items: LocalItem[], deps: DetectDeps): AsyncGenerator<Candidate>;
```

Also re-exports `KnownIndex` and `KnownIndexEntry`, so consumers get `DetectDeps` and its field type from one module.

**Streaming is a product requirement.** The generator must yield every free candidate before it opens a socket. Order:

1. `inline-url` (free)
2. `plugin-cache` (free)
3. `known-index` (free)
4. **cluster, free pass** — everything above this line is yielded before the first network call.
5. `code-search` (network, one item at a time, yielding as each resolves)
6. **cluster, immediately after every code-search hit** — not after the loop. This is the detail that makes the target reachable: if propagation waited until the loop ended, `marketing-brand` and `marketing-seo` would each burn their own lookup before `marketing-ads`'s hit ever reached them. Propagating inside the loop means the eleven siblings cost zero requests. A final sweep after the loop catches families seeded by the last item.
7. `claude` (network)

Items are walked in sorted id order in every phase, so a run is reproducible and does not depend on `discover()`'s ordering.

An item that already has any candidate is skipped by later strategies — a second opinion is not worth a request against a 10-per-minute budget, and the user can always correct a wrong guess with `skilled add`. The first `NO_AUTH`, `RATE_LIMIT`, or `NETWORK` from a network strategy switches that strategy off for the rest of the run instead of failing the scan; any other error propagates. `detectAll` never writes to disk.

- [ ] **Step 1: Write the failing test**

```ts
// tests/detect/index.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectAll } from '../../src/detect/index.js';
import { emptyKnownIndex } from '../../src/detect/known-index.js';
import { discover } from '../../src/discover.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { fakeClaude, fakeGitHub } from '../helpers/fakes.js';
import type { Candidate, LocalItem, RepoMeta } from '../../src/types.js';

const META: RepoMeta = { createdAt: '2026-01-05', stars: 42, pushedAt: '2026-08-01' };

describe('detectAll', () => {
  let dir: string;
  let items: LocalItem[];

  beforeEach(async () => {
    dir = await makeTempManagedDir();
    items = await discover(dir);
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('yields the free inline-url hit before touching the network', async () => {
    const github = fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META });
    const claude = fakeClaude({ identify: async () => null });
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    const seen: Candidate[] = [];
    for await (const candidate of detectAll(items, deps)) {
      seen.push(candidate);
      if (candidate.id === 'agents/ponytail.md') break;
    }

    expect(seen.at(-1)?.method).toBe('inline-url');
    expect(seen.at(-1)?.source.repo).toBe('DietrichGebert/ponytail');
    expect(github.calls).toEqual([]);
    expect(claude.calls).toEqual([]);
  });

  it('finds both attributed files with zero network calls', async () => {
    const github = fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META });
    const claude = fakeClaude({ identify: async () => null });
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    const free: Candidate[] = [];
    for await (const candidate of detectAll(items, deps)) {
      if (github.calls.length > 0) break;
      free.push(candidate);
    }

    const byId = new Map(free.map((candidate) => [candidate.id, candidate]));
    expect(byId.get('agents/ponytail.md')?.source.repo).toBe('DietrichGebert/ponytail');
    expect(byId.get('skills/explain-code')?.source.repo).toBe('anthropics/claude-plugins-official');
    expect(byId.get('skills/explain-code')?.source.subpath).toBe(
      'plugins/code-review/skills/explain-code',
    );
  });

  it('resolves the whole marketing family from a single search', async () => {
    const queries: string[] = [];
    const github = fakeGitHub({
      searchCode: async (query) => {
        queries.push(query);
        return query.includes('headline variants')
          ? [{ repo: 'growth/skills', path: 'skills/marketing-ads/SKILL.md' }]
          : [];
      },
      getRepoMeta: async () => META,
    });
    const claude = fakeClaude({ identify: async () => null });
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    const byId = new Map<string, Candidate>();
    for await (const candidate of detectAll(items, deps)) {
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }

    expect(queries.filter((query) => query.includes('headline variants'))).toHaveLength(1);
    expect(byId.get('skills/marketing-ads')?.method).toBe('code-search');
    expect(byId.get('skills/marketing-brand')?.method).toBe('cluster');
    expect(byId.get('skills/marketing-seo')?.method).toBe('cluster');
    expect(byId.get('skills/marketing-seo')?.source).toEqual({
      type: 'github',
      repo: 'growth/skills',
      ref: 'main',
      subpath: 'skills/marketing-seo',
    });
    // brand and seo cost no lookups of their own
    expect(queries.some((query) => query.includes('brand as a person'))).toBe(false);
    expect(queries.some((query) => query.includes('intent behind them'))).toBe(false);
  });

  it('stops searching after the first NO_AUTH and still completes', async () => {
    const github = fakeGitHub();
    const claude = fakeClaude();
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    const seen: Candidate[] = [];
    for await (const candidate of detectAll(items, deps)) seen.push(candidate);

    expect(github.calls.filter((call) => call.startsWith('searchCode'))).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);
    expect(seen.map((candidate) => candidate.id)).toContain('agents/ponytail.md');
  });

  it('leaves genuinely unidentifiable items unresolved', async () => {
    const github = fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META });
    const claude = fakeClaude({ identify: async () => null });
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    const ids = new Set<string>();
    for await (const candidate of detectAll(items, deps)) ids.add(candidate.id);

    expect(ids.has('skills/qa-only')).toBe(false);
    expect(ids.has('agents/thomas.md')).toBe(false);
  });

  it('writes nothing to the managed directory', async () => {
    const github = fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META });
    const claude = fakeClaude({ identify: async () => null });
    const deps = { github, claude, knownIndex: emptyKnownIndex(), pluginCacheDir: `${dir}/plugins` };

    for await (const candidate of detectAll(items, deps)) void candidate;

    const fs = await import('node:fs/promises');
    await expect(fs.stat(`${dir}/.skilled`)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/detect/index.test.ts`
Expected: FAIL with "Failed to load url ../../src/detect/index.js" (`detectAll` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/detect/index.ts
import type { ClaudeClient, GitHubClient } from '../clients.js';
import { readItemContent } from '../discover.js';
import { SkilledError } from '../errors.js';
import type { Candidate, LocalItem } from '../types.js';
import { detectAskClaude } from './ask-claude.js';
import { inferCluster } from './cluster.js';
import { detectCodeSearch } from './code-search.js';
import { detectInlineUrl } from './inline-url.js';
import { detectKnownIndex, type KnownIndex } from './known-index.js';
import { detectPluginCache } from './plugin-cache.js';

export type { KnownIndex, KnownIndexEntry } from './known-index.js';

export interface DetectDeps {
  github: GitHubClient;
  claude: ClaudeClient;
  knownIndex: KnownIndex;
  pluginCacheDir: string;
}

/** Codes that mean "this collaborator is unavailable", not "the scan failed". */
function isDegradation(error: unknown): boolean {
  return (
    error instanceof SkilledError &&
    (error.code === 'NO_AUTH' || error.code === 'RATE_LIMIT' || error.code === 'NETWORK')
  );
}

/** Streams candidates as they are found. Never writes to disk. */
export async function* detectAll(
  items: LocalItem[],
  deps: DetectDeps,
): AsyncGenerator<Candidate> {
  // Sorted once, so a run is reproducible whatever order discover() returned.
  const worklist = [...items].sort((a, b) => a.id.localeCompare(b.id));

  const contentsById = new Map<string, Map<string, string>>();
  for (const item of worklist) contentsById.set(item.id, await readItemContent(item));

  const best = new Map<string, Candidate>();
  function remember(candidate: Candidate): void {
    const previous = best.get(candidate.id);
    if (previous === undefined || candidate.confidence > previous.confidence) {
      best.set(candidate.id, candidate);
    }
  }

  // 1 — inline URLs. Free, and the only strategy that works on a file nobody else has.
  for (const item of worklist) {
    const contents = contentsById.get(item.id) ?? new Map<string, string>();
    for (const candidate of detectInlineUrl(item.id, item.kind, contents)) {
      remember(candidate);
      yield candidate;
    }
  }

  // 2 — the local plugin cache, which already pins a commit per plugin. Free.
  const unresolvedForCache = worklist.filter((item) => !best.has(item.id));
  for (const candidate of await detectPluginCache(
    unresolvedForCache,
    contentsById,
    deps.pluginCacheDir,
  )) {
    remember(candidate);
    yield candidate;
  }

  // 3 — the bundled known-sources index. Free.
  for (const item of worklist) {
    if (best.has(item.id)) continue;
    const contents = contentsById.get(item.id) ?? new Map<string, string>();
    for (const candidate of detectKnownIndex(item.id, item.kind, contents, deps.knownIndex)) {
      remember(candidate);
      yield candidate;
    }
  }

  // 4 — cluster, free pass. Shrinks the network worklist before any request is made.
  for (const candidate of inferCluster(worklist, best, contentsById)) {
    remember(candidate);
    yield candidate;
  }

  // 5 — GitHub code search. First network work in the whole cascade.
  let searchAvailable = true;
  for (const item of worklist) {
    if (!searchAvailable || best.has(item.id)) continue;
    const contents = contentsById.get(item.id) ?? new Map<string, string>();
    try {
      const found = await detectCodeSearch(item, contents, deps.github);
      for (const candidate of found) {
        remember(candidate);
        yield candidate;
      }
      // 6 — propagate this hit to its siblings NOW, so the rest of the family
      // is already resolved when the loop reaches it and costs no requests.
      if (found.length > 0) {
        for (const candidate of inferCluster(worklist, best, contentsById)) {
          remember(candidate);
          yield candidate;
        }
      }
    } catch (error) {
      if (!isDegradation(error)) throw error;
      searchAvailable = false;
    }
  }

  // Final cluster sweep, for a family seeded by the very last item.
  for (const candidate of inferCluster(worklist, best, contentsById)) {
    remember(candidate);
    yield candidate;
  }

  // 7 — Claude, for whatever is left.
  let claudeAvailable = true;
  for (const item of worklist) {
    if (!claudeAvailable || best.has(item.id)) continue;
    const contents = contentsById.get(item.id) ?? new Map<string, string>();
    try {
      for (const candidate of await detectAskClaude(item, contents, deps.claude)) {
        remember(candidate);
        yield candidate;
      }
    } catch (error) {
      if (!isDegradation(error)) throw error;
      claudeAvailable = false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/detect/index.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/detect/index.ts tests/detect/index.test.ts
git commit -m "feat(detect): stream the six-strategy cascade cheapest-first"
```

---

### Task 12: Status cache read and write

**Files:**
- Create: `src/status.ts`
- Test: `tests/status.cache.test.ts`

**Interfaces:**
- Consumes: `cachePath` from `src/config.ts`; `StatusReport`, `StatusRow`, `EntryStatus` from `src/types.ts`.
- Produces: `readCachedStatus(managedDir: string): Promise<StatusReport | null>`, `writeCachedStatus(managedDir: string, report: StatusReport): Promise<void>`.

The cache is disposable. A missing, truncated, or hand-mangled `cache/status.json` returns `null` rather than throwing — a broken cache must never break a scan, because the whole point of the cache is to make checking cheap.

- [ ] **Step 1: Write the failing test**

```ts
// tests/status.cache.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cachePath } from '../src/config.js';
import { readCachedStatus, writeCachedStatus } from '../src/status.js';
import { cleanupTempDir, makeEmptyTempDir } from './helpers/managed-dir.js';
import type { StatusReport } from '../src/types.js';

function report(dir: string): StatusReport {
  return {
    dir,
    rows: [
      {
        id: 'skills/cso',
        status: 'behind',
        source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
        behindBy: 6,
        localEdits: false,
      },
      { id: 'skills/qa-only', status: 'unknown', localEdits: false },
    ],
    identified: 1,
    total: 2,
    behind: 1,
    unknown: 1,
    fetchedAt: '2026-08-27T10:00:00.000Z',
  };
}

describe('status cache', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) await cleanupTempDir(dir);
  });

  it('round-trips a report and creates the cache directory', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);

    await writeCachedStatus(dir, report(dir));

    expect(await readCachedStatus(dir)).toEqual(report(dir));
    const raw = await fs.readFile(cachePath(dir), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('returns null when no cache exists', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    expect(await readCachedStatus(dir)).toBeNull();
  });

  it('returns null for a corrupt cache instead of throwing', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    await fs.mkdir(path.dirname(cachePath(dir)), { recursive: true });
    await fs.writeFile(cachePath(dir), '{ truncated', 'utf8');

    expect(await readCachedStatus(dir)).toBeNull();
  });

  it('returns null when the cache has the wrong shape', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    await fs.mkdir(path.dirname(cachePath(dir)), { recursive: true });
    await fs.writeFile(cachePath(dir), JSON.stringify({ dir, rows: 'nope' }), 'utf8');

    expect(await readCachedStatus(dir)).toBeNull();
  });

  it('drops rows that are not usable but keeps the rest', async () => {
    const dir = await makeEmptyTempDir();
    dirs.push(dir);
    await fs.mkdir(path.dirname(cachePath(dir)), { recursive: true });
    await fs.writeFile(
      cachePath(dir),
      JSON.stringify({
        dir,
        rows: [{ id: 'skills/cso', status: 'current', localEdits: false }, { status: 'current' }],
        identified: 1,
        total: 2,
        behind: 0,
        unknown: 1,
        fetchedAt: null,
      }),
      'utf8',
    );

    const cached = await readCachedStatus(dir);
    expect(cached?.rows.map((row) => row.id)).toEqual(['skills/cso']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/status.cache.test.ts`
Expected: FAIL with "Failed to load url ../src/status.js" (`writeCachedStatus` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/status.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { cachePath } from './config.js';
import type { EntryStatus, Source, StatusReport, StatusRow } from './types.js';

const STATUSES: EntryStatus[] = ['current', 'behind', 'unknown', 'unreachable'];

function parseSource(value: unknown): Source | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'github' ||
    typeof record.repo !== 'string' ||
    typeof record.ref !== 'string' ||
    typeof record.subpath !== 'string'
  ) {
    return undefined;
  }
  return { type: 'github', repo: record.repo, ref: record.ref, subpath: record.subpath };
}

function parseRow(value: unknown): StatusRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof record.id !== 'string' || typeof status !== 'string') return null;
  if (!STATUSES.includes(status as EntryStatus)) return null;

  const row: StatusRow = {
    id: record.id,
    status: status as EntryStatus,
    localEdits: record.localEdits === true,
  };
  const source = parseSource(record.source);
  if (source !== undefined) row.source = source;
  if (typeof record.behindBy === 'number') row.behindBy = record.behindBy;
  return row;
}

/** Reads the cached report. A missing or unusable cache is null, never an error. */
export async function readCachedStatus(managedDir: string): Promise<StatusReport | null> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath(managedDir), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.dir !== 'string' || !Array.isArray(record.rows)) return null;

  const rows: StatusRow[] = [];
  for (const rawRow of record.rows) {
    const row = parseRow(rawRow);
    if (row !== null) rows.push(row);
  }

  return {
    dir: record.dir,
    rows,
    identified: typeof record.identified === 'number' ? record.identified : 0,
    total: typeof record.total === 'number' ? record.total : rows.length,
    behind: typeof record.behind === 'number' ? record.behind : 0,
    unknown: typeof record.unknown === 'number' ? record.unknown : 0,
    fetchedAt: typeof record.fetchedAt === 'string' ? record.fetchedAt : null,
  };
}

export async function writeCachedStatus(managedDir: string, report: StatusReport): Promise<void> {
  const file = cachePath(managedDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/status.cache.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts tests/status.cache.test.ts
git commit -m "feat(status): read and write the disposable status cache"
```

---

### Task 13: buildStatus

**Files:**
- Extend: `src/status.ts`
- Test: `tests/status.build.test.ts`

**Interfaces:**
- Consumes: `discover` from `src/discover.ts`; `readManifest`, `writeManifest`, `findEntry` from `src/manifest.ts`; `basePath` from `src/config.ts`; `GitHubClient` from `src/clients.ts`; `SkilledError` from `src/errors.ts`; `normalizeContent` from `src/detect/hash.ts`; `readCachedStatus` from Task 12.
- Produces (signature copied verbatim from the contract): `buildStatus(managedDir: string, deps: { github: GitHubClient }, opts: { refresh: boolean }): Promise<StatusReport>`.

Rules, exactly:
1. Rows cover every item on disk, sorted by id. An item with no manifest entry gets `status: 'unknown'` and no `source`.
2. `opts.refresh === false` reuses the cached status per id and never touches the network. No cached row → `'unknown'`.
3. `opts.refresh === true` calls `listCommits(entry.source, entry.base.commit)`. `behindBy` is the number of commits returned; `> 0` is `'behind'`, `0` is `'current'`, and `behindBy` is only set on a `'behind'` row.
4. An entry whose `base.commit` is not a 40-hex sha cannot be compared, so it is `'unknown'` — spec 02 confirms sources but cannot capture BASE without a network fetch, which is spec 03's job.
5. `NO_AUTH` → `'unknown'`. `UPSTREAM_GONE` or `NETWORK` → `'unreachable'`. Never throws: a scan reports what it knows.
6. `localEdits` compares LOCAL against `<dir>/.skilled/base/<id>` with normalized text. No BASE on disk → `false`.
7. Counts: `identified` = rows **with** a source, `unknown` = rows **without** one, `behind` = rows with status `'behind'`, `total` = row count. Note that `unknown` the *count* means "no known origin" (the design's "8 unknown origin") while `'unknown'` the *row status* means "cannot say whether this is current" — a row can have a source and still be `'unknown'`.
8. `fetchedAt` is now when at least one upstream call succeeded, otherwise the cached value, otherwise `null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/status.build.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../src/config.js';
import { readManifest, upsertEntry, writeManifest } from '../src/manifest.js';
import { buildStatus, writeCachedStatus } from '../src/status.js';
import { cleanupTempDir, makeTempManagedDir } from './helpers/managed-dir.js';
import { fakeGitHub } from './helpers/fakes.js';
import { SkilledError } from '../src/errors.js';
import type { Entry } from '../src/types.js';

const SHA = 'a'.repeat(40);

function entry(id: string, commit = SHA): Entry {
  return {
    id,
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: id },
    base: { commit, adoptedAt: '2026-05-12', reconstructed: true },
    detection: {
      method: 'code-search',
      confidence: 0.92,
      confirmedBy: 'user',
      evidence: 'matched 14 consecutive lines of SKILL.md',
    },
  };
}

async function track(dir: string, ...entries: Entry[]): Promise<void> {
  let manifest = await readManifest(dir);
  for (const item of entries) manifest = upsertEntry(manifest, item);
  await writeManifest(dir, manifest);
}

describe('buildStatus', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('counts every item on disk and marks untracked ones unknown', async () => {
    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: false });

    expect(report.dir).toBe(dir);
    expect(report.total).toBe(8);
    expect(report.identified).toBe(0);
    expect(report.unknown).toBe(8);
    expect(report.behind).toBe(0);
    expect(report.fetchedAt).toBeNull();
    expect(report.rows.map((row) => row.id)).toEqual([
      'agents/ponytail.md',
      'agents/thomas.md',
      'skills/cso',
      'skills/explain-code',
      'skills/marketing-ads',
      'skills/marketing-brand',
      'skills/marketing-seo',
      'skills/qa-only',
    ]);
    expect(report.rows.every((row) => row.status === 'unknown')).toBe(true);
  });

  it('never touches the network without refresh', async () => {
    await track(dir, entry('skills/cso'));
    const github = fakeGitHub();

    const report = await buildStatus(dir, { github }, { refresh: false });

    expect(github.calls).toEqual([]);
    expect(report.identified).toBe(1);
    expect(report.unknown).toBe(7);
  });

  it('reuses the cached status per id without refresh', async () => {
    await track(dir, entry('skills/cso'));
    await writeCachedStatus(dir, {
      dir,
      rows: [{ id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false }],
      identified: 1,
      total: 8,
      behind: 1,
      unknown: 7,
      fetchedAt: '2026-08-20T09:00:00.000Z',
    });

    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: false });
    const row = report.rows.find((candidate) => candidate.id === 'skills/cso');

    expect(row?.status).toBe('behind');
    expect(row?.behindBy).toBe(6);
    expect(report.behind).toBe(1);
    expect(report.fetchedAt).toBe('2026-08-20T09:00:00.000Z');
  });

  it('counts commits behind on refresh', async () => {
    await track(dir, entry('skills/cso'));
    const github = fakeGitHub({
      listCommits: async () => [
        { sha: 'b'.repeat(40), date: '2026-08-01', message: 'one' },
        { sha: 'c'.repeat(40), date: '2026-08-02', message: 'two' },
      ],
    });

    const report = await buildStatus(dir, { github }, { refresh: true });
    const row = report.rows.find((candidate) => candidate.id === 'skills/cso');

    expect(row?.status).toBe('behind');
    expect(row?.behindBy).toBe(2);
    expect(report.behind).toBe(1);
    expect(report.fetchedAt).not.toBeNull();
  });

  it('marks an entry current when upstream has nothing new', async () => {
    await track(dir, entry('skills/cso'));
    const github = fakeGitHub({ listCommits: async () => [] });

    const report = await buildStatus(dir, { github }, { refresh: true });
    const row = report.rows.find((candidate) => candidate.id === 'skills/cso');

    expect(row?.status).toBe('current');
    expect(row?.behindBy).toBeUndefined();
  });

  it('cannot compare an entry with no captured BASE', async () => {
    await track(dir, entry('skills/cso', ''));
    const github = fakeGitHub({ listCommits: async () => [] });

    const report = await buildStatus(dir, { github }, { refresh: true });
    const row = report.rows.find((candidate) => candidate.id === 'skills/cso');

    expect(row?.status).toBe('unknown');
    expect(row?.source?.repo).toBe('owner/repo');
    expect(github.calls).toEqual([]);
    // it still counts as identified: the origin is known, the staleness is not
    expect(report.identified).toBe(1);
  });

  it('marks a missing upstream unreachable and keeps going', async () => {
    await track(dir, entry('skills/cso'), entry('skills/qa-only'));
    const github = fakeGitHub({
      listCommits: async (source) => {
        if (source.subpath === 'skills/cso') {
          throw new SkilledError({
            code: 'UPSTREAM_GONE',
            problem: 'Can\'t reach github.com/owner/repo (404)',
            cause: 'skills/cso points at a repo that no longer exists or went private.',
            fixes: ['skilled remove cso'],
            exitCode: 3,
          });
        }
        return [];
      },
    });

    const report = await buildStatus(dir, { github }, { refresh: true });

    expect(report.rows.find((row) => row.id === 'skills/cso')?.status).toBe('unreachable');
    expect(report.rows.find((row) => row.id === 'skills/qa-only')?.status).toBe('current');
  });

  it('falls back to unknown when GitHub is not authenticated', async () => {
    await track(dir, entry('skills/cso'));

    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: true });

    expect(report.rows.find((row) => row.id === 'skills/cso')?.status).toBe('unknown');
    expect(report.fetchedAt).toBeNull();
  });

  it('detects a local edit against BASE', async () => {
    await track(dir, entry('skills/cso'));
    const base = basePath(dir, 'skills/cso');
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'SKILL.md'), 'the pristine upstream copy\n', 'utf8');

    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: false });

    expect(report.rows.find((row) => row.id === 'skills/cso')?.localEdits).toBe(true);
  });

  it('reports no local edits when LOCAL matches BASE apart from whitespace', async () => {
    await track(dir, entry('skills/cso'));
    const local = await fs.readFile(path.join(dir, 'skills', 'cso', 'SKILL.md'), 'utf8');
    const base = basePath(dir, 'skills/cso');
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'SKILL.md'), `${local.replace(/\n/g, '\r\n')}\n\n`, 'utf8');

    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: false });

    expect(report.rows.find((row) => row.id === 'skills/cso')?.localEdits).toBe(false);
  });

  it('reports no local edits when there is no BASE at all', async () => {
    await track(dir, entry('skills/cso'));

    const report = await buildStatus(dir, { github: fakeGitHub() }, { refresh: false });

    expect(report.rows.find((row) => row.id === 'skills/cso')?.localEdits).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/status.build.test.ts`
Expected: FAIL with "buildStatus is not a function".

- [ ] **Step 3: Write minimal implementation — append to `src/status.ts`**

Replace the file's two existing import lines with this block, so there is one import per module:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitHubClient } from './clients.js';
import { basePath, cachePath } from './config.js';
import { normalizeContent } from './detect/hash.js';
import { discover } from './discover.js';
import { SkilledError } from './errors.js';
import { findEntry, readManifest } from './manifest.js';
import type { EntryStatus, LocalItem, Source, StatusReport, StatusRow } from './types.js';
```

Then append:

```ts
const SHA_RE = /^[0-9a-f]{40}$/;

/** True when any tracked file differs from its pristine BASE copy. */
async function hasLocalEdits(managedDir: string, item: LocalItem): Promise<boolean> {
  const baseRoot = basePath(managedDir, item.id);
  for (const relpath of item.files) {
    const localFile = relpath === '' ? item.absPath : path.join(item.absPath, relpath);
    const baseFile = relpath === '' ? baseRoot : path.join(baseRoot, relpath);
    let baseText: string;
    try {
      baseText = await fs.readFile(baseFile, 'utf8');
    } catch {
      return false; // no BASE captured yet, so there is nothing to compare against
    }
    let localText: string;
    try {
      localText = await fs.readFile(localFile, 'utf8');
    } catch {
      return true; // tracked file is gone, which is certainly a local change
    }
    if (normalizeContent(baseText) !== normalizeContent(localText)) return true;
  }
  return false;
}

export async function buildStatus(
  managedDir: string,
  deps: { github: GitHubClient },
  opts: { refresh: boolean },
): Promise<StatusReport> {
  const items = (await discover(managedDir)).sort((a, b) => a.id.localeCompare(b.id));
  const manifest = await readManifest(managedDir);
  const cached = await readCachedStatus(managedDir);
  const cachedRows = new Map((cached?.rows ?? []).map((row) => [row.id, row]));

  const rows: StatusRow[] = [];
  let fetched = false;

  for (const item of items) {
    const entry = findEntry(manifest, item.id);
    if (entry === undefined) {
      rows.push({ id: item.id, status: 'unknown', localEdits: false });
      continue;
    }

    const localEdits = await hasLocalEdits(managedDir, item);
    const row: StatusRow = { id: item.id, status: 'unknown', source: entry.source, localEdits };

    if (!opts.refresh) {
      const previous = cachedRows.get(item.id);
      if (previous !== undefined) {
        row.status = previous.status;
        if (previous.status === 'behind' && previous.behindBy !== undefined) {
          row.behindBy = previous.behindBy;
        }
      }
      rows.push(row);
      continue;
    }

    if (!SHA_RE.test(entry.base.commit)) {
      rows.push(row); // status stays 'unknown': no BASE to measure from
      continue;
    }

    try {
      const commits = await deps.github.listCommits(entry.source, entry.base.commit);
      fetched = true;
      if (commits.length > 0) {
        row.status = 'behind';
        row.behindBy = commits.length;
      } else {
        row.status = 'current';
      }
    } catch (error) {
      const code = error instanceof SkilledError ? error.code : 'NETWORK';
      row.status = code === 'NO_AUTH' ? 'unknown' : 'unreachable';
    }
    rows.push(row);
  }

  return {
    dir: managedDir,
    rows,
    identified: rows.filter((row) => row.source !== undefined).length,
    total: rows.length,
    behind: rows.filter((row) => row.status === 'behind').length,
    unknown: rows.filter((row) => row.source === undefined).length,
    fetchedAt: fetched ? new Date().toISOString() : cached?.fetchedAt ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/status.build.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts tests/status.build.test.ts
git commit -m "feat(status): build the status report from manifest, cache, and upstream"
```

---

### Task 14: Argument normalization and URL parsing

**Files:**
- Create: `src/commands/args.ts`
- Test: `tests/commands/args.test.ts`

**Interfaces:**
- Consumes: `Source` from `src/types.ts`; `SkilledError` from `src/errors.ts`.
- Produces: `positional(args: string[], commandName: string): string[]`, `parseSourceUrl(input: string): Source`.

`positional` drops a leading token equal to the command's own name, so the commands work whether `cli.ts` includes the command name in `args` or strips it.

`parseSourceUrl` accepts, and nothing else:

| Input | `repo` | `ref` | `subpath` |
|---|---|---|---|
| `https://github.com/owner/repo` | `owner/repo` | `main` | `''` |
| `https://github.com/owner/repo.git` | `owner/repo` | `main` | `''` |
| `github.com/owner/repo` | `owner/repo` | `main` | `''` |
| `.../repo/tree/<ref>/<subpath>` | `owner/repo` | `<ref>` | `<subpath>` |
| `.../repo/blob/<ref>/<subpath>` | `owner/repo` | `<ref>` | `<subpath>` |
| `owner/repo` | `owner/repo` | `main` | `''` |
| `owner/repo@ref` | `owner/repo` | `ref` | `''` |
| `owner/repo@ref#subpath` | `owner/repo` | `ref` | `subpath` |
| `owner/repo#subpath` | `owner/repo` | `main` | `subpath` |

Anything else raises `SkilledError` with code **`BAD_SOURCE`** and `exitCode: 2`. `BAD_SOURCE` is the eleventh member of spec 01's `ErrorCode` union, added for exactly this case (spec 01 Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/args.test.ts
import { describe, expect, it } from 'vitest';
import { parseSourceUrl, positional } from '../../src/commands/args.js';
import { SkilledError } from '../../src/errors.js';

describe('positional', () => {
  it('drops a leading token equal to the command name', () => {
    expect(positional(['add', 'owner/repo'], 'add')).toEqual(['owner/repo']);
  });

  it('leaves args alone when the command name is already stripped', () => {
    expect(positional(['owner/repo'], 'add')).toEqual(['owner/repo']);
  });

  it('handles an empty list', () => {
    expect(positional([], 'add')).toEqual([]);
  });
});

describe('parseSourceUrl', () => {
  it('parses a bare repo URL', () => {
    expect(parseSourceUrl('https://github.com/owner/repo')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: '',
    });
  });

  it('tolerates a .git suffix, a trailing slash, and a missing scheme', () => {
    for (const input of [
      'https://github.com/owner/repo.git',
      'https://github.com/owner/repo/',
      'github.com/owner/repo',
      'http://www.github.com/owner/repo',
    ]) {
      expect(parseSourceUrl(input).repo).toBe('owner/repo');
      expect(parseSourceUrl(input).ref).toBe('main');
    }
  });

  it('parses a /tree/ URL with a nested subpath', () => {
    expect(parseSourceUrl('https://github.com/owner/repo/tree/v2/skills/cso')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'v2',
      subpath: 'skills/cso',
    });
  });

  it('parses a /blob/ URL', () => {
    expect(parseSourceUrl('https://github.com/owner/repo/blob/main/agents/ponytail.md')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: 'agents/ponytail.md',
    });
  });

  it('parses the short form with a ref and a subpath', () => {
    expect(parseSourceUrl('owner/repo@dev#skills/cso')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'dev',
      subpath: 'skills/cso',
    });
  });

  it('parses the short form without a ref', () => {
    expect(parseSourceUrl('owner/repo#skills/cso')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: 'skills/cso',
    });
  });

  it('parses the plain short form', () => {
    expect(parseSourceUrl('owner/repo')).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: '',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseSourceUrl('  owner/repo  ').repo).toBe('owner/repo');
  });

  it('rejects anything that is not a GitHub source with BAD_SOURCE, exit code 2', async () => {
    for (const input of ['', 'not a url', 'https://gitlab.com/owner/repo', 'owner', '/owner/repo']) {
      expect(() => parseSourceUrl(input)).toThrow(SkilledError);
      try {
        parseSourceUrl(input);
      } catch (error) {
        expect(error).toMatchObject({ code: 'BAD_SOURCE', exitCode: 2 });
        expect((error as SkilledError).problem).toContain('GitHub');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/args.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/args.js" (`positional` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/args.ts
import { SkilledError } from '../errors.js';
import type { Source } from '../types.js';

const URL_FORM =
  /^(?:git\+)?(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s]+)((?:\/[^\s]+)?))?\/?$/i;

const SHORT_FORM =
  /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:@([^#\s]+))?(?:#(\S+))?$/;

/** Drops a leading token equal to the command's own name. */
export function positional(args: string[], commandName: string): string[] {
  return args.length > 0 && args[0] === commandName ? args.slice(1) : args;
}

function tidySubpath(raw: string): string {
  return raw.replace(/^\//, '').replace(/\/$/, '');
}

function badSource(input: string): SkilledError {
  return new SkilledError({
    code: 'BAD_SOURCE',
    problem: `Not a GitHub source: ${JSON.stringify(input)}`,
    cause:
      'A source must be a GitHub repo. Accepted forms: ' +
      'https://github.com/owner/repo, https://github.com/owner/repo/tree/<ref>/<subpath>, ' +
      'or owner/repo@ref#subpath.',
    fixes: [
      'skilled add https://github.com/owner/repo skills/cso',
      'skilled add owner/repo@main#skills/cso skills/cso',
    ],
    exitCode: 2,
  });
}

export function parseSourceUrl(input: string): Source {
  const raw = input.trim();
  if (raw === '') throw badSource(input);

  const url = URL_FORM.exec(raw);
  if (url !== null) {
    return {
      type: 'github',
      repo: `${url[1] ?? ''}/${url[2] ?? ''}`,
      ref: url[3] ?? 'main',
      subpath: tidySubpath(url[4] ?? ''),
    };
  }

  const short = SHORT_FORM.exec(raw);
  if (short !== null) {
    return {
      type: 'github',
      repo: `${short[1] ?? ''}/${short[2] ?? ''}`,
      ref: short[3] ?? 'main',
      subpath: tidySubpath(short[4] ?? ''),
    };
  }

  throw badSource(input);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/args.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/args.ts tests/commands/args.test.ts
git commit -m "feat(cli): parse GitHub source URLs and normalize positionals"
```

---

### Task 15: Entry construction and manifest persistence

**Files:**
- Create: `src/commands/entries.ts`
- Test: `tests/commands/entries.test.ts`

**Interfaces:**
- Consumes: `readManifest`, `writeManifest`, `upsertEntry`, `findEntry` from `src/manifest.ts`; `Candidate`, `Entry`, `DetectionMethod` from `src/types.ts`; `clusterAnchorId` from Task 9.
- Produces: `todayIso(): string`, `entryFromCandidate(candidate: Candidate, adoptedAt: string, confirmedBy: 'user' | 'auto'): Entry`, `shouldAutoAccept(candidate: Candidate, competing: number, autoAcceptedIds: ReadonlySet<string>): boolean`, `persistEntry(managedDir: string, entry: Entry): Promise<void>`, `syncUnknown(managedDir: string, ids: string[]): Promise<void>`.

`confirmedBy` is `'user'` for anything the user answered, and `'auto'` for a
detection certain enough to accept without asking. The rule is fixed by the contract
(§ "Auto-accepting certain provenance detections") — do not widen it:

**Auto-accept** when `confidence >= 0.95` AND `method` is `'inline-url'`,
`'plugin-cache'`, or `'known-index'`. Those three are assertions, not inferences.

**Always prompt** when `method` is `'code-search'` or `'claude'` (forks and
wrong-copy-direction matches live here, and no score rules them out), when more than
one candidate exists for the same `id`, or when a `'cluster'` candidate's propagated
parent was itself prompted — cluster inherits its parent's confirmation status.

`confirmedBy: null` is still never persisted: an entry reaches the manifest only via
`'user'` or `'auto'`. Auto-accepted rows print with a marker distinguishing them from
prompted ones, the closing summary reports how many were auto-accepted, and
`--confirm-each` forces a prompt for every candidate.

`shouldAutoAccept` is the single place that rule lives, and it is evaluated in this
order:

1. `competing > 1` → **false**. Two candidates for one id is a question, never an assertion.
2. `method` is `'inline-url'`, `'plugin-cache'`, or `'known-index'` **and** `confidence >= 0.95` → **true**.
3. `method` is `'cluster'` → **true** only when `clusterAnchorId(candidate)` names an id in `autoAcceptedIds`. This is the inheritance clause: the eleven `figma-*` siblings of an auto-accepted plugin-cache hit ride along, while siblings of a prompted `code-search` hit are prompted too. The caller must therefore decide non-cluster candidates first and pass the ids it auto-accepted; cluster candidates always arrive after their anchor, so one pass in arrival order is enough.
4. Anything else → **false**. That covers `'code-search'` and `'claude'`, where forks and wrong-copy-direction matches live and no score rules them out, and `'manual'`, which only ever comes from a user typing it.

A `Candidate` has no field for a pinned commit, so a 40-hex `Source.ref` (which only `plugin-cache` produces) is read as the BASE commit with `reconstructed: false`. Everything else gets `commit: ''` and `reconstructed: true`, meaning "origin confirmed, BASE not captured yet" — spec 03's fetch fills it in, and `buildStatus` already treats such an entry as `'unknown'` rather than pretending to know.

`persistEntry` re-reads the manifest, upserts, and writes on **every** confirmation. That is a deliberate read-modify-write per keypress: it makes Ctrl-C lossless, which the design demands.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/entries.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readManifest, writeManifest } from '../../src/manifest.js';
import {
  entryFromCandidate,
  persistEntry,
  shouldAutoAccept,
  syncUnknown,
  todayIso,
} from '../../src/commands/entries.js';
import { cleanupTempDir, makeEmptyTempDir } from '../helpers/managed-dir.js';
import type { Candidate } from '../../src/types.js';

const SHA = '9680714bad40503ef37a9f815fd1d2cd15150af4';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'skills/cso',
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
    method: 'code-search',
    confidence: 0.92,
    evidence: 'matched 14 consecutive lines of SKILL.md',
    ...overrides,
  };
}

describe('todayIso', () => {
  it('is an ISO date with no time part', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('entryFromCandidate', () => {
  it('records the detection and marks BASE as not captured', () => {
    const entry = entryFromCandidate(candidate(), '2026-08-27', 'user');

    expect(entry).toEqual({
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: '', adoptedAt: '2026-08-27', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.92,
        confirmedBy: 'user',
        evidence: 'matched 14 consecutive lines of SKILL.md',
      },
    });
  });

  it('records an auto-accepted detection as such', () => {
    const entry = entryFromCandidate(
      candidate({ method: 'inline-url', confidence: 0.95 }),
      '2026-08-27',
      'auto',
    );

    expect(entry.detection.confirmedBy).toBe('auto');
  });

  it('takes the BASE commit from a pinned ref', () => {
    const entry = entryFromCandidate(
      candidate({
        method: 'plugin-cache',
        confidence: 0.99,
        source: { type: 'github', repo: 'owner/repo', ref: SHA, subpath: 'plugins/p/skills/cso' },
      }),
      '2026-08-27',
      'auto',
    );

    expect(entry.base).toEqual({ commit: SHA, adoptedAt: '2026-08-27', reconstructed: false });
  });
});

describe('shouldAutoAccept', () => {
  const none: ReadonlySet<string> = new Set();

  it('accepts an assertion-grade detection', () => {
    for (const method of ['inline-url', 'plugin-cache', 'known-index'] as const) {
      expect(shouldAutoAccept(candidate({ method, confidence: 0.95 }), 1, none)).toBe(true);
      expect(shouldAutoAccept(candidate({ method, confidence: 0.99 }), 1, none)).toBe(true);
    }
  });

  it('prompts below the confidence threshold', () => {
    expect(shouldAutoAccept(candidate({ method: 'inline-url', confidence: 0.55 }), 1, none)).toBe(
      false,
    );
    expect(shouldAutoAccept(candidate({ method: 'inline-url', confidence: 0.94 }), 1, none)).toBe(
      false,
    );
  });

  it('always prompts for an inference, however confident', () => {
    for (const method of ['code-search', 'claude', 'manual'] as const) {
      expect(shouldAutoAccept(candidate({ method, confidence: 1 }), 1, none)).toBe(false);
    }
  });

  it('always prompts when candidates compete for the same id', () => {
    expect(shouldAutoAccept(candidate({ method: 'inline-url', confidence: 0.95 }), 2, none)).toBe(
      false,
    );
  });

  it('lets a cluster candidate inherit an auto-accepted anchor', () => {
    const sibling = candidate({
      id: 'skills/figma-mcp',
      method: 'cluster',
      confidence: 0.79,
      evidence:
        'sibling of skills/figma-power, which resolved to anthropics/x (family "figma", 11 members)',
    });

    expect(shouldAutoAccept(sibling, 1, new Set(['skills/figma-power']))).toBe(true);
    expect(shouldAutoAccept(sibling, 1, none)).toBe(false);
  });

  it('does not auto-accept a cluster candidate with an unparseable anchor', () => {
    const sibling = candidate({ method: 'cluster', confidence: 0.79, evidence: 'inferred somehow' });
    expect(shouldAutoAccept(sibling, 1, new Set(['skills/figma-power']))).toBe(false);
  });
});

describe('persistEntry', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeEmptyTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('writes the entry and clears the id from unknown', async () => {
    await writeManifest(dir, { version: 1, entries: [], unknown: ['skills/cso', 'skills/qa-only'] });

    await persistEntry(dir, entryFromCandidate(candidate(), '2026-08-27', 'user'));

    const manifest = await readManifest(dir);
    expect(manifest.entries.map((entry) => entry.id)).toEqual(['skills/cso']);
    expect(manifest.unknown).toEqual(['skills/qa-only']);
  });

  it('is safe to call repeatedly and keeps the newest source', async () => {
    await persistEntry(dir, entryFromCandidate(candidate(), '2026-08-27', 'user'));
    await persistEntry(
      dir,
      entryFromCandidate(
        candidate({ source: { type: 'github', repo: 'other/repo', ref: 'main', subpath: 'x' } }),
        '2026-08-27',
        'user',
      ),
    );

    const manifest = await readManifest(dir);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.source.repo).toBe('other/repo');
  });
});

describe('syncUnknown', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeEmptyTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('records exactly the ids with no entry, sorted and deduplicated', async () => {
    await persistEntry(dir, entryFromCandidate(candidate(), '2026-08-27', 'user'));

    await syncUnknown(dir, ['skills/qa-only', 'agents/thomas.md', 'skills/cso', 'skills/qa-only']);

    const manifest = await readManifest(dir);
    expect(manifest.unknown).toEqual(['agents/thomas.md', 'skills/qa-only']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/entries.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/entries.js" (`todayIso` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/entries.ts
import { clusterAnchorId } from '../detect/cluster.js';
import { findEntry, readManifest, upsertEntry, writeManifest } from '../manifest.js';
import type { Candidate, DetectionMethod, Entry } from '../types.js';

const SHA_RE = /^[0-9a-f]{40}$/;
const AUTO_ACCEPT_THRESHOLD = 0.95;

/** Methods that assert a source rather than infer one. */
const ASSERTION_METHODS: ReadonlySet<DetectionMethod> = new Set<DetectionMethod>([
  'inline-url',
  'plugin-cache',
  'known-index',
]);

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The one place the auto-accept rule lives. Callers must decide non-cluster
 * candidates first and pass the ids they auto-accepted, because a cluster
 * candidate inherits its anchor's decision.
 */
export function shouldAutoAccept(
  candidate: Candidate,
  competing: number,
  autoAcceptedIds: ReadonlySet<string>,
): boolean {
  // Two candidates for one id is a question, never an assertion.
  if (competing > 1) return false;
  if (ASSERTION_METHODS.has(candidate.method)) {
    return candidate.confidence >= AUTO_ACCEPT_THRESHOLD;
  }
  if (candidate.method === 'cluster') {
    const anchor = clusterAnchorId(candidate);
    return anchor !== null && autoAcceptedIds.has(anchor);
  }
  // code-search and claude are inferences: forks and wrong-copy-direction
  // matches live here and no score rules them out. manual only comes from a user.
  return false;
}

/**
 * A confirmed candidate becomes a tracked entry. confirmedBy is 'user' when the
 * user answered and 'auto' when shouldAutoAccept did; it is never null.
 */
export function entryFromCandidate(
  candidate: Candidate,
  adoptedAt: string,
  confirmedBy: 'user' | 'auto',
): Entry {
  const pinned = SHA_RE.test(candidate.source.ref);
  return {
    id: candidate.id,
    source: { ...candidate.source },
    base: {
      commit: pinned ? candidate.source.ref : '',
      adoptedAt,
      reconstructed: !pinned,
    },
    detection: {
      method: candidate.method,
      confidence: candidate.confidence,
      confirmedBy,
      evidence: candidate.evidence,
    },
  };
}

/** Flushed after every single confirmation, so Ctrl-C cannot lose work. */
export async function persistEntry(managedDir: string, entry: Entry): Promise<void> {
  const manifest = await readManifest(managedDir);
  const next = upsertEntry(manifest, entry);
  next.unknown = next.unknown.filter((id) => id !== entry.id);
  await writeManifest(managedDir, next);
}

/** Sets manifest.unknown to exactly the ids on disk that have no entry. */
export async function syncUnknown(managedDir: string, ids: string[]): Promise<void> {
  const manifest = await readManifest(managedDir);
  const unknown = [...new Set(ids)]
    .filter((id) => findEntry(manifest, id) === undefined)
    .sort((a, b) => a.localeCompare(b));
  await writeManifest(managedDir, { ...manifest, unknown });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/entries.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/entries.ts tests/commands/entries.test.ts
git commit -m "feat(cli): turn confirmed candidates into manifest entries"
```

---

### Task 16: `skilled add <url> [<path>]`

**Files:**
- Create: `src/commands/add.ts`
- Create: `tests/helpers/context.ts`
- Test: `tests/commands/add.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `resolveName` from `src/cli.ts`; `discover` from `src/discover.ts`; `readManifest`, `findEntry` from `src/manifest.ts`; `SkilledError` from `src/errors.ts`; `parseSourceUrl`, `positional` from Task 14; `persistEntry`, `todayIso` from Task 15.
- Produces: `addCommand: Command` (name `'add'`), and `tests/helpers/context.ts` exporting `makeContext(dir: string, args: string[], flags?: Record<string, string | boolean>): CommandContext & { out: string[]; err: string[] }`.

Behavior:
1. `skilled add <url>` with no `<path>`: the target is inferred when exactly one item on disk has the same basename as the URL's subpath. Zero or several matches is a `UNKNOWN_ENTRY` error, exit 2, that names the ambiguity and asks for the second argument.
2. `<path>` is resolved through spec 01's `resolveName`, so `cso`, `skills/cso`, and `ponytail` all work.
3. A `manual` detection is recorded at confidence `1` with `confirmedBy: 'user'`, because the user is the evidence.
4. Correcting a wrong guess overwrites the entry. `adoptedAt` is preserved when the source is unchanged and reset when it changes, since a different source means a different BASE.
5. The managed file is never touched, and the output says so.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/add.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCommand } from '../../src/commands/add.js';
import { persistEntry } from '../../src/commands/entries.js';
import { readManifest, writeManifest } from '../../src/manifest.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { makeContext } from '../helpers/context.js';
import { SkilledError } from '../../src/errors.js';

describe('addCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('registers a source against an explicit path', async () => {
    const ctx = makeContext(dir, ['https://github.com/owner/repo/tree/main/skills/cso', 'skills/cso']);

    expect(await addCommand.run(ctx)).toBe(0);

    const manifest = await readManifest(dir);
    const entry = manifest.entries[0];
    expect(entry?.id).toBe('skills/cso');
    expect(entry?.source).toEqual({
      type: 'github',
      repo: 'owner/repo',
      ref: 'main',
      subpath: 'skills/cso',
    });
    expect(entry?.detection).toEqual({
      method: 'manual',
      confidence: 1,
      confirmedBy: 'user',
      evidence: 'registered by hand: skilled add https://github.com/owner/repo/tree/main/skills/cso',
    });
    expect(entry?.base.adoptedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry?.base.reconstructed).toBe(true);
    expect(ctx.out.join('\n')).toContain('skills/cso');
    expect(ctx.out.join('\n')).toContain('not modified');
  });

  it('accepts a bare basename as the path', async () => {
    const ctx = makeContext(dir, ['owner/repo@main#skills/cso', 'cso']);

    expect(await addCommand.run(ctx)).toBe(0);
    expect((await readManifest(dir)).entries[0]?.id).toBe('skills/cso');
  });

  it('infers the target from the subpath basename', async () => {
    const ctx = makeContext(dir, ['https://github.com/owner/repo/tree/main/skills/cso']);

    expect(await addCommand.run(ctx)).toBe(0);
    expect((await readManifest(dir)).entries[0]?.id).toBe('skills/cso');
  });

  it('removes the id from unknown', async () => {
    await writeManifest(dir, { version: 1, entries: [], unknown: ['skills/cso', 'skills/qa-only'] });
    const ctx = makeContext(dir, ['owner/repo#skills/cso', 'skills/cso']);

    await addCommand.run(ctx);

    expect((await readManifest(dir)).unknown).toEqual(['skills/qa-only']);
  });

  it('corrects a wrong guess and resets the adopted date', async () => {
    await persistEntry(dir, {
      id: 'skills/cso',
      source: { type: 'github', repo: 'wrong/fork', ref: 'main', subpath: 'skills/cso' },
      base: { commit: '', adoptedAt: '2026-01-01', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.7,
        confirmedBy: 'user',
        evidence: 'matched a sentence',
      },
    });

    const ctx = makeContext(dir, ['owner/right#skills/cso', 'skills/cso']);
    expect(await addCommand.run(ctx)).toBe(0);

    const manifest = await readManifest(dir);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.source.repo).toBe('owner/right');
    expect(manifest.entries[0]?.detection.method).toBe('manual');
    expect(manifest.entries[0]?.base.adoptedAt).not.toBe('2026-01-01');
  });

  it('keeps the adopted date when the source is unchanged', async () => {
    await persistEntry(dir, {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: '', adoptedAt: '2026-01-01', reconstructed: true },
      detection: {
        method: 'manual',
        confidence: 1,
        confirmedBy: 'user',
        evidence: 'registered by hand',
      },
    });

    await addCommand.run(makeContext(dir, ['owner/repo#skills/cso', 'skills/cso']));

    expect((await readManifest(dir)).entries[0]?.base.adoptedAt).toBe('2026-01-01');
  });

  it('emits JSON and nothing else with --json', async () => {
    const ctx = makeContext(dir, ['owner/repo#skills/cso', 'skills/cso'], { json: true });

    expect(await addCommand.run(ctx)).toBe(0);
    expect(ctx.out).toHaveLength(1);
    expect(JSON.parse(ctx.out[0] ?? '')).toMatchObject({
      id: 'skills/cso',
      source: { repo: 'owner/repo' },
    });
  });

  it('fails with exit 2 when the URL is missing', async () => {
    await expect(addCommand.run(makeContext(dir, []))).rejects.toMatchObject({
      code: 'BAD_FLAG',
      exitCode: 2,
    });
  });

  it('fails with exit 2 for an unparseable URL', async () => {
    await expect(addCommand.run(makeContext(dir, ['not a url', 'cso']))).rejects.toBeInstanceOf(
      SkilledError,
    );
  });

  it('fails with exit 2 when the target cannot be inferred', async () => {
    await expect(addCommand.run(makeContext(dir, ['owner/repo']))).rejects.toMatchObject({
      code: 'UNKNOWN_ENTRY',
      exitCode: 2,
    });
  });

  it('tolerates the command name being present in args', async () => {
    const ctx = makeContext(dir, ['add', 'owner/repo#skills/cso', 'skills/cso']);
    expect(await addCommand.run(ctx)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/add.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/add.js" (`addCommand` is undefined).

- [ ] **Step 3: Write minimal implementation**

`tests/helpers/context.ts`:

```ts
import path from 'node:path';
import type { CommandContext } from '../../src/cli.js';

export interface TestContext extends CommandContext {
  out: string[];
  err: string[];
}

/**
 * A CommandContext whose output is captured instead of printed. flags.json and
 * flags.refresh are defaulted to false because spec 01's run() normalizes them
 * to booleans before dispatch (spec 01 § "Command dispatch"), and env is supplied
 * so nothing here can read the real environment.
 */
export function makeContext(
  dir: string,
  args: string[],
  flags: Record<string, string | boolean> = {},
): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  return {
    args,
    flags: { color: false, json: false, refresh: false, ...flags },
    env: { HOME: dir, XDG_CONFIG_HOME: path.join(dir, '.config') },
    config: {
      dirs: [dir],
      origin: 'flag',
      configPath: path.join(dir, '.config', 'skilled', 'config.json'),
      configExists: false,
    },
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    out,
    err,
  };
}
```

`src/commands/add.ts`:

```ts
import path from 'node:path';
import type { Command, CommandContext } from '../cli.js';
import { resolveName } from '../cli.js';
import { discover } from '../discover.js';
import { SkilledError } from '../errors.js';
import { findEntry, readManifest } from '../manifest.js';
import type { Entry, LocalItem, Source } from '../types.js';
import { parseSourceUrl, positional } from './args.js';
import { persistEntry, todayIso } from './entries.js';

function sameSource(a: Source, b: Source): boolean {
  return a.type === b.type && a.repo === b.repo && a.ref === b.ref && a.subpath === b.subpath;
}

function missingUrl(): SkilledError {
  return new SkilledError({
    code: 'BAD_FLAG',
    problem: 'skilled add needs a source URL.',
    cause: 'No URL was given, so there is nothing to register.',
    fixes: [
      'skilled add https://github.com/owner/repo skills/cso',
      'skilled            see which entries have no known source',
    ],
    exitCode: 2,
  });
}

function cannotInfer(source: Source, matches: LocalItem[]): SkilledError {
  const guess = source.subpath === '' ? '(none)' : path.posix.basename(source.subpath);
  return new SkilledError({
    code: 'UNKNOWN_ENTRY',
    problem: 'skilled add could not tell which local entry this source belongs to.',
    cause:
      `The URL's subpath basename is ${guess}, which matches ${matches.length} entries on disk. ` +
      'Name the entry explicitly as the second argument.',
    fixes: [
      'skilled add <url> skills/cso',
      'skilled            list every entry and its status',
    ],
    exitCode: 2,
  });
}

export const addCommand: Command = {
  name: 'add',
  summary: 'register a source by hand, or correct a wrong guess',

  async run(ctx: CommandContext): Promise<number> {
    const args = positional(ctx.args, 'add');
    const url = args[0];
    if (url === undefined) throw missingUrl();

    const source = parseSourceUrl(url);
    const managedDir = ctx.config.dirs[0] ?? process.cwd();
    const items = await discover(managedDir);

    let target: LocalItem;
    const nameArg = args[1];
    if (nameArg !== undefined) {
      target = resolveName(nameArg, items);
    } else {
      const wanted = source.subpath === '' ? '' : path.posix.basename(source.subpath);
      const matches =
        wanted === ''
          ? []
          : items.filter((item) => path.posix.basename(item.id).replace(/\.md$/i, '') === wanted.replace(/\.md$/i, ''));
      const only = matches[0];
      if (matches.length !== 1 || only === undefined) throw cannotInfer(source, matches);
      target = only;
    }

    const manifest = await readManifest(managedDir);
    const existing = findEntry(manifest, target.id);
    const keepAdoptedAt =
      existing !== undefined && sameSource(existing.source, source)
        ? existing.base.adoptedAt
        : todayIso();

    const entry: Entry = {
      id: target.id,
      source,
      base: {
        commit: existing !== undefined && sameSource(existing.source, source) ? existing.base.commit : '',
        adoptedAt: keepAdoptedAt,
        reconstructed: true,
      },
      detection: {
        method: 'manual',
        confidence: 1,
        confirmedBy: 'user',
        evidence: `registered by hand: skilled add ${url}`,
      },
    };

    await persistEntry(managedDir, entry);

    if (ctx.flags.json === true) {
      ctx.stdout(JSON.stringify(entry, null, 2));
      return 0;
    }

    ctx.stdout(`tracking ${entry.id} → github.com/${source.repo}@${source.ref}`);
    if (source.subpath !== '') ctx.stdout(`  subpath   ${source.subpath}`);
    ctx.stdout('  Your file was not modified. Only .skilled/manifest.json changed.');
    ctx.stdout('');
    ctx.stdout(`  → skilled ${path.posix.basename(entry.id).replace(/\.md$/i, '')}   see what skilled now knows`);
    ctx.stdout('  → skilled --refresh                      check whether it is behind');
    return 0;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/add.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/add.ts tests/commands/add.test.ts tests/helpers/context.ts
git commit -m "feat(cli): add skilled add to register or correct a source"
```

---

### Task 17: `skilled remove <name>`

**Files:**
- Create: `src/commands/remove.ts`
- Test: `tests/commands/remove.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `resolveName` from `src/cli.ts`; `discover` from `src/discover.ts`; `readManifest`, `writeManifest`, `removeEntry`, `findEntry` from `src/manifest.ts`; `basePath` from `src/config.ts`; `SkilledError` from `src/errors.ts`; `positional` from Task 14.
- Produces: `removeCommand: Command` (name `'remove'`).

Stops tracking and deletes the BASE copies (state, always allowed). The skill or agent file itself is left exactly where it is, and the output says so — that is the whole promise of the command. The id moves into `manifest.unknown`, because the file is still on disk with no known source.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/remove.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../../src/config.js';
import { persistEntry } from '../../src/commands/entries.js';
import { removeCommand } from '../../src/commands/remove.js';
import { readManifest } from '../../src/manifest.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { makeContext } from '../helpers/context.js';
import type { Entry } from '../../src/types.js';

function entry(id: string): Entry {
  return {
    id,
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: id },
    base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: false },
    detection: {
      method: 'code-search',
      confidence: 0.92,
      confirmedBy: 'user',
      evidence: 'matched 14 consecutive lines of SKILL.md',
    },
  };
}

describe('removeCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
    await persistEntry(dir, entry('skills/cso'));
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('stops tracking and leaves the file alone', async () => {
    const before = await fs.readFile(path.join(dir, 'skills', 'cso', 'SKILL.md'), 'utf8');
    const ctx = makeContext(dir, ['cso']);

    expect(await removeCommand.run(ctx)).toBe(0);

    const manifest = await readManifest(dir);
    expect(manifest.entries).toEqual([]);
    expect(manifest.unknown).toEqual(['skills/cso']);
    expect(await fs.readFile(path.join(dir, 'skills', 'cso', 'SKILL.md'), 'utf8')).toBe(before);
    expect(ctx.out.join('\n')).toContain('left alone');
  });

  it('deletes the BASE copies', async () => {
    const base = basePath(dir, 'skills/cso');
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'SKILL.md'), 'pristine', 'utf8');

    await removeCommand.run(makeContext(dir, ['skills/cso']));

    await expect(fs.stat(base)).rejects.toThrow();
  });

  it('does not duplicate an id already in unknown', async () => {
    await removeCommand.run(makeContext(dir, ['cso']));
    await persistEntry(dir, entry('skills/cso'));
    await removeCommand.run(makeContext(dir, ['cso']));

    expect((await readManifest(dir)).unknown).toEqual(['skills/cso']);
  });

  it('fails with exit 2 when the entry is not tracked', async () => {
    await expect(removeCommand.run(makeContext(dir, ['qa-only']))).rejects.toMatchObject({
      code: 'UNKNOWN_ENTRY',
      exitCode: 2,
    });
  });

  it('fails with exit 2 when no name is given', async () => {
    await expect(removeCommand.run(makeContext(dir, []))).rejects.toMatchObject({
      code: 'BAD_FLAG',
      exitCode: 2,
    });
  });

  it('tolerates the command name being present in args', async () => {
    expect(await removeCommand.run(makeContext(dir, ['remove', 'cso']))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/remove.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/remove.js" (`removeCommand` is undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/remove.ts
import fs from 'node:fs/promises';
import type { Command, CommandContext } from '../cli.js';
import { resolveName } from '../cli.js';
import { basePath } from '../config.js';
import { discover } from '../discover.js';
import { SkilledError } from '../errors.js';
import { findEntry, readManifest, removeEntry, writeManifest } from '../manifest.js';
import { positional } from './args.js';

export const removeCommand: Command = {
  name: 'remove',
  summary: 'stop tracking an entry; the file itself is left alone',

  async run(ctx: CommandContext): Promise<number> {
    const args = positional(ctx.args, 'remove');
    const name = args[0];
    if (name === undefined) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: 'skilled remove needs the name of an entry.',
        cause: 'No name was given, so there is nothing to stop tracking.',
        fixes: ['skilled remove cso', 'skilled        list every tracked entry'],
        exitCode: 2,
      });
    }

    const managedDir = ctx.config.dirs[0] ?? process.cwd();
    const items = await discover(managedDir);
    const target = resolveName(name, items);

    const manifest = await readManifest(managedDir);
    if (findEntry(manifest, target.id) === undefined) {
      throw new SkilledError({
        code: 'UNKNOWN_ENTRY',
        problem: `${target.id} is not tracked, so there is nothing to remove.`,
        cause: 'It has no entry in .skilled/manifest.json.',
        fixes: [
          `skilled add <url> ${target.id}   tell skilled where it came from`,
          'skilled                          see what is tracked',
        ],
        exitCode: 2,
      });
    }

    const next = removeEntry(manifest, target.id);
    if (!next.unknown.includes(target.id)) {
      next.unknown = [...next.unknown, target.id].sort((a, b) => a.localeCompare(b));
    }
    await writeManifest(managedDir, next);
    await fs.rm(basePath(managedDir, target.id), { recursive: true, force: true });

    if (ctx.flags.json === true) {
      ctx.stdout(JSON.stringify({ id: target.id, tracked: false }, null, 2));
      return 0;
    }

    ctx.stdout(`stopped tracking ${target.id}`);
    ctx.stdout('  The file itself was left alone. Only .skilled/ changed.');
    ctx.stdout('');
    ctx.stdout(`  → skilled add <url> ${target.id}   start tracking it again`);
    return 0;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/remove.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/remove.ts tests/commands/remove.test.ts
git commit -m "feat(cli): add skilled remove to stop tracking an entry"
```

---

### Task 18: `skilled <name>` — detail on one entry

**Files:**
- Create: `src/commands/detail.ts`
- Test: `tests/commands/detail.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `resolveName` from `src/cli.ts`; `discover` from `src/discover.ts`; `readManifest`, `findEntry` from `src/manifest.ts`; `nullGitHubClient` from `src/clients.ts`; `buildStatus` from `src/status.ts`; `SkilledError` from `src/errors.ts`.
- Produces: `detailCommand: Command` (name `'show'` — the command spec 01 dispatches to when `args[0]` matches no command; spec 01 § "Command registry and name resolution").

Answers "why does it think cso came from there?" — the design's stage-5 debug journey. It shows source, adopted date, BASE commit and whether it was reconstructed, detection method, confidence, evidence, local edits, and cached staleness. It calls `buildStatus` with `refresh: false` and a null client, so it is offline and instant. An untracked-but-present item is not an error: it prints what it does not know and how to fix it, exit `0`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/detail.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { basePath } from '../../src/config.js';
import { persistEntry } from '../../src/commands/entries.js';
import { detailCommand } from '../../src/commands/detail.js';
import { writeCachedStatus } from '../../src/status.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { makeContext } from '../helpers/context.js';
import type { Entry } from '../../src/types.js';

const SHA = 'a'.repeat(40);

const ENTRY: Entry = {
  id: 'skills/cso',
  source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
  base: { commit: SHA, adoptedAt: '2026-05-12', reconstructed: true },
  detection: {
    method: 'code-search',
    confidence: 0.92,
    confirmedBy: 'user',
    evidence: 'matched 14 consecutive lines of SKILL.md',
  },
};

describe('detailCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('shows source, adoption, method, confidence, and evidence', async () => {
    await persistEntry(dir, ENTRY);
    const ctx = makeContext(dir, ['cso']);

    expect(await detailCommand.run(ctx)).toBe(0);

    const text = ctx.out.join('\n');
    expect(text).toContain('skills/cso');
    expect(text).toContain('github.com/owner/repo@main');
    expect(text).toContain('2026-05-12');
    expect(text).toContain('code-search');
    expect(text).toContain('92%');
    expect(text).toContain('matched 14 consecutive lines of SKILL.md');
    expect(text).toContain('reconstructed');
    expect(text).toContain(SHA.slice(0, 7));
  });

  it('reports cached staleness and local edits', async () => {
    await persistEntry(dir, ENTRY);
    const base = basePath(dir, 'skills/cso');
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, 'SKILL.md'), 'a different pristine copy\n', 'utf8');
    await writeCachedStatus(dir, {
      dir,
      rows: [{ id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: true }],
      identified: 1,
      total: 8,
      behind: 1,
      unknown: 7,
      fetchedAt: '2026-08-20T09:00:00.000Z',
    });

    const ctx = makeContext(dir, ['cso']);
    await detailCommand.run(ctx);

    const text = ctx.out.join('\n');
    expect(text).toContain('6 commits behind');
    expect(text).toContain('yes');
    expect(text).toContain('2026-08-20T09:00:00.000Z');
  });

  it('says plainly when nothing records the origin', async () => {
    const ctx = makeContext(dir, ['qa-only']);

    expect(await detailCommand.run(ctx)).toBe(0);

    const text = ctx.out.join('\n');
    expect(text).toContain('unknown');
    expect(text).toContain('skilled add');
  });

  it('emits the entry as JSON with --json', async () => {
    await persistEntry(dir, ENTRY);
    const ctx = makeContext(dir, ['cso'], { json: true });

    await detailCommand.run(ctx);

    expect(ctx.out).toHaveLength(1);
    expect(JSON.parse(ctx.out[0] ?? '')).toMatchObject({
      id: 'skills/cso',
      detection: { method: 'code-search' },
    });
  });

  it('emits a null source as JSON for an untracked entry', async () => {
    const ctx = makeContext(dir, ['qa-only'], { json: true });

    await detailCommand.run(ctx);

    expect(JSON.parse(ctx.out[0] ?? '')).toEqual({ id: 'skills/qa-only', source: null });
  });

  it('fails with exit 2 for a name nothing matches', async () => {
    await expect(detailCommand.run(makeContext(dir, ['nope']))).rejects.toMatchObject({
      exitCode: 2,
    });
  });

  it('fails with exit 2 when no name is given', async () => {
    await expect(detailCommand.run(makeContext(dir, []))).rejects.toMatchObject({
      code: 'BAD_FLAG',
      exitCode: 2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/detail.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/detail.js" (`detailCommand` is undefined).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/detail.ts
import type { Command, CommandContext } from '../cli.js';
import { resolveName } from '../cli.js';
import { nullGitHubClient } from '../clients.js';
import { discover } from '../discover.js';
import { SkilledError } from '../errors.js';
import { findEntry, readManifest } from '../manifest.js';
import { buildStatus } from '../status.js';
import type { StatusRow } from '../types.js';

function label(text: string): string {
  return `  ${text.padEnd(14)}`;
}

function describeStatus(row: StatusRow | undefined): string {
  if (row === undefined) return 'not checked yet — run `skilled --refresh`';
  switch (row.status) {
    case 'behind':
      return `${row.behindBy ?? 0} commits behind upstream`;
    case 'current':
      return 'up to date with upstream';
    case 'unreachable':
      return 'upstream could not be reached';
    default:
      return 'unknown — run `skilled --refresh`';
  }
}

export const detailCommand: Command = {
  name: 'show',
  summary: 'show where one entry came from and how it was identified',

  async run(ctx: CommandContext): Promise<number> {
    const name = ctx.args[0];
    if (name === undefined) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: 'skilled <name> needs the name of an entry.',
        cause: 'No name was given.',
        fixes: ['skilled cso', 'skilled        list every entry'],
        exitCode: 2,
      });
    }

    const managedDir = ctx.config.dirs[0] ?? process.cwd();
    const items = await discover(managedDir);
    const target = resolveName(name, items);
    const manifest = await readManifest(managedDir);
    const entry = findEntry(manifest, target.id);

    if (entry === undefined) {
      if (ctx.flags.json === true) {
        ctx.stdout(JSON.stringify({ id: target.id, source: null }, null, 2));
        return 0;
      }
      ctx.stdout(target.id);
      ctx.stdout(`${label('source')}unknown — nothing on disk records where this came from`);
      ctx.stdout(`${label('kind')}${target.kind}, ${target.files.length} file(s)`);
      ctx.stdout('');
      ctx.stdout(`  → skilled add <url> ${target.id}   tell skilled where it came from`);
      return 0;
    }

    if (ctx.flags.json === true) {
      ctx.stdout(JSON.stringify(entry, null, 2));
      return 0;
    }

    // refresh:false with a null client keeps this offline and instant.
    const report = await buildStatus(managedDir, { github: nullGitHubClient() }, { refresh: false });
    const row = report.rows.find((candidate) => candidate.id === target.id);

    const commit =
      entry.base.commit === ''
        ? 'not captured yet — the next `skilled update` records it'
        : `${entry.base.commit.slice(0, 7)}${entry.base.reconstructed ? ' (reconstructed)' : ''}`;

    ctx.stdout(target.id);
    ctx.stdout(`${label('source')}github.com/${entry.source.repo}@${entry.source.ref}`);
    if (entry.source.subpath !== '') ctx.stdout(`${label('subpath')}${entry.source.subpath}`);
    ctx.stdout(`${label('adopted')}${entry.base.adoptedAt}`);
    ctx.stdout(`${label('base commit')}${commit}`);
    ctx.stdout(
      `${label('detected by')}${entry.detection.method} · confidence ${Math.round(
        entry.detection.confidence * 100,
      )}% · confirmed by ${entry.detection.confirmedBy ?? 'nobody'}`,
    );
    ctx.stdout(`${label('evidence')}${entry.detection.evidence}`);
    ctx.stdout(`${label('local edits')}${row?.localEdits === true ? 'yes' : 'none'}`);
    ctx.stdout(`${label('status')}${describeStatus(row)}`);
    ctx.stdout(`${label('checked')}${report.fetchedAt ?? 'never'}`);
    ctx.stdout('');
    ctx.stdout(`  → skilled add <url> ${target.id}   correct this source`);
    ctx.stdout(`  → skilled remove ${target.id}      stop tracking it`);
    return 0;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/detail.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/detail.ts tests/commands/detail.test.ts
git commit -m "feat(cli): add skilled <name> to explain one entry's provenance"
```

---

### Task 19: The candidate confirmation flow

**Files:**
- Create: `src/commands/confirm.ts`
- Test: `tests/commands/confirm.test.ts`

**Interfaces:**
- Consumes: `Candidate` from `src/types.ts`.
- Produces:

```ts
export interface ConfirmIO {
  stdout: (line: string) => void;
  promptKey: (message: string, keys: Array<{ key: string; label: string }>) => Promise<string>;
}
export interface ConfirmResult {
  confirmed: Candidate[];
  rejected: string[];
  skipped: string[];
  /** true when the user pressed Ctrl-C or Escape; the rest were never asked */
  cancelled: boolean;
}
export function candidateHeader(candidate: Candidate): string[];
export function confirmCandidates(
  groups: Map<string, Candidate[]>,
  io: ConfirmIO,
  onConfirm: (candidate: Candidate) => Promise<void>,
): Promise<ConfirmResult>;
```

**Nothing is tracked on an unconfirmed guess.** Every candidate — including a 0.99 plugin-cache match — is presented with its evidence and waits for a keypress. The design's mock shows the keys exactly:

```
? skills/cso — best match: github.com/owner/repo
    matched 14 consecutive lines of SKILL.md
    repo created 2026-02-11 · 340 stars · last push 2026-08-09
  [y] that's it  [n] wrong  [o] show other candidates  [s] skip
```

Rules:
1. Ids are processed in sorted order; candidates within an id in descending confidence.
2. `y` calls `onConfirm` **immediately**, before moving on, so Ctrl-C keeps everything already confirmed.
3. `n` advances to the next candidate for that id; running out of candidates records the id as rejected.
4. `o` prints every candidate for that id with its confidence and evidence, then re-prompts the same one.
5. `s` records the id as skipped and moves on.
6. **`PROMPT_CANCEL` (`'cancel'`) stops the whole loop**, sets `cancelled: true`, and leaves every remaining id unasked. Spec 01 resolves Ctrl-C and Escape to that constant rather than to a key (spec 01 § "Interactive prompts"), so treating it as a skip would silently walk through 40 more prompts after the user asked to stop. Everything already confirmed is on disk, because rule 2 flushes per keypress.
7. `promptKey` is injected, so no test needs a TTY. Spec 01's real `promptKey` *rejects* when stdin is not a TTY, which is why the caller checks `isInteractive()` before ever getting here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/confirm.test.ts
import { describe, expect, it } from 'vitest';
import { candidateHeader, confirmCandidates, type ConfirmIO } from '../../src/commands/confirm.js';
import { PROMPT_CANCEL } from '../../src/render/prompt.js';
import type { Candidate } from '../../src/types.js';

function candidate(id: string, repo: string, confidence: number): Candidate {
  return {
    id,
    source: { type: 'github', repo, ref: 'main', subpath: id },
    method: 'code-search',
    confidence,
    evidence: 'matched 14 consecutive lines of SKILL.md',
    repoMeta: { createdAt: '2026-02-11', stars: 340, pushedAt: '2026-08-09' },
  };
}

function io(keys: string[]): ConfirmIO & { out: string[]; prompts: number } {
  const out: string[] = [];
  let prompts = 0;
  return {
    out,
    get prompts() {
      return prompts;
    },
    stdout: (line: string) => {
      out.push(line);
    },
    promptKey: async () => {
      const key = keys[prompts] ?? 's';
      prompts += 1;
      return key;
    },
  };
}

describe('candidateHeader', () => {
  it('shows the repo, the evidence, and the repo metadata as judgment aids', () => {
    const lines = candidateHeader(candidate('skills/cso', 'owner/repo', 0.92));

    expect(lines[0]).toBe('? skills/cso — best match: github.com/owner/repo');
    expect(lines[1]).toBe('    matched 14 consecutive lines of SKILL.md');
    expect(lines[2]).toBe('    repo created 2026-02-11 · 340 stars · last push 2026-08-09');
  });

  it('omits the metadata line when there is none', () => {
    const bare = candidate('skills/cso', 'owner/repo', 0.92);
    delete bare.repoMeta;
    expect(candidateHeader(bare)).toHaveLength(2);
  });
});

describe('confirmCandidates', () => {
  it('confirms on y and persists immediately', async () => {
    const groups = new Map([['skills/cso', [candidate('skills/cso', 'owner/repo', 0.92)]]]);
    const persisted: string[] = [];
    const context = io(['y']);

    const result = await confirmCandidates(groups, context, async (chosen) => {
      persisted.push(chosen.source.repo);
    });

    expect(persisted).toEqual(['owner/repo']);
    expect(result.confirmed.map((chosen) => chosen.id)).toEqual(['skills/cso']);
    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('walks to the next candidate on n and persists nothing until y', async () => {
    const groups = new Map([
      [
        'skills/cso',
        [candidate('skills/cso', 'fork/repo', 0.5), candidate('skills/cso', 'origin/repo', 0.85)],
      ],
    ]);
    const persisted: string[] = [];
    const context = io(['n', 'y']);

    const result = await confirmCandidates(groups, context, async (chosen) => {
      persisted.push(chosen.source.repo);
    });

    // highest confidence is offered first
    expect(persisted).toEqual(['origin/repo']);
    expect(result.confirmed).toHaveLength(1);
    expect(context.prompts).toBe(2);
  });

  it('records a rejection when every candidate is refused', async () => {
    const groups = new Map([['skills/cso', [candidate('skills/cso', 'owner/repo', 0.92)]]]);
    const persisted: string[] = [];
    const context = io(['n']);

    const result = await confirmCandidates(groups, context, async () => {
      persisted.push('nope');
    });

    expect(persisted).toEqual([]);
    expect(result.rejected).toEqual(['skills/cso']);
    expect(result.confirmed).toEqual([]);
  });

  it('lists the competing candidates on o and re-prompts', async () => {
    const groups = new Map([
      [
        'skills/cso',
        [candidate('skills/cso', 'origin/repo', 0.85), candidate('skills/cso', 'fork/repo', 0.5)],
      ],
    ]);
    const context = io(['o', 'y']);

    await confirmCandidates(groups, context, async () => undefined);

    const text = context.out.join('\n');
    expect(text).toContain('origin/repo');
    expect(text).toContain('fork/repo');
    expect(text).toContain('85%');
    expect(text).toContain('50%');
    expect(context.prompts).toBe(2);
  });

  it('skips on s without persisting', async () => {
    const groups = new Map([['skills/cso', [candidate('skills/cso', 'owner/repo', 0.92)]]]);
    const persisted: string[] = [];
    const context = io(['s']);

    const result = await confirmCandidates(groups, context, async () => {
      persisted.push('nope');
    });

    expect(persisted).toEqual([]);
    expect(result.skipped).toEqual(['skills/cso']);
  });

  it('stops the whole loop on Ctrl-C and keeps what was already confirmed', async () => {
    const groups = new Map([
      ['agents/alpha.md', [candidate('agents/alpha.md', 'a/repo', 0.9)]],
      ['skills/beta', [candidate('skills/beta', 'b/repo', 0.9)]],
      ['skills/gamma', [candidate('skills/gamma', 'c/repo', 0.9)]],
    ]);
    const persisted: string[] = [];
    const context = io(['y', PROMPT_CANCEL]);

    const result = await confirmCandidates(groups, context, async (chosen) => {
      persisted.push(chosen.id);
    });

    expect(persisted).toEqual(['agents/alpha.md']);
    expect(result.cancelled).toBe(true);
    expect(result.confirmed.map((chosen) => chosen.id)).toEqual(['agents/alpha.md']);
    expect(result.skipped).toEqual([]);
    expect(result.rejected).toEqual([]);
    // gamma was never asked about
    expect(context.prompts).toBe(2);
  });

  it('reports cancelled false on a normal run', async () => {
    const groups = new Map([['skills/cso', [candidate('skills/cso', 'owner/repo', 0.92)]]]);
    const result = await confirmCandidates(groups, io(['y']), async () => undefined);
    expect(result.cancelled).toBe(false);
  });

  it('processes ids in sorted order', async () => {
    const groups = new Map([
      ['skills/zeta', [candidate('skills/zeta', 'z/repo', 0.9)]],
      ['agents/alpha.md', [candidate('agents/alpha.md', 'a/repo', 0.9)]],
    ]);
    const order: string[] = [];
    const context = io(['y', 'y']);

    await confirmCandidates(groups, context, async (chosen) => {
      order.push(chosen.id);
    });

    expect(order).toEqual(['agents/alpha.md', 'skills/zeta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/confirm.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/confirm.js" (`candidateHeader` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/confirm.ts
import { PROMPT_CANCEL } from '../render/prompt.js';
import type { Candidate } from '../types.js';

const KEYS = [
  { key: 'y', label: "that's it" },
  { key: 'n', label: 'wrong' },
  { key: 'o', label: 'show other candidates' },
  { key: 's', label: 'skip' },
];

const PROMPT = "  [y] that's it  [n] wrong  [o] show other candidates  [s] skip";

export interface ConfirmIO {
  stdout: (line: string) => void;
  promptKey: (message: string, keys: Array<{ key: string; label: string }>) => Promise<string>;
}

export interface ConfirmResult {
  confirmed: Candidate[];
  rejected: string[];
  skipped: string[];
  /** true when the user pressed Ctrl-C or Escape; the rest were never asked */
  cancelled: boolean;
}

/** The candidate plus the evidence that makes the y/n call answerable. */
export function candidateHeader(candidate: Candidate): string[] {
  const lines = [
    `? ${candidate.id} — best match: github.com/${candidate.source.repo}`,
    `    ${candidate.evidence}`,
  ];
  const meta = candidate.repoMeta;
  if (meta !== undefined) {
    lines.push(
      `    repo created ${meta.createdAt} · ${meta.stars} stars · last push ${meta.pushedAt}`,
    );
  }
  return lines;
}

function listAll(candidates: Candidate[]): string[] {
  const lines = ['    all candidates:'];
  candidates.forEach((candidate, index) => {
    lines.push(
      `      ${index + 1}. github.com/${candidate.source.repo}` +
        (candidate.source.subpath === '' ? '' : `/${candidate.source.subpath}`) +
        ` — ${Math.round(candidate.confidence * 100)}% via ${candidate.method}`,
    );
    lines.push(`         ${candidate.evidence}`);
  });
  return lines;
}

/**
 * Every auto-detection is a guess until the user confirms it. onConfirm runs the
 * moment a yes lands, so Ctrl-C never discards a confirmed entry.
 */
export async function confirmCandidates(
  groups: Map<string, Candidate[]>,
  io: ConfirmIO,
  onConfirm: (candidate: Candidate) => Promise<void>,
): Promise<ConfirmResult> {
  const result: ConfirmResult = { confirmed: [], rejected: [], skipped: [], cancelled: false };

  for (const id of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    if (result.cancelled) break;
    const candidates = [...(groups.get(id) ?? [])].sort((a, b) => b.confidence - a.confidence);
    let index = 0;
    let decided = false;

    while (index < candidates.length && !decided) {
      const candidate = candidates[index];
      if (candidate === undefined) break;
      for (const line of candidateHeader(candidate)) io.stdout(line);

      const key = await io.promptKey(PROMPT, KEYS);
      if (key === PROMPT_CANCEL) {
        // Ctrl-C or Escape: stop asking entirely. Everything confirmed so far is
        // already on disk, so there is nothing to roll back.
        result.cancelled = true;
        decided = true;
      } else if (key === 'y') {
        await onConfirm(candidate);
        result.confirmed.push(candidate);
        decided = true;
      } else if (key === 'n') {
        index += 1;
      } else if (key === 'o') {
        for (const line of listAll(candidates)) io.stdout(line);
      } else {
        result.skipped.push(id);
        decided = true;
      }
    }

    if (!decided) result.rejected.push(id);
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/confirm.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/confirm.ts tests/commands/confirm.test.ts
git commit -m "feat(cli): confirm every candidate against its evidence before tracking"
```

---

### Task 20: Bare `skilled` — the streaming scan

**Files:**
- Create: `src/commands/scan.ts`
- Test: `tests/commands/scan.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext` from `src/cli.ts`; `discover` from `src/discover.ts`; `stateDir`, `statusLinePath` from `src/config.ts`; `nullGitHubClient`, `nullClaudeClient`, `GitHubClient`, `ClaudeClient` from `src/clients.ts`; `promptKey`, `isInteractive` from `src/render/prompt.ts`; `SkilledError` from `src/errors.ts`; `detectAll`, `DetectDeps` from Task 11; `loadKnownIndex` from Task 5; `RateLimiter`, `throttledGitHubClient`, `SearchEvent` from Task 7; `instrumentedClaudeClient`, `ClaudeEvent` from Task 10; `buildStatus`, `writeCachedStatus` from Tasks 12-13; `confirmCandidates` from Task 19; `entryFromCandidate`, `persistEntry`, `shouldAutoAccept`, `syncUnknown`, `todayIso` from Task 15.
- Produces: `scanCommand: Command` (name `'scan'`, reached by bare `skilled`), `runScan(ctx: CommandContext, io: ScanIO, deps?: ScanDeps): Promise<number>`, `pluginCacheDirFor(managedDir: string): string`, `createDetectClients(): Promise<ScanDeps>`, `streamLine(candidate: Candidate, autoAccepted: boolean): string`, `summaryLine(report: StatusReport): string`, `statusLineText(report: StatusReport): string`, `writeStatusLine(managedDir: string, report: StatusReport): Promise<void>`, plus `interface ScanIO { stdout: (line: string) => void; promptKey: ConfirmIO['promptKey']; interactive: boolean }` and `interface ScanDeps { github: GitHubClient; claude: ClaudeClient }`.

Behavior:
1. Header, then candidates streamed as they land — free strategies print before any network call, which is the magical moment.
2. After the stream, every item with no candidate is printed as `✗ … → no match`. The unknown list is part of the value, not a failure.
3. **Auto-accept runs after the stream and before any prompt.** Each id's candidate list is passed to `shouldAutoAccept`; non-cluster candidates are decided first so cluster candidates can inherit (Task 15). An auto-accepted candidate is persisted with `confirmedBy: 'auto'` and removed from the group map, so it is never prompted for. It runs regardless of `--json` and regardless of interactivity, because it is not a prompt — the only thing that disables it is `--confirm-each`. The stream's marker is therefore **provisional**: it is decided per candidate on arrival, and if a competitor turns up later for the same id the scan prints a correction line rather than leaving a stale `✓` on screen.
4. What survives auto-accept is prompted for, and only when interactive and not `--json`. Non-interactive prints how many are still waiting and persists none of them.
5. Both counts are reported: `N accepted automatically · M need your confirmation`. An auto-accepted stream line carries a `✓` marker, a prompted one a `?`, so the two are never confused.
6. The trust line says `No skill or agent file has been modified` — accurate, because auto-accept writes the manifest without asking, and the manifest is inside `.skilled/`. It must not claim that nothing at all was written.
7. `manifest.unknown` is then set to exactly the ids with no entry, the status report is built, and both `cache/status.json` and the one-line `status` file are written. Those live in `.skilled/`, so writing them needs no approval.
8. Detection only runs on items that have **no manifest entry**. Re-detecting a confirmed entry would burn the rate limit and re-ask a question the user already answered.
9. Exit code: `3` when `--refresh` was asked for and the network degraded, else `1` when anything is behind, else `0`.
10. Every failure is re-thrown as a `SkilledError` whose cause states that no managed file was modified.

`createDetectClients` dynamically imports spec 03's `fetch.ts` through a variable specifier, so this compiles today and lights up with no edit when spec 03 lands. Until then it returns the null clients and the network strategies degrade to a clear `NO_AUTH` line.

`pluginCacheDirFor` is `<managed-dir>/plugins` — which is exactly `~/.claude/plugins` for the default managed directory. It never reaches into a real home directory, which keeps tests hermetic.

> **Blocker for `--confirm-each`, one word, in a file spec 02 does not own.** Spec 01's `parseArgs` validates against a whitelist — `BOOLEAN_FLAGS = new Set(['refresh', 'json', 'no-color', 'help', 'version', 'add'])` (spec 01 Task 16) — and rejects anything else with `BAD_FLAG` exit 2. `'confirm-each'` must be added to that set or `skilled --confirm-each` fails before any command runs. Every test in this task injects flags straight into `CommandContext`, so the suite passes either way; only the real binary is affected, which is why Definition of Done step 8 exercises the flag through `dist/cli.js`. If the flag is rejected there, add `'confirm-each'` to `BOOLEAN_FLAGS` — that is the whole fix.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/scan.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { statusLinePath } from '../../src/config.js';
import { persistEntry } from '../../src/commands/entries.js';
import {
  pluginCacheDirFor,
  runScan,
  statusLineText,
  streamLine,
  summaryLine,
} from '../../src/commands/scan.js';
import { readCachedStatus } from '../../src/status.js';
import { readManifest } from '../../src/manifest.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { makeContext, type TestContext } from '../helpers/context.js';
import { fakeClaude, fakeGitHub } from '../helpers/fakes.js';
import { SkilledError } from '../../src/errors.js';
import type { Candidate, Entry, StatusReport } from '../../src/types.js';

const SHA = 'a'.repeat(40);

function quietDeps() {
  return {
    github: fakeGitHub({
      searchCode: async () => [],
      getRepoMeta: async () => ({ createdAt: '2026-01-01', stars: 1, pushedAt: '2026-01-02' }),
      listCommits: async () => [],
    }),
    claude: fakeClaude({ identify: async () => null }),
  };
}

function scanIo(ctx: TestContext, keys: string[] = [], interactive = false) {
  let index = 0;
  return {
    stdout: ctx.stdout,
    interactive,
    promptKey: async () => {
      const key = keys[index] ?? 's';
      index += 1;
      return key;
    },
  };
}

function trackedEntry(id: string): Entry {
  return {
    id,
    source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: id },
    base: { commit: SHA, adoptedAt: '2026-05-12', reconstructed: false },
    detection: {
      method: 'manual',
      confidence: 1,
      confirmedBy: 'user',
      evidence: 'registered by hand',
    },
  };
}

describe('streamLine', () => {
  it('ticks an auto-accepted detection and questions one that needs a decision', () => {
    const candidate: Candidate = {
      id: 'agents/ponytail.md',
      source: { type: 'github', repo: 'DietrichGebert/ponytail', ref: 'main', subpath: '' },
      method: 'inline-url',
      confidence: 0.95,
      evidence: 'named in agents/ponytail.md line 13',
    };

    expect(streamLine(candidate, true)).toContain('✓');
    expect(streamLine(candidate, true)).toContain('DietrichGebert/ponytail');
    expect(streamLine(candidate, true)).toContain('named in file');
    expect(streamLine(candidate, false)).toContain('?');
    expect(streamLine(candidate, false)).not.toContain('✓');
  });
});

describe('summaryLine', () => {
  it('reports identified, behind, and unknown', () => {
    const report: StatusReport = {
      dir: '/tmp/x',
      rows: [],
      identified: 43,
      total: 51,
      behind: 12,
      unknown: 8,
      fetchedAt: '2026-08-27T10:00:00.000Z',
    };

    expect(summaryLine(report)).toBe('  43 of 51 identified · 12 behind upstream · 8 unknown origin');
  });

  it('says the upstream was not checked when it was not', () => {
    const report: StatusReport = {
      dir: '/tmp/x',
      rows: [],
      identified: 2,
      total: 8,
      behind: 0,
      unknown: 6,
      fetchedAt: null,
    };

    expect(summaryLine(report)).toBe(
      '  2 of 8 identified · upstream state not checked · 6 unknown origin',
    );
  });
});

describe('statusLineText', () => {
  it('is empty when nothing is behind', () => {
    expect(
      statusLineText({ dir: '/x', rows: [], identified: 0, total: 0, behind: 0, unknown: 0, fetchedAt: null }),
    ).toBe('');
  });

  it('names what is behind', () => {
    const text = statusLineText({
      dir: '/x',
      rows: [
        { id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false },
        { id: 'agents/ponytail.md', status: 'behind', behindBy: 1, localEdits: false },
        { id: 'skills/qa-only', status: 'current', localEdits: false },
      ],
      identified: 3,
      total: 3,
      behind: 2,
      unknown: 0,
      fetchedAt: '2026-08-27T10:00:00.000Z',
    });

    expect(text).toBe('skilled: 2 behind upstream (cso, ponytail) · run `skilled update`\n');
  });
});

describe('pluginCacheDirFor', () => {
  it('is the plugins directory inside the managed dir', () => {
    expect(pluginCacheDirFor('/home/x/.claude')).toBe('/home/x/.claude/plugins');
  });
});

describe('runScan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('streams the free detections, lists the misses, and auto-accepts the assertions', async () => {
    const ctx = makeContext(dir, []);

    expect(await runScan(ctx, scanIo(ctx), quietDeps())).toBe(0);

    const text = ctx.out.join('\n');
    expect(text).toContain('6 skills, 2 agents');
    expect(text).toContain('✓ agents/ponytail.md');
    expect(text).toContain('DietrichGebert/ponytail');
    expect(text).toContain('anthropics/claude-plugins-official');
    expect(text).toContain('✗ skills/qa-only');
    expect(text).toContain('no match');
    expect(text).toContain('2 accepted automatically · 0 need your confirmation');
    expect(text).toContain('No skill or agent file has been modified');
    expect(text).toContain('2 of 8 identified');
    expect(text).toContain('6 unknown origin');

    // both fixture detections are inline-url at 0.95 with no competitor
    const manifest = await readManifest(dir);
    expect(manifest.entries.map((entry) => entry.id).sort()).toEqual([
      'agents/ponytail.md',
      'skills/explain-code',
    ]);
    expect(manifest.entries.every((entry) => entry.detection.confirmedBy === 'auto')).toBe(true);
    expect(manifest.unknown).toHaveLength(6);
  });

  it('never auto-accepts an inference, however confident', async () => {
    const deps = {
      github: fakeGitHub({
        // a lone code-search hit scores 0.9, above the 0.95 gate for assertions
        // but still an inference, so it must be prompted for
        searchCode: async (query) =>
          query.includes('blast radius')
            ? [{ repo: 'origin/repo', path: 'skills/cso/SKILL.md' }]
            : [],
        getRepoMeta: async () => ({ createdAt: '2026-01-01', stars: 9, pushedAt: '2026-02-02' }),
        listCommits: async () => [],
      }),
      claude: fakeClaude({ identify: async () => null }),
    };
    const ctx = makeContext(dir, []);

    await runScan(ctx, scanIo(ctx), deps);

    const manifest = await readManifest(dir);
    expect(manifest.entries.map((entry) => entry.id)).not.toContain('skills/cso');
    expect(ctx.out.join('\n')).toContain('2 accepted automatically · 1 need your confirmation');
  });

  it('corrects the streamed marker out loud when a competitor turns up', async () => {
    // one file naming two different upstreams: the first streams as accepted,
    // the second makes it a question again
    await fs.writeFile(
      `${dir}/agents/twinsource.md`,
      [
        '---',
        'name: twinsource',
        '---',
        '',
        'Adapted from github.com/first/origin',
        'Based on github.com/second/origin',
      ].join('\n'),
      'utf8',
    );
    const ctx = makeContext(dir, []);

    await runScan(ctx, scanIo(ctx), quietDeps());

    const text = ctx.out.join('\n');
    expect(text).toContain("a second candidate turned up; I'll ask");
    expect(text).toContain('2 accepted automatically · 1 need your confirmation');
    expect((await readManifest(dir)).entries.map((entry) => entry.id)).not.toContain(
      'agents/twinsource.md',
    );
  });

  it('--confirm-each prompts for everything and auto-accepts nothing', async () => {
    const ctx = makeContext(dir, [], { 'confirm-each': true });

    expect(await runScan(ctx, scanIo(ctx, ['n', 'n'], true), quietDeps())).toBe(0);

    const text = ctx.out.join('\n');
    expect(text).toContain('0 accepted automatically · 2 need your confirmation');
    expect(text).not.toContain('✓ agents/ponytail.md');
    expect((await readManifest(dir)).entries).toEqual([]);
  });

  it('writes the cache and the one-line status file', async () => {
    const ctx = makeContext(dir, []);

    await runScan(ctx, scanIo(ctx), quietDeps());

    expect((await readCachedStatus(dir))?.total).toBe(8);
    expect(await fs.readFile(statusLinePath(dir), 'utf8')).toBe('');
  });

  it('never writes a managed file', async () => {
    const before = await fs.readFile(`${dir}/agents/ponytail.md`, 'utf8');
    const ctx = makeContext(dir, []);

    await runScan(ctx, scanIo(ctx), quietDeps());

    expect(await fs.readFile(`${dir}/agents/ponytail.md`, 'utf8')).toBe(before);
  });

  it('persists exactly what the user confirms', async () => {
    const ctx = makeContext(dir, [], { 'confirm-each': true });

    // two candidates, prompted because --confirm-each; accept the first, skip the second
    expect(await runScan(ctx, scanIo(ctx, ['y', 's'], true), quietDeps())).toBe(0);

    const manifest = await readManifest(dir);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]?.id).toBe('agents/ponytail.md');
    expect(manifest.entries[0]?.detection.confirmedBy).toBe('user');
    expect(manifest.unknown).toHaveLength(7);
  });

  it('emits only a StatusReport with --json', async () => {
    const ctx = makeContext(dir, [], { json: true });

    expect(await runScan(ctx, scanIo(ctx, ['y'], true), quietDeps())).toBe(0);

    expect(ctx.out).toHaveLength(1);
    const report = JSON.parse(ctx.out[0] ?? '') as StatusReport;
    expect(report.dir).toBe(dir);
    expect(report.total).toBe(8);
    expect(report.rows).toHaveLength(8);
  });

  it('exits 1 when something is behind', async () => {
    await persistEntry(dir, trackedEntry('skills/cso'));
    const deps = {
      github: fakeGitHub({
        searchCode: async () => [],
        getRepoMeta: async () => ({ createdAt: '2026-01-01', stars: 1, pushedAt: '2026-01-02' }),
        listCommits: async () => [{ sha: 'b'.repeat(40), date: '2026-08-01', message: 'one' }],
      }),
      claude: fakeClaude({ identify: async () => null }),
    };
    const ctx = makeContext(dir, [], { refresh: true });

    expect(await runScan(ctx, scanIo(ctx), deps)).toBe(1);
    expect(await fs.readFile(statusLinePath(dir), 'utf8')).toContain('1 behind upstream (cso)');
  });

  it('exits 3 when --refresh cannot reach GitHub, and says why', async () => {
    const ctx = makeContext(dir, [], { refresh: true });

    expect(
      await runScan(ctx, scanIo(ctx), { github: fakeGitHub(), claude: fakeClaude() }),
    ).toBe(3);
    expect(ctx.out.join('\n')).toContain('not authenticated');
  });

  it('states that no managed file was modified when it fails', async () => {
    const deps = {
      github: fakeGitHub({
        searchCode: async () => {
          throw new SkilledError({
            code: 'BAD_MANIFEST',
            problem: 'Something unexpected went wrong.',
            cause: 'A deliberate test failure.',
            fixes: ['try again'],
            exitCode: 2,
          });
        },
      }),
      claude: fakeClaude({ identify: async () => null }),
    };
    const ctx = makeContext(dir, []);

    await expect(runScan(ctx, scanIo(ctx), deps)).rejects.toMatchObject({ code: 'BAD_MANIFEST' });
    try {
      await runScan(ctx, scanIo(ctx), deps);
    } catch (error) {
      expect((error as SkilledError).cause).toContain('No skill or agent file was modified');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/scan.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/scan.js" (`runScan` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/scan.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command, CommandContext } from '../cli.js';
import type { ClaudeClient, GitHubClient } from '../clients.js';
import { nullClaudeClient, nullGitHubClient } from '../clients.js';
import { stateDir, statusLinePath } from '../config.js';
import { detectAll } from '../detect/index.js';
import { instrumentedClaudeClient } from '../detect/ask-claude.js';
import { RateLimiter, throttledGitHubClient, type SearchEvent } from '../detect/code-search.js';
import { loadKnownIndex } from '../detect/known-index.js';
import { discover } from '../discover.js';
import { SkilledError } from '../errors.js';
import { findEntry, readManifest } from '../manifest.js';
import { isInteractive, promptKey } from '../render/prompt.js';
import { buildStatus, writeCachedStatus } from '../status.js';
import type { Candidate, DetectionMethod, StatusReport } from '../types.js';
import { confirmCandidates, type ConfirmIO } from './confirm.js';
import {
  entryFromCandidate,
  persistEntry,
  shouldAutoAccept,
  syncUnknown,
  todayIso,
} from './entries.js';

const SEARCH_LIMIT_PER_MINUTE = 10;
const ID_WIDTH = 26;
const REPO_WIDTH = 36;

const METHOD_LABELS: Record<DetectionMethod, string> = {
  'inline-url': 'named in file',
  'plugin-cache': 'plugin cache',
  'known-index': 'known index',
  'code-search': 'github search',
  cluster: 'sibling inferred',
  claude: 'Claude',
  manual: 'by hand',
};

export interface ScanIO {
  stdout: (line: string) => void;
  promptKey: ConfirmIO['promptKey'];
  interactive: boolean;
}

export interface ScanDeps {
  github: GitHubClient;
  claude: ClaudeClient;
}

/** The plugin cache that belongs to this managed directory. */
export function pluginCacheDirFor(managedDir: string): string {
  return path.join(managedDir, 'plugins');
}

/**
 * The real GitHub client arrives with spec 03's fetch.ts. The specifier is held
 * in a variable so tsc does not resolve a module that does not exist yet; when
 * spec 03 lands this picks it up with no edit here.
 */
export async function createDetectClients(): Promise<ScanDeps> {
  const specifier = '../fetch.js';
  try {
    const loaded: unknown = await import(specifier);
    const mod = loaded as { createGitHubClient?: unknown; resolveToken?: unknown };
    if (typeof mod.createGitHubClient === 'function' && typeof mod.resolveToken === 'function') {
      const token = await (mod.resolveToken as () => Promise<string | null>)();
      if (token !== null) {
        const github = (mod.createGitHubClient as (t: string | null) => GitHubClient)(token);
        return { github, claude: nullClaudeClient() };
      }
    }
  } catch {
    // spec 03 has not shipped yet, or `gh` is unavailable
  }
  return { github: nullGitHubClient(), claude: nullClaudeClient() };
}

/** `✓` means accepted without asking; `?` means it still needs a decision. */
export function streamLine(candidate: Candidate, autoAccepted: boolean): string {
  const marker = autoAccepted ? '✓' : '?';
  const repo = candidate.source.repo.padEnd(REPO_WIDTH);
  return `  ${marker} ${candidate.id.padEnd(ID_WIDTH)} → ${repo} (${METHOD_LABELS[candidate.method]})`;
}

export function summaryLine(report: StatusReport): string {
  const staleness =
    report.fetchedAt === null ? 'upstream state not checked' : `${report.behind} behind upstream`;
  return `  ${report.identified} of ${report.total} identified · ${staleness} · ${report.unknown} unknown origin`;
}

export function statusLineText(report: StatusReport): string {
  if (report.behind === 0) return '';
  const names = report.rows
    .filter((row) => row.status === 'behind')
    .map((row) => path.posix.basename(row.id).replace(/\.md$/i, ''));
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? `, +${names.length - 3} more` : '';
  return `skilled: ${report.behind} behind upstream (${shown}${more}) · run \`skilled update\`\n`;
}

export async function writeStatusLine(managedDir: string, report: StatusReport): Promise<void> {
  const file = statusLinePath(managedDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, statusLineText(report), 'utf8');
}

function rateLimitNotice(total: number, identified: number, waitMs: number): string[] {
  // Wording taken from the design's error catalogue, verbatim.
  const seconds = Math.max(1, Math.round(waitMs / 1000));
  return [
    '  ✗ GitHub search rate limit reached (10/min)',
    `      Identified ${identified} of ${total} so far. ${total - identified} still unknown.`,
    `      Resuming automatically in ${seconds}s, or press Ctrl-C — progress is saved.`,
  ];
}

/** Errors during a scan must say that nothing on disk was touched. */
function reassure(error: unknown): SkilledError {
  if (error instanceof SkilledError) {
    return new SkilledError({
      code: error.code,
      problem: error.problem,
      cause: `${error.cause}\nNo skill or agent file was modified — skilled had not written to one.`,
      fixes: error.fixes,
      exitCode: error.exitCode,
    });
  }
  return new SkilledError({
    code: 'NETWORK',
    problem: 'The scan stopped before it finished.',
    cause:
      `${error instanceof Error ? error.message : String(error)}\n` +
      'No skill or agent file was modified.',
    fixes: [
      'skilled --dir <path>   scan a different directory',
      'skilled config         show which directory is managed',
    ],
    exitCode: 3,
  });
}

export async function runScan(
  ctx: CommandContext,
  io: ScanIO,
  deps?: ScanDeps,
): Promise<number> {
  const json = ctx.flags.json === true;
  const refresh = ctx.flags.refresh === true;
  const managedDir = ctx.config.dirs[0] ?? process.cwd();

  try {
    const items = await discover(managedDir);
    const manifest = await readManifest(managedDir);
    // Already-confirmed entries are not re-detected: it would burn the rate
    // limit and re-ask a question the user has already answered.
    const untracked = items.filter((item) => findEntry(manifest, item.id) === undefined);
    const alreadyTracked = items.length - untracked.length;

    const skills = items.filter((item) => item.kind === 'skill').length;
    const agents = items.filter((item) => item.kind === 'agent').length;
    if (!json) {
      io.stdout(`Scanning ${managedDir} … ${skills} skills, ${agents} agents`);
      io.stdout('');
      if (ctx.config.dirs.length > 1) {
        const rest = ctx.config.dirs.slice(1).join(', ');
        io.stdout(`  note: also configured, not scanned here: ${rest} (use skilled --dir <path>)`);
      }
    }

    const groups = new Map<string, Candidate[]>();
    const searchEvents: SearchEvent[] = [];
    const claudeEvents: Array<{ kind: string }> = [];
    let searchAnnounced = false;

    const clients = deps ?? (await createDetectClients());
    const limiter = new RateLimiter({ maxPerMinute: SEARCH_LIMIT_PER_MINUTE });

    const github = throttledGitHubClient(clients.github, limiter, (event) => {
      searchEvents.push(event);
      if (json) return;
      const identifiedSoFar = alreadyTracked + groups.size;
      if (event.kind === 'search-start') {
        if (!searchAnnounced) {
          searchAnnounced = true;
          io.stdout(`  … searching GitHub for the remaining ${untracked.length - groups.size} …`);
        }
      } else if (event.kind === 'rate-limit-wait') {
        for (const line of rateLimitNotice(items.length, identifiedSoFar, event.waitMs)) {
          io.stdout(line);
        }
      } else if (event.kind === 'rate-limited') {
        for (const line of rateLimitNotice(
          items.length,
          identifiedSoFar,
          event.retryAfterSeconds * 1000,
        )) {
          io.stdout(line);
        }
      } else if (event.kind === 'no-auth') {
        io.stdout(
          '  … GitHub search unavailable: not authenticated. Run `gh auth login`, then `skilled --refresh`.',
        );
      } else {
        io.stdout(`  … GitHub search stopped: ${event.message}`);
      }
    });

    const claude = instrumentedClaudeClient(clients.claude, (event) => {
      claudeEvents.push(event);
      if (!json && event.kind === 'no-auth') {
        io.stdout('  … Claude identification unavailable: not authenticated.');
      }
    });

    const knownIndex = await loadKnownIndex(path.join(stateDir(managedDir), 'known-index.json'));

    // Provisional accept decisions, so the stream can carry a marker without
    // waiting for the whole cascade. Corrected out loud if a competitor turns up.
    const confirmEach = ctx.flags['confirm-each'] === true;
    const provisionalAuto = new Set<string>();

    for await (const candidate of detectAll(untracked, {
      github,
      claude,
      knownIndex,
      pluginCacheDir: pluginCacheDirFor(managedDir),
    })) {
      const list = groups.get(candidate.id) ?? [];
      list.push(candidate);
      groups.set(candidate.id, list);
      if (json) continue;

      if (list.length === 1) {
        const provisional = !confirmEach && shouldAutoAccept(candidate, 1, provisionalAuto);
        if (provisional) provisionalAuto.add(candidate.id);
        io.stdout(streamLine(candidate, provisional));
      } else if (provisionalAuto.delete(candidate.id)) {
        // It streamed as accepted; a second candidate makes it a question again.
        io.stdout(`  ? ${candidate.id.padEnd(ID_WIDTH)} → a second candidate turned up; I'll ask`);
      }
    }

    if (!json) {
      for (const item of [...untracked].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!groups.has(item.id)) io.stdout(`  ✗ ${item.id.padEnd(ID_WIDTH)} → no match`);
      }
      io.stdout('');
    }

    // The definitive auto-accept pass. Non-cluster ids first, so a cluster
    // candidate can inherit its anchor's decision (Task 15, rule 3).
    const autoAccepted = new Set<string>();
    if (!confirmEach) {
      const ids = [...groups.keys()].sort((a, b) => a.localeCompare(b));
      for (const pass of ['non-cluster', 'cluster'] as const) {
        for (const id of ids) {
          const list = groups.get(id);
          const first = list?.[0];
          if (list === undefined || first === undefined) continue;
          const isCluster = first.method === 'cluster';
          if ((pass === 'cluster') !== isCluster) continue;
          if (!shouldAutoAccept(first, list.length, autoAccepted)) continue;
          await persistEntry(managedDir, entryFromCandidate(first, todayIso(), 'auto'));
          autoAccepted.add(id);
          groups.delete(id);
        }
      }
    }

    if (!json) {
      io.stdout(
        `  ${autoAccepted.size} accepted automatically · ${groups.size} need your confirmation`,
      );
      io.stdout('  No skill or agent file has been modified — skilled only ever writes .skilled/.');
      io.stdout('');
    }

    if (!json && groups.size > 0) {
      if (io.interactive) {
        const decisions = await confirmCandidates(
          groups,
          { stdout: io.stdout, promptKey: io.promptKey },
          async (candidate) => {
            await persistEntry(managedDir, entryFromCandidate(candidate, todayIso(), 'user'));
          },
        );
        if (decisions.cancelled) {
          io.stdout(
            `  stopped at your request. The ${decisions.confirmed.length} you confirmed are saved; the rest are still unknown.`,
          );
        }
        io.stdout('');
      } else {
        io.stdout(
          `  ${groups.size} candidates need your confirmation. Run skilled in a terminal to review them.`,
        );
        io.stdout('');
      }
    }

    await syncUnknown(
      managedDir,
      items.map((item) => item.id),
    );

    const report = await buildStatus(managedDir, { github }, { refresh });
    await writeCachedStatus(managedDir, report);
    await writeStatusLine(managedDir, report);

    if (json) {
      io.stdout(JSON.stringify(report, null, 2));
    } else {
      io.stdout(summaryLine(report));
      io.stdout('');
      io.stdout('  Next:  skilled update        review what is behind');
      io.stdout('         skilled add <url>     tell me about the unknown ones');
      io.stdout('         skilled <name>        why it thinks that');
    }

    const degraded = searchEvents.some(
      (event) => event.kind === 'no-auth' || event.kind === 'rate-limited' || event.kind === 'error',
    );
    if (refresh && degraded) return 3;
    return report.behind > 0 ? 1 : 0;
  } catch (error) {
    throw reassure(error);
  }
}

export const scanCommand: Command = {
  name: 'scan',
  summary: 'scan the managed directory: what is tracked, what is stale, what is unknown',

  run(ctx: CommandContext): Promise<number> {
    return runScan(ctx, {
      stdout: ctx.stdout,
      promptKey,
      interactive: isInteractive(),
    });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/scan.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/scan.ts tests/commands/scan.test.ts
git commit -m "feat(cli): stream the scan, confirm candidates, and report status"
```

---

### Task 21: Command registration and CLI wiring

**Files:**
- Create: `src/commands/index.ts`
- Test: `tests/commands/index.test.ts`
- Do NOT modify: `src/cli.ts` — spec 01 already loads this module (see Step 5)

**Interfaces:**
- Consumes: `registerCommand` from `src/cli.ts`; the four command objects from Tasks 16-20.
- Produces: `registerCommands(): void`.

The two names reached without the user typing them are `'scan'` (bare `skilled`) and `'show'` (a first argument matching no command) — spec 01 § "Command registry and name resolution". Registering them replaces spec 01's minimal built-ins, because `registerCommand` overwrites by name.

Three requirements come straight from spec 01's loader (Task 18, `registerOptionalCommands`), and breaking any of them means the commands silently never register: `registerCommands` must be a **named export** of `src/commands/index.ts`, it must be **synchronous** (`() => void` — spec 01 calls it directly, it does not await it), and this module must register **nothing at module scope**. Module scope is unsafe because `commands/index.ts` imports `registerCommand` from `cli.ts`, so a top-level call would run mid-cycle against a partially initialized module.

Spec 01 already owns the extension hook — `ensureCommands()` loads this module
through a dynamic import guarded on module-not-found, so **this task writes no
`cli.ts` code at all**. Step 5 verifies that wiring is present instead of assuming it.

One consequence to respect in this spec's tests: `ensureCommands()` is idempotent and
registers once per process. A test that installs a double over a real command must
`await ensureCommands()` **before** its own `registerCommand(...)` call, or the first
`run()` will install the real command over the double.

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/index.test.ts
import { describe, expect, it } from 'vitest';
import { registerCommands } from '../../src/commands/index.js';
import { addCommand } from '../../src/commands/add.js';
import { detailCommand } from '../../src/commands/detail.js';
import { removeCommand } from '../../src/commands/remove.js';
import { scanCommand } from '../../src/commands/scan.js';

describe('registerCommands', () => {
  it('registers the four spec-02 commands without throwing, twice over', () => {
    expect(() => {
      registerCommands();
      registerCommands();
    }).not.toThrow();
  });

  it('uses the reserved names for the bare and fallback invocations', () => {
    expect(scanCommand.name).toBe('scan');
    expect(detailCommand.name).toBe('show');
    expect(addCommand.name).toBe('add');
    expect(removeCommand.name).toBe('remove');
  });

  it('gives every command a one-line summary', () => {
    for (const command of [scanCommand, detailCommand, addCommand, removeCommand]) {
      expect(command.summary.length).toBeGreaterThan(10);
      expect(command.summary).not.toContain('\n');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/index.test.ts`
Expected: FAIL with "Failed to load url ../../src/commands/index.js" (`registerCommands` is not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/index.ts
import { registerCommand } from '../cli.js';
import { addCommand } from './add.js';
import { detailCommand } from './detail.js';
import { removeCommand } from './remove.js';
import { scanCommand } from './scan.js';

/**
 * Named, synchronous, and never called at module scope — spec 01's
 * ensureCommands() imports this module and calls this function directly
 * (spec 01 Task 18, registerOptionalCommands). A top-level call would execute mid-cycle,
 * because this module imports cli.ts.
 */
export function registerCommands(): void {
  registerCommand(scanCommand);
  registerCommand(detailCommand);
  registerCommand(addCommand);
  registerCommand(removeCommand);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/index.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the wiring — do not edit `cli.ts`**

Spec 01 already loads this module: `OPTIONAL_COMMAND_MODULES` in `src/cli.ts` lists `{ specifier: './commands/index.js', registrar: 'registerCommands' }`, and `ensureCommands()` calls it before dispatch. **No edit to `cli.ts` is needed or wanted.** Confirm the wiring is present rather than assuming it:

```bash
grep -n "commands/index.js" src/cli.ts
grep -n "registerCommands" src/cli.ts
```

Expected: both match, inside `OPTIONAL_COMMAND_MODULES` / `registerOptionalCommands`. If — and only if — neither matches, spec 01 shipped differently from its Task 18; in that case add the guarded loader below inside `cli.ts`'s dispatch, after spec 01's own `registerCommand(...)` calls, keeping the array shape so spec 03 can append `./update.js`:

```ts
const OPTIONAL_COMMAND_MODULES = [
  { specifier: './commands/index.js', registrar: 'registerCommands' },
];
for (const { specifier, registrar } of OPTIONAL_COMMAND_MODULES) {
  try {
    const loaded = (await import(specifier)) as Record<string, unknown>;
    const register = loaded[registrar];
    if (typeof register === 'function') (register as () => void)();
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (
      code !== 'ERR_MODULE_NOT_FOUND' &&
      !/cannot find module|failed to load url|failed to resolve import/i.test(message)
    ) {
      throw err;
    }
  }
}
```

- [ ] **Step 6: Confirm the build is clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/commands/index.ts tests/commands/index.test.ts
git commit -m "feat(cli): register the detection commands with the CLI dispatcher"
```

---

### Task 22: Acceptance test for the spec's guarantees

**Files:**
- Test: `tests/acceptance/detection.test.ts`

**Interfaces:**
- Consumes: everything above. Adds no production code.

This is the executable form of the Definition of Done. It proves the two acceptance criteria the design's Verification section names for detection, plus the three trust guarantees: no managed file is written, an **inference** is never tracked without a keypress, and an **assertion** is auto-accepted and honestly labelled `'auto'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/acceptance/detection.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { detectAll } from '../../src/detect/index.js';
import { emptyKnownIndex } from '../../src/detect/known-index.js';
import { discover } from '../../src/discover.js';
import { runScan } from '../../src/commands/scan.js';
import { readManifest } from '../../src/manifest.js';
import { cleanupTempDir, makeTempManagedDir } from '../helpers/managed-dir.js';
import { makeContext } from '../helpers/context.js';
import { fakeClaude, fakeGitHub } from '../helpers/fakes.js';
import type { Candidate, RepoMeta } from '../../src/types.js';

const META: RepoMeta = { createdAt: '2026-01-05', stars: 42, pushedAt: '2026-08-01' };

describe('spec 02 acceptance', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempManagedDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it('criterion 1: inline-url finds the "Adapted from" source with zero network calls', async () => {
    const github = fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META });
    const claude = fakeClaude({ identify: async () => null });
    const items = await discover(dir);

    const found: Candidate[] = [];
    for await (const candidate of detectAll(items, {
      github,
      claude,
      knownIndex: emptyKnownIndex(),
      pluginCacheDir: `${dir}/plugins`,
    })) {
      found.push(candidate);
      if (candidate.id === 'agents/ponytail.md') break;
    }

    const ponytail = found.find((candidate) => candidate.id === 'agents/ponytail.md');
    expect(ponytail?.source.repo).toBe('DietrichGebert/ponytail');
    expect(ponytail?.method).toBe('inline-url');
    expect(ponytail?.evidence).toContain('line 13');
    expect(github.calls).toEqual([]);
    expect(claude.calls).toEqual([]);
  });

  it('criterion 2: the multi-file skill family resolves from a single lookup', async () => {
    const queries: string[] = [];
    const github = fakeGitHub({
      searchCode: async (query) => {
        queries.push(query);
        return query.includes('headline variants')
          ? [{ repo: 'growth/skills', path: 'skills/marketing-ads/SKILL.md' }]
          : [];
      },
      getRepoMeta: async () => META,
    });
    const claude = fakeClaude({ identify: async () => null });
    const items = await discover(dir);

    const byId = new Map<string, Candidate>();
    for await (const candidate of detectAll(items, {
      github,
      claude,
      knownIndex: emptyKnownIndex(),
      pluginCacheDir: `${dir}/plugins`,
    })) {
      if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }

    const family = ['skills/marketing-ads', 'skills/marketing-brand', 'skills/marketing-seo'];
    expect(family.every((id) => byId.has(id))).toBe(true);
    expect(byId.get('skills/marketing-ads')?.method).toBe('code-search');
    expect(byId.get('skills/marketing-brand')?.method).toBe('cluster');
    expect(byId.get('skills/marketing-seo')?.method).toBe('cluster');
    // one lookup for the whole family
    expect(queries.filter((query) => query.includes('headline variants'))).toHaveLength(1);
    expect(queries.some((query) => query.includes('brand as a person'))).toBe(false);
    expect(queries.some((query) => query.includes('intent behind them'))).toBe(false);
  });

  it('criterion 3: a full scan writes nothing outside .skilled/', async () => {
    const before = new Map<string, string>();
    for (const relpath of [
      'agents/ponytail.md',
      'agents/thomas.md',
      'skills/cso/SKILL.md',
      'skills/explain-code/SKILL.md',
      'skills/marketing-ads/SKILL.md',
      'skills/marketing-ads/references/tone.md',
      'skills/marketing-brand/SKILL.md',
      'skills/marketing-seo/SKILL.md',
      'skills/qa-only/SKILL.md',
    ]) {
      before.set(relpath, await fs.readFile(`${dir}/${relpath}`, 'utf8'));
    }

    const ctx = makeContext(dir, []);
    await runScan(
      ctx,
      { stdout: ctx.stdout, interactive: false, promptKey: async () => 's' },
      {
        github: fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META }),
        claude: fakeClaude({ identify: async () => null }),
      },
    );

    for (const [relpath, text] of before) {
      expect(await fs.readFile(`${dir}/${relpath}`, 'utf8')).toBe(text);
    }
    const entries = (await fs.readdir(dir)).sort();
    expect(entries).toEqual(['.skilled', 'agents', 'skills']);
  });

  it('criterion 4: an inference is never tracked without a confirmation', async () => {
    // cso can only be resolved by code search, which is an inference and must
    // therefore always be asked about, whatever its score
    const deps = {
      github: fakeGitHub({
        searchCode: async (query) =>
          query.includes('blast radius')
            ? [{ repo: 'origin/repo', path: 'skills/cso/SKILL.md' }]
            : [],
        getRepoMeta: async () => META,
        listCommits: async () => [],
      }),
      claude: fakeClaude({ identify: async () => null }),
    };

    // non-interactive: the inference is reported, never persisted
    const first = makeContext(dir, []);
    await runScan(
      first,
      { stdout: first.stdout, interactive: false, promptKey: async () => 'y' },
      deps,
    );
    let ids = (await readManifest(dir)).entries.map((entry) => entry.id);
    expect(ids).not.toContain('skills/cso');

    // interactive, user says no: still not persisted
    const second = makeContext(dir, []);
    await runScan(
      second,
      { stdout: second.stdout, interactive: true, promptKey: async () => 'n' },
      deps,
    );
    ids = (await readManifest(dir)).entries.map((entry) => entry.id);
    expect(ids).not.toContain('skills/cso');

    // interactive, user says yes: persisted, and attributed to the user
    const third = makeContext(dir, []);
    await runScan(
      third,
      { stdout: third.stdout, interactive: true, promptKey: async () => 'y' },
      deps,
    );
    const cso = (await readManifest(dir)).entries.find((entry) => entry.id === 'skills/cso');
    expect(cso?.source.repo).toBe('origin/repo');
    expect(cso?.detection.confirmedBy).toBe('user');
  });

  it('criterion 5: an assertion is auto-accepted and recorded as auto', async () => {
    const deps = {
      github: fakeGitHub({ searchCode: async () => [], getRepoMeta: async () => META }),
      claude: fakeClaude({ identify: async () => null }),
    };
    const ctx = makeContext(dir, []);

    // non-interactive and never prompted: auto-accept is not a prompt
    await runScan(ctx, { stdout: ctx.stdout, interactive: false, promptKey: async () => 'n' }, deps);

    const manifest = await readManifest(dir);
    const ponytail = manifest.entries.find((entry) => entry.id === 'agents/ponytail.md');
    expect(ponytail?.source.repo).toBe('DietrichGebert/ponytail');
    expect(ponytail?.detection.method).toBe('inline-url');
    expect(ponytail?.detection.confirmedBy).toBe('auto');
    expect(manifest.entries.every((entry) => entry.detection.confirmedBy !== null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/acceptance/detection.test.ts`
Expected: FAIL — this test only passes once Tasks 1-21 are complete. If any criterion fails, fix the implementation, not the test.

- [ ] **Step 3: Make it pass**

No new production code should be required. If a criterion fails, the defect is in one of Tasks 3-20; fix it there and re-run that task's test as well.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, every test file green.

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance/detection.test.ts
git commit -m "test(detect): assert the spec 02 acceptance criteria end to end"
```

---

## Definition of Done

Every command below must pass, in order, from the repository root.

**1. The whole suite is green.**

```bash
npm test
```

Expected: all test files pass. 22 tasks' worth of tests, no skips, no `.only`.

**2. Types are clean.**

```bash
npx tsc --noEmit
```

Expected: no output.

**3. The commands actually reach the dispatcher.**

```bash
grep -n "commands/index.js" src/cli.ts
```

Expected: a match inside spec 01's `OPTIONAL_COMMAND_MODULES`. Spec 02 registers `'scan'`, `'show'`, `add`, and `remove`; if this grep is empty, none of them are reachable and every check below that runs the binary will fail with "unknown command". No edit to `cli.ts` should be needed — see Task 21, Step 5.

**4. Detection accuracy — the design's Verification criterion 1.**

```bash
npx vitest run tests/acceptance/detection.test.ts
```

Expected: PASS, 5 tests. Specifically:
- `inline-url` finds `DietrichGebert/ponytail` from `agents/ponytail.md` line 13, and `github.calls` is `[]` — **zero network calls**.
- `inline-url` finds `anthropics/claude-plugins-official` with subpath `plugins/code-review/skills/explain-code` from the `/tree/` URL.
- The `marketing-*` family resolves from **one** `searchCode` call: `marketing-ads` via `code-search`, `marketing-brand` and `marketing-seo` via `cluster`, and no query is ever issued for the two siblings.
- `skills/cso`, which only code search can resolve, is never persisted without a keypress — not even non-interactively with a fake that would answer yes.
- `agents/ponytail.md`, an assertion at 0.95, **is** persisted without a keypress, and records `confirmedBy: 'auto'` rather than pretending a user answered.

**5. Streaming — free results before any socket.**

```bash
npx vitest run tests/detect/index.test.ts -t 'yields the free inline-url hit before touching the network'
```

Expected: PASS. The first candidate arrives with `github.calls` empty.

**6. Graceful degradation with no auth.**

```bash
npx vitest run tests/commands/scan.test.ts -t 'exits 3 when --refresh cannot reach GitHub'
```

Expected: PASS. Exit code `3`, and the output contains `not authenticated` — the run reports what it could not do instead of failing silently.

**7. Nothing written without consent — the design's Verification criterion 6.**

```bash
npx vitest run tests/acceptance/detection.test.ts -t 'writes nothing outside'
npx vitest run tests/acceptance/detection.test.ts -t 'an inference is never tracked'
npx vitest run tests/acceptance/detection.test.ts -t 'an assertion is auto-accepted'
```

Expected: PASS all three. After a full scan the managed directory contains only `.skilled`, `agents`, and `skills` and every fixture file is byte-identical; an inference (`code-search`, `claude`) reaches the manifest only after a real `y`; an assertion (`inline-url`, `plugin-cache`, `known-index` at `>= 0.95`, uncontested) reaches it without asking and is labelled `confirmedBy: 'auto'`.

**8. The commands work end to end.** After building (`npm run build`, or `npx tsc -p tsconfig.json` if spec 01 named the script differently):

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/skills/cso"
printf '%s\n' '---' 'name: cso' '---' '' 'Adapted from github.com/owner/repo.' > "$TMP/skills/cso/SKILL.md"

node dist/cli.js --dir "$TMP" --json
```

Expected: a single JSON object with `"total": 1`, `"identified": 1`, `"unknown": 0`, and no prompts. The `Adapted from` line is an uncontested `inline-url` assertion at 0.95, so it is auto-accepted even non-interactively. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" --confirm-each --json
```

Expected: identical JSON. `--confirm-each` suppresses auto-accept, but the entry is already tracked from the previous run, so it is not re-detected. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" cso
```

Expected: `github.com/owner/repo@main`, `detected by inline-url · confidence 95% · confirmed by auto`, `local edits none`. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" add https://github.com/owner/repo/tree/main/skills/cso skills/cso
```

Expected: `tracking skills/cso → github.com/owner/repo@main`, plus the line stating your file was not modified. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" cso
```

Expected: the same source, now `detected by manual · confidence 100% · confirmed by user` — the hand-registration overrides the auto-accepted guess. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" remove cso
cat "$TMP/skills/cso/SKILL.md"
```

Expected: `stopped tracking skills/cso` and `The file itself was left alone.`; the file still prints its original content. Exit code `0`.

```bash
node dist/cli.js --dir "$TMP" add "not a url"; echo "exit=$?"
```

Expected: `Not a GitHub source: "not a url"` with the accepted forms and two `→` fixes on stderr, and `exit=2`.

```bash
ls "$TMP/.skilled"; rm -rf "$TMP"
```

Expected: `cache`, `manifest.json`, `status` — and nothing else has been created anywhere.

---

## Where the contract is wrong or underspecified

Five gaps were found while writing this plan, and one more surfaced when auto-accept
landed. **The original five are now resolved in `00-CONTRACT.md`; the implementations
here stay exactly as written, so no rework follows. The sixth is still open and is
listed below.**

- **Gaps 1, 2, 4** — accepted as implemented: `KnownIndex` is defined in the contract,
  a 40-hex `Source.ref` is the sanctioned way to pin a commit, and the throttling
  decorator is the sanctioned progress channel.
- **Gap 3 — closed.** `{ commit: '', reconstructed: true }` is now the contract's
  official "origin known, BASE not yet captured" sentinel, with the rules spelled out:
  the pair is required together, `buildStatus` must report such an entry as
  `'unknown'` rather than guess, `skilled update` must reconstruct BASE before merging
  it and must not persist a reconstruction during a dry run, and `plugin-cache` is the
  one strategy that skips the sentinel because it recovers a real pinned
  `gitCommitSha`. `commit: string | null` was considered and rejected — spec 03 had
  independently converged on the same `''` sentinel and already tests it, so changing
  the type would churn three finished specs for no behavioral gain.
- **Gap 5 — closed.** `BAD_SOURCE` is the eleventh member of the `ErrorCode` union,
  exit 2, added to spec 01 Task 2 with a test. This spec's `parseSourceUrl` is the
  only caller and should raise it instead of `BAD_FLAG`.

What each gap was, for the record:

1. **`KnownIndex` was used but never defined.** `DetectDeps.knownIndex` had a type that appeared nowhere in `types.ts`. Defined here in `src/detect/known-index.ts` as `{ version: 1; entries: KnownIndexEntry[] }`, re-exported from `src/detect/index.ts`.
2. **`Candidate` could not carry a pinned commit**, though `plugin-cache` recovers one exactly from `installed_plugins.json`. The sha goes in `Source.ref`; `entryFromCandidate` promotes a 40-hex ref to `base.commit` with `reconstructed: false`.
3. **No representation existed for "origin confirmed, BASE not captured."** `{ commit: '', reconstructed: true }` is now the official sentinel.
4. **`DetectDeps` had no progress channel**, yet the design mandates exact rate-limit wording. `throttledGitHubClient` — a `GitHubClient` wrapping a `GitHubClient` — supplies one without touching the interface.
5. **No error code existed for a bad source URL.** `BAD_SOURCE` now exists; `parseSourceUrl` raises it.

**Still open, and it blocks one feature of this spec.** `--confirm-each` is ratified, but spec 01's `parseArgs` validates flags against `BOOLEAN_FLAGS = new Set(['refresh', 'json', 'no-color', 'help', 'version', 'add'])` (spec 01 Task 16) and rejects anything else with `BAD_FLAG` exit 2. Until `'confirm-each'` joins that set, `skilled --confirm-each` fails before a command runs. Spec 02 cannot fix it — `cli.ts` is spec-01-owned — and the flag is also missing from the contract's flag table. The tests here inject flags into `CommandContext` directly and pass regardless; Definition of Done step 8 is what catches it.

**One correction worth recording — read this before changing a `name:` field.**
The registry keys are **`'scan'` and `'show'`**. `RESERVED_COMMANDS` is
`['scan','show','update','add','remove','config']` — spec 01 § "Command registry and
name resolution", and `00-CONTRACT.md` § "Command names, dispatch, and how later
specs override".

This took three passes to settle, and an earlier draft of this very section asserted
the opposite. What happened: spec 01 briefly adopted magic keys `''` and `'<name>'`
after a mid-review suggestion, then reverted to the named keys it had designed
originally. Spec 02 read spec 01 *during* that window, captured the transient state,
and recorded it with line citations that were already stale by the time they were
written.

Two lessons encoded here rather than repeated: **cite section headings, not line
numbers, when referring across specs** — sibling line numbers drift on every edit.
And a wrong key fails *silently*: the command registers fine and is simply never
reached, so there is no error to trace back. Verify with the Task 21 Step 5 greps
rather than by reading a summary, including this one.

Spec 01 also owns the loader: `ensureCommands()` imports `./commands/index.js` and
calls `registerCommands` through a dynamic import guarded on module-not-found. No
hand-added `cli.ts` wiring is needed, and none should be written — `cli.ts` is
spec-01-owned.

Two smaller ambiguities were resolved by choosing, and are documented at their use sites: `StatusReport.unknown` is defined here as "rows with no source" (the design's "8 unknown origin") while the row status `'unknown'` means "cannot say whether this is current" — a row can have a source and still be `'unknown'`; and bare `skilled` scans only `config.dirs[0]`, printing a note about any other configured directory, because `--json` is specified as exactly one `StatusReport`.

**Resolved.** An earlier version of this spec followed the brief's "confirm every
candidate" literally and never wrote `confirmedBy: 'auto'`, which cost ~40 keypresses
on a 51-file directory and contradicted the design mock's already-confirmed `✓` lines.
The user ratified auto-accepting certain detections; the design mock was right. The
rule now lives in the contract, in Task 15 (`shouldAutoAccept`, the single place it is
decided), and in Task 20 (where it is applied). Applying updates is unaffected and
stays review-then-choose.

Three things had to change together for that rule to be real, and they are worth
knowing about if it is ever revised. **`entryFromCandidate` takes the confirmer as an
argument** rather than hardcoding `'user'`. **`shouldAutoAccept` needs to know which
ids were auto-accepted**, because a `cluster` candidate inherits its anchor's decision —
that is what lets the eleven `figma-*` siblings of an auto-accepted plugin-cache hit
ride along, and it is why the caller decides non-cluster candidates first. And since
`Candidate` has no anchor field, the anchor id travels in the cluster evidence line,
with `clusterAnchorId` (Task 9) parsing it back out and a round-trip test pinning the
format so the two halves cannot drift apart.














