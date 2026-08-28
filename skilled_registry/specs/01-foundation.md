# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `skilled` binary that resolves its managed directory, walks it, reports totals, and persists configuration — with every shared type, error, path helper, manifest reader, and CLI primitive that specs 02–04 build on.

**Architecture:** A single ESM TypeScript package. `types.ts` holds every shared type; `errors.ts` holds the one error class the CLI translates into exit codes; `config.ts` resolves the managed directory by a four-source precedence chain and owns every path helper; `manifest.ts` and `discover.ts` are the only modules that read the managed directory; `render/` turns data into terminal text; `cli.ts` parses flags, owns a command registry that later specs extend, and maps `SkilledError` to exit codes. Every function that touches the network or the filesystem outside the managed dir takes its collaborator (client, env, io) as a parameter, which is what makes the tests hermetic.

**Tech Stack:** Node.js ≥ 20, TypeScript 5.x (`strict`), ESM, Vitest, `zod` for schema validation, `picocolors` for color. No CLI framework, no HTTP client, no git library.

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
- **All user-facing strings** state problem, cause, and fix — via `SkilledError.format()`.
- **Every thrown error is a `SkilledError`.** A bare `throw new Error(...)` anywhere in `src/` is a defect.
- **Required reassurance:** any error raised during a scan, detect, or update states that no managed file was modified, when that is true.
- **Exit codes are fixed:** `0` success / everything current · `1` success but something is stale (bare `skilled` only) · `2` user error · `3` operational failure · `4` unresolved merge conflict.
- **Temp dirs in tests:** `fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'))`, removed in `afterEach`. Never touch the real `~/.claude` or `~/.config` in a test — inject `env` and paths instead.
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`), one per task step that says commit.
- **Registry conventions specs 02 and 03 are written against — do not change them:** commands are keyed by name (`scan`, `show`, `update`, `add`, `remove`, `config`); registering a name twice replaces the earlier command, which is how a later spec overrides one of spec 01's without editing `cli.ts`; bare `skilled` dispatches to `scan` and an unrecognized first argument dispatches to `show` with `ctx.args` unchanged; every other command receives `ctx.args` with its own name removed; and all command registration happens through function calls made inside `run()`, never as a module-level side effect. See Tasks 17–20.
- **Ownership:** this spec owns `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `src/types.ts`, `src/errors.ts`, `src/clients.ts`, `src/config.ts`, `src/manifest.ts`, `src/discover.ts`, `src/cli.ts`, `src/render/status.ts`, `src/render/prompt.ts`, `tests/fixtures/`. Do not create `src/detect/**`, `src/status.ts`, `src/fetch.ts`, `src/merge.ts`, or `src/render/diff.ts` — they belong to specs 02 and 03.

---

## File Structure

| File | Its one responsibility |
|---|---|
| `package.json` | Package identity, `skilled` bin, scripts, the four allowed dependencies |
| `tsconfig.json` | Build config: `src/` → `dist/`, strict, NodeNext ESM |
| `tsconfig.test.json` | Typecheck-only config that also covers `tests/` |
| `vitest.config.ts` | Point Vitest at `tests/**/*.test.ts` |
| `.gitignore` | Keep `node_modules/` and `dist/` out of git |
| `src/types.ts` | Every shared type, copied verbatim from the contract. No runtime code. |
| `src/errors.ts` | `ErrorCode`, `SkilledError`, and `format()` — the only error type in the codebase |
| `src/clients.ts` | `GitHubClient` / `ClaudeClient` interfaces plus null implementations that throw `NO_AUTH` |
| `src/config.ts` | Managed-directory resolution and every filesystem path helper |
| `src/manifest.ts` | Read, validate, and write `<managed-dir>/.skilled/manifest.json` |
| `src/discover.ts` | Walk a managed dir into `LocalItem[]` and read an item's file contents |
| `src/render/status.ts` | Turn items, `StatusReport`s, and `ResolvedConfig` into terminal text |
| `src/render/prompt.ts` | Single-keypress prompts, and knowing when prompting is impossible |
| `src/cli.ts` | Flag parsing, command registry, name resolution, dispatch, exit-code mapping, and the `scan` / `show` / `config` commands |
| `tests/fixtures/managed/` | A realistic read-only managed directory shared by specs 01–04 |
| `tests/fixtures/index.ts` | Fixture paths plus temp-dir and copy helpers |

---

### Task 1: Project scaffolding and shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `commitlint.config.js`, `.githooks/commit-msg`, `.gitignore`, `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SourceType`, `Source`, `BaseRecord`, `DetectionMethod`, `Detection`, `Entry`, `Manifest`, `SkilledConfig`, `ConfigOrigin`, `ResolvedConfig`, `ItemKind`, `LocalItem`, `RepoMeta`, `Candidate`, `EntryStatus`, `StatusRow`, `StatusReport`, `MergeOutcome` — all as types only, no runtime exports. Scripts `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "skilled",
  "version": "0.1.0",
  "description": "Vendoring for AI agent instructions: find where your skills came from, and keep them current.",
  "type": "module",
  "bin": {
    "skilled": "dist/cli.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "dist",
    "hooks",
    "skill"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test",
    "prepare": "git config core.hooksPath .githooks"
  },
  "dependencies": {
    "picocolors": "^1.1.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.6.1",
    "@commitlint/config-conventional": "^19.6.0",
    "@eslint/js": "^9.17.0",
    "@types/node": "^20.19.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.18.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create the TypeScript and Vitest config**

`tsconfig.json` — the build config. `rootDir: "src"` is what makes `bin` resolve to `dist/cli.js` rather than `dist/src/cli.js`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

`tsconfig.test.json` — exists only so `npm run typecheck` also covers the tests, which the build config cannot include without breaking `outDir`.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "declaration": false,
    "sourceMap": false,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 2b: Create the formatter and linter config**

`.prettierrc.json` — settings chosen to match the code style used throughout every
spec, so running `prettier --write` on spec code is a no-op rather than a reformat:

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

`.prettierignore`:

```
dist
node_modules
package-lock.json
```

`eslint.config.js` — ESLint 9 flat config. Deliberately small: type-checked rules are
not enabled, because `npm run typecheck` already covers what they would catch and the
lint run stays fast.

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The contract forbids `any` in exported signatures; make it an error, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused args prefixed with _ are intentional (interface conformance).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Every error must be a SkilledError; a bare throw is a defect per the contract.
      'no-throw-literal': 'error',
    },
  },
);
```

Prettier owns formatting and ESLint owns correctness — no `eslint-config-prettier` is
needed because none of the rules above are stylistic.

- [ ] **Step 2c: Create the commit-message linter**

This plan is built from micro commits — one per task step — so a malformed message is
a mistake that gets made often and is annoying to rewrite later. `commitlint` catches it
at commit time instead.

`commitlint.config.js`:

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The scope is the module or area: feat(config), fix(merge), test(detect).
    'scope-case': [2, 'always', 'kebab-case'],
    // Micro commits describe one action; keep the subject short enough to scan in a log.
    'header-max-length': [2, 'always', 72],
  },
};
```

`.githooks/commit-msg` — a plain git hook rather than `husky`, so there is no extra
dependency and no `node_modules` involvement in the hook path:

```sh
#!/bin/sh
npx --no-install commitlint --edit "$1"
```

The `prepare` script points git at this directory (`git config core.hooksPath .githooks`)
and runs automatically on `npm install`. The hook file must be executable:

```bash
chmod +x .githooks/commit-msg
```

`--no-install` makes the hook fail loudly if commitlint is missing rather than silently
downloading it mid-commit.

**Allowed types** come from `config-conventional`: `feat`, `fix`, `test`, `refactor`,
`docs`, `chore`, `build`, `ci`, `perf`, `revert`, `style`. Every `git commit` in every
spec already uses one of these — if a commit message in a later task fails the hook, the
message is wrong, not the rule.

- [ ] **Step 3: Initialise the repo and install dependencies**

Run:

```bash
git init
npm install
```

Expected: `node_modules/` and `package-lock.json` exist; `npx vitest --version` prints a 3.x version.

- [ ] **Step 4: Write the failing test**

`tests/types.test.ts`. The bare `import '../src/types.js'` is deliberate: a file of type-only imports is erased at transpile time and would pass without `src/types.ts` existing.

```ts
import { describe, it, expect } from 'vitest';
import '../src/types.js';
import type {
  Entry,
  LocalItem,
  Manifest,
  MergeOutcome,
  ResolvedConfig,
  StatusReport,
} from '../src/types.js';

describe('shared types', () => {
  it('describes a complete manifest entry', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.92,
        confirmedBy: 'user',
        evidence: 'matched 14 consecutive lines of SKILL.md',
      },
    };
    const manifest: Manifest = { version: 1, entries: [entry], unknown: ['skills/qa-only'] };

    expect(manifest.entries[0].id).toBe('skills/cso');
    expect(manifest.entries[0].base.commit).toHaveLength(40);
    expect(manifest.unknown).toEqual(['skills/qa-only']);
  });

  it('describes a single-file agent item', () => {
    const item: LocalItem = {
      id: 'agents/ponytail.md',
      absPath: '/tmp/skilled-x/agents/ponytail.md',
      kind: 'agent',
      files: [''],
    };

    expect(item.files).toEqual(['']);
  });

  it('describes a resolved config and a status report', () => {
    const config: ResolvedConfig = {
      dirs: ['/home/u/.claude'],
      origin: 'autodetect',
      configPath: '/home/u/.config/skilled/config.json',
      configExists: false,
    };
    const report: StatusReport = {
      dir: config.dirs[0],
      rows: [{ id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false }],
      identified: 1,
      total: 1,
      behind: 1,
      unknown: 0,
      fetchedAt: null,
    };

    expect(config.origin).toBe('autodetect');
    expect(report.rows[0].behindBy).toBe(6);
    expect(report.fetchedAt).toBeNull();
  });

  it('describes both merge outcomes', () => {
    const clean: MergeOutcome = { kind: 'clean', content: 'merged' };
    const conflict: MergeOutcome = { kind: 'conflict', content: '<<<<<<< LOCAL', conflictCount: 1 };

    expect(clean.kind).toBe('clean');
    expect(conflict.kind === 'conflict' ? conflict.conflictCount : 0).toBe(1);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL with "Failed to load ../src/types.js" (the module does not exist yet).

- [ ] **Step 6: Write the implementation**

`src/types.ts` — copied verbatim from the contract. Do not add, rename, or reorder anything in this file.

```ts
// ---------- sources & entries ----------

export type SourceType = 'github';

export interface Source {
  type: SourceType;
  /** "owner/name" */
  repo: string;
  /** branch or tag, e.g. "main" */
  ref: string;
  /** path within the repo, e.g. "skills/cso". "" means repo root. */
  subpath: string;
}

export interface BaseRecord {
  /** full 40-char commit sha */
  commit: string;
  /** ISO 8601 date, YYYY-MM-DD */
  adoptedAt: string;
  /** true when BASE was inferred after the fact rather than captured at adopt time */
  reconstructed: boolean;
}

export type DetectionMethod =
  | 'inline-url'
  | 'plugin-cache'
  | 'known-index'
  | 'code-search'
  | 'cluster'
  | 'claude'
  | 'manual';

export interface Detection {
  method: DetectionMethod;
  /** 0..1 */
  confidence: number;
  confirmedBy: 'user' | 'auto' | null;
  /** one human-readable line, e.g. "matched 14 consecutive lines of SKILL.md" */
  evidence: string;
}

export interface Entry {
  /** path relative to the managed dir, POSIX separators, e.g. "skills/cso" */
  id: string;
  source: Source;
  base: BaseRecord;
  detection: Detection;
}

export interface Manifest {
  version: 1;
  entries: Entry[];
  /** ids present on disk with no known source */
  unknown: string[];
}

// ---------- config ----------

export interface SkilledConfig {
  version: 1;
  /** absolute paths, in precedence order */
  dirs: string[];
}

export type ConfigOrigin = 'flag' | 'env' | 'file' | 'autodetect';

export interface ResolvedConfig {
  /** absolute, validated, at least one entry */
  dirs: string[];
  /** which source actually won */
  origin: ConfigOrigin;
  /** absolute path to config.json, whether or not it exists */
  configPath: string;
  configExists: boolean;
}

// ---------- local items ----------

export type ItemKind = 'skill' | 'agent';

export interface LocalItem {
  /** e.g. "skills/cso" or "agents/ponytail.md" */
  id: string;
  /** absolute path to the file or directory */
  absPath: string;
  kind: ItemKind;
  /** file paths relative to absPath; for a single-file agent this is [""] */
  files: string[];
}

// ---------- detection ----------

export interface RepoMeta {
  /** ISO 8601 date */
  createdAt: string;
  stars: number;
  /** ISO 8601 date */
  pushedAt: string;
}

export interface Candidate {
  /** the LocalItem.id this candidate is for */
  id: string;
  source: Source;
  method: DetectionMethod;
  /** 0..1 */
  confidence: number;
  evidence: string;
  repoMeta?: RepoMeta;
}

// ---------- status ----------

export type EntryStatus = 'current' | 'behind' | 'unknown' | 'unreachable';

export interface StatusRow {
  id: string;
  status: EntryStatus;
  source?: Source;
  /** commits behind upstream; only set when status === 'behind' */
  behindBy?: number;
  /** true when LOCAL differs from BASE */
  localEdits: boolean;
}

export interface StatusReport {
  /** the managed dir this report covers */
  dir: string;
  rows: StatusRow[];
  identified: number;
  total: number;
  behind: number;
  unknown: number;
  /** ISO 8601 timestamp of last successful upstream fetch; null = never */
  fetchedAt: string | null;
}

// ---------- merge ----------

export type MergeOutcome =
  | { kind: 'clean'; content: string }
  | { kind: 'conflict'; content: string; conflictCount: number };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Verify the build, typecheck, lint, and format all pass**

Run: `npm run typecheck && npm run build`
Expected: no output from either, and `dist/types.js` exists.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.test.json vitest.config.ts .prettierrc.json .prettierignore eslint.config.js commitlint.config.js .githooks/commit-msg .gitignore src/types.ts tests/types.test.ts
git commit -m "feat(types): scaffold the package and add the shared type contract"
```

---

### Task 2: The error catalogue

**Files:**
- Create: `src/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type ErrorCode = 'BAD_DIR' | 'BAD_FLAG' | 'UNKNOWN_ENTRY' | 'AMBIGUOUS_NAME' | 'NO_AUTH' | 'RATE_LIMIT' | 'UPSTREAM_GONE' | 'NETWORK' | 'MERGE_CONFLICT' | 'BAD_MANIFEST' | 'BAD_SOURCE'`
  - `export class SkilledError extends Error` with `readonly code: ErrorCode`, `readonly problem: string`, `readonly cause: string`, `readonly fixes: string[]`, `readonly exitCode: 2 | 3 | 4`, `constructor(init: { code: ErrorCode; problem: string; cause: string; fixes: string[]; exitCode: 2 | 3 | 4 })`, `format(): string`

- [ ] **Step 1: Write the failing test**

`tests/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SkilledError } from '../src/errors.js';

describe('SkilledError', () => {
  const err = new SkilledError({
    code: 'BAD_DIR',
    problem: '/tmp/nope is not a managed directory.',
    cause:
      'Expected a skills/ or agents/ subdirectory. Found: notes, README.md.\nNo managed file was modified.',
    fixes: ['skilled config dir ~/.claude', 'skilled --dir <path>'],
    exitCode: 2,
  });

  it('carries the catalogue fields and behaves like an Error', () => {
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SkilledError');
    expect(err.code).toBe('BAD_DIR');
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe('/tmp/nope is not a managed directory.');
    expect(err.fixes).toEqual(['skilled config dir ~/.claude', 'skilled --dir <path>']);
  });

  it('formats problem, then cause, then fixes', () => {
    expect(err.format()).toBe(
      [
        '✗ /tmp/nope is not a managed directory.',
        '',
        '  Expected a skills/ or agents/ subdirectory. Found: notes, README.md.',
        '  No managed file was modified.',
        '',
        '  → skilled config dir ~/.claude',
        '  → skilled --dir <path>',
      ].join('\n'),
    );
  });

  it('omits the fixes block when there are none', () => {
    const bare = new SkilledError({
      code: 'NETWORK',
      problem: 'github.com is unreachable.',
      cause: 'The DNS lookup failed.',
      fixes: [],
      exitCode: 3,
    });

    expect(bare.format()).toBe(
      ['✗ github.com is unreachable.', '', '  The DNS lookup failed.'].join('\n'),
    );
  });

  it('carries BAD_SOURCE for an unparseable source URL', () => {
    const badSource = new SkilledError({
      code: 'BAD_SOURCE',
      problem: 'Cannot read a repository out of "github.com/owner".',
      cause: 'A source needs an owner and a repository name, like github.com/owner/repo.',
      fixes: ['skilled add https://github.com/owner/repo skills/cso'],
      exitCode: 2,
    });

    expect(badSource.code).toBe('BAD_SOURCE');
    expect(badSource.exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL with "Failed to load ../src/errors.js".

- [ ] **Step 3: Write the implementation**

`src/errors.ts`:

```ts
export type ErrorCode =
  | 'BAD_DIR'
  | 'BAD_FLAG'
  | 'UNKNOWN_ENTRY'
  | 'AMBIGUOUS_NAME'
  | 'NO_AUTH'
  | 'RATE_LIMIT'
  | 'UPSTREAM_GONE'
  | 'NETWORK'
  | 'MERGE_CONFLICT'
  | 'BAD_MANIFEST'
  /** exit 2; a source URL that cannot be parsed. Raised by spec 02's parseSourceUrl. */
  | 'BAD_SOURCE';

/**
 * The only error type in src/. cli.ts catches it, prints format() to stderr,
 * and exits with exitCode. A bare `throw new Error(...)` is a defect.
 */
export class SkilledError extends Error {
  readonly code: ErrorCode;
  /** what went wrong, one line */
  readonly problem: string;
  /** why, one or two lines; include the offending value */
  readonly cause: string;
  /** concrete next commands, one per line */
  readonly fixes: string[];
  readonly exitCode: 2 | 3 | 4;

  constructor(init: {
    code: ErrorCode;
    problem: string;
    cause: string;
    fixes: string[];
    exitCode: 2 | 3 | 4;
  }) {
    super(init.problem);
    this.name = 'SkilledError';
    this.code = init.code;
    this.problem = init.problem;
    this.cause = init.cause;
    this.fixes = init.fixes;
    this.exitCode = init.exitCode;
  }

  /** renders problem / cause / fixes, in that order */
  format(): string {
    const lines: string[] = [`✗ ${this.problem}`, ''];
    for (const line of this.cause.split('\n')) {
      lines.push(`  ${line}`);
    }
    if (this.fixes.length > 0) {
      lines.push('');
      for (const fix of this.fixes) {
        lines.push(`  → ${fix}`);
      }
    }
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts tests/errors.test.ts
git commit -m "feat(errors): add SkilledError with problem/cause/fixes formatting"
```

---

### Task 3: The shared test fixtures

**Files:**
- Create: `tests/fixtures/managed/skills/marketing-ads/SKILL.md`, `tests/fixtures/managed/skills/marketing-ads/references/ad-copy-patterns.md`, `tests/fixtures/managed/skills/marketing-ads/references/channel-benchmarks.md`, `tests/fixtures/managed/skills/marketing-ads/evals/basic.md`, `tests/fixtures/managed/skills/cso/SKILL.md`, `tests/fixtures/managed/skills/explain-code/SKILL.md`, `tests/fixtures/managed/skills/qa-only/SKILL.md`, `tests/fixtures/managed/agents/ponytail.md`, `tests/fixtures/managed/agents/thomas.md`, `tests/fixtures/index.ts`
- Test: `tests/fixtures.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const FIXTURE_MANAGED_DIR: string`
  - `export const FIXTURE_IDS: readonly string[]`
  - `export function makeTempDir(): Promise<string>`
  - `export function removeTempDir(dir: string): Promise<void>`
  - `export function copyDir(src: string, dest: string): Promise<void>`
  - `export function copyManagedFixture(): Promise<string>`
  - `export function makeManagedDir(subdirs?: string[]): Promise<string>`

This fixture mirrors the real `~/.claude` audited in the design doc: a multi-file skill with `references/` and `evals/`, a single-file skill carrying `allowed-tools: Bash`, a skill that names its own upstream, a skill with no provenance at all, a flat agent file with an `Adapted from github.com/...` line on line 13, and a flat agent file with no provenance. Specs 02–04 reuse it, so its shape is part of this spec's deliverable.

- [ ] **Step 1: Create the multi-file skill**

`tests/fixtures/managed/skills/marketing-ads/SKILL.md`:

```markdown
---
name: marketing-ads
description: Draft and critique paid-ad copy for a specific channel.
metadata:
  version: 2.2.0
---

# Marketing ads

Use this skill when writing or reviewing paid advertising copy.

## Workflow

1. Read `references/ad-copy-patterns.md` and pick a pattern that fits the offer.
2. Check `references/channel-benchmarks.md` for the channel's length limits.
3. Draft three variants, then score them against `evals/basic.md`.
```

`tests/fixtures/managed/skills/marketing-ads/references/ad-copy-patterns.md`:

```markdown
# Ad copy patterns

## Problem / agitate / solve

Name the reader's problem in the first six words, make it concrete, then offer
the product as the shortest path out.

## Proof first

Open with the number that is hardest to argue with, then explain it.
```

`tests/fixtures/managed/skills/marketing-ads/references/channel-benchmarks.md`:

```markdown
# Channel benchmarks

| Channel | Headline | Body | Notes |
|---|---|---|---|
| Google Search | 30 chars | 90 chars | Three headlines, two descriptions |
| Meta Feed | 40 chars | 125 chars | The first line is the only line most people read |
| LinkedIn | 70 chars | 150 chars | Job-title targeting beats interest targeting |
```

`tests/fixtures/managed/skills/marketing-ads/evals/basic.md`:

```markdown
# Basic eval

For each variant, answer yes or no:

- Does the first line name a problem the reader has?
- Is there exactly one call to action?
- Would the claim survive a screenshot on a competitor's slide?
```

- [ ] **Step 2: Create the single-file skills**

`tests/fixtures/managed/skills/cso/SKILL.md` — the capability-granting skill. The `allowed-tools: Bash` line is load-bearing for later specs; do not drop it.

```markdown
---
name: cso
description: Review a change the way a chief security officer would before it ships.
allowed-tools: Bash
---

# CSO review

Run this before shipping anything that touches auth, secrets, or user data.

## Checks

1. `git diff --stat` — how large is the blast radius?
2. Grep the diff for credentials.
3. List every new outbound network call and say who reviewed it.
4. Confirm the change is revertible in one command.

## Output

A short verdict — ship, ship with follow-up, or hold — and the single riskiest
line in the diff.
```

`tests/fixtures/managed/skills/explain-code/SKILL.md` — names its own upstream, which is what cascade strategy 1 catches.

```markdown
---
name: explain-code
description: Explain unfamiliar code at the level of detail the reader asked for.
---

# Explain code

Adapted from https://github.com/anthropics/claude-plugins-official/tree/main/skills/explain-code

Start with what the code is for, then how it works, then the edge cases. Stop at
the level the reader asked for, and say which level that was.
```

`tests/fixtures/managed/skills/qa-only/SKILL.md` — no provenance anywhere, the "no match" case.

```markdown
---
name: qa-only
description: Answer strictly from the provided context and say so when it is not enough.
---

# QA only

Answer only from the supplied context. If the context does not contain the
answer, say "not in the provided context" and stop.
```

- [ ] **Step 3: Create the flat agent files**

`tests/fixtures/managed/agents/ponytail.md` — the `Adapted from` line must land on line 13, mirroring `agents/ponytail.md:13` in the audited directory. Count the lines after writing.

```markdown
---
name: ponytail
description: Find the loose ends in a pull request before a human reviewer does.
---

# Ponytail

You review pull requests for loose ends: dead code, a renamed function whose
callers were missed, a test that asserts nothing, a TODO with no owner.

Report each finding as `file:line — what is loose — what closes it`.

Adapted from github.com/DietrichGebert/ponytail.
```

`tests/fixtures/managed/agents/thomas.md`:

```markdown
---
name: thomas
description: Turn a rambling meeting transcript into decisions, owners, and dates.
---

# Thomas

Read the transcript and produce three lists: decisions made, open questions, and
action items with an owner and a date. Quote the transcript for each decision.
Leave out everything else.
```

- [ ] **Step 4: Write the failing test**

`tests/fixtures.test.ts`:

```ts
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

    const cso = await fs.readFile(path.join(FIXTURE_MANAGED_DIR, 'skills', 'cso', 'SKILL.md'), 'utf8');
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run tests/fixtures.test.ts`
Expected: FAIL with "Failed to load ./fixtures/index.js".

- [ ] **Step 6: Write the implementation**

`tests/fixtures/index.ts`. `copyDir` is hand-rolled rather than `fs.cp` so it runs without an experimental-API warning on Node 20.

```ts
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/fixtures.test.ts`
Expected: PASS, 6 tests. If the ponytail assertion fails, count the lines in `agents/ponytail.md` — the provenance line must be the 13th.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures
git commit -m "test(fixtures): add the shared managed-directory fixture"
```

---

### Task 4: Client interfaces and null implementations

**Files:**
- Create: `src/clients.ts`
- Test: `tests/clients.test.ts`

**Interfaces:**
- Consumes: `SkilledError` from `src/errors.js`; `RepoMeta`, `Source` from `src/types.js`.
- Produces:
  - `export interface GitHubClient` with `searchCode(query: string): Promise<Array<{ repo: string; path: string }>>`, `getRepoMeta(repo: string): Promise<RepoMeta>`, `listCommits(source: Source, sinceSha?: string): Promise<Array<{ sha: string; date: string; message: string }>>`, `readTree(source: Source, sha: string): Promise<Map<string, string>>`
  - `export interface ClaudeClient` with `identify(excerpt: string): Promise<string | null>`, `resolveConflict(args: { base: string; local: string; upstream: string; conflicted: string }): Promise<string | null>`
  - `export function nullGitHubClient(): GitHubClient`
  - `export function nullClaudeClient(): ClaudeClient`

- [ ] **Step 1: Write the failing test**

`tests/clients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SkilledError } from '../src/errors.js';
import { nullClaudeClient, nullGitHubClient } from '../src/clients.js';
import type { Source } from '../src/types.js';

const source: Source = { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' };

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected the call to reject');
}

describe('nullGitHubClient', () => {
  const github = nullGitHubClient();

  it('rejects every method with NO_AUTH and exit code 3', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => github.searchCode('needle'),
      () => github.getRepoMeta('owner/repo'),
      () => github.listCommits(source),
      () => github.readTree(source, 'a'.repeat(40)),
    ];

    for (const call of calls) {
      const err = await captureError(call);
      expect(err.code).toBe('NO_AUTH');
      expect(err.exitCode).toBe(3);
      expect(err.cause).toContain('No managed file was modified.');
    }
  });

  it('names the operation it could not perform', async () => {
    const err = await captureError(() => github.searchCode('needle'));
    expect(err.problem).toContain('search GitHub code');
    expect(err.fixes.join('\n')).toContain('gh auth login');
  });
});

describe('nullClaudeClient', () => {
  const claude = nullClaudeClient();

  it('rejects every method with NO_AUTH and exit code 3', async () => {
    const identifyError = await captureError(() => claude.identify('an excerpt'));
    expect(identifyError.code).toBe('NO_AUTH');
    expect(identifyError.exitCode).toBe(3);
    expect(identifyError.problem).toContain('identify content with Claude');

    const conflictError = await captureError(() =>
      claude.resolveConflict({ base: 'b', local: 'l', upstream: 'u', conflicted: 'c' }),
    );
    expect(conflictError.code).toBe('NO_AUTH');
    expect(conflictError.problem).toContain('resolve a conflict with Claude');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clients.test.ts`
Expected: FAIL with "Failed to load ../src/clients.js".

- [ ] **Step 3: Write the implementation**

`src/clients.ts`:

```ts
import { SkilledError } from './errors.js';
import type { RepoMeta, Source } from './types.js';

export interface GitHubClient {
  searchCode(query: string): Promise<Array<{ repo: string; path: string }>>;
  getRepoMeta(repo: string): Promise<RepoMeta>;
  listCommits(
    source: Source,
    sinceSha?: string,
  ): Promise<Array<{ sha: string; date: string; message: string }>>;
  readTree(source: Source, sha: string): Promise<Map<string, string>>; // relpath -> text
}

export interface ClaudeClient {
  /** returns "owner/name" or null when it cannot identify the content */
  identify(excerpt: string): Promise<string | null>;
  /** resolves a conflicted merge; returns merged content or null to give up */
  resolveConflict(args: {
    base: string;
    local: string;
    upstream: string;
    conflicted: string;
  }): Promise<string | null>;
}

function noGitHubAuth(operation: string): SkilledError {
  return new SkilledError({
    code: 'NO_AUTH',
    problem: `Cannot ${operation}: no GitHub credentials are available.`,
    cause:
      'skilled borrows a token from the gh CLI and no usable token was found. No managed file was modified.',
    fixes: [
      'gh auth login',
      'export GITHUB_TOKEN=<token>',
      'skilled            re-run offline; the free detection strategies still work',
    ],
    exitCode: 3,
  });
}

function noClaudeClient(operation: string): SkilledError {
  return new SkilledError({
    code: 'NO_AUTH',
    problem: `Cannot ${operation}: no Claude client is configured.`,
    cause:
      'This build has no Claude integration wired up, so it cannot ask Claude anything. No managed file was modified.',
    fixes: [
      'skilled            re-run; the deterministic strategies still work',
      'skilled <name>     see how an entry was identified without Claude',
    ],
    exitCode: 3,
  });
}

/**
 * Every method throws SkilledError NO_AUTH. Lets specs 01-02 ship before the
 * real clients exist in spec 03's fetch.ts.
 */
export function nullGitHubClient(): GitHubClient {
  return {
    async searchCode() {
      throw noGitHubAuth('search GitHub code');
    },
    async getRepoMeta() {
      throw noGitHubAuth('read GitHub repository metadata');
    },
    async listCommits() {
      throw noGitHubAuth('list upstream commits');
    },
    async readTree() {
      throw noGitHubAuth('read an upstream file tree');
    },
  };
}

export function nullClaudeClient(): ClaudeClient {
  return {
    async identify() {
      throw noClaudeClient('identify content with Claude');
    },
    async resolveConflict() {
      throw noClaudeClient('resolve a conflict with Claude');
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/clients.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/clients.ts tests/clients.test.ts
git commit -m "feat(clients): add GitHub/Claude interfaces and NO_AUTH null clients"
```

---

### Task 5: Path helpers

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.paths.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (imports `node:os`, `node:path` only).
- Produces:
  - `export function homeDir(env?: NodeJS.ProcessEnv): string`
  - `export function configPath(env?: NodeJS.ProcessEnv): string` — `~/.config/skilled/config.json`, honors `XDG_CONFIG_HOME`
  - `export function autodetectDir(env?: NodeJS.ProcessEnv): string` — `~/.claude`
  - `export function stateDir(managedDir: string): string` — `<dir>/.skilled`
  - `export function manifestPath(managedDir: string): string` — `<dir>/.skilled/manifest.json`
  - `export function basePath(managedDir: string, id: string): string` — `<dir>/.skilled/base/<id>`
  - `export function cachePath(managedDir: string): string` — `<dir>/.skilled/cache/status.json`
  - `export function statusLinePath(managedDir: string): string` — `<dir>/.skilled/status`
  - `export function expandPath(p: string, env?: NodeJS.ProcessEnv): string`

The contract declares these as no-argument or single-argument functions. The trailing `env` parameter is optional and defaults to `process.env`, so every call written against the contract still compiles; it exists only so tests never read the real environment.

- [ ] **Step 1: Write the failing test**

`tests/config.paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  autodetectDir,
  basePath,
  cachePath,
  configPath,
  expandPath,
  homeDir,
  manifestPath,
  stateDir,
  statusLinePath,
} from '../src/config.js';

describe('path helpers', () => {
  it('reads the home directory from the injected env', () => {
    expect(homeDir({ HOME: '/home/collector' })).toBe('/home/collector');
    expect(homeDir({})).toBe(os.homedir());
  });

  it('puts the config file under ~/.config by default', () => {
    expect(configPath({ HOME: '/home/collector' })).toBe(
      '/home/collector/.config/skilled/config.json',
    );
  });

  it('honors XDG_CONFIG_HOME', () => {
    expect(configPath({ HOME: '/home/collector', XDG_CONFIG_HOME: '/xdg' })).toBe(
      '/xdg/skilled/config.json',
    );
  });

  it('auto-detects ~/.claude', () => {
    expect(autodetectDir({ HOME: '/home/collector' })).toBe('/home/collector/.claude');
  });

  it('derives every state path from the managed dir', () => {
    const dir = '/managed';
    expect(stateDir(dir)).toBe(path.join('/managed', '.skilled'));
    expect(manifestPath(dir)).toBe(path.join('/managed', '.skilled', 'manifest.json'));
    expect(basePath(dir, 'skills/cso')).toBe(
      path.join('/managed', '.skilled', 'base', 'skills', 'cso'),
    );
    expect(basePath(dir, 'agents/ponytail.md')).toBe(
      path.join('/managed', '.skilled', 'base', 'agents', 'ponytail.md'),
    );
    expect(cachePath(dir)).toBe(path.join('/managed', '.skilled', 'cache', 'status.json'));
    expect(statusLinePath(dir)).toBe(path.join('/managed', '.skilled', 'status'));
  });

  it('expands a leading tilde and makes paths absolute', () => {
    const env = { HOME: '/home/collector' };
    expect(expandPath('~', env)).toBe('/home/collector');
    expect(expandPath('~/.codex', env)).toBe('/home/collector/.codex');
    expect(expandPath('/already/absolute', env)).toBe('/already/absolute');
    expect(expandPath('./relative', env)).toBe(path.resolve('./relative'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.paths.test.ts`
Expected: FAIL with "Failed to load ../src/config.js".

- [ ] **Step 3: Write the implementation**

`src/config.ts` — first version. Later tasks append to this file; keep these exports at the top.

```ts
import os from 'node:os';
import path from 'node:path';

/** Home directory, from the injected env when present so tests stay hermetic. */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  return home !== undefined && home.length > 0 ? home : os.homedir();
}

/** ~/.config/skilled/config.json — config lives outside the managed dir by design. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg.length > 0 ? xdg : path.join(homeDir(env), '.config');
  return path.join(base, 'skilled', 'config.json');
}

/** The directory skilled falls back to when nothing else is configured. */
export function autodetectDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(homeDir(env), '.claude');
}

export function stateDir(managedDir: string): string {
  return path.join(managedDir, '.skilled');
}

export function manifestPath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'manifest.json');
}

/** id uses POSIX separators, so split it before joining. */
export function basePath(managedDir: string, id: string): string {
  return path.join(stateDir(managedDir), 'base', ...id.split('/'));
}

export function cachePath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'cache', 'status.json');
}

export function statusLinePath(managedDir: string): string {
  return path.join(stateDir(managedDir), 'status');
}

/** Expands a leading `~` and resolves to an absolute path. */
export function expandPath(p: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = homeDir(env);
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return path.resolve(p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.paths.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.paths.test.ts
git commit -m "feat(config): resolve every state and config path from one place"
```

---

### Task 6: Managed-directory validation

**Files:**
- Modify: `src/config.ts` (append; do not touch the exports from Task 5)
- Test: `tests/config.validate.test.ts`

**Interfaces:**
- Consumes: `SkilledError` from `src/errors.js`; `makeManagedDir`, `makeTempDir`, `removeTempDir` from `tests/fixtures/index.js`.
- Produces: `export function validateManagedDir(dir: string): Promise<void>` — resolves when the directory exists and contains `skills/` or `agents/`, otherwise throws `SkilledError` `BAD_DIR` with exit code 2 stating what was expected and what was found.

- [ ] **Step 1: Write the failing test**

`tests/config.validate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.validate.test.ts`
Expected: FAIL with "validateManagedDir is not a function".

- [ ] **Step 3: Write the implementation**

Add these imports to the top of `src/config.ts`:

```ts
import fs from 'node:fs/promises';
import { SkilledError } from './errors.js';
```

Append to `src/config.ts`:

```ts
/** fs.stat follows symlinks, so a symlinked skills/ still counts. */
async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A directory qualifies as managed only when it exists and contains a skills/
 * or agents/ subdirectory. Throws SkilledError BAD_DIR otherwise — never accept
 * a typo silently.
 */
export async function validateManagedDir(dir: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new SkilledError({
      code: 'BAD_DIR',
      problem: `Managed directory not found: ${dir}`,
      cause:
        'skilled needs an existing directory that contains a skills/ or agents/ subdirectory; that path does not exist.',
      fixes: [
        `mkdir -p ${path.join(dir, 'skills')}`,
        'skilled config dir <path>   point skilled somewhere else',
        'skilled config             show what is configured now',
      ],
      exitCode: 2,
    });
  }

  if (!stat.isDirectory()) {
    throw new SkilledError({
      code: 'BAD_DIR',
      problem: `Not a directory: ${dir}`,
      cause:
        'The managed directory must be a directory containing skills/ or agents/; this path is a file.',
      fixes: [
        'skilled config dir <path>   point skilled at a directory',
        'skilled config             show what is configured now',
      ],
      exitCode: 2,
    });
  }

  if ((await isDirectory(path.join(dir, 'skills'))) || (await isDirectory(path.join(dir, 'agents')))) {
    return;
  }

  const names = (await fs.readdir(dir, { withFileTypes: true }))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .sort();
  const found =
    names.length === 0
      ? '(empty)'
      : `${names.slice(0, 5).join(', ')}${names.length > 5 ? `, … (${names.length} entries)` : ''}`;

  throw new SkilledError({
    code: 'BAD_DIR',
    problem: `${dir} is not a managed directory.`,
    cause: `Expected a skills/ or agents/ subdirectory. Found: ${found}.`,
    fixes: [
      `mkdir -p ${path.join(dir, 'skills')}`,
      'skilled config dir <path>   point skilled somewhere else',
      'skilled config             show what is configured now',
    ],
    exitCode: 2,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.validate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.validate.test.ts
git commit -m "feat(config): validate a managed directory and say what was expected"
```

---

### Task 7: Managed-directory resolution

**Files:**
- Modify: `src/config.ts` (append)
- Test: `tests/config.resolve.test.ts`

**Interfaces:**
- Consumes: `validateManagedDir`, `configPath`, `autodetectDir`, `expandPath` from Tasks 5–6; `SkilledError`; `ResolvedConfig`, `SkilledConfig`, `ConfigOrigin` from `src/types.js`; `zod`.
- Produces:
  - `export interface ResolveConfigOptions { dirFlag?: string; env?: NodeJS.ProcessEnv; tolerant?: boolean }`
  - `export function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig>` — precedence `--dir` flag > `SKILLED_DIR` env > config file > autodetect `~/.claude`, with `origin` reporting which won
  - `export function readConfigFile(cfgPath: string): Promise<SkilledConfig>` — returns `{ version: 1, dirs: [] }` when absent, throws `BAD_DIR` when corrupt
  - `export function writeJsonAtomic(file: string, value: unknown): Promise<void>` — used again by `manifest.ts` in Task 10

`tolerant` is an optional addition to the contract's declared `{ dirFlag?, env? }` options object; every call written against the contract still compiles. Only `skilled config` sets it, because that command has to run even when the current setup is broken — otherwise a bad config would be unfixable. An explicit `--dir` is always validated strictly, tolerant or not.

- [ ] **Step 1: Write the failing test**

`tests/config.resolve.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configPath, readConfigFile, resolveConfig } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

/** A hermetic env: HOME and XDG_CONFIG_HOME both inside a temp dir. */
async function makeEnv(): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await makeTempDir();
  created.push(home);
  return { home, env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } };
}

async function writeConfigFile(env: NodeJS.ProcessEnv, dirs: string[]): Promise<string> {
  const file = configPath(env);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ version: 1, dirs }, null, 2)}\n`, 'utf8');
  return file;
}

async function captureError(run: () => Promise<unknown>): Promise<SkilledError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected resolveConfig to reject');
}

describe('resolveConfig precedence', () => {
  it('prefers the --dir flag over everything else', async () => {
    const { home, env } = await makeEnv();
    const flagDir = await makeManagedDir(['skills']);
    const envDir = await makeManagedDir(['skills']);
    created.push(flagDir, envDir);
    await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
    await writeConfigFile(env, [envDir]);

    const resolved = await resolveConfig({ dirFlag: flagDir, env: { ...env, SKILLED_DIR: envDir } });

    expect(resolved.dirs).toEqual([flagDir]);
    expect(resolved.origin).toBe('flag');
    expect(resolved.configPath).toBe(configPath(env));
    expect(resolved.configExists).toBe(true);
  });

  it('falls back to SKILLED_DIR', async () => {
    const { env } = await makeEnv();
    const envDir = await makeManagedDir(['agents']);
    created.push(envDir);

    const resolved = await resolveConfig({ env: { ...env, SKILLED_DIR: envDir } });

    expect(resolved.dirs).toEqual([envDir]);
    expect(resolved.origin).toBe('env');
    expect(resolved.configExists).toBe(false);
  });

  it('falls back to the config file, keeping its order', async () => {
    const { env } = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);
    await writeConfigFile(env, [first, second]);

    const resolved = await resolveConfig({ env });

    expect(resolved.dirs).toEqual([first, second]);
    expect(resolved.origin).toBe('file');
    expect(resolved.configExists).toBe(true);
  });

  it('falls back to auto-detecting ~/.claude', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });

    const resolved = await resolveConfig({ env });

    expect(resolved.dirs).toEqual([path.join(home, '.claude')]);
    expect(resolved.origin).toBe('autodetect');
    expect(resolved.configExists).toBe(false);
  });

  it('auto-detects when the config file has no dirs', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, '.claude', 'agents'), { recursive: true });
    await writeConfigFile(env, []);

    const resolved = await resolveConfig({ env });

    expect(resolved.origin).toBe('autodetect');
    expect(resolved.dirs).toEqual([path.join(home, '.claude')]);
  });

  it('expands a tilde in the env var', async () => {
    const { home, env } = await makeEnv();
    await fs.mkdir(path.join(home, 'codex', 'skills'), { recursive: true });

    const resolved = await resolveConfig({ env: { ...env, SKILLED_DIR: '~/codex' } });

    expect(resolved.dirs).toEqual([path.join(home, 'codex')]);
    expect(resolved.origin).toBe('env');
  });
});

describe('resolveConfig failure modes', () => {
  it('rejects an invalid --dir flag', async () => {
    const { env } = await makeEnv();

    const err = await captureError(() => resolveConfig({ dirFlag: '/definitely/not/here', env }));
    expect(err.code).toBe('BAD_DIR');
    expect(err.exitCode).toBe(2);
  });

  it('rejects when auto-detection finds nothing', async () => {
    const { home, env } = await makeEnv();

    const err = await captureError(() => resolveConfig({ env }));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain(path.join(home, '.claude'));
  });

  it('returns no dirs instead of throwing in tolerant mode', async () => {
    const { env } = await makeEnv();

    const resolved = await resolveConfig({ env, tolerant: true });

    expect(resolved.dirs).toEqual([]);
    expect(resolved.origin).toBe('autodetect');
  });

  it('still validates an explicit --dir in tolerant mode', async () => {
    const { env } = await makeEnv();

    const err = await captureError(() =>
      resolveConfig({ dirFlag: '/definitely/not/here', env, tolerant: true }),
    );
    expect(err.code).toBe('BAD_DIR');
  });
});

describe('readConfigFile', () => {
  it('returns an empty config when the file is absent', async () => {
    const { env } = await makeEnv();

    expect(await readConfigFile(configPath(env))).toEqual({ version: 1, dirs: [] });
  });

  it('rejects a file that is not JSON', async () => {
    const { env } = await makeEnv();
    const file = configPath(env);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json at all', 'utf8');

    const err = await captureError(() => readConfigFile(file));
    expect(err.code).toBe('BAD_DIR');
    expect(err.problem).toContain('is not valid JSON');
    expect(err.cause).toContain('No managed file was modified.');
  });

  it('names the offending field when the shape is wrong', async () => {
    const { env } = await makeEnv();
    const file = configPath(env);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 1, dirs: 'nope' }), 'utf8');

    const err = await captureError(() => readConfigFile(file));
    expect(err.code).toBe('BAD_DIR');
    expect(err.cause).toContain('dirs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.resolve.test.ts`
Expected: FAIL with "resolveConfig is not a function".

- [ ] **Step 3: Write the implementation**

Add these imports to the top of `src/config.ts`:

```ts
import { z } from 'zod';
import type { ConfigOrigin, ResolvedConfig, SkilledConfig } from './types.js';
```

Append to `src/config.ts`:

```ts
const configFileSchema = z.object({
  version: z.literal(1),
  dirs: z.array(z.string()),
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Writes JSON through a temp file so a crash cannot leave a half-written file. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function badConfigFile(cfgPath: string, problem: string, detail: string): SkilledError {
  return new SkilledError({
    code: 'BAD_DIR',
    problem,
    cause: `${detail} No managed file was modified.`,
    fixes: [
      `cat ${cfgPath}`,
      `rm ${cfgPath}   start over from auto-detection`,
      'skilled config dir <path>   rewrite it',
    ],
    exitCode: 2,
  });
}

/** Reads ~/.config/skilled/config.json. An absent file is not an error. */
export async function readConfigFile(cfgPath: string): Promise<SkilledConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(cfgPath, 'utf8');
  } catch {
    return { version: 1, dirs: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw badConfigFile(cfgPath, `${cfgPath} is not valid JSON.`, `Parsing it failed: ${message}.`);
  }

  const result = configFileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw badConfigFile(
      cfgPath,
      `${cfgPath} is not a valid skilled config.`,
      `Field \`${field}\`: ${issue.message}.`,
    );
  }

  const config: SkilledConfig = result.data;
  return config;
}

export interface ResolveConfigOptions {
  dirFlag?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * When true, a managed dir that fails validation is dropped instead of
   * throwing. Only `skilled config` sets this: it must run even when the
   * current setup is broken. An explicit dirFlag is always strict.
   */
  tolerant?: boolean;
}

async function keepValid(dirs: string[], tolerant: boolean): Promise<string[]> {
  const kept: string[] = [];
  for (const dir of dirs) {
    try {
      await validateManagedDir(dir);
      kept.push(dir);
    } catch (err) {
      if (!tolerant) throw err;
    }
  }
  return kept;
}

/**
 * Precedence, highest first: --dir flag, SKILLED_DIR, config file, ~/.claude.
 * origin reports which one actually applied, so it is never a mystery.
 */
export async function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig> {
  const env = opts.env ?? process.env;
  const tolerant = opts.tolerant === true;
  const cfgPath = configPath(env);
  const configExists = await pathExists(cfgPath);

  const finish = async (dirs: string[], origin: ConfigOrigin): Promise<ResolvedConfig> => ({
    dirs: await keepValid(dirs, tolerant),
    origin,
    configPath: cfgPath,
    configExists,
  });

  if (opts.dirFlag !== undefined && opts.dirFlag.length > 0) {
    const dir = expandPath(opts.dirFlag, env);
    await validateManagedDir(dir);
    return { dirs: [dir], origin: 'flag', configPath: cfgPath, configExists };
  }

  const envDir = env.SKILLED_DIR;
  if (envDir !== undefined && envDir.length > 0) {
    return await finish([expandPath(envDir, env)], 'env');
  }

  if (configExists) {
    const file = await readConfigFile(cfgPath);
    if (file.dirs.length > 0) {
      return await finish(
        file.dirs.map((dir) => expandPath(dir, env)),
        'file',
      );
    }
  }

  return await finish([autodetectDir(env)], 'autodetect');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.resolve.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.resolve.test.ts
git commit -m "feat(config): resolve the managed directory by precedence and report the origin"
```

---

### Task 8: Persisting the managed directory

**Files:**
- Modify: `src/config.ts` (append)
- Test: `tests/config.set.test.ts`

**Interfaces:**
- Consumes: `configPath`, `expandPath`, `validateManagedDir`, `readConfigFile`, `writeJsonAtomic` from Tasks 5–7.
- Produces: `export function setConfigDir(dir: string, mode: 'replace' | 'add', env?: NodeJS.ProcessEnv): Promise<SkilledConfig>` — validates before writing, so a typo is never saved; `replace` keeps only the new dir, `add` appends it and de-duplicates.

- [ ] **Step 1: Write the failing test**

`tests/config.set.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configPath, setConfigDir } from '../src/config.js';
import { SkilledError } from '../src/errors.js';
import { makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

async function makeEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await makeTempDir();
  created.push(home);
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
}

describe('setConfigDir', () => {
  it('writes the config file, creating the directory tree', async () => {
    const env = await makeEnv();
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    const saved = await setConfigDir(dir, 'replace', env);

    expect(saved).toEqual({ version: 1, dirs: [dir] });
    const onDisk = JSON.parse(await fs.readFile(configPath(env), 'utf8')) as unknown;
    expect(onDisk).toEqual({ version: 1, dirs: [dir] });
  });

  it('replaces the previous directory in replace mode', async () => {
    const env = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);

    await setConfigDir(first, 'replace', env);
    const saved = await setConfigDir(second, 'replace', env);

    expect(saved.dirs).toEqual([second]);
  });

  it('appends in add mode and de-duplicates', async () => {
    const env = await makeEnv();
    const first = await makeManagedDir(['skills']);
    const second = await makeManagedDir(['agents']);
    created.push(first, second);

    await setConfigDir(first, 'replace', env);
    const withSecond = await setConfigDir(second, 'add', env);
    const again = await setConfigDir(first, 'add', env);

    expect(withSecond.dirs).toEqual([first, second]);
    expect(again.dirs).toEqual([second, first]);
  });

  it('expands a tilde before saving', async () => {
    const env = await makeEnv();
    const home = env.HOME as string;
    await fs.mkdir(path.join(home, 'codex', 'skills'), { recursive: true });

    const saved = await setConfigDir('~/codex', 'replace', env);

    expect(saved.dirs).toEqual([path.join(home, 'codex')]);
  });

  it('never saves a directory that is not managed', async () => {
    const env = await makeEnv();
    const plain = await makeTempDir();
    created.push(plain);

    await expect(setConfigDir(plain, 'replace', env)).rejects.toBeInstanceOf(SkilledError);
    await expect(fs.stat(configPath(env))).rejects.toThrow();
  });

  it('leaves no temp file behind', async () => {
    const env = await makeEnv();
    const dir = await makeManagedDir(['skills']);
    created.push(dir);

    await setConfigDir(dir, 'replace', env);

    const entries = await fs.readdir(path.dirname(configPath(env)));
    expect(entries).toEqual(['config.json']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.set.test.ts`
Expected: FAIL with "setConfigDir is not a function".

- [ ] **Step 3: Write the implementation**

Append to `src/config.ts`:

```ts
/**
 * Persists which directory skilled manages. Validates first: the design says
 * say what was expected rather than accepting a typo silently.
 * The optional env parameter exists so tests never touch the real ~/.config.
 */
export async function setConfigDir(
  dir: string,
  mode: 'replace' | 'add',
  env: NodeJS.ProcessEnv = process.env,
): Promise<SkilledConfig> {
  const abs = expandPath(dir, env);
  await validateManagedDir(abs);

  const cfgPath = configPath(env);
  const current = await readConfigFile(cfgPath);
  const dirs =
    mode === 'replace'
      ? [abs]
      : [...current.dirs.map((d) => expandPath(d, env)).filter((d) => d !== abs), abs];

  const next: SkilledConfig = { version: 1, dirs };
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await writeJsonAtomic(cfgPath, next);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.set.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.set.test.ts
git commit -m "feat(config): persist the managed directory with validation"
```

---

### Task 9: Manifest pure helpers

**Files:**
- Create: `src/manifest.ts`
- Test: `tests/manifest.pure.test.ts`

**Interfaces:**
- Consumes: `Entry`, `Manifest` from `src/types.js`.
- Produces:
  - `export function findEntry(m: Manifest, id: string): Entry | undefined`
  - `export function upsertEntry(m: Manifest, e: Entry): Manifest` — pure; returns a new manifest with entries sorted by id and `e.id` removed from `unknown`
  - `export function removeEntry(m: Manifest, id: string): Manifest` — pure; returns a new manifest with the entry gone and `id` appended to `unknown` if it is not already there

The `unknown` bookkeeping is deliberate: `unknown` means "ids present on disk with no known source", so adopting an entry takes it out of that list and untracking puts it back.

- [ ] **Step 1: Write the failing test**

`tests/manifest.pure.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findEntry, removeEntry, upsertEntry } from '../src/manifest.js';
import type { Entry, Manifest } from '../src/types.js';

function makeEntry(id: string, repo = 'owner/repo'): Entry {
  return {
    id,
    source: { type: 'github', repo, ref: 'main', subpath: id },
    base: { commit: 'a'.repeat(40), adoptedAt: '2026-05-12', reconstructed: false },
    detection: {
      method: 'inline-url',
      confidence: 1,
      confirmedBy: 'auto',
      evidence: 'the file names its own upstream',
    },
  };
}

const empty: Manifest = { version: 1, entries: [], unknown: [] };

describe('findEntry', () => {
  it('finds an entry by id', () => {
    const manifest: Manifest = { version: 1, entries: [makeEntry('skills/cso')], unknown: [] };

    expect(findEntry(manifest, 'skills/cso')?.source.repo).toBe('owner/repo');
    expect(findEntry(manifest, 'skills/nope')).toBeUndefined();
  });
});

describe('upsertEntry', () => {
  it('adds an entry and keeps entries sorted by id', () => {
    const withSkill = upsertEntry(empty, makeEntry('skills/cso'));
    const withAgent = upsertEntry(withSkill, makeEntry('agents/ponytail.md'));

    expect(withAgent.entries.map((e) => e.id)).toEqual(['agents/ponytail.md', 'skills/cso']);
    expect(withAgent.version).toBe(1);
  });

  it('replaces an existing entry rather than duplicating it', () => {
    const first = upsertEntry(empty, makeEntry('skills/cso', 'owner/first'));
    const second = upsertEntry(first, makeEntry('skills/cso', 'owner/second'));

    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].source.repo).toBe('owner/second');
  });

  it('drops the id from unknown, because it now has a source', () => {
    const manifest: Manifest = { version: 1, entries: [], unknown: ['skills/cso', 'skills/retro'] };

    const next = upsertEntry(manifest, makeEntry('skills/cso'));

    expect(next.unknown).toEqual(['skills/retro']);
  });

  it('does not mutate its input', () => {
    const manifest: Manifest = { version: 1, entries: [], unknown: ['skills/cso'] };

    upsertEntry(manifest, makeEntry('skills/cso'));

    expect(manifest.entries).toEqual([]);
    expect(manifest.unknown).toEqual(['skills/cso']);
  });
});

describe('removeEntry', () => {
  it('removes the entry and records the id as unknown', () => {
    const manifest = upsertEntry(empty, makeEntry('skills/cso'));

    const next = removeEntry(manifest, 'skills/cso');

    expect(next.entries).toEqual([]);
    expect(next.unknown).toEqual(['skills/cso']);
  });

  it('is a no-op for an id it does not track', () => {
    const manifest = upsertEntry(empty, makeEntry('skills/cso'));

    const next = removeEntry(manifest, 'skills/nope');

    expect(next.entries.map((e) => e.id)).toEqual(['skills/cso']);
    expect(next.unknown).toEqual([]);
  });

  it('does not record the same unknown id twice', () => {
    const manifest: Manifest = {
      version: 1,
      entries: [makeEntry('skills/cso')],
      unknown: ['skills/cso'],
    };

    expect(removeEntry(manifest, 'skills/cso').unknown).toEqual(['skills/cso']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manifest.pure.test.ts`
Expected: FAIL with "Failed to load ../src/manifest.js".

- [ ] **Step 3: Write the implementation**

`src/manifest.ts` — first version. Task 10 appends the filesystem side.

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manifest.pure.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts tests/manifest.pure.test.ts
git commit -m "feat(manifest): add pure upsert, remove, and find helpers"
```

---

### Task 10: Reading and writing the manifest

**Files:**
- Modify: `src/manifest.ts` (append)
- Test: `tests/manifest.io.test.ts`

**Interfaces:**
- Consumes: `manifestPath`, `stateDir`, `writeJsonAtomic` from `src/config.js`; `SkilledError`; `zod`.
- Produces:
  - `export const manifestSchema` — the zod schema for a `Manifest`
  - `export function readManifest(managedDir: string): Promise<Manifest>` — returns `{ version: 1, entries: [], unknown: [] }` when the file is absent; throws `BAD_MANIFEST` naming the offending field when it is corrupt
  - `export function writeManifest(managedDir: string, m: Manifest): Promise<void>` — validates before writing, creates `<dir>/.skilled/`, writes atomically

- [ ] **Step 1: Write the failing test**

`tests/manifest.io.test.ts`:

```ts
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
      entries: [{ ...makeEntry('skills/cso'), base: { commit: 'abc123', adoptedAt: '2026-05-12', reconstructed: false } }],
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
      entries: [{ ...makeEntry('skills/cso'), detection: { method: 'telepathy', confidence: 0.5, confirmedBy: null, evidence: '' } }],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manifest.io.test.ts`
Expected: FAIL with "readManifest is not a function".

- [ ] **Step 3: Write the implementation**

Add these imports to the top of `src/manifest.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { manifestPath, writeJsonAtomic } from './config.js';
import { SkilledError } from './errors.js';
```

Append to `src/manifest.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manifest.io.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts tests/manifest.io.test.ts
git commit -m "feat(manifest): read and write a schema-validated manifest"
```

---

### Task 11: Discovering local items

**Files:**
- Create: `src/discover.ts`
- Test: `tests/discover.test.ts`

**Interfaces:**
- Consumes: `ItemKind`, `LocalItem` from `src/types.js`; `copyManagedFixture`, `FIXTURE_IDS`, `makeManagedDir`, `removeTempDir` from `tests/fixtures/index.js`.
- Produces: `export function discover(managedDir: string): Promise<LocalItem[]>` — walks `<dir>/skills/` and `<dir>/agents/`, returns items sorted by id. A directory becomes one item whose `files` lists every file inside it recursively, POSIX-relative to `absPath`; a flat `.md` file becomes one item whose `files` is `['']`. Dotfiles and dot-directories (including `.skilled/`) are ignored, and a missing `skills/` or `agents/` directory is skipped rather than an error.

- [ ] **Step 1: Write the failing test**

`tests/discover.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discover } from '../src/discover.js';
import { FIXTURE_IDS, copyManagedFixture, makeManagedDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

describe('discover', () => {
  it('finds every skill and agent in the fixture, sorted by id', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual([...FIXTURE_IDS]);
  });

  it('lists every file of a multi-file skill, relative to the item', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const marketing = items.find((item) => item.id === 'skills/marketing-ads');

    expect(marketing).toBeDefined();
    expect(marketing?.kind).toBe('skill');
    expect(marketing?.absPath).toBe(path.join(dir, 'skills', 'marketing-ads'));
    expect(marketing?.files).toEqual([
      'SKILL.md',
      'evals/basic.md',
      'references/ad-copy-patterns.md',
      'references/channel-benchmarks.md',
    ]);
  });

  it('represents a single-file skill directory as one file', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const cso = items.find((item) => item.id === 'skills/cso');

    expect(cso?.files).toEqual(['SKILL.md']);
  });

  it('represents a flat agent file with files [""]', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);

    const items = await discover(dir);
    const ponytail = items.find((item) => item.id === 'agents/ponytail.md');

    expect(ponytail?.kind).toBe('agent');
    expect(ponytail?.files).toEqual(['']);
    expect(ponytail?.absPath).toBe(path.join(dir, 'agents', 'ponytail.md'));
  });

  it('handles a flat .md file directly under skills/', async () => {
    const dir = await makeManagedDir(['skills']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'skills', 'retro.md'), '# retro\n', 'utf8');

    const items = await discover(dir);

    expect(items).toEqual([
      {
        id: 'skills/retro.md',
        absPath: path.join(dir, 'skills', 'retro.md'),
        kind: 'skill',
        files: [''],
      },
    ]);
  });

  it('ignores dotfiles, dot-directories, and skilled state', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    await fs.mkdir(path.join(dir, '.skilled', 'base'), { recursive: true });
    await fs.writeFile(path.join(dir, '.skilled', 'manifest.json'), '{}', 'utf8');
    await fs.writeFile(path.join(dir, 'skills', '.DS_Store'), 'junk', 'utf8');
    await fs.writeFile(path.join(dir, 'skills', 'cso', '.DS_Store'), 'junk', 'utf8');
    await fs.mkdir(path.join(dir, 'agents', '.cache'), { recursive: true });

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual([...FIXTURE_IDS]);
    expect(items.find((item) => item.id === 'skills/cso')?.files).toEqual(['SKILL.md']);
  });

  it('skips a missing skills/ or agents/ directory', async () => {
    const dir = await makeManagedDir(['agents']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'agents', 'thomas.md'), '# thomas\n', 'utf8');

    const items = await discover(dir);

    expect(items.map((item) => item.id)).toEqual(['agents/thomas.md']);
  });

  it('returns an empty list for a managed dir with nothing in it', async () => {
    const dir = await makeManagedDir(['skills', 'agents']);
    created.push(dir);

    expect(await discover(dir)).toEqual([]);
  });

  it('ignores non-markdown flat files', async () => {
    const dir = await makeManagedDir(['agents']);
    created.push(dir);
    await fs.writeFile(path.join(dir, 'agents', 'notes.txt'), 'not an agent\n', 'utf8');

    expect(await discover(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discover.test.ts`
Expected: FAIL with "Failed to load ../src/discover.js".

- [ ] **Step 3: Write the implementation**

`src/discover.ts` — first version. Task 12 appends `readItemContent`.

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discover.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts tests/discover.test.ts
git commit -m "feat(discover): walk a managed directory into LocalItems"
```

---

### Task 12: Reading an item's content

**Files:**
- Modify: `src/discover.ts` (append)
- Test: `tests/discover.content.test.ts`

**Interfaces:**
- Consumes: `discover` from Task 11; `SkilledError`; `LocalItem`.
- Produces: `export function readItemContent(item: LocalItem): Promise<Map<string, string>>` — maps each entry of `item.files` to its UTF-8 text. The key for a flat file is `''`, and its content comes from `item.absPath` itself. A file that cannot be read throws `SkilledError` `BAD_DIR` naming the path.

- [ ] **Step 1: Write the failing test**

`tests/discover.content.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discover.content.test.ts`
Expected: FAIL with "readItemContent is not a function".

- [ ] **Step 3: Write the implementation**

Add this import to the top of `src/discover.ts`:

```ts
import { SkilledError } from './errors.js';
```

Append to `src/discover.ts`:

```ts
/** relpath -> text. A flat file is keyed by the empty string. */
export async function readItemContent(item: LocalItem): Promise<Map<string, string>> {
  const content = new Map<string, string>();

  for (const rel of item.files) {
    const abs = rel === '' ? item.absPath : path.join(item.absPath, ...rel.split('/'));
    try {
      content.set(rel, await fs.readFile(abs, 'utf8'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SkilledError({
        code: 'BAD_DIR',
        problem: `Cannot read ${abs}`,
        cause: `It was listed while scanning ${item.id} but is not readable now: ${message}. No managed file was modified.`,
        fixes: [
          `ls -la ${item.absPath}`,
          'skilled            re-scan; the listing is rebuilt every run',
        ],
        exitCode: 2,
      });
    }
  }

  return content;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discover.content.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts tests/discover.content.test.ts
git commit -m "feat(discover): read an item's files into a relpath map"
```

---

### Task 13: Rendering a scan

**Files:**
- Create: `src/render/status.ts`
- Test: `tests/render/status.test.ts`

**Interfaces:**
- Consumes: `ConfigOrigin`, `EntryStatus`, `LocalItem`, `StatusReport`, `StatusRow` from `src/types.js`; `picocolors`.
- Produces:
  - `export interface RenderOptions { color: boolean }`
  - `export interface ItemCounts { skills: number; agents: number; total: number }`
  - `export function countItems(items: LocalItem[]): ItemCounts`
  - `export function plural(n: number, word: string, many?: string): string`
  - `export function formatCounts(counts: ItemCounts): string`
  - `export function tildify(p: string, home?: string): string`
  - `export function shortName(id: string): string`
  - `export const ORIGIN_LABELS: Record<ConfigOrigin, string>`
  - `export const STATUS_SYMBOLS: Record<EntryStatus, string>`
  - `export function renderScanHeader(dir: string, counts: ItemCounts, opts: RenderOptions): string`
  - `export function renderStatusRow(row: StatusRow, opts: RenderOptions): string`
  - `export function renderTotals(report: StatusReport, opts: RenderOptions): string`
  - `export function renderStatusReport(report: StatusReport, opts: RenderOptions): string`
  - `export function renderNextSteps(reports: StatusReport[], opts: RenderOptions): string`
  - `export function statusLineSummary(report: StatusReport): string | null` — the one line the session hook `cat`s; `null` when nothing is behind

`RenderOptions` and `ItemCounts` live here rather than in `types.ts` because `types.ts` is copied verbatim from the contract and must not grow.

- [ ] **Step 1: Write the failing test**

`tests/render/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ORIGIN_LABELS,
  countItems,
  formatCounts,
  plural,
  renderNextSteps,
  renderScanHeader,
  renderStatusReport,
  renderStatusRow,
  renderTotals,
  shortName,
  statusLineSummary,
  tildify,
} from '../../src/render/status.js';
import type { LocalItem, StatusReport, StatusRow } from '../../src/types.js';

const plain = { color: false };

const items: LocalItem[] = [
  { id: 'agents/ponytail.md', absPath: '/m/agents/ponytail.md', kind: 'agent', files: [''] },
  { id: 'agents/thomas.md', absPath: '/m/agents/thomas.md', kind: 'agent', files: [''] },
  { id: 'skills/cso', absPath: '/m/skills/cso', kind: 'skill', files: ['SKILL.md'] },
  { id: 'skills/qa-only', absPath: '/m/skills/qa-only', kind: 'skill', files: ['SKILL.md'] },
];

function report(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    dir: '/m',
    rows: [],
    identified: 0,
    total: 0,
    behind: 0,
    unknown: 0,
    fetchedAt: null,
    ...overrides,
  };
}

describe('counting and formatting', () => {
  it('counts skills and agents', () => {
    expect(countItems(items)).toEqual({ skills: 2, agents: 2, total: 4 });
    expect(countItems([])).toEqual({ skills: 0, agents: 0, total: 0 });
  });

  it('pluralises', () => {
    expect(plural(1, 'skill')).toBe('1 skill');
    expect(plural(2, 'skill')).toBe('2 skills');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('formats counts, dropping the empty half', () => {
    expect(formatCounts({ skills: 8, agents: 2, total: 10 })).toBe('8 skills, 2 agents');
    expect(formatCounts({ skills: 3, agents: 0, total: 3 })).toBe('3 skills');
    expect(formatCounts({ skills: 0, agents: 1, total: 1 })).toBe('1 agent');
    expect(formatCounts({ skills: 0, agents: 0, total: 0 })).toBe('no skills or agents');
  });

  it('shortens a path against home and an id to a name', () => {
    expect(tildify('/home/u/.claude', '/home/u')).toBe('~/.claude');
    expect(tildify('/home/u', '/home/u')).toBe('~');
    expect(tildify('/elsewhere/.claude', '/home/u')).toBe('/elsewhere/.claude');
    expect(shortName('skills/marketing-ads')).toBe('marketing-ads');
    expect(shortName('agents/ponytail.md')).toBe('ponytail');
  });

  it('labels every config origin', () => {
    expect(ORIGIN_LABELS.flag).toBe('--dir flag');
    expect(ORIGIN_LABELS.env).toBe('SKILLED_DIR env var');
    expect(ORIGIN_LABELS.file).toBe('config file');
    expect(ORIGIN_LABELS.autodetect).toBe('auto-detected');
  });
});

describe('renderScanHeader', () => {
  it('names the directory and the counts', () => {
    expect(renderScanHeader('/home/u/.claude', countItems(items), plain)).toBe(
      'Scanning /home/u/.claude … 2 skills, 2 agents',
    );
  });

  it('emits color when asked', () => {
    const colored = renderScanHeader('/m', countItems(items), { color: true });
    expect(colored).toContain('[');
  });
});

describe('renderStatusRow', () => {
  it('marks an item with no known source', () => {
    const row: StatusRow = { id: 'skills/qa-only', status: 'unknown', localEdits: false };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('?');
    expect(line).toContain('skills/qa-only');
    expect(line).toContain('no known source');
  });

  it('marks a known but unchecked item differently', () => {
    const row: StatusRow = {
      id: 'skills/cso',
      status: 'unknown',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      localEdits: false,
    };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('owner/repo');
    expect(line).toContain('not checked yet');
    expect(line).not.toContain('no known source');
  });

  it('reports how far behind an entry is, and local edits', () => {
    const row: StatusRow = {
      id: 'skills/git',
      status: 'behind',
      source: { type: 'github', repo: 'owner/git', ref: 'main', subpath: 'skills/git' },
      behindBy: 3,
      localEdits: true,
    };
    const line = renderStatusRow(row, plain);

    expect(line).toContain('3 commits behind');
    expect(line).toContain('local edits');
  });

  it('reports current and unreachable entries', () => {
    const current = renderStatusRow(
      {
        id: 'skills/retro',
        status: 'current',
        source: { type: 'github', repo: 'owner/retro', ref: 'main', subpath: '' },
        localEdits: false,
      },
      plain,
    );
    const gone = renderStatusRow(
      {
        id: 'skills/dead',
        status: 'unreachable',
        source: { type: 'github', repo: 'owner/dead', ref: 'main', subpath: '' },
        localEdits: false,
      },
      plain,
    );

    expect(current).toContain('✓');
    expect(gone).toContain('✗');
    expect(gone).toContain('upstream unreachable');
  });
});

describe('renderTotals and renderStatusReport', () => {
  it('renders the totals line', () => {
    const totals = renderTotals(
      report({ identified: 43, total: 51, behind: 12, unknown: 8 }),
      plain,
    );

    expect(totals.trim()).toBe('43 of 51 identified · 12 behind upstream · 8 unknown origin');
  });

  it('renders one line per row then the totals', () => {
    const rows: StatusRow[] = [
      { id: 'skills/cso', status: 'unknown', localEdits: false },
      { id: 'skills/qa-only', status: 'unknown', localEdits: false },
    ];
    const text = renderStatusReport(report({ rows, total: 2, unknown: 2 }), plain);
    const lines = text.split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('skills/cso');
    expect(lines[1]).toContain('skills/qa-only');
    expect(lines[2]).toBe('');
    expect(lines[3].trim()).toBe('0 of 2 identified · 0 behind upstream · 2 unknown origin');
  });
});

describe('renderNextSteps', () => {
  it('offers update only when something is behind', () => {
    const behind = renderNextSteps([report({ behind: 12, unknown: 8, total: 51 })], plain);
    expect(behind).toContain('Next:');
    expect(behind).toContain('skilled update');
    expect(behind).toContain('skilled add <url> <name>');

    const clean = renderNextSteps([report({ behind: 0, unknown: 0, total: 3 })], plain);
    expect(clean).not.toContain('skilled update');
    expect(clean).toContain('skilled config');
  });
});

describe('statusLineSummary', () => {
  it('is null when nothing is behind', () => {
    expect(statusLineSummary(report({ total: 6, unknown: 6 }))).toBeNull();
  });

  it('names the entries that are behind', () => {
    const rows: StatusRow[] = [
      { id: 'skills/cso', status: 'behind', behindBy: 6, localEdits: false },
      { id: 'skills/git', status: 'behind', behindBy: 3, localEdits: true },
      { id: 'skills/marketing-ads', status: 'behind', behindBy: 1, localEdits: false },
      { id: 'agents/ponytail.md', status: 'current', localEdits: false },
    ];

    expect(statusLineSummary(report({ rows, behind: 3, total: 4, identified: 4 }))).toBe(
      'skilled: 3 entries behind upstream (cso, git, marketing-ads) · run `skilled update`',
    );
  });

  it('caps the names it lists', () => {
    const rows: StatusRow[] = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      id: `skills/${name}`,
      status: 'behind' as const,
      behindBy: 1,
      localEdits: false,
    }));

    expect(statusLineSummary(report({ rows, behind: 5, total: 5 }))).toBe(
      'skilled: 5 entries behind upstream (a, b, c, +2 more) · run `skilled update`',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/status.test.ts`
Expected: FAIL with "Failed to load ../../src/render/status.js".

- [ ] **Step 3: Write the implementation**

`src/render/status.ts` — first version. Task 14 appends the config and detail renderers.

```ts
import os from 'node:os';
import path from 'node:path';
import pc from 'picocolors';
import type {
  ConfigOrigin,
  EntryStatus,
  LocalItem,
  StatusReport,
  StatusRow,
} from '../types.js';

export interface RenderOptions {
  color: boolean;
}

export interface ItemCounts {
  skills: number;
  agents: number;
  total: number;
}

/** picocolors with color forced on or off, so --no-color is exact, not ambient. */
function colors(opts: RenderOptions) {
  return pc.createColors(opts.color);
}
// If the typecheck reports that `createColors` is not on the default export,
// picocolors is exposing it as a named export in the installed version: switch
// to `import { createColors } from 'picocolors';` and call it directly.

export function countItems(items: LocalItem[]): ItemCounts {
  const skills = items.filter((item) => item.kind === 'skill').length;
  const agents = items.filter((item) => item.kind === 'agent').length;
  return { skills, agents, total: items.length };
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function formatCounts(counts: ItemCounts): string {
  const parts: string[] = [];
  if (counts.skills > 0) parts.push(plural(counts.skills, 'skill'));
  if (counts.agents > 0) parts.push(plural(counts.agents, 'agent'));
  return parts.length > 0 ? parts.join(', ') : 'no skills or agents';
}

export function tildify(p: string, home: string = os.homedir()): string {
  if (p === home) return '~';
  return p.startsWith(`${home}${path.sep}`) ? `~${path.sep}${p.slice(home.length + 1)}` : p;
}

/** "skills/marketing-ads" -> "marketing-ads", "agents/ponytail.md" -> "ponytail" */
export function shortName(id: string): string {
  const base = id.slice(id.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

export const ORIGIN_LABELS: Record<ConfigOrigin, string> = {
  flag: '--dir flag',
  env: 'SKILLED_DIR env var',
  file: 'config file',
  autodetect: 'auto-detected',
};

export const STATUS_SYMBOLS: Record<EntryStatus, string> = {
  current: '✓',
  behind: '↑',
  unknown: '?',
  unreachable: '✗',
};

export function renderScanHeader(dir: string, counts: ItemCounts, opts: RenderOptions): string {
  const c = colors(opts);
  return `Scanning ${c.bold(tildify(dir))} … ${formatCounts(counts)}`;
}

export function renderStatusRow(row: StatusRow, opts: RenderOptions): string {
  const c = colors(opts);
  const symbol = STATUS_SYMBOLS[row.status];
  const painted =
    row.status === 'current'
      ? c.green(symbol)
      : row.status === 'behind'
        ? c.yellow(symbol)
        : row.status === 'unreachable'
          ? c.red(symbol)
          : c.dim(symbol);

  const source = row.source === undefined ? '—' : row.source.repo;

  const detail: string[] = [];
  if (row.status === 'behind' && row.behindBy !== undefined) {
    detail.push(`${plural(row.behindBy, 'commit')} behind`);
  }
  if (row.status === 'unknown') {
    detail.push(row.source === undefined ? 'no known source' : 'not checked yet');
  }
  if (row.status === 'unreachable') detail.push('upstream unreachable');
  if (row.localEdits) detail.push('local edits');
  const tail = detail.length > 0 ? `  ${c.dim(`(${detail.join(' · ')})`)}` : '';

  return `  ${painted} ${row.id.padEnd(28)} → ${source}${tail}`;
}

export function renderTotals(report: StatusReport, opts: RenderOptions): string {
  const c = colors(opts);
  const parts = [
    `${report.identified} of ${report.total} identified`,
    `${report.behind} behind upstream`,
    `${report.unknown} unknown origin`,
  ];
  return `  ${c.bold(parts.join(' · '))}`;
}

export function renderStatusReport(report: StatusReport, opts: RenderOptions): string {
  const lines = report.rows.map((row) => renderStatusRow(row, opts));
  lines.push('');
  lines.push(renderTotals(report, opts));
  return lines.join('\n');
}

export function renderNextSteps(reports: StatusReport[], opts: RenderOptions): string {
  const c = colors(opts);
  const behind = reports.reduce((sum, report) => sum + report.behind, 0);
  const unknown = reports.reduce((sum, report) => sum + report.unknown, 0);

  const steps: Array<[string, string]> = [];
  if (behind > 0) steps.push(['skilled update', `review the ${behind} behind upstream`]);
  if (unknown > 0) {
    steps.push(['skilled add <url> <name>', `tell skilled about the ${unknown} with no known source`]);
  }
  steps.push(['skilled config', 'check which directory skilled manages']);

  return steps
    .map(([command, why], index) => {
      const lead = index === 0 ? 'Next:' : '     ';
      return `  ${lead}  ${c.bold(command.padEnd(26))}${c.dim(why)}`;
    })
    .join('\n');
}

/** The one line <managed-dir>/.skilled/status holds for the session hook. */
export function statusLineSummary(report: StatusReport): string | null {
  if (report.behind === 0) return null;
  const names = report.rows.filter((row) => row.status === 'behind').map((row) => shortName(row.id));
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? `, +${names.length - 3} more` : '';
  return `skilled: ${plural(report.behind, 'entry', 'entries')} behind upstream (${shown}${more}) · run \`skilled update\``;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/status.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/status.ts tests/render/status.test.ts
git commit -m "feat(render): render scan headers, status rows, totals, and the hook line"
```

---

### Task 14: Rendering config and entry detail

**Files:**
- Modify: `src/render/status.ts` (append)
- Test: `tests/render/config.test.ts`

**Interfaces:**
- Consumes: `RenderOptions`, `ItemCounts`, `formatCounts`, `plural`, `tildify`, `ORIGIN_LABELS` from Task 13; `Entry`, `LocalItem`, `ResolvedConfig` from `src/types.js`.
- Produces:
  - `export interface DirSummary { dir: string; counts: ItemCounts }`
  - `export function renderConfig(config: ResolvedConfig, dirs: DirSummary[], opts: RenderOptions): string`
  - `export function renderConfigSaved(dirs: DirSummary[], mode: 'replace' | 'add', configFile: string, opts: RenderOptions): string`
  - `export function renderNoManagedDirHint(autodetected: string, opts: RenderOptions): string`
  - `export function renderItemDetail(item: LocalItem, entry: Entry | undefined, opts: RenderOptions): string`

- [ ] **Step 1: Write the failing test**

`tests/render/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  renderConfig,
  renderConfigSaved,
  renderItemDetail,
  renderNoManagedDirHint,
} from '../../src/render/status.js';
import type { DirSummary } from '../../src/render/status.js';
import type { Entry, LocalItem, ResolvedConfig } from '../../src/types.js';

const plain = { color: false };

const oneDir: DirSummary[] = [
  { dir: '/home/u/.claude', counts: { skills: 34, agents: 17, total: 51 } },
];

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    dirs: ['/home/u/.claude'],
    origin: 'autodetect',
    configPath: '/home/u/.config/skilled/config.json',
    configExists: false,
    ...overrides,
  };
}

describe('renderConfig', () => {
  it('shows the directory, its counts, the config file, and which source won', () => {
    const text = renderConfig(config(), oneDir, plain);

    expect(text).toContain('managed directory');
    expect(text).toContain('/home/u/.claude');
    expect(text).toContain('(auto-detected)');
    expect(text).toContain('34 skills, 17 agents');
    expect(text).toContain('/home/u/.config/skilled/config.json');
    expect(text).toContain('(not created yet)');
  });

  it('reports the origin that actually applied', () => {
    expect(renderConfig(config({ origin: 'flag' }), oneDir, plain)).toContain('(--dir flag)');
    expect(renderConfig(config({ origin: 'env' }), oneDir, plain)).toContain(
      '(SKILLED_DIR env var)',
    );
    expect(renderConfig(config({ origin: 'file', configExists: true }), oneDir, plain)).toContain(
      '(config file)',
    );
  });

  it('says the config file is in use once it exists', () => {
    expect(renderConfig(config({ configExists: true }), oneDir, plain)).toContain('(in use)');
  });

  it('lists every managed directory', () => {
    const dirs: DirSummary[] = [
      { dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } },
      { dir: '/work/app/.claude', counts: { skills: 3, agents: 0, total: 3 } },
    ];

    const text = renderConfig(
      config({ dirs: dirs.map((d) => d.dir), origin: 'file', configExists: true }),
      dirs,
      plain,
    );

    expect(text).toContain('managed directories');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('8 skills, 2 agents');
    expect(text).toContain('/work/app/.claude');
    expect(text).toContain('3 skills');
  });

  it('says (none) when nothing is managed', () => {
    const text = renderConfig(config({ dirs: [] }), [], plain);

    expect(text).toContain('(none)');
    expect(text).toContain('(auto-detected)');
  });
});

describe('renderConfigSaved', () => {
  it('confirms a replace with the counts it found', () => {
    const text = renderConfigSaved(
      [{ dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } }],
      'replace',
      '/home/u/.config/skilled/config.json',
      plain,
    );

    expect(text).toContain('managed directory');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('✓ saved');
    expect(text).toContain('found 8 skills, 2 agents');
    expect(text).toContain('saved to /home/u/.config/skilled/config.json');
  });

  it('lists every directory after an add', () => {
    const text = renderConfigSaved(
      [
        { dir: '/home/u/.codex', counts: { skills: 8, agents: 2, total: 10 } },
        { dir: '/work/app/.claude', counts: { skills: 3, agents: 0, total: 3 } },
      ],
      'add',
      '/home/u/.config/skilled/config.json',
      plain,
    );

    expect(text).toContain('managing 2 directories:');
    expect(text).toContain('/home/u/.codex');
    expect(text).toContain('/work/app/.claude');
    expect(text).toContain('3 skills');
  });

  it('uses the singular for one directory after an add', () => {
    const text = renderConfigSaved(
      [{ dir: '/home/u/.codex', counts: { skills: 1, agents: 0, total: 1 } }],
      'add',
      '/cfg/config.json',
      plain,
    );

    expect(text).toContain('managing 1 directory:');
  });
});

describe('renderNoManagedDirHint', () => {
  it('says where it looked and how to fix it', () => {
    const text = renderNoManagedDirHint('/home/u/.claude', plain);

    expect(text).toContain('No managed directory yet.');
    expect(text).toContain('/home/u/.claude');
    expect(text).toContain('skills/ or agents/');
    expect(text).toContain('skilled config dir <path>');
  });
});

describe('renderItemDetail', () => {
  const item: LocalItem = {
    id: 'skills/cso',
    absPath: '/home/u/.claude/skills/cso',
    kind: 'skill',
    files: ['SKILL.md'],
  };

  it('describes an untracked item and how to record it', () => {
    const text = renderItemDetail(item, undefined, plain);

    expect(text).toContain('skills/cso');
    expect(text).toContain('/home/u/.claude/skills/cso');
    expect(text).toContain('skill');
    expect(text).toContain('SKILL.md');
    expect(text).toContain('unknown — not tracked yet');
    expect(text).toContain('skilled add <url> skills/cso');
  });

  it('names the flat file of a single-file item', () => {
    const agent: LocalItem = {
      id: 'agents/ponytail.md',
      absPath: '/home/u/.claude/agents/ponytail.md',
      kind: 'agent',
      files: [''],
    };

    expect(renderItemDetail(agent, undefined, plain)).toContain('ponytail.md');
  });

  it('shows source, base, and detection evidence for a tracked item', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: 'skills/cso' },
      base: { commit: 'c'.repeat(40), adoptedAt: '2026-05-12', reconstructed: true },
      detection: {
        method: 'code-search',
        confidence: 0.92,
        confirmedBy: 'user',
        evidence: 'matched 14 consecutive lines of SKILL.md',
      },
    };

    const text = renderItemDetail(item, entry, plain);

    expect(text).toContain('github.com/owner/repo (main)');
    expect(text).toContain('skills/cso');
    expect(text).toContain('ccccccc adopted 2026-05-12 (reconstructed)');
    expect(text).toContain('code-search · confidence 0.92 · user');
    expect(text).toContain('matched 14 consecutive lines of SKILL.md');
  });

  it('says unconfirmed when nothing confirmed the detection', () => {
    const entry: Entry = {
      id: 'skills/cso',
      source: { type: 'github', repo: 'owner/repo', ref: 'main', subpath: '' },
      base: { commit: 'd'.repeat(40), adoptedAt: '2026-06-01', reconstructed: false },
      detection: { method: 'cluster', confidence: 0.7, confirmedBy: null, evidence: '11 siblings' },
    };

    const text = renderItemDetail(item, entry, plain);

    expect(text).toContain('unconfirmed');
    expect(text).not.toContain('(reconstructed)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/config.test.ts`
Expected: FAIL with "renderConfig is not a function".

- [ ] **Step 3: Write the implementation**

Replace the type import at the top of `src/render/status.ts` with this one, which adds `Entry` and `ResolvedConfig`:

```ts
import type {
  ConfigOrigin,
  Entry,
  EntryStatus,
  LocalItem,
  ResolvedConfig,
  StatusReport,
  StatusRow,
} from '../types.js';
```

Then append:

```ts
export interface DirSummary {
  dir: string;
  counts: ItemCounts;
}

/** Two-column layout: a 20-character label, then the value. */
function label(text: string): string {
  return text.padEnd(20);
}

export function renderConfig(
  config: ResolvedConfig,
  dirs: DirSummary[],
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const origin = ORIGIN_LABELS[config.origin];
  const lines: string[] = [];

  if (dirs.length === 0) {
    lines.push(`${label('managed directory')}${c.dim('(none)')}  (${origin})`);
  } else {
    const heading = dirs.length === 1 ? 'managed directory' : 'managed directories';
    dirs.forEach((summary, index) => {
      const suffix = index === 0 ? `  (${origin})` : '';
      lines.push(`${label(index === 0 ? heading : '')}${c.bold(tildify(summary.dir))}${suffix}`);
      lines.push(`${label('')}${c.dim(formatCounts(summary.counts))}`);
    });
  }

  const state = config.configExists ? 'in use' : 'not created yet';
  lines.push(`${label('config file')}${tildify(config.configPath)}  (${state})`);
  return lines.join('\n');
}

export function renderConfigSaved(
  dirs: DirSummary[],
  mode: 'replace' | 'add',
  configFile: string,
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const lines: string[] = [];
  const only = dirs[0];

  if (mode === 'replace' && dirs.length === 1 && only !== undefined) {
    lines.push(`${label('managed directory')}${c.bold(tildify(only.dir))}  ${c.green('✓ saved')}`);
    lines.push(`  found ${formatCounts(only.counts)}`);
  } else {
    lines.push(`managing ${plural(dirs.length, 'directory', 'directories')}:`);
    for (const summary of dirs) {
      lines.push(`  ${tildify(summary.dir).padEnd(24)}${formatCounts(summary.counts)}`);
    }
  }

  lines.push(`  ${c.dim(`saved to ${tildify(configFile)}`)}`);
  return lines.join('\n');
}

export function renderNoManagedDirHint(autodetected: string, opts: RenderOptions): string {
  const c = colors(opts);
  return [
    '',
    `  ${c.bold('No managed directory yet.')}`,
    `  skilled looked at ${tildify(autodetected)} and found no skills/ or agents/ subdirectory.`,
    '',
    '  → skilled config dir <path>   point skilled at your instructions directory',
  ].join('\n');
}

export function renderItemDetail(
  item: LocalItem,
  entry: Entry | undefined,
  opts: RenderOptions,
): string {
  const c = colors(opts);
  const field = (text: string): string => `  ${text.padEnd(10)}`;
  const files = item.files
    .map((file) => (file === '' ? path.basename(item.absPath) : file))
    .join(', ');

  const lines: string[] = [
    c.bold(item.id),
    `${field('path')}${tildify(item.absPath)}`,
    `${field('kind')}${item.kind}`,
    `${field('files')}${files}`,
  ];

  if (entry === undefined) {
    lines.push(`${field('source')}${c.dim('unknown — not tracked yet')}`);
    lines.push('');
    lines.push(`  → skilled add <url> ${item.id}   record where this came from`);
    return lines.join('\n');
  }

  const subpath = entry.source.subpath === '' ? '' : ` · ${entry.source.subpath}`;
  const reconstructed = entry.base.reconstructed ? ' (reconstructed)' : '';
  lines.push(
    `${field('source')}github.com/${entry.source.repo} (${entry.source.ref})${subpath}`,
  );
  lines.push(
    `${field('base')}${entry.base.commit.slice(0, 7)} adopted ${entry.base.adoptedAt}${reconstructed}`,
  );
  lines.push(
    `${field('detected')}${entry.detection.method} · confidence ${entry.detection.confidence.toFixed(2)} · ${entry.detection.confirmedBy ?? 'unconfirmed'}`,
  );
  lines.push(`${field('evidence')}${entry.detection.evidence}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/config.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/status.ts tests/render/config.test.ts
git commit -m "feat(render): render config output and single-entry detail"
```

---

### Task 15: Single-keypress prompts

**Files:**
- Create: `src/render/prompt.ts`
- Test: `tests/render/prompt.test.ts`

**Interfaces:**
- Consumes: `SkilledError` from `src/errors.js`.
- Produces:
  - `export interface PromptInput`, `export interface PromptOutput`, `export interface PromptIO`
  - `export function defaultPromptIO(): PromptIO` — `{ input: process.stdin, output: process.stderr }`
  - `export function isInteractive(io?: PromptIO): boolean` — false when stdin is not a TTY
  - `export const PROMPT_CANCEL = 'cancel'`
  - `export function promptKey(message: string, keys: Array<{ key: string; label: string }>, io?: PromptIO): Promise<string>` — resolves the chosen lowercase key, or `PROMPT_CANCEL` for Ctrl-C / Escape

**Defined non-interactive behavior:** when `isInteractive()` is false, `promptKey` rejects with `SkilledError` `BAD_FLAG` (exit 2) rather than hanging or silently picking an answer. Callers in specs 02–04 must check `isInteractive()` first and choose an explicit default — for the update flow that means skipping the entry and reporting it, never applying a write. The `io` parameter is optional, so every call written against the contract's two-argument signature still compiles.

- [ ] **Step 1: Write the failing test**

`tests/render/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SkilledError } from '../../src/errors.js';
import { PROMPT_CANCEL, isInteractive, promptKey } from '../../src/render/prompt.js';
import type { PromptIO, PromptInput } from '../../src/render/prompt.js';

class FakeInput implements PromptInput {
  isTTY = true;
  raw: boolean | null = null;
  encoding: string | null = null;
  resumed = 0;
  paused = 0;
  private listeners: Array<(chunk: string) => void> = [];

  setRawMode(mode: boolean): void {
    this.raw = mode;
  }
  resume(): void {
    this.resumed += 1;
  }
  pause(): void {
    this.paused += 1;
  }
  setEncoding(encoding: string): void {
    this.encoding = encoding;
  }
  on(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners.push(listener);
  }
  removeListener(_event: 'data', listener: (chunk: string) => void): void {
    this.listeners = this.listeners.filter((existing) => existing !== listener);
  }
  send(chunk: string): void {
    for (const listener of [...this.listeners]) listener(chunk);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

function makeIO(): { input: FakeInput; written: string[]; io: PromptIO } {
  const input = new FakeInput();
  const written: string[] = [];
  return { input, written, io: { input, output: { write: (s) => written.push(s) } } };
}

const keys = [
  { key: 'a', label: 'apply' },
  { key: 's', label: 'skip' },
  { key: 'q', label: 'quit' },
];

describe('isInteractive', () => {
  it('is true only when stdin is a TTY', () => {
    const { input, io } = makeIO();
    expect(isInteractive(io)).toBe(true);

    input.isTTY = false;
    expect(isInteractive(io)).toBe(false);
  });
});

describe('promptKey', () => {
  it('prints the message and the key hints', async () => {
    const { input, written, io } = makeIO();

    const answer = promptKey('skills/cso — 6 commits behind', keys, io);
    input.send('a');

    expect(await answer).toBe('a');
    expect(written[0]).toContain('skills/cso — 6 commits behind');
    expect(written[0]).toContain('[a] apply');
    expect(written[0]).toContain('[s] skip');
  });

  it('accepts an uppercase keypress', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    input.send('S');

    expect(await answer).toBe('s');
  });

  it('ignores keys that were not offered', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    input.send('z');
    input.send('\r');
    input.send('q');

    expect(await answer).toBe('q');
  });

  // Ctrl-C is U+0003 and Escape is U+001B. Both are sent below as the raw
  // control characters they are — write them as escape sequences if you prefer:
  // '' for Ctrl-C and '' for Escape.
  it('reports Ctrl-C and Escape as a cancel', async () => {
    const ctrlC = makeIO();
    const ctrlCAnswer = promptKey('pick', keys, ctrlC.io);
    ctrlC.input.send('');
    expect(await ctrlCAnswer).toBe(PROMPT_CANCEL);

    const escape = makeIO();
    const escapeAnswer = promptKey('pick', keys, escape.io);
    escape.input.send('');
    expect(await escapeAnswer).toBe(PROMPT_CANCEL);
  });

  it('leaves the terminal as it found it', async () => {
    const { input, io } = makeIO();

    const answer = promptKey('pick', keys, io);
    expect(input.raw).toBe(true);
    expect(input.encoding).toBe('utf8');
    input.send('a');
    await answer;

    expect(input.raw).toBe(false);
    expect(input.paused).toBe(1);
    expect(input.listenerCount).toBe(0);
  });

  it('refuses to prompt when stdin is not a TTY', async () => {
    const { input, io } = makeIO();
    input.isTTY = false;

    try {
      await promptKey('pick', keys, io);
      throw new Error('expected promptKey to reject');
    } catch (err) {
      if (!(err instanceof SkilledError)) throw err;
      expect(err.code).toBe('BAD_FLAG');
      expect(err.exitCode).toBe(2);
      expect(err.cause).toContain('Nothing was written to disk.');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/prompt.test.ts`
Expected: FAIL with "Failed to load ../../src/render/prompt.js".

- [ ] **Step 3: Write the implementation**

`src/render/prompt.ts`:

```ts
import { SkilledError } from '../errors.js';

/** The slice of a readable stream a keypress prompt needs. process.stdin satisfies it. */
export interface PromptInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  setEncoding(encoding: string): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  removeListener(event: 'data', listener: (chunk: string) => void): void;
}

export interface PromptOutput {
  write(s: string): void;
}

export interface PromptIO {
  input: PromptInput;
  output: PromptOutput;
}

/** Prompts go to stderr so that --json output on stdout stays machine-readable. */
export function defaultPromptIO(): PromptIO {
  return { input: process.stdin, output: process.stderr };
}

export function isInteractive(io: PromptIO = defaultPromptIO()): boolean {
  return io.input.isTTY === true;
}

/** What promptKey resolves to when the user presses Ctrl-C or Escape. */
export const PROMPT_CANCEL = 'cancel';

/**
 * Single-keypress prompt. keys are lowercase single chars. Returns the chosen key,
 * or PROMPT_CANCEL. Non-interactive callers must check isInteractive() first and
 * pick an explicit default; this function refuses rather than guessing.
 */
export async function promptKey(
  message: string,
  keys: Array<{ key: string; label: string }>,
  io: PromptIO = defaultPromptIO(),
): Promise<string> {
  if (!isInteractive(io)) {
    throw new SkilledError({
      code: 'BAD_FLAG',
      problem: 'skilled needs an answer but the terminal is not interactive.',
      cause: `stdin is not a TTY, so "${message}" cannot be answered. Nothing was written to disk.`,
      fixes: [
        'run skilled in a terminal',
        'skilled --json     non-interactive output, no questions asked',
      ],
      exitCode: 2,
    });
  }

  const hint = keys.map((entry) => `[${entry.key}] ${entry.label}`).join('  ');
  io.output.write(`${message}\n  ${hint} `);

  const allowed = new Set(keys.map((entry) => entry.key.toLowerCase()));

  return await new Promise<string>((resolve) => {
    const finish = (value: string): void => {
      io.input.removeListener('data', onData);
      if (io.input.setRawMode !== undefined) io.input.setRawMode(false);
      io.input.pause();
      io.output.write('\n');
      resolve(value);
    };

    const onData = (chunk: string): void => {
      const text = String(chunk);
      // The two literals compared next are U+0003 (Ctrl-C) and U+001B (Escape),
      // written as raw control characters. '' and '' are equivalent.
      if (text === '' || text === '') {
        finish(PROMPT_CANCEL);
        return;
      }
      const key = text.toLowerCase();
      if (allowed.has(key)) finish(key);
      // any other key: ignore it and keep waiting
    };

    if (io.input.setRawMode !== undefined) io.input.setRawMode(true);
    io.input.setEncoding('utf8');
    io.input.resume();
    io.input.on('data', onData);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/prompt.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/prompt.ts tests/render/prompt.test.ts
git commit -m "feat(render): add a non-interactive-safe keypress prompt"
```

---

### Task 16: Flag parsing

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.flags.test.ts`

**Interfaces:**
- Consumes: `SkilledError` from `src/errors.js`.
- Produces:
  - `export interface ParsedArgs { args: string[]; flags: Record<string, string | boolean> }`
  - `export function parseArgs(argv: string[]): ParsedArgs` — the six documented flags, `--dir=<path>` and `--dir <path>` forms, `-h` / `-V` shorts, `--` terminator; anything else throws `SkilledError` `BAD_FLAG` (exit 2)
  - `export function shouldUseColor(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv, isTTY: boolean): boolean`

Flag keys are the long name without dashes: `refresh`, `json`, `dir`, `no-color`, `help`, `version`, plus `add` for `skilled config dir --add`.

- [ ] **Step 1: Write the failing test**

`tests/cli.flags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs, shouldUseColor } from '../src/cli.js';
import { SkilledError } from '../src/errors.js';

function captureError(run: () => unknown): SkilledError {
  try {
    run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected parseArgs to throw');
}

describe('parseArgs', () => {
  it('returns nothing for no arguments', () => {
    expect(parseArgs([])).toEqual({ args: [], flags: {} });
  });

  it('keeps positional arguments in order', () => {
    expect(parseArgs(['add', 'https://github.com/o/r', 'skills/cso']).args).toEqual([
      'add',
      'https://github.com/o/r',
      'skills/cso',
    ]);
  });

  it('parses the switches', () => {
    expect(parseArgs(['--refresh', '--json', '--no-color', '--confirm-each']).flags).toEqual({
      refresh: true,
      json: true,
      'no-color': true,
      'confirm-each': true,
    });
  });

  it('accepts --confirm-each, which spec 02 reads', () => {
    // Spec 02's provenance confirmation reads this flag. If it is missing from
    // BOOLEAN_FLAGS, `skilled --confirm-each` exits 2 before any command runs.
    expect(parseArgs(['--confirm-each']).flags['confirm-each']).toBe(true);
  });

  it('parses --dir in both forms', () => {
    expect(parseArgs(['--dir', '~/.codex']).flags.dir).toBe('~/.codex');
    expect(parseArgs(['--dir=~/.codex']).flags.dir).toBe('~/.codex');
  });

  it('parses the short flags', () => {
    expect(parseArgs(['-h']).flags.help).toBe(true);
    expect(parseArgs(['-V']).flags.version).toBe(true);
  });

  it('parses --add for config dir', () => {
    const parsed = parseArgs(['config', 'dir', '--add', './.claude']);

    expect(parsed.args).toEqual(['config', 'dir', './.claude']);
    expect(parsed.flags.add).toBe(true);
  });

  it('treats everything after -- as positional', () => {
    expect(parseArgs(['--', '--dir']).args).toEqual(['--dir']);
  });

  it('rejects an unknown flag', () => {
    const err = captureError(() => parseArgs(['--turbo']));

    expect(err.code).toBe('BAD_FLAG');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain('--turbo');
    expect(err.fixes.join('\n')).toContain('skilled --help');
  });

  it('rejects --dir without a value', () => {
    const err = captureError(() => parseArgs(['--dir']));

    expect(err.code).toBe('BAD_FLAG');
    expect(err.cause).toContain('needs a value');
  });

  it('rejects a value given to a switch', () => {
    const err = captureError(() => parseArgs(['--json=yes']));

    expect(err.cause).toContain('takes no value');
  });
});

describe('shouldUseColor', () => {
  it('follows the TTY by default', () => {
    expect(shouldUseColor({}, {}, true)).toBe(true);
    expect(shouldUseColor({}, {}, false)).toBe(false);
  });

  it('honors --no-color and NO_COLOR', () => {
    expect(shouldUseColor({ 'no-color': true }, {}, true)).toBe(false);
    expect(shouldUseColor({}, { NO_COLOR: '1' }, true)).toBe(false);
    expect(shouldUseColor({}, { NO_COLOR: '' }, true)).toBe(true);
  });

  it('never colors machine-readable output', () => {
    expect(shouldUseColor({ json: true }, {}, true)).toBe(false);
  });

  it('honors FORCE_COLOR when there is no TTY', () => {
    expect(shouldUseColor({}, { FORCE_COLOR: '1' }, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.flags.test.ts`
Expected: FAIL with "Failed to load ../src/cli.js".

- [ ] **Step 3: Write the implementation**

`src/cli.ts` — first version. Later tasks append to this file. The shebang must stay on line 1: `tsc` preserves it, and npm makes `dist/cli.js` executable on install.

```ts
#!/usr/bin/env node
import { SkilledError } from './errors.js';

export interface ParsedArgs {
  args: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(['refresh', 'json', 'no-color', 'confirm-each', 'help', 'version', 'add']);
const VALUE_FLAGS = new Set(['dir']);
const SHORT_FLAGS: Record<string, string> = { h: 'help', V: 'version' };

function badFlag(token: string, why: string): SkilledError {
  return new SkilledError({
    code: 'BAD_FLAG',
    problem: `Unusable flag: ${token}`,
    cause: `${why}. No managed file was modified.`,
    fixes: ['skilled --help   list every flag'],
    exitCode: 2,
  });
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (positionalOnly) {
      args.push(token);
      continue;
    }
    if (token === '--') {
      positionalOnly = true;
      continue;
    }
    if (token === '-' || !token.startsWith('-')) {
      args.push(token);
      continue;
    }

    const isLong = token.startsWith('--');
    const body = isLong ? token.slice(2) : token.slice(1);
    const eq = body.indexOf('=');
    const rawName = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);
    const name = isLong ? rawName : (SHORT_FLAGS[rawName] ?? rawName);

    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[i + 1];
      if (inlineValue === undefined) i += 1;
      if (value === undefined || value.length === 0) {
        throw badFlag(token, `--${name} needs a value, e.g. --${name} ~/.claude`);
      }
      flags[name] = value;
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw badFlag(token, `--${name} is a switch and takes no value`);
      }
      flags[name] = true;
      continue;
    }

    throw badFlag(token, `skilled has no ${token} flag`);
  }

  return { args, flags };
}

/** NO_COLOR and --json both win over a TTY; FORCE_COLOR wins over no TTY. */
export function shouldUseColor(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
): boolean {
  if (flags['no-color'] === true) return false;
  if (flags.json === true) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return true;
  return isTTY;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.flags.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.flags.test.ts
git commit -m "feat(cli): parse the documented flags and decide on color"
```

---

### Task 17: Command registry and name resolution

**Files:**
- Modify: `src/cli.ts` (append)
- Test: `tests/cli.registry.test.ts`

**Interfaces:**
- Consumes: `parseArgs` from Task 16; `SkilledError`; `LocalItem`, `ResolvedConfig` from `src/types.js`.
- Produces:
  - `export interface Command { name: string; summary: string; run(ctx: CommandContext): Promise<number> }`
  - `export interface CommandContext { args: string[]; flags: Record<string, string | boolean>; config: ResolvedConfig; stdout: (s: string) => void; stderr: (s: string) => void; env?: NodeJS.ProcessEnv }`
  - `export const RESERVED_COMMANDS: readonly string[]` — `['scan', 'show', 'update', 'add', 'remove', 'config']`
  - `export function registerCommand(c: Command): void` — registering a name twice replaces the earlier command, which is how specs 02–04 override spec 01's commands without editing `cli.ts`
  - `export function getCommand(name: string): Command | undefined`
  - `export function listCommands(): Command[]`
  - `export function resolveName(name: string, items: LocalItem[]): LocalItem`

**Every command is keyed by its name.** Two of those names are reached without the user typing them, and specs 02 and 03 are written against that:

| Name | Reached by | `ctx.args` |
|---|---|---|
| `scan` | bare `skilled` | `[]` |
| `show` | a first argument that is not a registered command name, e.g. `skilled cso` | the full positional list, unchanged |
| `update`, `add`, `remove`, `config` | the verb itself | the verb removed — `skilled add <url> skills/cso` gives `['<url>', 'skills/cso']` |

A later spec replaces one of spec 01's commands by registering the same name; the last registration wins. Known tradeoff of naming rather than using magic keys: an entry literally called `scan` or `show` is shadowed by the command, so it needs its full id (`skilled skills/scan`). That is cheap next to a registry key nobody can read.

`CommandContext.env` is an optional addition to the contract's five fields. `run()` always supplies it, and commands must use it instead of `process.env` — without it a command that writes config could not be tested without touching the real `~/.config`. Existing five-field context literals still typecheck.

**Name resolution rules:** the comparison is case-insensitive, ignores a trailing `/`, a leading `./`, and a trailing `.md`, and matches either the full id (`skills/cso`) or the last segment (`cso`, `ponytail`). No match throws `UNKNOWN_ENTRY`; more than one throws `AMBIGUOUS_NAME` listing the candidates. Both exit 2.

- [ ] **Step 1: Write the failing test**

`tests/cli.registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RESERVED_COMMANDS,
  getCommand,
  listCommands,
  registerCommand,
  resolveName,
} from '../src/cli.js';
import type { Command, CommandContext } from '../src/cli.js';
import { SkilledError } from '../src/errors.js';
import type { LocalItem } from '../src/types.js';

const items: LocalItem[] = [
  { id: 'agents/ponytail.md', absPath: '/m/agents/ponytail.md', kind: 'agent', files: [''] },
  { id: 'agents/git.md', absPath: '/m/agents/git.md', kind: 'agent', files: [''] },
  { id: 'skills/cso', absPath: '/m/skills/cso', kind: 'skill', files: ['SKILL.md'] },
  { id: 'skills/git', absPath: '/m/skills/git', kind: 'skill', files: ['SKILL.md'] },
];

function captureError(run: () => unknown): SkilledError {
  try {
    run();
  } catch (err) {
    if (err instanceof SkilledError) return err;
    throw err;
  }
  throw new Error('expected resolveName to throw');
}

const probe: Command = {
  name: 'spec01-probe',
  summary: 'a test double',
  async run(_ctx: CommandContext) {
    return 0;
  },
};

describe('command registry', () => {
  it('registers and reads back a command', () => {
    registerCommand(probe);

    expect(getCommand('spec01-probe')?.summary).toBe('a test double');
    expect(getCommand('nothing-here')).toBeUndefined();
  });

  it('replaces a command registered under the same name', () => {
    registerCommand(probe);
    registerCommand({ ...probe, summary: 'the replacement' });

    expect(getCommand('spec01-probe')?.summary).toBe('the replacement');
    expect(listCommands().filter((c) => c.name === 'spec01-probe')).toHaveLength(1);
  });

  it('lists commands sorted by name', () => {
    registerCommand(probe);
    const names = listCommands().map((command) => command.name);

    expect([...names]).toEqual([...names].sort());
  });

  it('names the whole command surface', () => {
    expect([...RESERVED_COMMANDS]).toEqual(['scan', 'show', 'update', 'add', 'remove', 'config']);
  });
});

describe('resolveName', () => {
  it('matches a full id', () => {
    expect(resolveName('skills/cso', items).id).toBe('skills/cso');
  });

  it('matches a bare basename', () => {
    expect(resolveName('cso', items).id).toBe('skills/cso');
  });

  it('matches an agent name with or without .md', () => {
    expect(resolveName('ponytail', items).id).toBe('agents/ponytail.md');
    expect(resolveName('ponytail.md', items).id).toBe('agents/ponytail.md');
    expect(resolveName('agents/ponytail.md', items).id).toBe('agents/ponytail.md');
  });

  it('ignores case, a leading ./ and a trailing /', () => {
    expect(resolveName('CSO', items).id).toBe('skills/cso');
    expect(resolveName('./skills/cso', items).id).toBe('skills/cso');
    expect(resolveName('skills/cso/', items).id).toBe('skills/cso');
  });

  it('reports an unknown name', () => {
    const err = captureError(() => resolveName('nope', items));

    expect(err.code).toBe('UNKNOWN_ENTRY');
    expect(err.exitCode).toBe(2);
    expect(err.problem).toContain('nope');
    expect(err.cause).toContain('No managed file was modified.');
  });

  it('lists the candidates for an ambiguous name', () => {
    const err = captureError(() => resolveName('git', items));

    expect(err.code).toBe('AMBIGUOUS_NAME');
    expect(err.exitCode).toBe(2);
    expect(err.cause).toContain('agents/git.md');
    expect(err.cause).toContain('skills/git');
    expect(err.fixes).toEqual(['skilled agents/git.md', 'skilled skills/git']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.registry.test.ts`
Expected: FAIL with "registerCommand is not a function".

- [ ] **Step 3: Write the implementation**

Add this import to the top of `src/cli.ts`:

```ts
import type { LocalItem, ResolvedConfig } from './types.js';
```

Append to `src/cli.ts`:

```ts
export interface Command {
  name: string;
  summary: string;
  run(ctx: CommandContext): Promise<number>; // returns exit code
}

export interface CommandContext {
  args: string[];
  flags: Record<string, string | boolean>;
  config: ResolvedConfig;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Always supplied by run(). Commands read this instead of process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The whole surface. scan backs bare `skilled`; show backs `skilled <entry>`.
 * A reserved name with no command registered is reported, not guessed at.
 */
export const RESERVED_COMMANDS: readonly string[] = [
  'scan',
  'show',
  'update',
  'add',
  'remove',
  'config',
];

const registry = new Map<string, Command>();

/** Registering a name twice replaces it: later specs override spec 01's commands. */
export function registerCommand(c: Command): void {
  registry.set(c.name, c);
}

export function getCommand(name: string): Command | undefined {
  return registry.get(name);
}

export function listCommands(): Command[] {
  return [...registry.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function normalizeName(name: string): string {
  let n = name.trim().replace(/\\/g, '/');
  while (n.endsWith('/')) n = n.slice(0, -1);
  if (n.startsWith('./')) n = n.slice(2);
  if (n.toLowerCase().endsWith('.md')) n = n.slice(0, -3);
  return n.toLowerCase();
}

/** Accepts a full id, a bare basename, or an agent filename. */
export function resolveName(name: string, items: LocalItem[]): LocalItem {
  const wanted = normalizeName(name);
  const matches = items.filter((item) => {
    const id = normalizeName(item.id);
    return id === wanted || id.slice(id.lastIndexOf('/') + 1) === wanted;
  });

  const only = matches[0];
  if (matches.length === 1 && only !== undefined) return only;

  if (matches.length === 0) {
    throw new SkilledError({
      code: 'UNKNOWN_ENTRY',
      problem: `No skill or agent named "${name}".`,
      cause: `${items.length} entries were found in the managed directory and none of them matched. No managed file was modified.`,
      fixes: [
        'skilled            list everything that was found',
        'skilled config     check which directory skilled manages',
      ],
      exitCode: 2,
    });
  }

  throw new SkilledError({
    code: 'AMBIGUOUS_NAME',
    problem: `"${name}" matches ${matches.length} entries.`,
    cause: `Candidates: ${matches.map((item) => item.id).join(', ')}. No managed file was modified.`,
    fixes: matches.map((item) => `skilled ${item.id}`),
    exitCode: 2,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.registry.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.registry.test.ts
git commit -m "feat(cli): add the command registry and name resolution"
```

---

### Task 18: Dispatch, help, version, and exit codes

**Files:**
- Modify: `src/cli.ts` (append)
- Test: `tests/cli.run.test.ts`

**Interfaces:**
- Consumes: `parseArgs`, `shouldUseColor`, `getCommand`, `registerCommand`, `RESERVED_COMMANDS`, `Command`, `CommandContext` from Tasks 16–17; `resolveConfig` from `src/config.js`; `SkilledError`.
- Produces:
  - `export interface RunIO { stdout?: (s: string) => void; stderr?: (s: string) => void; env?: NodeJS.ProcessEnv; isTTY?: boolean }`
  - `export function usage(): string`
  - `export function readVersion(): Promise<string>` — reads `version` from the package's own `package.json`
  - `export function ensureCommands(): Promise<void>` — registers every command exactly once per process; `run()` awaits it before dispatch
  - `export function run(argv: string[], io?: RunIO): Promise<number>` — never calls `process.exit`; returns the exit code so tests can assert it

**Dispatch, in order:**

1. No positional argument → `scan`.
2. A first positional that is a registered command name → that command, with `args.slice(1)`.
3. A first positional that is a reserved name with no command registered → `SkilledError` `BAD_FLAG` (exit 2) saying it is not available in this build. Without this branch, `skilled update` before spec 03 lands would be misread as an entry name and produce "no skill or agent named update".
4. Anything else → `show`, with `args` unchanged.

**Registration is a function call from inside `run()`, never a module-level side effect.** `commands/index.ts` (spec 02) and `update.ts` (spec 03) import `registerCommand` from `cli.ts`, so a top-level call in those modules would execute against a partially initialised `cli.ts` and hit a temporal-dead-zone error. `ensureCommands()` registers spec 01's built-ins first, then calls the sibling registrars, so a later spec's command of the same name wins.

The sibling modules load through a **dynamic import guarded on "module not found"** — Node's `ERR_MODULE_NOT_FOUND` and Vitest's message form, since Vite's module runner does not set that code — so spec 01 builds and tests green on its own. Any other import failure propagates rather than being swallowed, so a syntax error in a sibling module is not hidden. The specifiers are held in a `string`-typed array so `tsc` does not try to resolve modules that do not exist yet. Specs 02 and 03 may also describe this wiring in their own tasks; the code is idempotent, so landing it twice registers the same command twice and changes nothing.

`ensureCommands()` is idempotent: it registers once per process. A test that overrides a command must `await ensureCommands()` before its `registerCommand(...)` call, or the first `run()` would overwrite the override.

**Normalized flags:** before dispatch, `run()` sets `flags.color`, `flags.json`, and `flags.refresh` to booleans, so every command can read them without touching `process.env` or `process.stdout`. Specs 02–04 rely on this.

- [ ] **Step 1: Write the failing test**

`tests/cli.run.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureCommands, getCommand, registerCommand, run, usage } from '../src/cli.js';
import type { Command, CommandContext } from '../src/cli.js';
import { makeTempDir, removeTempDir } from './fixtures/index.js';

// Register the real commands first, so the doubles below win over them.
beforeAll(async () => {
  await ensureCommands();
});

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Capture {
  out: string[];
  err: string[];
  io: { stdout: (s: string) => void; stderr: (s: string) => void; env: NodeJS.ProcessEnv; isTTY: boolean };
}

/** A hermetic home with a valid ~/.claude, so auto-detection succeeds. */
async function capture(): Promise<Capture> {
  const home = await makeTempDir();
  created.push(home);
  await fs.mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    },
  };
}

let seen: CommandContext | null = null;

const spy: Command = {
  name: 'scan',
  summary: 'a test double for scan',
  async run(ctx) {
    seen = ctx;
    return 0;
  },
};

afterEach(() => {
  seen = null;
});

describe('run', () => {
  it('prints usage for --help and -h', async () => {
    const first = await capture();
    expect(await run(['--help'], first.io)).toBe(0);
    expect(first.out.join('\n')).toContain('skilled config [dir <path>]');

    const second = await capture();
    expect(await run(['-h'], second.io)).toBe(0);
    expect(second.out.join('\n')).toBe(usage());
  });

  it('prints the package version for --version', async () => {
    const c = await capture();

    expect(await run(['--version'], c.io)).toBe(0);
    expect(c.out.join('')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('tolerates the later specs command modules being absent', async () => {
    // spec 01 ships without ./commands/index.js and ./update.js
    await expect(ensureCommands()).resolves.toBeUndefined();
  });

  it('dispatches a bare invocation to scan', async () => {
    registerCommand(spy);
    const c = await capture();

    expect(await run([], c.io)).toBe(0);
    expect(seen?.args).toEqual([]);
  });

  it('normalizes color, json, and refresh into booleans', async () => {
    registerCommand(spy);
    const c = await capture();

    await run(['--json'], c.io);

    expect(seen?.flags.json).toBe(true);
    expect(seen?.flags.color).toBe(false);
    expect(seen?.flags.refresh).toBe(false);
  });

  it('passes the resolved config and env to the command', async () => {
    registerCommand(spy);
    const c = await capture();

    await run([], c.io);

    expect(seen?.config.origin).toBe('autodetect');
    expect(seen?.config.dirs).toEqual([path.join(c.io.env.HOME as string, '.claude')]);
    expect(seen?.env).toBe(c.io.env);
  });

  it('returns the exit code the command returns', async () => {
    registerCommand({ ...spy, async run() { return 1; } });
    const c = await capture();

    expect(await run([], c.io)).toBe(1);
  });

  it('routes an unrecognized first argument to show, arguments unchanged', async () => {
    registerCommand({
      name: 'show',
      summary: 'a test double for show',
      async run(ctx) {
        seen = ctx;
        return 0;
      },
    });
    const c = await capture();

    await run(['cso'], c.io);

    expect(seen?.args).toEqual(['cso']);
  });

  it('strips the command name from the arguments it passes on', async () => {
    registerCommand({
      name: 'add',
      summary: 'a test double for add',
      async run(ctx) {
        seen = ctx;
        return 0;
      },
    });
    const c = await capture();

    await run(['add', 'https://github.com/o/r', 'skills/cso'], c.io);

    expect(seen?.args).toEqual(['https://github.com/o/r', 'skills/cso']);
  });

  it('says plainly when a reserved command is not wired up', async () => {
    expect(getCommand('remove')).toBeUndefined();
    const c = await capture();

    expect(await run(['remove', 'cso'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('`skilled remove` is not available in this build');
  });

  it('maps a SkilledError to its exit code and prints it to stderr', async () => {
    const c = await capture();

    expect(await run(['--turbo'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('✗ Unusable flag: --turbo');
    expect(c.out).toEqual([]);
  });

  it('exits 2 when the managed directory cannot be resolved', async () => {
    registerCommand(spy);
    const home = await makeTempDir();
    created.push(home);
    const out: string[] = [];
    const err: string[] = [];

    const code = await run([], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    });

    expect(code).toBe(2);
    expect(err.join('\n')).toContain('Managed directory not found');
  });

  it('reports an unexpected failure as a bug and exits 3', async () => {
    registerCommand({
      name: 'scan',
      summary: 'a test double that throws',
      async run() {
        throw new TypeError('cannot read properties of undefined');
      },
    });
    const c = await capture();

    expect(await run([], c.io)).toBe(3);
    expect(c.err.join('\n')).toContain('This is a bug in skilled.');
    expect(c.err.join('\n')).toContain('cannot read properties of undefined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.run.test.ts`
Expected: FAIL with "run is not a function".

- [ ] **Step 3: Write the implementation**

Add these imports to the top of `src/cli.ts`:

```ts
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from './config.js';
```

Append to `src/cli.ts`:

```ts
export interface RunIO {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

export function usage(): string {
  return [
    'skilled — keep collected skills and agents current',
    '',
    'Usage',
    '  skilled                      scan the managed directory and report',
    '  skilled <name>               detail on one entry',
    '  skilled update [<name>]      review and apply upstream changes, one at a time',
    '  skilled add <url> [<path>]   register a source by hand',
    '  skilled remove <name>        stop tracking an entry; the file is left alone',
    '  skilled config [dir <path>]  show or set the managed directory',
    '',
    'Flags',
    '  --refresh          hit the network instead of reading the cache',
    '  --json             machine-readable output, no human output',
    '  --dir <path>       one-off managed-directory override',
    '  --no-color         disable color (also honored via NO_COLOR)',
    '  --confirm-each     confirm every detected source, including certain ones',
    '  -h, --help         this help',
    '  -V, --version      print the version',
    '',
    'Exit codes',
    '  0 everything current   1 something is stale   2 user error',
    '  3 operational failure  4 unresolved conflict',
  ].join('\n');
}

/** Reads the version from the package's own package.json, in src/ and in dist/. */
export async function readVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Commands added by later specs. They import registerCommand from this module,
 * so they must be loaded and called from inside run(), never at module scope.
 * The specifiers are plain strings so tsc does not resolve modules that do not
 * exist in this build.
 */
const OPTIONAL_COMMAND_MODULES: ReadonlyArray<{ specifier: string; registrar: string }> = [
  { specifier: './commands/index.js', registrar: 'registerCommands' },
  { specifier: './update.js', registrar: 'registerUpdateCommand' },
];

async function registerOptionalCommands(): Promise<void> {
  for (const { specifier, registrar } of OPTIONAL_COMMAND_MODULES) {
    let loaded: Record<string, unknown>;
    try {
      loaded = (await import(specifier)) as Record<string, unknown>;
    } catch (err) {
      // Node reports a missing module with a code; Vitest's module runner
      // reports it with a message instead. Anything else is a real defect.
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : String(err);
      const missing =
        code === 'ERR_MODULE_NOT_FOUND' ||
        /cannot find module|failed to load url|failed to resolve import/i.test(message);
      if (missing) continue;
      throw err;
    }
    const register = loaded[registrar];
    if (typeof register === 'function') (register as () => void)();
  }
}

let commandsRegistered = false;

/**
 * Registers every command, once per process. Built-ins first, then the sibling
 * specs' registrars, so a later spec's command of the same name wins.
 * A test that overrides a command must await this before registering its double.
 */
export async function ensureCommands(): Promise<void> {
  if (commandsRegistered) return;
  commandsRegistered = true;
  await registerOptionalCommands();
}

/** Returns the exit code instead of calling process.exit, so tests can assert it. */
export async function run(argv: string[], io: RunIO = {}): Promise<number> {
  const stdout =
    io.stdout ??
    ((s: string) => {
      process.stdout.write(`${s}\n`);
    });
  const stderr =
    io.stderr ??
    ((s: string) => {
      process.stderr.write(`${s}\n`);
    });
  const env = io.env ?? process.env;
  const isTTY = io.isTTY ?? process.stdout.isTTY === true;

  try {
    await ensureCommands();

    const { args, flags } = parseArgs(argv);
    flags.color = shouldUseColor(flags, env, isTTY);
    flags.json = flags.json === true;
    flags.refresh = flags.refresh === true;

    if (flags.help === true) {
      stdout(usage());
      return 0;
    }
    if (flags.version === true) {
      stdout(await readVersion());
      return 0;
    }

    const first = args[0];
    let commandName: string;
    let commandArgs: string[];
    if (first === undefined) {
      commandName = 'scan';
      commandArgs = [];
    } else if (getCommand(first) !== undefined) {
      commandName = first;
      commandArgs = args.slice(1);
    } else if (RESERVED_COMMANDS.includes(first)) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: `\`skilled ${first}\` is not available in this build.`,
        cause: `${first} is part of skilled's command surface but is not wired up here. No managed file was modified.`,
        fixes: [
          'skilled            scan and report',
          'skilled config     show or set the managed directory',
          'skilled --help     the full surface',
        ],
        exitCode: 2,
      });
    } else {
      commandName = 'show';
      commandArgs = args;
    }

    const command = getCommand(commandName);
    if (command === undefined) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: `\`skilled ${commandName}\` is not available in this build.`,
        cause: `${commandName} is part of skilled's command surface but is not wired up here. No managed file was modified.`,
        fixes: [
          'skilled config     show or set the managed directory',
          'skilled --help     the full surface',
        ],
        exitCode: 2,
      });
    }

    const dirFlag = typeof flags.dir === 'string' ? flags.dir : undefined;
    const config = await resolveConfig({ dirFlag, env, tolerant: commandName === 'config' });

    return await command.run({ args: commandArgs, flags, config, stdout, stderr, env });
  } catch (err) {
    if (err instanceof SkilledError) {
      stderr(err.format());
      return err.exitCode;
    }
    if (env.SKILLED_DEBUG !== undefined && env.SKILLED_DEBUG !== '') throw err;
    const message = err instanceof Error ? err.message : String(err);
    stderr(
      [
        '✗ skilled hit an unexpected failure.',
        '',
        `  ${message}`,
        '  This is a bug in skilled. No managed file was modified.',
        '',
        '  → re-run with SKILLED_DEBUG=1 to see a stack trace',
      ].join('\n'),
    );
    return 3;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // process.exitCode rather than process.exit, so stdout is never truncated
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err);
      process.exitCode = 3;
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.run.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.run.test.ts
git commit -m "feat(cli): dispatch commands and map errors to exit codes"
```

---

### Task 19: The config command

**Files:**
- Modify: `src/cli.ts` (insert **above** the `if (process.argv[1] !== undefined …)` guard at the end of the file — anything registered after the guard would be registered too late)
- Test: `tests/cli.config.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandContext`, `registerCommand` from Task 17; `autodetectDir`, `setConfigDir` from `src/config.js`; `discover` from `src/discover.js`; `countItems`, `renderConfig`, `renderConfigSaved`, `renderNoManagedDirHint`, `DirSummary`, `RenderOptions` from `src/render/status.js`; `SkilledError`.
- Produces:
  - `export function summarizeDirs(dirs: string[]): Promise<DirSummary[]>`
  - `export function registerBuiltins(): void` — called by `ensureCommands()`; Task 20 adds `scan` and `show` to it
  - a registered command named `config`

- [ ] **Step 1: Write the failing test**

`tests/cli.config.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../src/cli.js';
import { configPath } from '../src/config.js';
import { copyManagedFixture, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Capture {
  out: string[];
  err: string[];
  env: NodeJS.ProcessEnv;
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}

/** A hermetic home with no ~/.claude: auto-detection finds nothing. */
async function capture(): Promise<Capture> {
  const home = await makeTempDir();
  created.push(home);
  const env: NodeJS.ProcessEnv = { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    env,
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env, isTTY: false },
  };
}

describe('skilled config', () => {
  it('reports the directory, the config file, and which source won', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('managed directory');
    expect(text).toContain(managed);
    expect(text).toContain('(--dir flag)');
    expect(text).toContain('4 skills, 2 agents');
    expect(text).toContain(configPath(c.env));
    expect(text).toContain('(not created yet)');
  });

  it('runs even when no managed directory can be found', async () => {
    const c = await capture();

    const code = await run(['config'], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('(none)');
    expect(text).toContain('No managed directory yet.');
    expect(text).toContain('skilled config dir <path>');
  });

  it('saves a directory and reports what it found', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', 'dir', managed], c.io);

    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('✓ saved');
    expect(c.out.join('\n')).toContain('found 4 skills, 2 agents');
    expect(JSON.parse(await fs.readFile(configPath(c.env), 'utf8'))).toEqual({
      version: 1,
      dirs: [managed],
    });
  });

  it('reports the config file as the winning source once it is saved', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    await run(['config', 'dir', managed], c.io);
    const after = await capture();
    after.io.env.HOME = c.env.HOME;
    after.io.env.XDG_CONFIG_HOME = c.env.XDG_CONFIG_HOME;

    const code = await run(['config'], after.io);

    expect(code).toBe(0);
    expect(after.out.join('\n')).toContain('(config file)');
    expect(after.out.join('\n')).toContain('(in use)');
  });

  it('adds a second directory with --add', async () => {
    const first = await copyManagedFixture();
    const second = await copyManagedFixture();
    created.push(first, second);
    const c = await capture();

    await run(['config', 'dir', first], c.io);
    const code = await run(['config', 'dir', '--add', second], c.io);

    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('managing 2 directories:');
    expect(JSON.parse(await fs.readFile(configPath(c.env), 'utf8'))).toEqual({
      version: 1,
      dirs: [first, second],
    });
  });

  it('refuses a path that is not a managed directory and saves nothing', async () => {
    const plain = await makeTempDir();
    created.push(plain);
    const c = await capture();

    const code = await run(['config', 'dir', plain], c.io);

    expect(code).toBe(2);
    expect(c.err.join('\n')).toContain('is not a managed directory');
    expect(c.err.join('\n')).toContain('Expected a skills/ or agents/ subdirectory');
    await expect(fs.stat(configPath(c.env))).rejects.toThrow();
  });

  it('rejects config dir without a path', async () => {
    const c = await capture();

    expect(await run(['config', 'dir'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('needs a path');
  });

  it('rejects an unknown subcommand', async () => {
    const c = await capture();

    expect(await run(['config', 'reset'], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('reset');
    expect(c.err.join('\n')).toContain('skilled config dir <path>');
  });

  it('emits JSON with --json and no human output', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['config', '--dir', managed, '--json'], c.io);
    const parsed = JSON.parse(c.out.join('\n')) as {
      origin: string;
      configExists: boolean;
      dirs: Array<{ dir: string; skills: number; agents: number }>;
    };

    expect(code).toBe(0);
    expect(parsed.origin).toBe('flag');
    expect(parsed.configExists).toBe(false);
    expect(parsed.dirs).toEqual([{ dir: managed, skills: 4, agents: 2 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.config.test.ts`
Expected: FAIL with "`skilled config` is not available in this build" (the command is not registered yet).

- [ ] **Step 3: Write the implementation**

Add these imports to the top of `src/cli.ts`:

```ts
import { autodetectDir, setConfigDir } from './config.js';
import { discover } from './discover.js';
import {
  countItems,
  renderConfig,
  renderConfigSaved,
  renderNoManagedDirHint,
} from './render/status.js';
import type { DirSummary, RenderOptions } from './render/status.js';
```

Insert into `src/cli.ts`, above the `if (process.argv[1] !== undefined …)` guard:

```ts
export async function summarizeDirs(dirs: string[]): Promise<DirSummary[]> {
  const summaries: DirSummary[] = [];
  for (const dir of dirs) {
    summaries.push({ dir, counts: countItems(await discover(dir)) });
  }
  return summaries;
}

const configCommand: Command = {
  name: 'config',
  summary: 'show or set which directory skilled manages',
  async run(ctx: CommandContext) {
    const opts: RenderOptions = { color: ctx.flags.color === true };
    const env = ctx.env ?? process.env;
    const subcommand = ctx.args[0];

    if (subcommand === undefined) {
      const dirs = await summarizeDirs(ctx.config.dirs);
      if (ctx.flags.json === true) {
        ctx.stdout(
          JSON.stringify(
            {
              origin: ctx.config.origin,
              configPath: ctx.config.configPath,
              configExists: ctx.config.configExists,
              dirs: dirs.map((summary) => ({
                dir: summary.dir,
                skills: summary.counts.skills,
                agents: summary.counts.agents,
              })),
            },
            null,
            2,
          ),
        );
        return 0;
      }
      ctx.stdout(renderConfig(ctx.config, dirs, opts));
      if (dirs.length === 0) {
        ctx.stdout(renderNoManagedDirHint(autodetectDir(env), opts));
      }
      return 0;
    }

    if (subcommand !== 'dir') {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: `Unknown \`skilled config\` subcommand: ${subcommand}`,
        cause:
          '`skilled config` takes no subcommand, or `dir <path>`. No managed file was modified.',
        fixes: [
          'skilled config                      show the current setup',
          'skilled config dir <path>           manage that directory instead',
          'skilled config dir --add <path>     manage it as well',
        ],
        exitCode: 2,
      });
    }

    const target = ctx.args[1];
    if (target === undefined) {
      throw new SkilledError({
        code: 'BAD_FLAG',
        problem: '`skilled config dir` needs a path.',
        cause:
          'It sets which directory skilled manages, so it needs exactly one path. No managed file was modified.',
        fixes: [
          'skilled config dir ~/.claude',
          'skilled config dir --add ./.claude',
          'skilled config                      show the current setup',
        ],
        exitCode: 2,
      });
    }

    const mode: 'replace' | 'add' = ctx.flags.add === true ? 'add' : 'replace';
    const saved = await setConfigDir(target, mode, env);
    const dirs = await summarizeDirs(saved.dirs);

    if (ctx.flags.json === true) {
      ctx.stdout(JSON.stringify(saved, null, 2));
      return 0;
    }
    ctx.stdout(renderConfigSaved(dirs, mode, ctx.config.configPath, opts));
    return 0;
  },
};

export function registerBuiltins(): void {
  registerCommand(configCommand);
}
```

Then replace `ensureCommands` from Task 18 with this version, which installs spec 01's
commands before the sibling specs' registrars so a later spec's command of the same name
wins:

```ts
export async function ensureCommands(): Promise<void> {
  if (commandsRegistered) return;
  commandsRegistered = true;
  registerBuiltins();
  await registerOptionalCommands();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.config.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.config.test.ts
git commit -m "feat(cli): add the config command"
```

---

### Task 20: The scan and show commands

**Files:**
- Modify: `src/cli.ts` (insert **above** the `if (process.argv[1] !== undefined …)` guard; extend `registerBuiltins`)
- Test: `tests/cli.scan.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 16–19; `readManifest`, `findEntry` from `src/manifest.js`; `renderItemDetail`, `renderNextSteps`, `renderScanHeader`, `renderStatusReport`, `tildify` from `src/render/status.js`; `LocalItem`, `Manifest`, `StatusReport`, `StatusRow` from `src/types.js`.
- Produces:
  - `export function buildLocalReport(dir: string, items: LocalItem[], manifest: Manifest): StatusReport` — pure. Every row is `unknown`, because nothing has been compared with upstream yet; `identified` counts the items the manifest already has a source for. Spec 02 replaces the `scan` command with one backed by `buildStatus`.
  - registered commands named `scan` (bare `skilled`) and `show` (`skilled cso`)

**Exit code rule:** `scan` returns 1 when any report has `behind > 0`, otherwise 0. In this spec `behind` is always 0, so a successful scan exits 0.

- [ ] **Step 1: Write the failing test**

`tests/cli.scan.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLocalReport, run } from '../src/cli.js';
import { discover } from '../src/discover.js';
import { upsertEntry, writeManifest } from '../src/manifest.js';
import type { Entry, Manifest, StatusReport } from '../src/types.js';
import { copyManagedFixture, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

async function capture(): Promise<{
  out: string[];
  err: string[];
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}> {
  const home = await makeTempDir();
  created.push(home);
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
      isTTY: false,
    },
  };
}

function makeEntry(id: string): Entry {
  return {
    id,
    source: { type: 'github', repo: 'DietrichGebert/ponytail', ref: 'main', subpath: '' },
    base: { commit: 'e'.repeat(40), adoptedAt: '2026-06-01', reconstructed: true },
    detection: {
      method: 'inline-url',
      confidence: 1,
      confirmedBy: 'auto',
      evidence: 'the file names its own upstream',
    },
  };
}

describe('buildLocalReport', () => {
  it('counts every item as unknown until upstream is checked', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const empty: Manifest = { version: 1, entries: [], unknown: [] };

    const report = buildLocalReport(dir, items, empty);

    expect(report.dir).toBe(dir);
    expect(report.total).toBe(6);
    expect(report.identified).toBe(0);
    expect(report.unknown).toBe(6);
    expect(report.behind).toBe(0);
    expect(report.fetchedAt).toBeNull();
    expect(report.rows.every((row) => row.status === 'unknown')).toBe(true);
    expect(report.rows.every((row) => row.localEdits === false)).toBe(true);
  });

  it('counts an item the manifest already tracks as identified', async () => {
    const dir = await copyManagedFixture();
    created.push(dir);
    const items = await discover(dir);
    const manifest = upsertEntry(
      { version: 1, entries: [], unknown: [] },
      makeEntry('agents/ponytail.md'),
    );

    const report = buildLocalReport(dir, items, manifest);

    expect(report.identified).toBe(1);
    expect(report.unknown).toBe(5);
    expect(report.rows.find((row) => row.id === 'agents/ponytail.md')?.source?.repo).toBe(
      'DietrichGebert/ponytail',
    );
  });
});

describe('skilled (bare)', () => {
  it('reports the totals for the managed directory and exits 0', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('4 skills, 2 agents');
    expect(text).toContain('0 of 6 identified · 0 behind upstream · 6 unknown origin');
    expect(text).toContain('skills/marketing-ads');
    expect(text).toContain('no known source');
    expect(text).toContain('Next:');
  });

  it('emits exactly a StatusReport with --json', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['--dir', managed, '--json'], c.io);
    const report = JSON.parse(c.out.join('\n')) as StatusReport;

    expect(code).toBe(0);
    expect(report.dir).toBe(managed);
    expect(report.rows).toHaveLength(6);
    expect(report.total).toBe(6);
    expect(report.unknown).toBe(6);
    expect(report.fetchedAt).toBeNull();
    expect(c.out.join('\n')).not.toContain('Scanning');
  });

  it('reads the manifest it finds in the managed directory', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    await writeManifest(
      managed,
      upsertEntry({ version: 1, entries: [], unknown: [] }, makeEntry('agents/ponytail.md')),
    );
    const c = await capture();

    await run(['--dir', managed, '--json'], c.io);
    const report = JSON.parse(c.out.join('\n')) as StatusReport;

    expect(report.identified).toBe(1);
    expect(report.unknown).toBe(5);
  });

  it('writes nothing into the managed directory', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const before = (await fs.readdir(managed)).sort();
    const c = await capture();

    await run(['--dir', managed], c.io);

    expect((await fs.readdir(managed)).sort()).toEqual(before);
  });
});

describe('skilled <name>', () => {
  it('shows the detail for an untracked item', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['cso', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('skills/cso');
    expect(text).toContain('SKILL.md');
    expect(text).toContain('unknown — not tracked yet');
  });

  it('shows source and evidence for a tracked item', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    await writeManifest(
      managed,
      upsertEntry({ version: 1, entries: [], unknown: [] }, makeEntry('agents/ponytail.md')),
    );
    const c = await capture();

    const code = await run(['ponytail', '--dir', managed], c.io);
    const text = c.out.join('\n');

    expect(code).toBe(0);
    expect(text).toContain('github.com/DietrichGebert/ponytail (main)');
    expect(text).toContain('the file names its own upstream');
    expect(text).toContain('(reconstructed)');
  });

  it('exits 2 for a name it cannot find', async () => {
    const managed = await copyManagedFixture();
    created.push(managed);
    const c = await capture();

    const code = await run(['nope', '--dir', managed], c.io);

    expect(code).toBe(2);
    expect(c.err.join('\n')).toContain('No skill or agent named "nope"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.scan.test.ts`
Expected: FAIL with "buildLocalReport is not a function".

- [ ] **Step 3: Write the implementation**

Add one import to the top of `src/cli.ts`:

```ts
import { findEntry, readManifest } from './manifest.js';
```

Replace the existing `import type { LocalItem, ResolvedConfig } from './types.js';` line with:

```ts
import type { LocalItem, Manifest, ResolvedConfig, StatusReport, StatusRow } from './types.js';
```

Replace the existing value import from `./render/status.js` with:

```ts
import {
  countItems,
  renderConfig,
  renderConfigSaved,
  renderItemDetail,
  renderNextSteps,
  renderNoManagedDirHint,
  renderScanHeader,
  renderStatusReport,
  tildify,
} from './render/status.js';
```

Insert into `src/cli.ts`, above the `if (process.argv[1] !== undefined …)` guard:

```ts
/**
 * The status of a managed dir from local information alone: nothing has been
 * compared with upstream, so every row is 'unknown'. identified counts the
 * items the manifest already has a source for. Spec 02's buildStatus supersedes
 * this once detection exists.
 */
export function buildLocalReport(
  dir: string,
  items: LocalItem[],
  manifest: Manifest,
): StatusReport {
  const rows: StatusRow[] = items.map((item) => {
    const entry = findEntry(manifest, item.id);
    return entry === undefined
      ? { id: item.id, status: 'unknown', localEdits: false }
      : { id: item.id, status: 'unknown', source: entry.source, localEdits: false };
  });
  const identified = rows.filter((row) => row.source !== undefined).length;

  return {
    dir,
    rows,
    identified,
    total: rows.length,
    behind: 0,
    unknown: rows.length - identified,
    fetchedAt: null,
  };
}

const EMPTY_REPORT: StatusReport = {
  dir: '',
  rows: [],
  identified: 0,
  total: 0,
  behind: 0,
  unknown: 0,
  fetchedAt: null,
};

const scanCommand: Command = {
  name: 'scan',
  summary: 'scan the managed directory and report',
  async run(ctx: CommandContext) {
    const opts: RenderOptions = { color: ctx.flags.color === true };
    const reports: StatusReport[] = [];
    const blocks: string[] = [];

    for (const dir of ctx.config.dirs) {
      const items = await discover(dir);
      const manifest = await readManifest(dir);
      const report = buildLocalReport(dir, items, manifest);
      reports.push(report);
      blocks.push(
        [
          renderScanHeader(dir, countItems(items), opts),
          '',
          renderStatusReport(report, opts),
        ].join('\n'),
      );
    }

    const stale = reports.some((report) => report.behind > 0) ? 1 : 0;

    if (ctx.flags.json === true) {
      const first = reports[0] ?? EMPTY_REPORT;
      if (reports.length > 1) {
        ctx.stderr(
          `note: --json covers ${tildify(first.dir)} only; re-run with --dir <path> for the others.`,
        );
      }
      ctx.stdout(JSON.stringify(first, null, 2));
      return stale;
    }

    ctx.stdout(blocks.join('\n\n'));
    ctx.stdout('');
    ctx.stdout(renderNextSteps(reports, opts));
    return stale;
  },
};

const showCommand: Command = {
  name: 'show',
  summary: 'detail on one entry',
  async run(ctx: CommandContext) {
    const opts: RenderOptions = { color: ctx.flags.color === true };
    const name = ctx.args[0];
    if (name === undefined) {
      throw new SkilledError({
        code: 'UNKNOWN_ENTRY',
        problem: '`skilled <name>` needs a name.',
        cause:
          'It shows the detail for one skill or agent, so it needs one name. No managed file was modified.',
        fixes: ['skilled            list everything that was found'],
        exitCode: 2,
      });
    }

    const found: Array<{ item: LocalItem; dir: string }> = [];
    for (const dir of ctx.config.dirs) {
      for (const item of await discover(dir)) {
        found.push({ item, dir });
      }
    }

    const item = resolveName(
      name,
      found.map((entry) => entry.item),
    );
    const owner = found.find((entry) => entry.item.absPath === item.absPath);
    const manifest = await readManifest(owner === undefined ? item.absPath : owner.dir);
    const entry = findEntry(manifest, item.id);

    if (ctx.flags.json === true) {
      ctx.stdout(JSON.stringify({ item, entry: entry ?? null }, null, 2));
      return 0;
    }
    ctx.stdout(renderItemDetail(item, entry, opts));
    return 0;
  },
};
```

Then replace the body of `registerBuiltins` with:

```ts
export function registerBuiltins(): void {
  registerCommand(scanCommand);
  registerCommand(showCommand);
  registerCommand(configCommand);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.scan.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: every suite green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.scan.test.ts
git commit -m "feat(cli): add the scan and show commands"
```

---

### Task 21: End-to-end behavior

**Files:**
- Test: `tests/cli.e2e.test.ts` (no source changes; this task proves the pieces work together)

**Interfaces:**
- Consumes: `run` from `src/cli.js`; `configPath` from `src/config.js`; `copyManagedFixture`, `makeManagedDir`, `makeTempDir`, `removeTempDir` from `tests/fixtures/index.js`.
- Produces: nothing. If a test here fails, the defect is in an earlier task's source, not here.

- [ ] **Step 1: Write the test**

`tests/cli.e2e.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from '../src/cli.js';
import { configPath } from '../src/config.js';
import { copyManagedFixture, makeManagedDir, makeTempDir, removeTempDir } from './fixtures/index.js';

const created: string[] = [];

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await removeTempDir(dir);
  }
});

interface Session {
  out: string[];
  err: string[];
  env: NodeJS.ProcessEnv;
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
  };
}

/** One shell session: a hermetic HOME, a shared env, fresh output buffers. */
function session(env: NodeJS.ProcessEnv, isTTY = false): Session {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    env,
    io: { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env, isTTY },
  };
}

async function hermeticEnv(): Promise<NodeJS.ProcessEnv> {
  const home = await makeTempDir();
  created.push(home);
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
}

describe('first run, end to end', () => {
  it('goes from no config, to a saved directory, to a scan of it', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    const before = session(env);
    expect(await run(['config'], before.io)).toBe(0);
    expect(before.out.join('\n')).toContain('(none)');

    const saving = session(env);
    expect(await run(['config', 'dir', managed], saving.io)).toBe(0);
    expect(saving.out.join('\n')).toContain('✓ saved');

    const scanning = session(env);
    expect(await run([], scanning.io)).toBe(0);
    expect(scanning.out.join('\n')).toContain('0 of 6 identified');

    const detail = session(env);
    expect(await run(['marketing-ads'], detail.io)).toBe(0);
    expect(detail.out.join('\n')).toContain('references/ad-copy-patterns.md');
  });

  it('lets SKILLED_DIR override the saved config for one run', async () => {
    const env = await hermeticEnv();
    const saved = await copyManagedFixture();
    const other = await makeManagedDir(['skills']);
    created.push(saved, other);
    await fs.writeFile(path.join(other, 'skills', 'solo.md'), '# solo\n', 'utf8');

    await run(['config', 'dir', saved], session(env).io);

    const overridden = session({ ...env, SKILLED_DIR: other });
    expect(await run(['config'], overridden.io)).toBe(0);
    expect(overridden.out.join('\n')).toContain('(SKILLED_DIR env var)');
    expect(overridden.out.join('\n')).toContain('1 skill');
  });

  it('scans every configured directory', async () => {
    const env = await hermeticEnv();
    const first = await copyManagedFixture();
    const second = await makeManagedDir(['agents']);
    created.push(first, second);
    await fs.writeFile(path.join(second, 'agents', 'solo.md'), '# solo\n', 'utf8');

    await run(['config', 'dir', first], session(env).io);
    await run(['config', 'dir', '--add', second], session(env).io);

    const scanning = session(env);
    expect(await run([], scanning.io)).toBe(0);
    const text = scanning.out.join('\n');
    expect(text).toContain('0 of 6 identified');
    expect(text).toContain('0 of 1 identified');

    const asJson = session(env);
    expect(await run(['--json'], asJson.io)).toBe(0);
    expect(asJson.err.join('\n')).toContain('--json covers');
    expect(JSON.parse(asJson.out.join('\n')).dir).toBe(first);
  });

  it('colors output for a TTY and never for --json or --no-color', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    const tty = session(env, true);
    await run(['--dir', managed], tty.io);
    expect(tty.out.join('\n')).toContain('[1m');

    const noColor = session(env, true);
    await run(['--dir', managed, '--no-color'], noColor.io);
    expect(noColor.out.join('\n')).not.toContain('[1m');

    const asJson = session(env, true);
    await run(['--dir', managed, '--json'], asJson.io);
    expect(asJson.out.join('\n')).not.toContain('[1m');
  });

  it('never touches the real config path', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    await run(['config', 'dir', managed], session(env).io);

    expect(configPath(env).startsWith(env.HOME as string)).toBe(true);
    await expect(fs.stat(configPath(env))).resolves.toBeDefined();
  });

  it('keeps every documented exit code reachable from the CLI', async () => {
    const env = await hermeticEnv();
    const managed = await copyManagedFixture();
    created.push(managed);

    expect(await run(['--dir', managed], session(env).io)).toBe(0);
    expect(await run(['--turbo'], session(env).io)).toBe(2);
    expect(await run(['--dir', '/definitely/not/here'], session(env).io)).toBe(2);
    expect(await run(['nope', '--dir', managed], session(env).io)).toBe(2);
    expect(await run(['update'], session(env).io)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/cli.e2e.test.ts`
Expected: PASS, 6 tests. A failure here means an earlier task's source is wrong — fix that source file, not this test.

- [ ] **Step 3: Verify the built binary**

Run:

```bash
npm run build
node dist/cli.js --dir tests/fixtures/managed
echo "exit: $?"
```

Expected: the scan output for the fixture (`4 skills, 2 agents`, `0 of 6 identified · 0 behind upstream · 6 unknown origin`) and `exit: 0`.

- [ ] **Step 4: Commit**

```bash
git add tests/cli.e2e.test.ts
git commit -m "test(cli): cover the first-run journey end to end"
```

---

## Definition of Done

Run these from the project root. Every command must produce the stated result.

```bash
npm install
npm test
```
Expected: all 21 test files pass, 0 failed: `types`, `errors`, `fixtures`, `clients`, `config.paths`, `config.validate`, `config.resolve`, `config.set`, `manifest.pure`, `manifest.io`, `discover`, `discover.content`, `render/status`, `render/config`, `render/prompt`, `cli.flags`, `cli.registry`, `cli.run`, `cli.config`, `cli.scan`, `cli.e2e`.

```bash
npm run typecheck
```
Expected: no output, exit 0.

```bash
npm run build && ls dist/cli.js dist/render/status.js
```
Expected: both paths listed; `head -1 dist/cli.js` prints `#!/usr/bin/env node`.

```bash
node dist/cli.js --version
```
Expected: `0.1.0`.

```bash
node dist/cli.js --help
```
Expected: the usage block, listing all six commands and all six flags. Exit 0.

```bash
node dist/cli.js --dir tests/fixtures/managed; echo "exit: $?"
```
Expected:
```
Scanning tests/fixtures/managed … 4 skills, 2 agents

  ? agents/ponytail.md           → —  (no known source)
  ? agents/thomas.md             → —  (no known source)
  ? skills/cso                   → —  (no known source)
  ? skills/explain-code          → —  (no known source)
  ? skills/marketing-ads         → —  (no known source)
  ? skills/qa-only               → —  (no known source)

  0 of 6 identified · 0 behind upstream · 6 unknown origin

  Next:  skilled add <url> <name>    tell skilled about the 6 with no known source
         skilled config              check which directory skilled manages
exit: 0
```
(The `→` column is padded; the leading path is printed as given, absolute or relative.)

```bash
node dist/cli.js --dir tests/fixtures/managed --json | head -5
```
Expected: the first lines of a serialized `StatusReport` — `{`, `"dir": "…/tests/fixtures/managed",`, `"rows": [`, and so on. No human output.

```bash
node dist/cli.js cso --dir tests/fixtures/managed
```
Expected: the detail block for `skills/cso`, including `files      SKILL.md` and `source     unknown — not tracked yet`. Exit 0.

```bash
node dist/cli.js --dir /definitely/not/here; echo "exit: $?"
```
Expected: `✗ Managed directory not found: /definitely/not/here`, a cause naming what was expected, three `→` fixes, and `exit: 2`.

```bash
node dist/cli.js --turbo; echo "exit: $?"
```
Expected: `✗ Unusable flag: --turbo` and `exit: 2`.

```bash
node dist/cli.js update; echo "exit: $?"
```
Expected: `✗ \`skilled update\` is not available in this build.` and `exit: 2` — the honest answer until spec 03 registers it.

Config persistence, in a throwaway config directory so the real `~/.config` is untouched:

```bash
SCRATCH=$(mktemp -d)
XDG_CONFIG_HOME="$SCRATCH" node dist/cli.js config
XDG_CONFIG_HOME="$SCRATCH" node dist/cli.js config dir "$PWD/tests/fixtures/managed"
cat "$SCRATCH/skilled/config.json"
XDG_CONFIG_HOME="$SCRATCH" node dist/cli.js config
rm -rf "$SCRATCH"
```
Expected, in order: a `config` report whose managed-directory line ends in `(auto-detected)`; then `✓ saved` with `found 4 skills, 2 agents`; then `{ "version": 1, "dirs": ["…/tests/fixtures/managed"] }`; then a `config` report ending in `(config file)` and `(in use)`.

```bash
git status --short tests/fixtures/managed
```
Expected: no output. Nothing in this spec ever writes to a managed file.
