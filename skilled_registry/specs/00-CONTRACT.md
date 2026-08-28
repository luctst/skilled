# Shared Interface Contract

> **Read this before implementing any spec.** Every type, path, command, and exit
> code in this file is fixed. Specs 01–04 are implemented independently, possibly
> by different agents in any order — this contract is the only thing keeping them
> compatible. Do not rename, restructure, or "improve" anything defined here. If
> something here is genuinely wrong, stop and flag it rather than diverging.

**Design doc:** `skilled_registry/specs/DESIGN.md`

---

## Global Constraints

- **Runtime:** Node.js ≥ 20.0.0. ESM only (`"type": "module"` in package.json).
- **Language:** TypeScript 5.x, `strict: true`. No `any` in exported signatures.
- **Test framework:** Vitest. Tests live in `tests/`, mirroring `src/` structure.
- **Package manager:** npm. Binary name `skilled`, exposed via `"bin"`.
- **No network in tests.** All network calls go through injected interfaces; tests
  use fakes. A test that hits github.com is a broken test.
- **No dependency added without justification in the task.** Available and expected:
  `node:fs/promises`, `node:path`, `node:os`, `node:child_process`. Third-party
  allowed: `zod` (schema validation), `picocolors` (terminal color).
  Do not add a CLI framework, an HTTP client, or a git library.
- **Never write to a managed file without explicit user approval.** Writing to
  `<managed-dir>/.skilled/` is always allowed. Writing to a skill or agent file
  requires the user to have said yes to that specific change.
- **Dates** are ISO 8601 `YYYY-MM-DD` strings. Timestamps are full ISO 8601 UTC.
- **All user-facing strings** state problem, cause, and fix. See `errors.ts` below.

---

## Repository layout

```
skilled/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    cli.ts              command dispatch, flag parsing, exit codes
    types.ts            every shared type in this contract
    errors.ts           SkilledError + the error catalogue
    clients.ts          GitHubClient/ClaudeClient interfaces + null implementations
    config.ts           managed-directory resolution
    manifest.ts         read/write <managed-dir>/.skilled/manifest.json
    discover.ts         walk a managed dir, produce LocalItem[]
    detect/
      index.ts          cascade orchestrator
      inline-url.ts     strategy 1
      plugin-cache.ts   strategy 2
      known-index.ts    strategy 3
      code-search.ts    strategy 4
      cluster.ts        strategy 5
      ask-claude.ts     strategy 6
    fetch.ts            upstream retrieval
    merge.ts            three-way merge
    status.ts           build the StatusReport
    render/
      status.ts         status output + streaming
      diff.ts           diff rendering
      prompt.ts         interactive key prompts
  tests/                mirrors src/
  hooks/session-start.sh
  skill/SKILL.md
```

**Ownership by spec.** Each file has exactly one owning spec. Never edit a file
owned by another spec; if you need behavior from it, consume its exported
interface as defined here.

| Spec | Owns |
|---|---|
| 01 Foundation | `package.json`, `tsconfig.json`, `vitest.config.ts`, `types.ts`, `errors.ts`, `config.ts`, `manifest.ts`, `discover.ts`, `cli.ts`, `render/status.ts`, `render/prompt.ts`, `clients.ts` |
| 02 Detection | `detect/**`, `status.ts` |
| 02 Detection | also `detect/hash.ts`, `commands/**` |
| 03 Update | `fetch.ts`, `merge.ts`, `render/diff.ts`, `claude.ts`, `update.ts` |
|  | *(spec 03 supplies the real clients that `clients.ts` stubs out)* |
| 04 Integration | `hooks/session-start.sh`, `skill/SKILL.md`, `README.md`, `statusline.ts`, `pointers.ts`, `refresh.ts` |

Specs 02–04 each add their own subcommand wiring by importing from `cli.ts`'s
registry (see `registerCommand` below) — they do not rewrite `cli.ts`.

**Dependency direction is strictly forward.** Spec 01 depends on nothing.
Spec 02 depends only on spec 01's exports (including the client *interfaces*, never
their implementations). Spec 03 depends on 01 and 02. Spec 04 depends on a working
binary and nothing else. Each spec must be independently runnable and testable at
its own completion — spec 02 ships working detection using only free, offline
strategies plus injected clients; the network strategies degrade to a clear
NO_AUTH message until spec 03 lands.

---

## `src/types.ts` — copy verbatim

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

---

## Paths

Resolve via functions, never hardcode at call sites.

```ts
// config.ts
export function configPath(): string;          // ~/.config/skilled/config.json
                                               // honors XDG_CONFIG_HOME
export function stateDir(managedDir: string): string;   // <dir>/.skilled
export function manifestPath(managedDir: string): string; // <dir>/.skilled/manifest.json
export function basePath(managedDir: string, id: string): string; // <dir>/.skilled/base/<id>
export function cachePath(managedDir: string): string;  // <dir>/.skilled/cache/status.json
export function statusLinePath(managedDir: string): string; // <dir>/.skilled/status
```

`~/.claude` is the autodetect default. A directory qualifies as managed only if it
exists and contains a `skills/` or `agents/` subdirectory.

---

## Module signatures

Every function that touches the network or filesystem-outside-the-managed-dir
takes its collaborator as a parameter. That is what makes the tests hermetic.

```ts
// config.ts
export function resolveConfig(opts: { dirFlag?: string; env?: NodeJS.ProcessEnv }): Promise<ResolvedConfig>;
export function setConfigDir(dir: string, mode: 'replace' | 'add'): Promise<SkilledConfig>;
export function validateManagedDir(dir: string): Promise<void>; // throws SkilledError

// manifest.ts
export function readManifest(managedDir: string): Promise<Manifest>;   // returns empty manifest if absent
export function writeManifest(managedDir: string, m: Manifest): Promise<void>;
export function upsertEntry(m: Manifest, e: Entry): Manifest;          // pure
export function removeEntry(m: Manifest, id: string): Manifest;        // pure
export function findEntry(m: Manifest, id: string): Entry | undefined;  // pure

// discover.ts
export function discover(managedDir: string): Promise<LocalItem[]>;
export function readItemContent(item: LocalItem): Promise<Map<string, string>>; // relpath -> text

// detect/index.ts
export interface DetectDeps {
  github: GitHubClient;
  claude: ClaudeClient;
  knownIndex: KnownIndex;
  pluginCacheDir: string;
}
/** Streams candidates as they are found. Never writes to disk. */
export function detectAll(items: LocalItem[], deps: DetectDeps): AsyncGenerator<Candidate>;

// clients.ts  — OWNED BY SPEC 01. Interfaces only, plus null implementations.
// Spec 02 codes against these interfaces and tests with its own fakes.
// Spec 03 supplies the real implementations in fetch.ts.
export interface GitHubClient {
  searchCode(query: string): Promise<Array<{ repo: string; path: string }>>;
  getRepoMeta(repo: string): Promise<RepoMeta>;
  listCommits(source: Source, sinceSha?: string): Promise<Array<{ sha: string; date: string; message: string }>>;
  readTree(source: Source, sha: string): Promise<Map<string, string>>; // relpath -> text
}
export interface ClaudeClient {
  /** returns "owner/name" or null when it cannot identify the content */
  identify(excerpt: string): Promise<string | null>;
  /** resolves a conflicted merge; returns merged content or null to give up */
  resolveConflict(args: { base: string; local: string; upstream: string; conflicted: string }): Promise<string | null>;
}
/** Every method throws SkilledError NO_AUTH. Lets specs 01-02 ship before 03 exists. */
export function nullGitHubClient(): GitHubClient;
export function nullClaudeClient(): ClaudeClient;

// fetch.ts  — OWNED BY SPEC 03
export function createGitHubClient(token: string | null): GitHubClient;
export function resolveToken(): Promise<string | null>; // borrows `gh auth token`; null when unavailable

// merge.ts
export function mergeFile(base: string, local: string, upstream: string): MergeOutcome;

// status.ts
export function buildStatus(managedDir: string, deps: { github: GitHubClient }, opts: { refresh: boolean }): Promise<StatusReport>;
export function readCachedStatus(managedDir: string): Promise<StatusReport | null>;
export function writeCachedStatus(managedDir: string, r: StatusReport): Promise<void>;

// render/prompt.ts
/** Single-keypress prompt. keys are lowercase single chars. Returns the chosen key. */
export function promptKey(message: string, keys: Array<{ key: string; label: string }>): Promise<string>;
export function isInteractive(): boolean; // false when stdin is not a TTY
```

---

## CLI surface

Six commands, exactly. No others.

```
skilled                      scan and report
skilled <name>               detail on one entry
skilled update [<name>]      review and apply, one at a time
skilled add <url> [<path>]   register a source by hand
skilled remove <name>        stop tracking
skilled config [dir <path>]  show or set the managed directory
```

Flags, all valid on bare `skilled`:

| Flag | Effect |
|---|---|
| `--refresh` | hit the network instead of reading cache |
| `--json` | emit machine-readable JSON, suppress all human output |
| `--dir <path>` | one-off managed-directory override, highest precedence |
| `--no-color` | disable color; also honored via `NO_COLOR` env |
| `--confirm-each` | prompt for every provenance candidate, including certain ones |
| `--help`, `-h` | usage |
| `--version`, `-V` | version |

**Exit codes — fixed:**

| Code | Meaning |
|---|---|
| 0 | success; for bare `skilled`, everything is current |
| 1 | success, but something is stale (bare `skilled` only) |
| 2 | user error — bad flag, bad path, unknown entry name |
| 3 | operational failure — network unreachable, auth missing, rate limited |
| 4 | merge conflict left unresolved |

`--json` output for bare `skilled` is exactly a serialized `StatusReport`.

**Name resolution.** `<name>` accepts a full id (`skills/cso`), a bare basename
(`cso`), or an agent filename (`ponytail`). Ambiguous matches exit 2 listing the
candidates. Implemented once, in `cli.ts`, exported as:

```ts
export function resolveName(name: string, items: LocalItem[]): LocalItem; // throws SkilledError on miss/ambiguity
```

**Command registration.** `cli.ts` exports a registry so later specs add commands
without editing dispatch:

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
}
export function registerCommand(c: Command): void;
```

---

## `src/errors.ts`

```ts
export type ErrorCode =
  | 'BAD_DIR' | 'BAD_FLAG' | 'UNKNOWN_ENTRY' | 'AMBIGUOUS_NAME'
  | 'NO_AUTH' | 'RATE_LIMIT' | 'UPSTREAM_GONE' | 'NETWORK'
  | 'MERGE_CONFLICT' | 'BAD_MANIFEST' | 'BAD_SOURCE';

export class SkilledError extends Error {
  readonly code: ErrorCode;
  /** what went wrong, one line */
  readonly problem: string;
  /** why, one or two lines; include the offending value */
  readonly cause: string;
  /** concrete next commands, one per line */
  readonly fixes: string[];
  readonly exitCode: 2 | 3 | 4;
  constructor(init: { code: ErrorCode; problem: string; cause: string; fixes: string[]; exitCode: 2 | 3 | 4 });
  /** renders problem / cause / fixes, in that order */
  format(): string;
}
```

Every thrown error is a `SkilledError`. `cli.ts` catches it, prints `format()` to
stderr, and exits with `exitCode`. A bare `throw new Error(...)` anywhere in
`src/` is a defect.

**Required reassurance:** any error raised during a scan, detect, or update must
state that no managed file was modified, when that is true. The design doc calls
this out as a trust requirement, not a nicety.

---

## Resolved gaps and ratified additions

These were found by the spec authors after the first draft of this contract. They
are now part of it. Where a spec already implements one, its implementation is
authoritative — do not rework it.

### `KnownIndex` (was referenced by `DetectDeps`, never defined)

```ts
export interface KnownIndexEntry {
  /** sha256 of the normalized primary file content */
  hash: string;
  source: Source;
  /** display name of the upstream project, for the evidence line */
  label: string;
}
export interface KnownIndex {
  lookup(hash: string): KnownIndexEntry | undefined;
  readonly size: number;
}
```

### `BaseRecord.commit: ''` is the official "origin known, BASE not yet captured" sentinel

Detection confirms *where* a file came from. It does not fetch, so it usually
cannot say *which commit* the local copy corresponds to. That intermediate state is
represented as:

```ts
base: { commit: '', adoptedAt: <today>, reconstructed: true }
```

Rules, and all three specs must hold to them:
- `commit: ''` **requires** `reconstructed: true`. The pair is the sentinel.
- `buildStatus` reports such an entry as `'unknown'` — "cannot say whether this is
  current" — never as `'current'` or `'behind'`. It must not guess.
- `skilled update` must reconstruct BASE before it can merge such an entry, and must
  not persist a reconstructed BASE during a dry run (`--json` or non-TTY).
- The one exception that skips the sentinel entirely: `plugin-cache` recovers a real
  pinned `gitCommitSha`, so it writes that commit with `reconstructed: false`. It is
  the only exact BASE this tool gets for free.

`commit: string | null` would model this more honestly, but specs 01–03 all shipped
against `commit: string` and two of them independently converged on `''`. Keeping
the sentinel and documenting it beats churning three finished specs for type purity.

### Pinning a commit on a `Candidate`

`Candidate` has no commit field and does not need one: a full 40-hex sha is a legal
git ref, so a strategy that knows the exact commit puts it in `Source.ref`. Callers
must therefore treat `Source.ref` as "branch, tag, **or** sha".

### Progress reporting during rate-limited work

`DetectDeps` gains no progress channel. Instead, wrap the injected `GitHubClient`
in a decorator that reports before and after each call. This keeps the client
interface minimal and keeps progress rendering out of the detection logic.

### `CommandContext.env`

```ts
export interface CommandContext {
  args: string[];
  flags: Record<string, string | boolean>;
  config: ResolvedConfig;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env?: NodeJS.ProcessEnv;   // always supplied by run(); use INSTEAD of process.env
}
```
Without it, a command that writes config cannot be tested without touching the
real `~/.config`. Existing five-field context literals still typecheck.

### Command names, dispatch, and how later specs override

Internal command names — these are NOT extra user-facing verbs, they are the
registry keys behind the six-command surface:

```ts
export const RESERVED_COMMANDS: readonly string[] = ['scan','show','update','add','remove','config'];
```

**Dispatch, in this exact order:**
1. No positional argument → `scan`.
2. First positional is a *registered* command name → that command, with `args.slice(1)`.
3. First positional is a *reserved* name with no command registered → `SkilledError`
   `BAD_FLAG`, exit 2, "not available in this build". Without this branch,
   `skilled update` before spec 03 lands routes to the detail command and reports
   "no skill or agent named update". Once specs 02–03 register their verbs the branch
   is unreachable, so it costs them nothing.
4. Anything else → `show`, with `args` unchanged.

**Known tradeoff of named keys:** an entry literally named `scan` or `show` is
shadowed by the command and must be addressed by full id (`skilled skills/scan`).
Documented rather than worked around — the escape hatch is clean.

`registerCommand` **replaces** any earlier command with the same name. That is how
specs 02–04 override spec 01's placeholder `scan`/`show` without editing `cli.ts`.

Registration must be a function call, never a module-level side effect — a
top-level `registerCommand(...)` in an extension module runs while `cli.ts`'s
registry is still initialising and hits a temporal-dead-zone error. `cli.ts`'s
dispatch function carries guarded extension imports as its first statements:

```ts
try { (await import('./commands/index.js')).registerCommands(); } catch { /* spec 02 absent */ }
try { (await import('./update.js')).registerUpdateCommand(); } catch { /* spec 03 absent */ }
```

The guards keep each spec's tests green before its successors exist. A failure is
skipped **only** when it is module-not-found (Node's `ERR_MODULE_NOT_FOUND`, plus
Vitest's message form, since Vite's module runner does not set that code). Any other
import failure propagates — a syntax error in a sibling module must not be swallowed.

`cli.ts` is spec-01-owned and is the **only** place this call may live: if a later
spec added it, that spec would be editing a file it does not own; if no spec added
it, the registrars would never run. Specs 02–04 therefore write no `cli.ts` code and
instead verify the wiring is present.

**`ensureCommands()` is idempotent** — registration happens once per process. Any
test in specs 02–04 that installs a double over a real command must
`await ensureCommands()` **before** its own `registerCommand(...)` call, or the first
`run()` installs the real command over the double.

### Normalized flags

Before dispatch, `run()` coerces `flags.color`, `flags.json`, and `flags.refresh`
to booleans. Commands read those rather than re-parsing argv or inspecting
`process.stdout`.

### A second binary: `skilled-refresh`

The background refresh must hit the network, write the cache, AND write the status
line in one Node boot. Bare `skilled --refresh` does the first two but cannot write
the status line without spec 01 or 02 importing spec 04. So `package.json` declares
a second `bin` entry, `skilled-refresh`, owned by spec 04. It is spawned detached by
the session hook and is **not** a seventh command — it adds no verb to the closed
six-command surface and is never documented as a user-facing command.

### Auto-accepting certain provenance detections (ratified by the user)

Requiring a keypress per detection costs ~40 keypresses on a 51-file directory and
destroys the sub-2-minute first run. Confirming provenance writes only to the
manifest and never touches a skill or agent file, so the bar is lower than for
applying an update. Note the asymmetry deliberately: **applying updates stays
review-then-choose, always.**

**Auto-accept** (`confirmedBy: 'auto'`) when BOTH hold:
- `confidence >= 0.95`, AND
- `method` is `'inline-url'`, `'plugin-cache'`, or `'known-index'`

Those three are assertions, not inferences: the file's own text names its upstream,
a pinned `gitCommitSha` matches, or a content hash matches exactly.

**Always prompt**, regardless of confidence:
- `method` is `'code-search'` or `'claude'` — this is where forks and
  wrong-copy-direction matches live, and no confidence score can rule them out
- more than one candidate exists for the same `id`
- `method` is `'cluster'` whose propagated parent was itself prompted rather than
  auto-accepted (cluster inherits its parent's confirmation status)

**Auto-accepted entries must be visible and cheap to undo:**
- printed in the stream with a marker distinguishing them from prompted ones
- `skilled <name>` shows `confirmedBy: 'auto'` and the evidence
- correcting one is `skilled add <url> <path>`; untracking is `skilled remove <name>`
- the closing summary states how many were auto-accepted

**Escape hatch:** `--confirm-each` on bare `skilled` forces a prompt for every
candidate, including the certain ones. This is the seventh and final flag.

### `BAD_SOURCE` (added)

A malformed source URL passed to `skilled add` raises `BAD_SOURCE`, exit 2 — not
`BAD_FLAG`. The argument is well-formed as a flag; it is the source that cannot be
parsed. Spec 01 owns the union; spec 02's `parseSourceUrl` is the only caller.

### Errors in the design doc — do not copy these

`DESIGN.md` is normative on wording and intent but contains three invalid command
invocations. Use the real surface instead:

| DESIGN.md says | Correct |
|---|---|
| `skilled refresh` (hook snippet) | `skilled --refresh`, or the `skilled-refresh` binary |
| `skilled diff git` (error catalogue) | the `[d]` option inside `skilled update` |
| `skilled update git --claude` | the `[c]` option inside `skilled update` |

The hook snippet in DESIGN.md also hardcodes `~/.claude`, which defeats
`skilled config`. The hook must resolve the managed directory without booting Node
in the foreground.

---

## Testing rules

- **TDD.** Every task writes the failing test first, runs it, watches it fail,
  then implements. No exceptions.
- **Fakes, not mocks of internals.** Implement fake `GitHubClient` / `ClaudeClient`
  objects satisfying the interfaces above. Do not monkeypatch modules.
- **Fixtures** live in `tests/fixtures/`. Build a realistic managed dir there:
  a multi-file skill (mirroring `marketing-ads/` with `references/`), a
  single-file skill (mirroring `cso/SKILL.md`), a flat agent file (mirroring
  `agents/ponytail.md`, including its `Adapted from github.com/...` line), and a
  skill with `allowed-tools: Bash` in frontmatter.
- **Temp dirs:** `fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'))`, removed in
  `afterEach`. Never touch the real `~/.claude` in a test.
- Run a single test: `npx vitest run tests/path/file.test.ts -t 'name'`
- Run all: `npm test`

## Commit convention

Conventional commits, one per task step where the plan says commit:
`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`. Scope optional.
