# Integration and Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `skilled` push staleness at you instead of waiting to be asked — a pure-shell Claude Code `SessionStart` hook that prints a one-line notice in under 10ms, a thin Claude skill for asking in chat, a README that gets a stranger to their first drift report, and a publishable npm tarball.

**Architecture:** A spec-04-owned writer (`src/statusline.ts`) renders a `StatusReport` into the one-line human summary at `<managed-dir>/.skilled/status`, and `src/pointers.ts` maintains two tiny text files under `~/.config/skilled/` that tell the shell hook where the managed directories are and how to invoke the background refresh without a PATH lookup. `src/refresh.ts` is a second, non-interactive binary (`skilled-refresh`) that the hook spawns detached — it is the only place Node runs. `hooks/session-start.sh` is pure POSIX shell: builtin reads, exactly one `find` fork, no Node in the foreground, always exit 0.

**Tech Stack:** Node.js ≥ 20, TypeScript 5.x (strict), Vitest, POSIX `sh`, one `.mjs` installer helper (runs before any build exists), GitHub Actions.

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
- **Every thrown error is a `SkilledError`.** A bare `throw new Error(...)` anywhere in `src/` is a defect.
- **Temp dirs:** `fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'))`, removed in `afterEach`. **Never touch the real `~/.claude`, the real `~/.config/skilled`, or the real `settings.json` in a test.**
- **Commit convention:** Conventional commits — `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`.
- **Exit codes are fixed:** 0 success/current · 1 success but stale (bare `skilled` only) · 2 user error · 3 operational failure · 4 unresolved merge conflict.
- **The six-command surface is closed:** `skilled`, `skilled <name>`, `skilled update [<name>]`, `skilled add <url> [<path>]`, `skilled remove <name>`, `skilled config [dir <path>]`. Flags on bare `skilled`: `--refresh`, `--json`, `--dir <path>`, `--no-color`, `--help`/`-h`, `--version`/`-V`. **There is no `skilled refresh` verb** — the design doc's hook snippet gets this wrong; every invocation in this spec uses the real surface.
- **The hook must never boot Node in the foreground.** Node costs 80–150ms to start and the hook runs on every session.
- **The hook must never fail a session start.** Every command guarded, all errors swallowed, always `exit 0`.

---

## File Structure

Files this spec creates, each with one responsibility:

| File | Single responsibility |
|---|---|
| `src/statusline.ts` | Render a `StatusReport` into the one-line summary, and write/delete `<managed-dir>/.skilled/status` atomically |
| `src/pointers.ts` | Maintain the two text files the shell hook reads: `dirs` and `refresh-cmd` |
| `src/refresh.ts` | The `skilled-refresh` entrypoint: refresh every managed dir, write cache + status line, never throw |
| `hooks/session-start.sh` | The Claude Code `SessionStart` hook: print cached news, spawn a detached refresh when the cache is out of date |
| `hooks/patch-settings.mjs` | Additively add/remove our `SessionStart` entry in `settings.json` (pure functions + CLI) |
| `hooks/patch-settings.d.mts` | Type declarations so the `.mjs` helper can be imported from a TypeScript test |
| `hooks/install.sh` | Install/uninstall the hook: copy the script, back up settings, invoke the patcher, prime the cache |
| `skill/SKILL.md` | The thin Claude Code skill wrapping the CLI, and the conflict-resolution routine |
| `README.md` | Zero to a first true drift report |
| `.github/workflows/ci.yml` | `npm test`, build, pack, global install, and a `skilled --json` drift report honoring the exit-code contract |
| `examples/managed/**` | A committed fixture managed directory so CI can demonstrate exit 1 offline |
| `examples/prepare-cache.mjs` | Rewrite the fixture cache with the absolute checkout path |
| `examples/assert-drift.mjs` | Assert the CI drift report parses and reports one entry behind |
| `tsconfig.build.json` | Emit `dist/` without editing spec 01's `tsconfig.json` (only if needed) |

**Ownership note.** The contract's repository layout does not list `src/statusline.ts`, `src/pointers.ts`, or `src/refresh.ts`. They are spec-04 additions, created here because the status-line writer is in spec 04's scope and because a reverse dependency (spec 01's `cli.ts` importing spec 04) would violate the contract's strictly-forward dependency rule. Spec 04 imports from specs 01–03; nothing in specs 01–03 imports from spec 04. **No file owned by another spec is edited**, with one exception called out in Task 1 and Task 15: the `name`, `bin`, `files`, `engines`, `publishConfig`, `scripts.build`, and `scripts.prepublishOnly` keys of `package.json`, which spec 04's scope explicitly grants.

**Why a second binary.** The background refresh must (a) hit the network, (b) write the cache, and (c) write the status line. Bare `skilled --refresh` does (a) and (b) but cannot do (c) without spec 01 or 02 importing spec 04. A second `bin` entry named `skilled-refresh` does all three in one Node boot, adds no verb to the closed six-command surface, and lives entirely inside spec 04's ownership.

**Test files** (all flat in `tests/`, so no change to spec 01's `vitest.config.ts` include patterns is needed):
`tests/statusline.test.ts`, `tests/pointers.test.ts`, `tests/refresh.test.ts`, `tests/hook-status.test.ts`, `tests/hook-refresh.test.ts`, `tests/hook-timing.test.ts`, `tests/hook-install.test.ts`, `tests/skill-frontmatter.test.ts`, `tests/docs-commands.test.ts`, `tests/package-publish.test.ts`.

---

### Task 1: Package name decision

The design doc lists the npm name as unresolved. Settle it first, because the README and the install command in `skill/SKILL.md` both depend on the answer.

**Files:**
- Modify: `package.json` (keys `name`, `publishConfig` only)
- Create: `docs/naming.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the package name used verbatim by Task 12 (`skill/SKILL.md`), Task 14 (`README.md`), Task 15 (publish fields), Task 16 (CI install step).

- [ ] **Step 1: Check availability on the real registry**

Run:

```bash
npm view skilled name version description time.modified 2>&1 | head -20
```

Interpretation, both branches:
- `npm error code E404` / `404 Not Found` → the name is **free**. Keep `"name": "skilled"`, do not add `publishConfig`, and record that in `docs/naming.md`.
- Any successful output → the name is **taken**. Go to Step 2.

As of 2026-08-27 the registry returns a real package: `skilled@0.4.5`, described as *"Skill lifecycle manager for AI agent skills — install, sync, upstream, and detect conflicts"*, last published 2026-04-04. **Expect the taken branch.** Re-run the command anyway — a name can be unpublished — and follow whichever branch the output actually shows.

- [ ] **Step 2: Take the scoped name**

Edit `package.json`. Change only these keys; leave everything spec 01 wrote alone.

```json
{
  "name": "@luctst/skilled",
  "publishConfig": {
    "access": "public"
  }
}
```

The contract fixes the *binary* name (`skilled`), not the package name, so the scope changes the install command and nothing else. Do not rename the binary.

- [ ] **Step 3: Record the decision**

Create `docs/naming.md`:

```markdown
# Package name

`skilled` is taken on npm. As of 2026-08-27 it resolves to `skilled@0.4.5`,
"Skill lifecycle manager for AI agent skills — install, sync, upstream, and
detect conflicts", last published 2026-04-04 — a tool in the same problem
space, which makes squatting the name both unavailable and undesirable.

**Decision:** publish as `@luctst/skilled` with `publishConfig.access: public`.

**The binary stays `skilled`.** The contract fixes the binary name; only the
install command changes:

    npm i -g @luctst/skilled     # installs the `skilled` and `skilled-refresh` binaries

**If the name frees up:** publishing `skilled` later is a `name` change plus a
`README.md` install-line change. Nothing else references the package name.

**Rejected alternatives:** `skilled-cli` (an unscoped near-collision with an
adjacent tool is worse than a scope), `vendir-skills` (buries the product name).
```

- [ ] **Step 4: Verify the manifest still parses**

Run:

```bash
node -e "const p=require('./package.json');console.log(p.name, p.version, JSON.stringify(p.bin))"
```

Expected: prints `@luctst/skilled` (or `skilled` on the free branch), the version spec 01 set, and spec 01's existing `bin` map. If it throws, the JSON edit was malformed — fix it before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json docs/naming.md
git commit -m "chore: publish under @luctst/skilled, npm name skilled is taken"
```

---

### Task 2: Status line renderer

The one line the hook prints. Pure function, no I/O, so it is trivially testable.

**Files:**
- Create: `src/statusline.ts`
- Test: `tests/statusline.test.ts`

**Interfaces:**
- Consumes: `StatusReport`, `StatusRow` from `src/types.ts` (spec 01).
- Produces: `renderStatusLine(report: StatusReport): string | null` — used by Task 3's writer and Task 5's refresh entrypoint.

**Two rules that make or break this feature:**

1. **`null` means say nothing.** The hook prints on every single session start. A line that appears when there is no news becomes noise and the user deletes the hook. Only `status === 'behind'` rows count as news.
2. **Unknown-origin entries are not news.** They are a standing condition that would print forever until resolved. The scan surfaces them; the hook does not.

The line must also never begin with `{`: Claude Code parses `SessionStart` stdout starting with `{` as a JSON control payload.

- [ ] **Step 1: Write the failing test**

Create `tests/statusline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderStatusLine } from '../src/statusline.js';
import type { StatusReport, StatusRow } from '../src/types.js';

function report(rows: StatusRow[]): StatusReport {
  return {
    dir: '/tmp/managed',
    rows,
    identified: rows.length,
    total: rows.length,
    behind: rows.filter((r) => r.status === 'behind').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
    fetchedAt: '2026-08-27T09:00:00Z',
  };
}

const behind = (id: string, behindBy = 1): StatusRow => ({ id, status: 'behind', behindBy, localEdits: false });
const current = (id: string): StatusRow => ({ id, status: 'current', localEdits: false });
const unknown = (id: string): StatusRow => ({ id, status: 'unknown', localEdits: false });

describe('renderStatusLine', () => {
  it('says nothing when there are no rows at all', () => {
    expect(renderStatusLine(report([]))).toBeNull();
  });

  it('says nothing when everything is current', () => {
    expect(renderStatusLine(report([current('skills/cso'), current('agents/ponytail.md')]))).toBeNull();
  });

  it('says nothing about unknown origins — a standing condition is not news', () => {
    expect(renderStatusLine(report([unknown('skills/qa-only'), current('skills/cso')]))).toBeNull();
  });

  it('says nothing about unreachable entries', () => {
    const rows: StatusRow[] = [{ id: 'skills/gone', status: 'unreachable', localEdits: false }];
    expect(renderStatusLine(report(rows))).toBeNull();
  });

  it('renders the design doc line for three behind skills', () => {
    const line = renderStatusLine(
      report([behind('skills/cso', 6), behind('skills/git', 3), behind('skills/marketing-ads', 1), current('skills/retro')]),
    );
    expect(line).toBe('skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`\n');
  });

  it('uses the singular for one', () => {
    expect(renderStatusLine(report([behind('skills/cso')]))).toBe(
      'skilled: 1 skill behind upstream (cso) · run `skilled update`\n',
    );
  });

  it('names three and counts the rest', () => {
    const line = renderStatusLine(
      report([behind('skills/a'), behind('skills/b'), behind('skills/c'), behind('skills/d'), behind('skills/e')]),
    );
    expect(line).toBe('skilled: 5 skills behind upstream (a, b, c, +2 more) · run `skilled update`\n');
  });

  it('says "agents" when every behind entry is an agent, and strips .md', () => {
    expect(renderStatusLine(report([behind('agents/ponytail.md'), behind('agents/thomas.md')]))).toBe(
      'skilled: 2 agents behind upstream (ponytail, thomas) · run `skilled update`\n',
    );
  });

  it('says "items" for a mixed set', () => {
    expect(renderStatusLine(report([behind('skills/cso'), behind('agents/ponytail.md')]))).toBe(
      'skilled: 2 items behind upstream (cso, ponytail) · run `skilled update`\n',
    );
  });

  it('never starts with { — Claude Code would parse that as a JSON control payload', () => {
    const line = renderStatusLine(report([behind('skills/cso')]));
    expect(line?.startsWith('{')).toBe(false);
  });

  it('is exactly one line, newline-terminated, with no ANSI escapes', () => {
    const line = renderStatusLine(report([behind('skills/cso'), behind('agents/ponytail.md')]));
    expect(line).toMatch(/^[^\n]+\n$/);
    // eslint-disable-next-line no-control-regex
    expect(line).not.toMatch(/\[/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/statusline.test.ts`
Expected: FAIL with `Failed to resolve import "../src/statusline.js"` (the module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/statusline.ts`:

```ts
import type { StatusReport, StatusRow } from './types.js';

/** How many names the line spells out before it starts counting. */
const NAMED_LIMIT = 3;

/** "skills/cso" -> "cso"; "agents/ponytail.md" -> "ponytail" */
function shortName(id: string): string {
  const last = id.split('/').pop() ?? id;
  return last.endsWith('.md') ? last.slice(0, -3) : last;
}

/** Skills, agents, or a mixed bag — matches the wording in the design doc. */
function noun(rows: StatusRow[], count: number): string {
  const allSkills = rows.every((r) => r.id.startsWith('skills/'));
  const allAgents = rows.every((r) => r.id.startsWith('agents/'));
  const singular = allSkills ? 'skill' : allAgents ? 'agent' : 'item';
  return count === 1 ? singular : `${singular}s`;
}

/**
 * The one line the SessionStart hook prints, or null when there is nothing worth
 * saying. Only "behind" counts as news: unknown origins are a standing condition
 * that would print on every session forever, and a hook that always speaks gets
 * uninstalled.
 */
export function renderStatusLine(report: StatusReport): string | null {
  const behind = report.rows.filter((r) => r.status === 'behind');
  if (behind.length === 0) return null;

  const names = behind.map((r) => shortName(r.id));
  const named = names.slice(0, NAMED_LIMIT).join(', ');
  const rest = names.length > NAMED_LIMIT ? `, +${names.length - NAMED_LIMIT} more` : '';

  return `skilled: ${behind.length} ${noun(behind, behind.length)} behind upstream (${named}${rest}) · run \`skilled update\`\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/statusline.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/statusline.ts tests/statusline.test.ts
git commit -m "feat(statusline): render the one-line staleness summary, silent when clean"
```

---

### Task 3: Status line writer

Writes what Task 2 renders to the path the hook reads. Two details matter: the write is **atomic** (the hook may `read` the file while a background refresh rewrites it), and a clean report **deletes** the file rather than truncating it — the hook's `[ -s ]` test then short-circuits with zero extra syscalls.

**Files:**
- Modify: `src/statusline.ts`
- Test: `tests/statusline.test.ts`

**Interfaces:**
- Consumes: `statusLinePath(managedDir: string): string` and `stateDir(managedDir: string): string` from `src/config.ts` (spec 01); `renderStatusLine` from Task 2.
- Produces: `writeStatusLine(managedDir: string, report: StatusReport): Promise<void>` — called by Task 5's refresh entrypoint.

- [ ] **Step 1: Write the failing test**

Append to `tests/statusline.test.ts`:

```ts
import { afterEach, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeStatusLine } from '../src/statusline.js';
import { statusLinePath } from '../src/config.js';

describe('writeStatusLine', () => {
  let managed: string;

  beforeEach(async () => {
    managed = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
    await fs.mkdir(path.join(managed, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(managed, { recursive: true, force: true });
  });

  it('writes the rendered line to statusLinePath, creating .skilled/', async () => {
    await writeStatusLine(managed, report([behind('skills/cso', 6)]));
    const written = await fs.readFile(statusLinePath(managed), 'utf8');
    expect(written).toBe('skilled: 1 skill behind upstream (cso) · run `skilled update`\n');
  });

  it('deletes an existing status file when the report is clean', async () => {
    await writeStatusLine(managed, report([behind('skills/cso')]));
    await writeStatusLine(managed, report([current('skills/cso')]));
    await expect(fs.readFile(statusLinePath(managed), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op, not an error, when the report is clean and no file exists', async () => {
    await expect(writeStatusLine(managed, report([current('skills/cso')]))).resolves.toBeUndefined();
    await expect(fs.readFile(statusLinePath(managed), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces the previous line instead of appending to it', async () => {
    await writeStatusLine(managed, report([behind('skills/cso')]));
    await writeStatusLine(managed, report([behind('skills/git'), behind('skills/retro')]));
    const written = await fs.readFile(statusLinePath(managed), 'utf8');
    expect(written).toBe('skilled: 2 skills behind upstream (git, retro) · run `skilled update`\n');
  });

  it('leaves no temp file behind — the hook must never cat a partial write', async () => {
    await writeStatusLine(managed, report([behind('skills/cso')]));
    const entries = await fs.readdir(path.join(managed, '.skilled'));
    expect(entries).toEqual(['status']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/statusline.test.ts -t 'writeStatusLine'`
Expected: FAIL with `"writeStatusLine" is not exported by "src/statusline.ts"`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/statusline.ts` (keep the existing exports):

```ts
import fsp from 'node:fs/promises';
import path from 'node:path';
import { statusLinePath, stateDir } from './config.js';

/**
 * Persist (or clear) the line the SessionStart hook reads.
 *
 * Written via temp-file-plus-rename because a background refresh can be writing
 * while a session-start hook is reading, and a half-written line in a Claude
 * Code session start would be worse than no line at all.
 */
export async function writeStatusLine(managedDir: string, report: StatusReport): Promise<void> {
  const target = statusLinePath(managedDir);
  const line = renderStatusLine(report);

  if (line === null) {
    await fsp.rm(target, { force: true });
    return;
  }

  await fsp.mkdir(stateDir(managedDir), { recursive: true });
  const tmp = path.join(path.dirname(target), `.status.${process.pid}.tmp`);
  await fsp.writeFile(tmp, line, 'utf8');
  await fsp.rename(tmp, target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/statusline.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/statusline.ts tests/statusline.test.ts
git commit -m "feat(statusline): write the status line atomically, delete it when clean"
```

---

### Task 4: Pointer files for the shell hook

The design doc's hook snippet hardcodes `~/.claude`, which defeats `skilled config dir`. The hook cannot call `resolveConfig()` — that would boot Node. So the CLI leaves the answer on disk in a fixed location the hook can read with shell builtins.

Two files, both under the same directory as `config.json`:

| File | Contents | Why the hook needs it |
|---|---|---|
| `dirs` | a `#` comment header, then one absolute managed dir per line | respects `skilled config dir` without booting Node |
| `refresh-cmd` | line 1: absolute path to the Node executable · line 2: absolute path to `dist/refresh.js` | Claude Code hooks run with a non-interactive PATH; npm globals installed under nvm are frequently *not* on it, so a `command -v` lookup alone would silently never refresh |

`refresh-cmd` is self-healing: every successful `skilled-refresh` run rewrites it, so a Node version switch is corrected the first time the fallback PATH lookup succeeds.

**Files:**
- Create: `src/pointers.ts`
- Test: `tests/pointers.test.ts`

**Interfaces:**
- Consumes: `configPath()` from `src/config.ts` (spec 01) — for the agreement test only.
- Produces:
  - `pointerDir(env?: NodeJS.ProcessEnv): string`
  - `dirsPointerPath(env?: NodeJS.ProcessEnv): string`
  - `refreshCmdPath(env?: NodeJS.ProcessEnv): string`
  - `writePointers(dirs: string[], cmd: { exe: string; script: string }, env?: NodeJS.ProcessEnv): Promise<void>`

`pointerDir` takes the environment as a parameter rather than reading `process.env` at import time, so tests never depend on the real `~/.config`.

- [ ] **Step 1: Write the failing test**

Create `tests/pointers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pointerDir, dirsPointerPath, refreshCmdPath, writePointers } from '../src/pointers.js';
import { configPath } from '../src/config.js';

describe('pointer files', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
    env = { XDG_CONFIG_HOME: path.join(home, '.config'), HOME: home };
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('honors XDG_CONFIG_HOME', () => {
    expect(pointerDir(env)).toBe(path.join(home, '.config', 'skilled'));
    expect(dirsPointerPath(env)).toBe(path.join(home, '.config', 'skilled', 'dirs'));
    expect(refreshCmdPath(env)).toBe(path.join(home, '.config', 'skilled', 'refresh-cmd'));
  });

  it('falls back to $HOME/.config when XDG_CONFIG_HOME is unset', () => {
    expect(pointerDir({ HOME: home })).toBe(path.join(home, '.config', 'skilled'));
  });

  it('lands in the same directory as spec 01 config.json', () => {
    // The hook reads `dirs` from a path derived the same way config.ts derives
    // config.json. If these ever diverge, the hook reads a file nobody writes.
    expect(pointerDir()).toBe(path.dirname(configPath()));
  });

  it('writes one absolute managed dir per line, under a comment header', async () => {
    await writePointers(['/a/.claude', '/b/.codex'], { exe: '/usr/bin/node', script: '/pkg/dist/refresh.js' }, env);
    const text = await fs.readFile(dirsPointerPath(env), 'utf8');
    const lines = text.split('\n').filter((l) => l !== '');
    expect(lines[0].startsWith('#')).toBe(true);
    expect(lines.slice(1)).toEqual(['/a/.claude', '/b/.codex']);
  });

  it('writes the node executable on line 1 and the script on line 2', async () => {
    await writePointers(['/a/.claude'], { exe: '/usr/bin/node', script: '/pkg/dist/refresh.js' }, env);
    const text = await fs.readFile(refreshCmdPath(env), 'utf8');
    expect(text.split('\n').slice(0, 2)).toEqual(['/usr/bin/node', '/pkg/dist/refresh.js']);
  });

  it('replaces previous contents instead of appending', async () => {
    await writePointers(['/a/.claude', '/b/.codex'], { exe: '/usr/bin/node', script: '/pkg/dist/refresh.js' }, env);
    await writePointers(['/c/.claude'], { exe: '/opt/node', script: '/pkg2/dist/refresh.js' }, env);
    const dirs = await fs.readFile(dirsPointerPath(env), 'utf8');
    expect(dirs.split('\n').filter((l) => l !== '' && !l.startsWith('#'))).toEqual(['/c/.claude']);
    const cmd = await fs.readFile(refreshCmdPath(env), 'utf8');
    expect(cmd.split('\n').slice(0, 2)).toEqual(['/opt/node', '/pkg2/dist/refresh.js']);
  });

  it('creates the pointer directory when it does not exist', async () => {
    await writePointers(['/a/.claude'], { exe: '/usr/bin/node', script: '/pkg/dist/refresh.js' }, env);
    const stat = await fs.stat(pointerDir(env));
    expect(stat.isDirectory()).toBe(true);
  });

  it('leaves no temp files behind', async () => {
    await writePointers(['/a/.claude'], { exe: '/usr/bin/node', script: '/pkg/dist/refresh.js' }, env);
    const entries = (await fs.readdir(pointerDir(env))).sort();
    expect(entries).toEqual(['dirs', 'refresh-cmd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pointers.test.ts`
Expected: FAIL with `Failed to resolve import "../src/pointers.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/pointers.ts`:

```ts
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where the shell hook looks for its pointers. Deliberately derived from the
 * environment rather than from config.ts, because the hook derives the same path
 * in POSIX sh and the two must agree without importing anything.
 * tests/pointers.test.ts asserts the agreement with config.ts's configPath().
 */
export function pointerDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== ''
    ? env.XDG_CONFIG_HOME
    : path.join(env.HOME ?? os.homedir(), '.config');
  return path.join(base, 'skilled');
}

/** One absolute managed directory per line, `#` comments allowed. */
export function dirsPointerPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(pointerDir(env), 'dirs');
}

/** Line 1: the node executable. Line 2: the refresh entrypoint script. */
export function refreshCmdPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(pointerDir(env), 'refresh-cmd');
}

async function writeAtomic(target: string, contents: string): Promise<void> {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, contents, 'utf8');
  await fsp.rename(tmp, target);
}

/**
 * Refresh both pointer files. Called before any network work, so a failed
 * refresh still leaves the hook correctly wired.
 */
export async function writePointers(
  dirs: string[],
  cmd: { exe: string; script: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await fsp.mkdir(pointerDir(env), { recursive: true });
  const header = '# written by skilled-refresh — change this with `skilled config dir <path>`\n';
  await writeAtomic(dirsPointerPath(env), header + dirs.map((d) => `${d}\n`).join(''));
  await writeAtomic(refreshCmdPath(env), `${cmd.exe}\n${cmd.script}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pointers.test.ts`
Expected: PASS, 8 tests.

If the `lands in the same directory as spec 01 config.json` case fails, spec 01's `configPath()` resolves differently (for example it ignores an empty `XDG_CONFIG_HOME`). Do not change `config.ts` — align `pointerDir` to it, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/pointers.ts tests/pointers.test.ts
git commit -m "feat(pointers): let the shell hook find managed dirs without booting node"
```

---

### Task 5: Background refresh entrypoint

The one place Node runs. Non-interactive, silent on stdout, and it must never throw — the hook spawns it detached and discards its output, so an uncaught rejection would be an invisible permanent failure.

**Files:**
- Create: `src/refresh.ts`
- Test: `tests/refresh.test.ts`

**Interfaces:**
- Consumes: `resolveConfig` from `src/config.ts` (01); `buildStatus`, `writeCachedStatus` from `src/status.ts` (02); `createGitHubClient`, `resolveToken` from `src/fetch.ts` (03); `writeStatusLine` (Task 3); `writePointers` (Task 4). Collaborators are injected into `runRefresh` so tests stay hermetic — the real ones are wired only inside `main()`.
- Produces: `runRefresh(deps: RefreshDeps): Promise<number>`, and the `dist/refresh.js` executable that Task 6 exposes as `skilled-refresh`.

**Order of operations in `main()` is load-bearing:** write the pointers *first*. A machine with no GitHub token still gets a correctly wired hook.

- [ ] **Step 1: Write the failing test**

Create `tests/refresh.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRefresh } from '../src/refresh.js';
import { statusLinePath, cachePath } from '../src/config.js';
import type { StatusReport, StatusRow } from '../src/types.js';

function report(dir: string, rows: StatusRow[]): StatusReport {
  return {
    dir,
    rows,
    identified: rows.length,
    total: rows.length,
    behind: rows.filter((r) => r.status === 'behind').length,
    unknown: 0,
    fetchedAt: '2026-08-27T09:00:00Z',
  };
}
const behind = (id: string): StatusRow => ({ id, status: 'behind', behindBy: 2, localEdits: false });
const current = (id: string): StatusRow => ({ id, status: 'current', localEdits: false });

describe('runRefresh', () => {
  let a: string;
  let b: string;

  beforeEach(async () => {
    a = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
    b = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
    for (const dir of [a, b]) await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  });

  it('writes the cache and the status line for every managed dir, and returns 0', async () => {
    const cached: string[] = [];
    const code = await runRefresh({
      dirs: [a, b],
      buildStatus: async (dir) => report(dir, [behind('skills/cso')]),
      writeCache: async (dir) => { cached.push(dir); },
    });

    expect(code).toBe(0);
    expect(cached).toEqual([a, b]);
    expect(await fs.readFile(statusLinePath(a), 'utf8')).toBe(
      'skilled: 1 skill behind upstream (cso) · run `skilled update`\n',
    );
    expect(await fs.readFile(statusLinePath(b), 'utf8')).toContain('behind upstream');
  });

  it('clears a stale status line when the dir has gone clean', async () => {
    await fs.mkdir(path.join(a, '.skilled'), { recursive: true });
    await fs.writeFile(statusLinePath(a), 'skilled: 9 skills behind upstream (x, y, z) · run `skilled update`\n');

    const code = await runRefresh({
      dirs: [a],
      buildStatus: async (dir) => report(dir, [current('skills/cso')]),
      writeCache: async () => {},
    });

    expect(code).toBe(0);
    await expect(fs.readFile(statusLinePath(a), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns 3 when a dir fails, and still processes the others', async () => {
    const code = await runRefresh({
      dirs: [a, b],
      buildStatus: async (dir) => {
        if (dir === a) throw new Error('github unreachable');
        return report(dir, [behind('skills/git')]);
      },
      writeCache: async () => {},
    });

    expect(code).toBe(3);
    expect(await fs.readFile(statusLinePath(b), 'utf8')).toContain('git');
  });

  it('leaves an existing status line alone when the refresh for that dir fails', async () => {
    await fs.mkdir(path.join(a, '.skilled'), { recursive: true });
    await fs.writeFile(statusLinePath(a), 'skilled: 1 skill behind upstream (cso) · run `skilled update`\n');

    await runRefresh({
      dirs: [a],
      buildStatus: async () => { throw new Error('rate limited'); },
      writeCache: async () => {},
    });

    expect(await fs.readFile(statusLinePath(a), 'utf8')).toBe(
      'skilled: 1 skill behind upstream (cso) · run `skilled update`\n',
    );
  });

  it('never rejects, even when writeCache throws', async () => {
    await expect(
      runRefresh({
        dirs: [a],
        buildStatus: async (dir) => report(dir, [behind('skills/cso')]),
        writeCache: async () => { throw new Error('disk full'); },
      }),
    ).resolves.toBe(3);
  });

  it('returns 0 with no dirs to refresh', async () => {
    expect(await runRefresh({ dirs: [], buildStatus: async () => { throw new Error('unused'); }, writeCache: async () => {} })).toBe(0);
  });

  it('writes nothing to stdout — the hook discards it and a stray print would be lost anyway', async () => {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: string) => { chunks.push(String(chunk)); return true; };
    try {
      await runRefresh({ dirs: [a], buildStatus: async (dir) => report(dir, [behind('skills/cso')]), writeCache: async () => {} });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = original;
    }
    expect(chunks.join('')).toBe('');
  });

  it('does not use the cachePath helper by hand — cache writing is spec 02 territory', async () => {
    // Guard against re-implementing writeCachedStatus here: runRefresh must delegate.
    const code = await runRefresh({
      dirs: [a],
      buildStatus: async (dir) => report(dir, [behind('skills/cso')]),
      writeCache: async () => {},
    });
    expect(code).toBe(0);
    await expect(fs.readFile(cachePath(a), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/refresh.test.ts`
Expected: FAIL with `Failed to resolve import "../src/refresh.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/refresh.ts`:

```ts
#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveConfig } from './config.js';
import { buildStatus, writeCachedStatus } from './status.js';
import { createGitHubClient, resolveToken } from './fetch.js';
import { writeStatusLine } from './statusline.js';
import { writePointers } from './pointers.js';
import type { StatusReport } from './types.js';

export interface RefreshDeps {
  /** absolute managed directories, in precedence order */
  dirs: string[];
  buildStatus: (dir: string) => Promise<StatusReport>;
  writeCache: (dir: string, report: StatusReport) => Promise<void>;
}

/**
 * Refresh every managed directory and leave the cache and the status line up to
 * date. Returns 0 when every dir succeeded, 3 when any of them failed — and
 * never rejects: this runs detached from a session-start hook with its output
 * discarded, so an uncaught rejection would be an invisible permanent failure.
 * A dir that fails keeps whatever status line it already had; overwriting it
 * with silence would hide news the user has not acted on yet.
 */
export async function runRefresh(deps: RefreshDeps): Promise<number> {
  let code = 0;
  for (const dir of deps.dirs) {
    try {
      const report = await deps.buildStatus(dir);
      await deps.writeCache(dir, report);
      await writeStatusLine(dir, report);
    } catch (err) {
      code = 3;
      process.stderr.write(`skilled-refresh: ${dir}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return code;
}

async function main(): Promise<void> {
  let code = 0;
  try {
    const config = await resolveConfig({ env: process.env });

    // Pointers first: a machine with no token or no network still ends up with a
    // correctly wired hook.
    await writePointers(config.dirs, {
      exe: process.execPath,
      script: fileURLToPath(import.meta.url),
    });

    const github = createGitHubClient(await resolveToken());
    code = await runRefresh({
      dirs: config.dirs,
      buildStatus: (dir) => buildStatus(dir, { github }, { refresh: true }),
      writeCache: writeCachedStatus,
    });
  } catch (err) {
    process.stderr.write(`skilled-refresh: ${err instanceof Error ? err.message : String(err)}\n`);
    code = 3;
  }
  process.exit(code);
}

// Only run when executed directly, so importing this module in a test is inert.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/refresh.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/refresh.ts tests/refresh.test.ts
git commit -m "feat(refresh): non-interactive entrypoint that refreshes cache, status line, and pointers"
```

---

### Task 6: Expose `skilled-refresh` as a binary

The hook invokes a built file by absolute path, so `dist/refresh.js` has to exist and be executable.

**Files:**
- Modify: `package.json` (keys `bin`, `scripts.build` only)
- Create: `tsconfig.build.json` (only on branch B below)

**Interfaces:**
- Consumes: spec 01's existing `bin.skilled` value and `tsconfig.json`.
- Produces: `dist/refresh.js` with a `#!/usr/bin/env node` shebang, reachable as `skilled-refresh` after a global install. Task 8's hook and Task 16's CI both depend on it.

- [ ] **Step 1: Read what spec 01 already established**

Run:

```bash
node -e "const p=require('./package.json');console.log(JSON.stringify({bin:p.bin,scripts:p.scripts,type:p.type},null,2))" && cat tsconfig.json
```

Note the exact value of `bin.skilled`. Two branches follow:

- **Branch A — `bin.skilled` points into a build output directory** (for example `dist/cli.js`) and `scripts.build` exists. Mirror it: `skilled-refresh` becomes the sibling `refresh.js` in the same directory. Skip Step 3.
- **Branch B — there is no build script, or `tsconfig.json` sets `noEmit`/has no `outDir`.** Add an emit-only config in Step 3 and point both bins at `dist/`.

- [ ] **Step 2: Add the second bin entry**

Edit `package.json` so `bin` names both executables, keeping spec 01's path convention:

```json
{
  "bin": {
    "skilled": "dist/cli.js",
    "skilled-refresh": "dist/refresh.js"
  }
}
```

If Step 1 showed a different directory for `bin.skilled`, use that same directory for `skilled-refresh` instead of `dist/`.

- [ ] **Step 3: Add an emit config (branch B only)**

Create `tsconfig.build.json` — a separate file so spec 01's `tsconfig.json` is not edited:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests/**"]
}
```

Then add the build script to `package.json` (`scripts.build` is spec 04's to set per its publish-preparation scope):

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json"
  }
}
```

On branch A, leave `scripts.build` exactly as spec 01 wrote it.

- [ ] **Step 4: Build and verify both binaries run**

`skilled-refresh` takes no flags and goes straight to work, so verify it against a
scratch `HOME` — running it bare would refresh the real `~/.claude` and write the
real `~/.config/skilled`.

```bash
npm run build \
  && head -1 dist/refresh.js \
  && node dist/cli.js --version
scratch="$(mktemp -d /tmp/skilled-verify-XXXXXX)"
env -i HOME="$scratch" XDG_CONFIG_HOME="$scratch/.config" PATH=/usr/bin:/bin \
  node dist/refresh.js; echo "refresh exit: $?"
find "$scratch" -type f | sed "s|$scratch|<scratch>|"
rm -rf "$scratch"
```

Expected: `#!/usr/bin/env node` on the first line of `dist/refresh.js`, a version
string from the CLI, and `refresh exit: 0` or `refresh exit: 3` — either proves it
booted and exited cleanly (`3` is correct here: the scratch home has no managed
directory). The `find` output must list only paths under `<scratch>`, proving it
wrote nowhere else. A non-zero `npm run build`, a missing shebang, or a stack
trace is a failure — fix before committing.

If the shebang is missing, TypeScript dropped it because it was not the very first line of `src/refresh.ts`. Move `#!/usr/bin/env node` to line 1, above every import.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.build.json
git commit -m "chore: expose skilled-refresh as a second bin entry"
```

---

### Task 7: The hook prints cached news, and nothing else

Half the hook: resolve the managed directories from the pointer file, print each non-empty status line, exit 0. No refresh trigger yet — that is Task 8.

**Files:**
- Create: `hooks/session-start.sh`
- Test: `tests/hook-status.test.ts`

**Interfaces:**
- Consumes: the `dirs` pointer file layout from Task 4; the state-directory layout fixed by the contract (`<dir>/.skilled/status`, `<dir>/.skilled/cache/status.json`, `<dir>/.skilled/manifest.json`).
- Produces: `hooks/session-start.sh`, consumed by Task 8 (extends it), Task 9 (times it), Task 10 (installs it) and Task 15 (`npm pack`).

**Why builtins instead of `cat`.** Every external command is a `fork` + `exec`, roughly 2–4ms on macOS. The whole budget is 10ms. A `while read` loop over the status file costs nothing measurable, so the script pays for exactly one external command — the `find` added in Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/hook-status.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusLinePath, cachePath, manifestPath } from '../src/config.js';

const HOOK = fileURLToPath(new URL('../hooks/session-start.sh', import.meta.url));
const NEWS = 'skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`\n';

let home: string | null = null;

interface Fixture {
  home: string;
  managed: string;
  env: NodeJS.ProcessEnv;
}

/**
 * A throwaway HOME with one managed dir at $HOME/.claude. PATH is deliberately
 * narrowed to an empty bin dir plus the system dirs, so a real globally
 * installed skilled-refresh on the developer's machine can never be invoked.
 */
async function fixture(): Promise<Fixture> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  const managed = path.join(home, '.claude');
  await fs.mkdir(path.join(managed, 'skills'), { recursive: true });
  await fs.mkdir(path.join(managed, '.skilled', 'cache'), { recursive: true });
  const emptyBin = path.join(home, 'empty-bin');
  await fs.mkdir(emptyBin, { recursive: true });
  return {
    home,
    managed,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      PATH: `${emptyBin}:/usr/bin:/bin`,
    },
  };
}

/** A fresh cache file, so the Task 8 refresh trigger stays quiet. */
async function freshCache(managed: string): Promise<void> {
  await fs.mkdir(path.dirname(cachePath(managed)), { recursive: true });
  await fs.writeFile(cachePath(managed), '{"version":1}');
}

async function writePointer(env: NodeJS.ProcessEnv, dirs: string[]): Promise<void> {
  const dir = path.join(String(env.XDG_CONFIG_HOME), 'skilled');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'dirs'), `# test pointer\n${dirs.map((d) => `${d}\n`).join('')}`);
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/sh', [HOOK], { env: env as Record<string, string>, encoding: 'utf8' });
}

afterEach(async () => {
  if (home !== null) {
    await fs.rm(home, { recursive: true, force: true });
    home = null;
  }
});

describe('session-start hook: what it prints', () => {
  it('prints the cached line verbatim when there is news', async () => {
    const f = await fixture();
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), NEWS);

    const r = run(f.env);
    expect(r.stdout).toBe(NEWS);
    expect(r.status).toBe(0);
  });

  it('is silent when there is no status file — a hook that always speaks gets deleted', async () => {
    const f = await fixture();
    await freshCache(f.managed);

    const r = run(f.env);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('is silent when the status file exists but is empty', async () => {
    const f = await fixture();
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), '');

    const r = run(f.env);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
  });

  it('prints a final line that has no trailing newline', async () => {
    const f = await fixture();
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), 'skilled: 1 skill behind upstream (cso) · run `skilled update`');

    const r = run(f.env);
    expect(r.stdout).toBe('skilled: 1 skill behind upstream (cso) · run `skilled update`\n');
    expect(r.status).toBe(0);
  });

  it('falls back to $HOME/.claude when no pointer file exists', async () => {
    const f = await fixture();
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), NEWS);

    const r = run(f.env);
    expect(r.stdout).toBe(NEWS);
  });

  it('reads the managed dirs from the pointer file, in order, and ignores comments', async () => {
    const f = await fixture();
    const other = path.join(f.home, 'codex');
    await fs.mkdir(path.join(other, '.skilled', 'cache'), { recursive: true });
    await freshCache(other);
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(other), 'skilled: 1 agent behind upstream (thomas) · run `skilled update`\n');
    await fs.writeFile(statusLinePath(f.managed), NEWS);
    await writePointer(f.env, [other, f.managed]);

    const r = run(f.env);
    expect(r.stdout).toBe(
      'skilled: 1 agent behind upstream (thomas) · run `skilled update`\n' + NEWS,
    );
    expect(r.status).toBe(0);
  });

  it('does not read $HOME/.claude once a pointer file exists', async () => {
    const f = await fixture();
    const other = path.join(f.home, 'codex');
    await fs.mkdir(path.join(other, '.skilled', 'cache'), { recursive: true });
    await freshCache(other);
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), NEWS);
    await writePointer(f.env, [other]);

    const r = run(f.env);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(0);
  });

  it('is silent and exits 0 when the managed dir has no .skilled state yet', async () => {
    const f = await fixture();
    await fs.rm(path.join(f.managed, '.skilled'), { recursive: true, force: true });

    const r = run(f.env);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('exits 0 when the pointer file names a directory that no longer exists', async () => {
    const f = await fixture();
    await writePointer(f.env, [path.join(f.home, 'deleted-dir')]);

    const r = run(f.env);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('exits 0 when the pointer file is empty', async () => {
    const f = await fixture();
    const dir = path.join(String(f.env.XDG_CONFIG_HOME), 'skilled');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'dirs'), '');
    await freshCache(f.managed);
    await fs.writeFile(statusLinePath(f.managed), NEWS);

    const r = run(f.env);
    // An empty pointer file is treated as "not written yet", so the default applies.
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(NEWS);
  });

  it('hardcodes the same state paths that config.ts computes', async () => {
    // The hook cannot import config.ts, so this asserts the two agree.
    const script = await fs.readFile(HOOK, 'utf8');
    const rel = (p: string) => p.slice('/m/'.length);
    expect(rel(statusLinePath('/m'))).toBe('.skilled/status');
    expect(rel(cachePath('/m'))).toBe('.skilled/cache/status.json');
    expect(rel(manifestPath('/m'))).toBe('.skilled/manifest.json');
    expect(script).toContain('$dir/.skilled');
    expect(script).toContain('$state/status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hook-status.test.ts`
Expected: FAIL — `spawnSync /bin/sh ENOENT` on the script path, or `hooks/session-start.sh: No such file or directory` with a non-zero status, because the script does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `hooks/session-start.sh`:

```sh
#!/bin/sh
# skilled — Claude Code SessionStart hook.
#
# Runs on every session start, so it is pure POSIX shell and never boots Node in
# the foreground: Node costs 80-150ms to start, and paying that on every session
# is exactly the cost this tool exists to avoid. Shell builtins do the reading;
# see the sibling comment in Task 8 for the single external command this pays for.
#
# Every failure is swallowed and the script always exits 0. A broken skilled
# install must never break a Claude Code session.

# --- which directories does skilled manage? --------------------------------
# `skilled-refresh` maintains this pointer file so the hook honors
# `skilled config dir` without asking Node. Absent or empty means skilled has
# not run yet, so fall back to the autodetect default.
pointer="${XDG_CONFIG_HOME:-$HOME/.config}/skilled/dirs"
dirs=""
if [ -s "$pointer" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | \#*) ;;
      *) dirs="$dirs
$line" ;;
    esac
  done < "$pointer"
fi
[ -n "$dirs" ] || dirs="$HOME/.claude"

# Split on newlines only: managed paths may contain spaces.
IFS='
'
for dir in $dirs; do
  [ -n "$dir" ] || continue
  state="$dir/.skilled"
  # skilled has never run here: nothing cached, nothing to say.
  [ -d "$state" ] || continue

  # Speak only when there is news. The writer deletes this file when everything
  # is current, so `-s` is the whole "is there news?" test.
  if [ -s "$state/status" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      printf '%s\n' "$line"
    done < "$state/status"
  fi
done
unset IFS

exit 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hook-status.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.sh tests/hook-status.test.ts
git commit -m "feat(hook): print the cached status line without booting node"
```

---

### Task 8: The hook refreshes in the background, never in the foreground

The other half. Two conditions mean "the cache is out of date":

1. `cache/status.json` is missing, or older than 12h (`-mmin +720`)
2. `manifest.json` is **newer** than `cache/status.json` — you ran `skilled update`, `add`, or `remove`, so the cached line may be telling you about work you have already done

Both are answered by **one** `find` call, the script's only external command. `-mmin` and `-newer` are both POSIX; `-quit` is not portable and is not used.

The spawn itself reads `refresh-cmd` (Task 4) so it does not depend on PATH — Claude Code hooks run non-interactively, and npm globals under nvm are frequently absent from that PATH. A `command -v skilled-refresh` fallback covers the first run before any pointer exists.

**Files:**
- Modify: `hooks/session-start.sh`
- Test: `tests/hook-refresh.test.ts`

**Interfaces:**
- Consumes: the `refresh-cmd` layout from Task 4; the `skilled-refresh` binary from Task 6.
- Produces: the complete hook, timed by Task 9 and installed by Task 10.

- [ ] **Step 1: Write the failing test**

Create `tests/hook-refresh.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath, manifestPath, statusLinePath } from '../src/config.js';

const HOOK = fileURLToPath(new URL('../hooks/session-start.sh', import.meta.url));

let home: string | null = null;

interface Fixture {
  home: string;
  managed: string;
  marker: string;
  env: NodeJS.ProcessEnv;
}

/**
 * A throwaway HOME whose refresh-cmd points at a fake refresh script, so no
 * Node and no network are involved. PATH excludes any real skilled-refresh.
 */
async function fixture(opts: { fakeBody: string }): Promise<Fixture> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  const managed = path.join(home, '.claude');
  await fs.mkdir(path.join(managed, 'skills'), { recursive: true });
  await fs.mkdir(path.dirname(cachePath(managed)), { recursive: true });

  const marker = path.join(home, 'refresh-ran');
  const fake = path.join(home, 'fake-refresh.sh');
  await fs.writeFile(fake, `#!/bin/sh\n${opts.fakeBody.replace(/__MARKER__/g, marker)}\n`, { mode: 0o755 });

  const cfg = path.join(home, '.config', 'skilled');
  await fs.mkdir(cfg, { recursive: true });
  await fs.writeFile(path.join(cfg, 'refresh-cmd'), `/bin/sh\n${fake}\n`);

  const emptyBin = path.join(home, 'empty-bin');
  await fs.mkdir(emptyBin, { recursive: true });

  return {
    home,
    managed,
    marker,
    env: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), PATH: `${emptyBin}:/usr/bin:/bin` },
  };
}

async function setCacheAge(managed: string, minutesAgo: number): Promise<void> {
  await fs.writeFile(cachePath(managed), '{"version":1}');
  const when = new Date(Date.now() - minutesAgo * 60_000);
  await fs.utimes(cachePath(managed), when, when);
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/sh', [HOOK], { env: env as Record<string, string>, encoding: 'utf8' });
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function waitFor(p: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await exists(p)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

afterEach(async () => {
  if (home !== null) {
    await fs.rm(home, { recursive: true, force: true });
    home = null;
  }
});

describe('session-start hook: background refresh', () => {
  it('spawns the refresh when the cache is older than 12h', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await setCacheAge(f.managed, 13 * 60);

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(await waitFor(f.marker, 3000)).toBe(true);
  });

  it('does not spawn the refresh when the cache is fresh', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await setCacheAge(f.managed, 5);

    const r = run(f.env);
    expect(r.status).toBe(0);
    await new Promise((res) => setTimeout(res, 300));
    expect(await exists(f.marker)).toBe(false);
  });

  it('spawns the refresh when the cache is missing but .skilled exists', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(await waitFor(f.marker, 3000)).toBe(true);
  });

  it('spawns the refresh when the manifest is newer than the cache', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await setCacheAge(f.managed, 60);
    await fs.writeFile(manifestPath(f.managed), '{"version":1,"entries":[],"unknown":[]}');

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(await waitFor(f.marker, 3000)).toBe(true);
  });

  it('does not spawn when the manifest is older than the cache', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await fs.writeFile(manifestPath(f.managed), '{"version":1,"entries":[],"unknown":[]}');
    const old = new Date(Date.now() - 120 * 60_000);
    await fs.utimes(manifestPath(f.managed), old, old);
    await setCacheAge(f.managed, 5);

    const r = run(f.env);
    expect(r.status).toBe(0);
    await new Promise((res) => setTimeout(res, 300));
    expect(await exists(f.marker)).toBe(false);
  });

  it('never spawns when the managed dir has no .skilled state', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await fs.rm(path.join(f.managed, '.skilled'), { recursive: true, force: true });

    const r = run(f.env);
    expect(r.status).toBe(0);
    await new Promise((res) => setTimeout(res, 300));
    expect(await exists(f.marker)).toBe(false);
  });

  it('spawns at most one refresh even with several managed dirs out of date', async () => {
    const f = await fixture({ fakeBody: 'printf x >> "__MARKER__"' });
    const other = path.join(f.home, 'codex');
    await fs.mkdir(path.dirname(cachePath(other)), { recursive: true });
    await setCacheAge(f.managed, 13 * 60);
    await setCacheAge(other, 13 * 60);
    const cfg = path.join(f.home, '.config', 'skilled');
    await fs.writeFile(path.join(cfg, 'dirs'), `# test\n${f.managed}\n${other}\n`);

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(await waitFor(f.marker, 3000)).toBe(true);
    await new Promise((res) => setTimeout(res, 300));
    expect(await fs.readFile(f.marker, 'utf8')).toBe('x');
  });

  it('returns without waiting for the refresh to finish', async () => {
    // The proof that Node is not booted in the foreground: the fake refresh
    // sleeps for a second, and the hook must be long gone before it finishes.
    const f = await fixture({ fakeBody: 'sleep 1\n: > "__MARKER__"' });

    const started = Date.now();
    const r = run(f.env);
    const elapsed = Date.now() - started;

    expect(r.status).toBe(0);
    expect(elapsed).toBeLessThan(250);
    expect(await exists(f.marker)).toBe(false);
    expect(await waitFor(f.marker, 4000)).toBe(true);
  });

  it('still prints the cached line while the refresh runs in the background', async () => {
    const f = await fixture({ fakeBody: 'sleep 1\n: > "__MARKER__"' });
    await fs.writeFile(statusLinePath(f.managed), 'skilled: 1 skill behind upstream (cso) · run `skilled update`\n');

    const r = run(f.env);
    expect(r.stdout).toBe('skilled: 1 skill behind upstream (cso) · run `skilled update`\n');
    expect(r.status).toBe(0);
  });

  it('exits 0 when refresh-cmd points at something unusable and nothing is on PATH', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await fs.writeFile(
      path.join(f.home, '.config', 'skilled', 'refresh-cmd'),
      `${path.join(f.home, 'no-such-node')}\n${path.join(f.home, 'no-such-script.js')}\n`,
    );

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    await new Promise((res) => setTimeout(res, 300));
    expect(await exists(f.marker)).toBe(false);
  });

  it('falls back to PATH when refresh-cmd does not exist yet', async () => {
    const f = await fixture({ fakeBody: ': > "__MARKER__"' });
    await fs.rm(path.join(f.home, '.config', 'skilled', 'refresh-cmd'), { force: true });
    const bin = path.join(f.home, 'empty-bin');
    await fs.writeFile(path.join(bin, 'skilled-refresh'), `#!/bin/sh\n: > "${f.marker}"\n`, { mode: 0o755 });

    const r = run(f.env);
    expect(r.status).toBe(0);
    expect(await waitFor(f.marker, 3000)).toBe(true);
  });

  it('never names a foreground interpreter (static read of the script)', async () => {
    const script = await fs.readFile(HOOK, 'utf8');
    const lines = script.split('\n');
    const code = lines.filter((l) => !/^\s*#/.test(l));

    for (const line of code) {
      expect(line, `executable line names an interpreter: ${line}`).not.toMatch(/\b(node|npx|npm)\b/);
    }

    const backgrounded = /^\s*\(.*&\s*\)\s*$/;
    for (const line of code.filter((l) => l.includes('"$exe" "$script"'))) {
      expect(line, `not backgrounded: ${line}`).toMatch(backgrounded);
    }
    for (const line of code.filter((l) => /(^|\(\s*)skilled-refresh\b/.test(l.trim()) || /\(\s*skilled-refresh\b/.test(l))) {
      expect(line.includes('command -v') || backgrounded.test(line), `not backgrounded: ${line}`).toBe(true);
    }
  });

  it('pays for exactly one external command', async () => {
    // The 10ms budget in tests/hook-timing.test.ts depends on this: every fork
    // costs 2-4ms. `find` is the only one allowed on the common path.
    const script = await fs.readFile(HOOK, 'utf8');
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect((code.match(/\bfind\b/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/\b(cat|grep|sed|awk|stat|date|tr|cut)\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hook-refresh.test.ts`
Expected: FAIL — `spawns the refresh when the cache is older than 12h` fails because the marker never appears (the current script only prints; it has no refresh trigger).

- [ ] **Step 3: Write minimal implementation**

In `hooks/session-start.sh`, replace the body of the `for dir in $dirs` loop's tail and the final `exit 0` so the file reads as follows from the loop onward. Everything above the loop is unchanged from Task 7.

```sh
need_refresh=""

# Split on newlines only: managed paths may contain spaces.
IFS='
'
for dir in $dirs; do
  [ -n "$dir" ] || continue
  state="$dir/.skilled"
  # skilled has never run here: nothing cached, nothing to say, nothing to refresh.
  [ -d "$state" ] || continue

  # Speak only when there is news. The writer deletes this file when everything
  # is current, so `-s` is the whole "is there news?" test.
  if [ -s "$state/status" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      printf '%s\n' "$line"
    done < "$state/status"
  fi

  # Is the cache out of date? Two conditions, one `find` — this is the only
  # external command the hook runs, and every fork costs 2-4ms of the 10ms budget.
  #   1. the cache is older than 12h (720 minutes)
  #   2. the manifest is newer than the cache, i.e. you have run update/add/remove
  #      since the line was written, so it may be describing work already done
  cache="$state/cache/status.json"
  manifest="$state/manifest.json"
  if [ ! -f "$cache" ]; then
    need_refresh=1
  elif [ -z "$need_refresh" ] && [ -n "$(find "$cache" "$manifest" \
      \( \( -name status.json -mmin +720 \) -o \( -name manifest.json -newer "$cache" \) \) \
      -print 2>/dev/null)" ]; then
    need_refresh=1
  fi
done
unset IFS

# --- background refresh -----------------------------------------------------
# The only place Node runs, and the hook does not wait for it. `( cmd & )`
# detaches: the subshell exits at once, so the refresh outlives this script.
# The command comes from a pointer file rather than PATH, because Claude Code
# hooks run non-interactively and npm globals under nvm are often not on it.
if [ -n "$need_refresh" ]; then
  exe=""
  script=""
  cmd_file="${XDG_CONFIG_HOME:-$HOME/.config}/skilled/refresh-cmd"
  if [ -s "$cmd_file" ]; then
    { IFS= read -r exe; IFS= read -r script; } < "$cmd_file"
  fi
  if [ -n "$exe" ] && [ -x "$exe" ] && [ -n "$script" ] && [ -f "$script" ]; then
    ( "$exe" "$script" >/dev/null 2>&1 & )
  elif command -v skilled-refresh >/dev/null 2>&1; then
    ( skilled-refresh >/dev/null 2>&1 & )
  fi
fi

exit 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hook-refresh.test.ts && npx vitest run tests/hook-status.test.ts`
Expected: PASS, 13 tests then 11 tests. Both files must stay green — Task 7's printing behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.sh tests/hook-refresh.test.ts
git commit -m "feat(hook): spawn a detached refresh when the cache is out of date"
```

---

### Task 9: Prove the hook costs under 10ms

The budget from the design doc's verification section. This task adds no production code — it adds the measurement that fails the build if the hook ever gets expensive.

**Measurement method, and why it is this and not `time`:**

- **Median of 20 runs, 3 discarded warmups.** A single run on a loaded laptop is noise.
- **Compare against a noop script run through the identical `spawnSync` path.** `spawnSync` itself costs several milliseconds (pipe setup, `fork`, `exec` of `/bin/sh`) and that cost is not the hook's. Subtracting a `exit 0` baseline measures what the hook actually adds, which is the number the 10ms budget is about.
- **Also assert an absolute ceiling.** A foreground Node boot is 80–150ms. An absolute median under 40ms is independent proof that no Node ran in the foreground, whatever the machine.
- **The common path is the one that must be under 10ms.** Fresh cache is what happens on all but one session in every twelve hours. The out-of-date path additionally forks a detached child, which is measured separately with its own documented allowance.

**Files:**
- Test: `tests/hook-timing.test.ts`

**Interfaces:**
- Consumes: `hooks/session-start.sh` from Task 8.
- Produces: the timing number quoted in the Definition of Done.

- [ ] **Step 1: Write the failing test**

Create `tests/hook-timing.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath, statusLinePath } from '../src/config.js';

const HOOK = fileURLToPath(new URL('../hooks/session-start.sh', import.meta.url));
const RUNS = 20;
const WARMUPS = 3;

/** The hook's own cost, over and above what it costs to start /bin/sh at all. */
const BUDGET_MS = 10;
/** A foreground node boot is 80-150ms. Anything near that fails here. */
const ABSOLUTE_CEILING_MS = 40;
/** The out-of-date path additionally forks a detached child: ~2 extra forks. */
const REFRESH_PATH_BUDGET_MS = 20;

let home: string | null = null;

afterEach(async () => {
  if (home !== null) {
    await fs.rm(home, { recursive: true, force: true });
    home = null;
  }
});

function medianMs(script: string, env: NodeJS.ProcessEnv): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS + WARMUPS; i += 1) {
    const started = process.hrtime.bigint();
    spawnSync('/bin/sh', [script], { env: env as Record<string, string>, encoding: 'utf8' });
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    if (i >= WARMUPS) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

interface Bench {
  hook: number;
  noop: number;
  overhead: number;
}

async function bench(opts: { cacheAgeMinutes: number | null; news: boolean }): Promise<Bench> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  const managed = path.join(home, '.claude');
  await fs.mkdir(path.join(managed, 'skills'), { recursive: true });
  await fs.mkdir(path.dirname(cachePath(managed)), { recursive: true });

  if (opts.cacheAgeMinutes !== null) {
    await fs.writeFile(cachePath(managed), '{"version":1}');
    const when = new Date(Date.now() - opts.cacheAgeMinutes * 60_000);
    await fs.utimes(cachePath(managed), when, when);
  }
  if (opts.news) {
    await fs.writeFile(statusLinePath(managed), 'skilled: 3 skills behind upstream (cso, git, retro) · run `skilled update`\n');
  }

  // A fake refresh so the out-of-date path spawns something real but cheap.
  const fake = path.join(home, 'fake-refresh.sh');
  await fs.writeFile(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const cfg = path.join(home, '.config', 'skilled');
  await fs.mkdir(cfg, { recursive: true });
  await fs.writeFile(path.join(cfg, 'refresh-cmd'), `/bin/sh\n${fake}\n`);

  const emptyBin = path.join(home, 'empty-bin');
  await fs.mkdir(emptyBin, { recursive: true });

  const noop = path.join(home, 'noop.sh');
  await fs.writeFile(noop, 'exit 0\n');

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${emptyBin}:/usr/bin:/bin`,
  };

  const hook = medianMs(HOOK, env);
  const noopMedian = medianMs(noop, env);
  return { hook, noop: noopMedian, overhead: hook - noopMedian };
}

describe('session-start hook: cost', () => {
  it('adds under 10ms on the common path (fresh cache, one line of news)', async () => {
    const b = await bench({ cacheAgeMinutes: 5, news: true });
    const detail = `hook median ${b.hook.toFixed(2)}ms, /bin/sh baseline ${b.noop.toFixed(2)}ms, hook overhead ${b.overhead.toFixed(2)}ms`;
    expect(b.overhead, detail).toBeLessThan(BUDGET_MS);
    expect(b.hook, detail).toBeLessThan(ABSOLUTE_CEILING_MS);
  }, 30_000);

  it('adds under 10ms when there is nothing to say', async () => {
    const b = await bench({ cacheAgeMinutes: 5, news: false });
    const detail = `hook median ${b.hook.toFixed(2)}ms, baseline ${b.noop.toFixed(2)}ms, overhead ${b.overhead.toFixed(2)}ms`;
    expect(b.overhead, detail).toBeLessThan(BUDGET_MS);
    expect(b.hook, detail).toBeLessThan(ABSOLUTE_CEILING_MS);
  }, 30_000);

  it('stays far below a node boot even when it spawns the refresh', async () => {
    const b = await bench({ cacheAgeMinutes: 13 * 60, news: true });
    const detail = `hook median ${b.hook.toFixed(2)}ms, baseline ${b.noop.toFixed(2)}ms, overhead ${b.overhead.toFixed(2)}ms`;
    // Two extra forks to detach the child. Still an order of magnitude below the
    // 80-150ms a foreground node boot would cost.
    expect(b.overhead, detail).toBeLessThan(REFRESH_PATH_BUDGET_MS);
    expect(b.hook, detail).toBeLessThan(ABSOLUTE_CEILING_MS);
  }, 30_000);

  it('reports the numbers so a regression is diagnosable', async () => {
    const b = await bench({ cacheAgeMinutes: 5, news: true });
    // eslint-disable-next-line no-console
    console.log(
      `session-start hook: ${b.hook.toFixed(2)}ms median of ${RUNS}, ` +
        `/bin/sh baseline ${b.noop.toFixed(2)}ms, hook overhead ${b.overhead.toFixed(2)}ms (budget ${BUDGET_MS}ms)`,
    );
    expect(b.hook).toBeGreaterThan(0);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Before running, temporarily add a deliberate regression to `hooks/session-start.sh` — insert this line immediately after the shebang:

```sh
sleep 0.05   # TEMPORARY: proves the timing test has teeth
```

Run: `npx vitest run tests/hook-timing.test.ts -t 'common path'`
Expected: FAIL with `hook median 5x.xxms, /bin/sh baseline x.xxms, hook overhead 5x.xxms` and `expected 5x.xx to be less than 10`.

This step exists because a timing assertion that has never failed is not a test. Confirm the failure message names the measured numbers.

- [ ] **Step 3: Remove the deliberate regression**

Delete the `sleep 0.05` line from `hooks/session-start.sh`. The script is back to exactly what Task 8 committed:

```bash
git diff --stat hooks/session-start.sh
```

Expected: no output — the file matches the last commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hook-timing.test.ts`
Expected: PASS, 4 tests, with a logged line of the form
`session-start hook: 6.41ms median of 20, /bin/sh baseline 4.02ms, hook overhead 2.39ms (budget 10ms)`.

If the overhead assertion fails on a genuinely unmodified script, the cause is an extra fork. Re-run `npx vitest run tests/hook-refresh.test.ts -t 'exactly one external command'` — that test names the offender.

- [ ] **Step 5: Commit**

```bash
git add tests/hook-timing.test.ts
git commit -m "test(hook): fail the build if the session-start hook exceeds 10ms"
```

---

### Task 10: Install the hook alongside whatever is already there

The user's `settings.json` may already run `git pull` on `SessionStart` and `git add -A && commit && push` on `Stop`. This install is **additive**: it appends one entry, keeps every existing entry in its existing order, and re-running it changes nothing.

**Why a `.mjs` helper and not shell.** Editing JSON with `sed` is how configuration files get corrupted. `jq` is not guaranteed to be installed; Node is, because that is how `skilled` got here. The helper is plain `.mjs` rather than TypeScript so it runs before any build exists, and its decision logic is exported as pure functions so it is unit-testable without a real `settings.json`.

**Files:**
- Create: `hooks/patch-settings.mjs`
- Create: `hooks/install.sh`
- Test: `tests/hook-install.test.ts`

**Interfaces:**
- Consumes: `hooks/session-start.sh` from Task 8; the Claude Code `SessionStart` schema (`hooks.SessionStart[].matcher` and `hooks.SessionStart[].hooks[] = { type: 'command', command }`).
- Produces: `addSessionStartHook(settings, commandPath)`, `MARKER`, and a working `sh hooks/install.sh`. Task 11 adds the removal half.

- [ ] **Step 1: Write the failing test**

Create `tests/hook-install.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSessionStartHook, MARKER } from '../hooks/patch-settings.mjs';

const INSTALL = fileURLToPath(new URL('../hooks/install.sh', import.meta.url));

/** What the user's real settings.json looks like before we touch it. */
const EXISTING = {
  model: 'fable',
  hooks: {
    SessionStart: [
      { matcher: '*', hooks: [{ type: 'command', command: 'cd ~/.claude && git pull --rebase' }] },
    ],
    Stop: [
      { matcher: '*', hooks: [{ type: 'command', command: 'cd ~/.claude && git add -A && git commit -m sync && git push' }] },
    ],
  },
};

let home: string | null = null;

interface Fixture {
  home: string;
  claudeDir: string;
  settings: string;
  dest: string;
  env: NodeJS.ProcessEnv;
}

/**
 * A throwaway HOME and CLAUDE_CONFIG_DIR. The fake bin dir holds a symlink to
 * the running node plus a no-op skilled-refresh, so install.sh never invokes a
 * real globally installed binary and never touches the real ~/.config/skilled.
 */
async function fixture(settings: unknown | null = EXISTING): Promise<Fixture> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'skilled-'));
  const claudeDir = path.join(home, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (settings !== null) {
    await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }

  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.symlink(process.execPath, path.join(bin, 'node'));
  await fs.writeFile(path.join(bin, 'skilled-refresh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  return {
    home,
    claudeDir,
    settings: settingsPath,
    dest: path.join(claudeDir, 'hooks', 'skilled-session-start.sh'),
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      PATH: `${bin}:/usr/bin:/bin`,
    },
  };
}

function install(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync('/bin/sh', [INSTALL, ...args], { env: env as Record<string, string>, encoding: 'utf8' });
}

async function readSettings(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
}

afterEach(async () => {
  if (home !== null) {
    await fs.rm(home, { recursive: true, force: true });
    home = null;
  }
});

describe('addSessionStartHook', () => {
  it('appends our entry after the existing ones, so git pull still runs first', () => {
    const { settings, changed } = addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh');
    expect(changed).toBe(true);
    const groups = settings.hooks.SessionStart;
    expect(groups).toHaveLength(2);
    expect(groups[0].hooks[0].command).toBe('cd ~/.claude && git pull --rebase');
    expect(groups[1].hooks[0].command).toContain(MARKER);
    expect(groups[1].matcher).toBe('startup|resume');
    expect(groups[1].hooks[0].type).toBe('command');
  });

  it('leaves other hook events untouched', () => {
    const { settings } = addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh');
    expect(settings.hooks.Stop).toEqual(EXISTING.hooks.Stop);
    expect(settings.model).toBe('fable');
  });

  it('is a no-op the second time', () => {
    const first = addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh');
    const second = addSessionStartHook(first.settings, '/h/.claude/hooks/skilled-session-start.sh');
    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });

  it('creates hooks.SessionStart when the file has no hooks at all', () => {
    const { settings, changed } = addSessionStartHook({ model: 'fable' }, '/h/.claude/hooks/skilled-session-start.sh');
    expect(changed).toBe(true);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.model).toBe('fable');
  });

  it('quotes a path containing spaces', () => {
    const { settings } = addSessionStartHook({}, '/h/My Claude/hooks/skilled-session-start.sh');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("sh '/h/My Claude/hooks/skilled-session-start.sh'");
  });

  it('does not quote a path that needs no quoting', () => {
    const { settings } = addSessionStartHook({}, '/h/.claude/hooks/skilled-session-start.sh');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('sh /h/.claude/hooks/skilled-session-start.sh');
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(EXISTING);
    addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh');
    expect(JSON.stringify(EXISTING)).toBe(before);
  });
});

describe('install.sh', () => {
  it('copies the hook, makes it executable, and appends to settings.json', async () => {
    const f = await fixture();
    const r = install(f.env);
    expect(r.status, r.stderr).toBe(0);

    const stat = await fs.stat(f.dest);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
    expect(await fs.readFile(f.dest, 'utf8')).toContain('skilled — Claude Code SessionStart hook');

    const settings = await readSettings(f.settings);
    const groups = (settings.hooks as { SessionStart: Array<{ hooks: Array<{ command: string }> }> }).SessionStart;
    expect(groups).toHaveLength(2);
    expect(groups[0].hooks[0].command).toBe('cd ~/.claude && git pull --rebase');
    expect(groups[1].hooks[0].command).toContain(MARKER);
  });

  it('backs up settings.json before editing it', async () => {
    const f = await fixture();
    install(f.env);
    const backups = (await fs.readdir(f.claudeDir)).filter((n) => n.startsWith('settings.json.bak.'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(path.join(f.claudeDir, backups[0]), 'utf8'))).toEqual(EXISTING);
  });

  it('is idempotent: running twice leaves one entry and says so', async () => {
    const f = await fixture();
    install(f.env);
    const afterFirst = await readSettings(f.settings);

    const second = install(f.env);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already installed');
    expect(await readSettings(f.settings)).toEqual(afterFirst);
  });

  it('works when settings.json does not exist yet', async () => {
    const f = await fixture(null);
    const r = install(f.env);
    expect(r.status, r.stderr).toBe(0);
    const settings = await readSettings(f.settings);
    expect((settings.hooks as { SessionStart: unknown[] }).SessionStart).toHaveLength(1);
  });

  it('refuses to guess when settings.json is not valid JSON, and changes nothing', async () => {
    const f = await fixture();
    await fs.writeFile(f.settings, '{ this is not json ');
    const r = install(f.env);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not valid JSON');
    expect(await fs.readFile(f.settings, 'utf8')).toBe('{ this is not json ');
  });

  it('rejects an unknown option with exit 2 and touches nothing', async () => {
    const f = await fixture();
    const r = install(f.env, '--force');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown option');
    expect(await readSettings(f.settings)).toEqual(EXISTING);
  });

  it('prints a usable summary of what it changed', async () => {
    const f = await fixture();
    const r = install(f.env);
    expect(r.stdout).toContain(f.dest);
    expect(r.stdout).toContain('existing hooks kept');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hook-install.test.ts`
Expected: FAIL with `Failed to resolve import "../hooks/patch-settings.mjs"`.

- [ ] **Step 3: Write the settings patcher**

Create `hooks/patch-settings.mjs`:

```js
#!/usr/bin/env node
// Additively edits <claude-dir>/settings.json for the skilled SessionStart hook.
//
// Plain .mjs rather than TypeScript because install.sh must work before any
// build exists. The decision logic is exported as pure functions so
// tests/hook-install.test.ts can exercise it without a real settings file.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Identifies our own entry. Present in the command string whatever the quoting. */
export const MARKER = 'skilled-session-start.sh';

/** POSIX shell quoting: only quote when the path actually needs it. */
function shellQuote(p) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Append our SessionStart entry. Never reorders, replaces, or removes anything
 * already there: ours goes last, so an existing `git pull` hook still runs first.
 */
export function addSessionStartHook(settings, commandPath) {
  const groups = Array.isArray(settings?.hooks?.SessionStart) ? [...settings.hooks.SessionStart] : [];
  const present = groups.some(
    (g) => Array.isArray(g?.hooks) && g.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(MARKER)),
  );
  if (present) return { settings, changed: false };

  groups.push({
    matcher: 'startup|resume',
    hooks: [{ type: 'command', command: `sh ${shellQuote(commandPath)}` }],
  });

  return {
    settings: { ...settings, hooks: { ...(settings?.hooks ?? {}), SessionStart: groups } },
    changed: true,
  };
}

function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const problem = new Error(
      `${file} is not valid JSON: ${err.message}\n` +
        '  skilled will not guess at a repair of your Claude Code settings.\n' +
        '  Fix the file, then run this installer again.',
    );
    problem.userFacing = true;
    throw problem;
  }
}

function main(argv) {
  const [action, file, commandPath] = argv;
  if (action !== 'add' || typeof file !== 'string' || typeof commandPath !== 'string') {
    process.stderr.write('usage: patch-settings.mjs add <settings.json> <hook-script-path>\n');
    return 2;
  }

  const result = addSessionStartHook(readSettings(file), commandPath);
  if (!result.changed) {
    process.stdout.write('SessionStart hook already installed — settings.json left unchanged\n');
    return 0;
  }

  fs.writeFileSync(file, `${JSON.stringify(result.settings, null, 2)}\n`);
  process.stdout.write(`updated ${file} — existing hooks kept, ours appended last\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`${err.userFacing === true ? err.message : `patch-settings: ${err.message}`}\n`);
    process.exit(3);
  }
}
```

- [ ] **Step 4: Write the installer**

Create `hooks/install.sh`:

```sh
#!/bin/sh
# skilled — install the Claude Code SessionStart hook.
#
# Additive by design: it appends one entry to hooks.SessionStart and never
# touches, reorders, or replaces what is already there. Re-running it is a no-op.
# settings.json is backed up before every edit. `--uninstall` reverses it.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
settings="$claude_dir/settings.json"
dest="$claude_dir/hooks/skilled-session-start.sh"

case "${1:-}" in
  '') ;;
  --help | -h)
    echo "usage: install.sh [--uninstall]"
    echo
    echo "  installs $dest and appends a SessionStart hook to $settings"
    echo "  --uninstall  removes both, leaving every other hook alone"
    exit 0
    ;;
  *)
    echo "install.sh: unknown option: $1" >&2
    echo "  try: install.sh [--uninstall]" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "install.sh: node was not found on PATH" >&2
  echo "  editing $settings safely needs it" >&2
  echo "  install Node 20 or newer, then run this script again" >&2
  exit 3
fi

if [ -f "$settings" ]; then
  backup="$settings.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$settings" "$backup"
  echo "backed up $settings"
  echo "       -> $backup"
fi

mkdir -p "$claude_dir/hooks"
cp "$here/session-start.sh" "$dest"
chmod +x "$dest"
echo "installed $dest"

node "$here/patch-settings.mjs" add "$settings" "$dest"

# Prime the pointer files so the very next session already knows where the
# managed directories are. Best effort: no token and no network must not fail
# an install.
if command -v skilled-refresh >/dev/null 2>&1; then
  skilled-refresh >/dev/null 2>&1 || true
  echo "primed the status cache"
else
  echo "note: skilled-refresh is not on PATH yet."
  echo "      install the package first, then run 'skilled-refresh' once:"
  echo "        npm i -g @luctst/skilled && skilled-refresh"
fi

echo
echo "Done. Claude Code will print one line at session start when something is"
echo "behind upstream, and stay silent when everything is current."
```

- [ ] **Step 5: Declare the .mjs module's types**

Vitest transpiles without typechecking, so the tests run as written. If the
project also typechecks `tests/` (`tsc --noEmit` over the default `tsconfig.json`),
importing a `.mjs` file with no declarations fails with
`Could not find a declaration file for module '../hooks/patch-settings.mjs'`.

Create `hooks/patch-settings.d.mts` — the `.d.mts` extension, because TypeScript
resolves declarations for an `.mjs` import from `.d.mts`, not `.d.ts`:

```ts
/**
 * Declarations for the plain-JS settings patcher. Deliberately permissive: the
 * shape being edited is a user's arbitrary Claude Code settings file, and the
 * tests index freely into it (`settings.hooks.SessionStart[1].hooks[0].command`).
 * The contract's "no `any` in exported signatures" rule governs `src/`; this is a
 * declaration for an installer helper that has to accept whatever JSON it is given.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export declare const MARKER: string;

export type ClaudeSettings = Record<string, any>;

export interface PatchResult {
  settings: ClaudeSettings;
  changed: boolean;
}

export declare function addSessionStartHook(settings: ClaudeSettings, commandPath: string): PatchResult;
export declare function removeSessionStartHook(settings: ClaudeSettings): PatchResult;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/hook-install.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 7: Commit**

```bash
git add hooks/patch-settings.mjs hooks/patch-settings.d.mts hooks/install.sh tests/hook-install.test.ts
git commit -m "feat(hook): additive, idempotent installer that never clobbers existing hooks"
```

---

### Task 11: Uninstall reverses exactly what install added

Installation is only reversible if uninstall removes our entry and nothing else — including when our entry is the only one left and the `SessionStart` key should disappear entirely.

**Files:**
- Modify: `hooks/patch-settings.mjs`
- Modify: `hooks/install.sh`
- Test: `tests/hook-install.test.ts`

**Interfaces:**
- Consumes: `MARKER` and `addSessionStartHook` from Task 10.
- Produces: `removeSessionStartHook(settings)`, and `sh hooks/install.sh --uninstall`.

- [ ] **Step 1: Write the failing test**

Append to `tests/hook-install.test.ts`:

```ts
import { removeSessionStartHook } from '../hooks/patch-settings.mjs';

describe('removeSessionStartHook', () => {
  it('removes only our entry and keeps the git pull hook', () => {
    const installed = addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh').settings;
    const { settings, changed } = removeSessionStartHook(installed);
    expect(changed).toBe(true);
    expect(settings.hooks.SessionStart).toEqual(EXISTING.hooks.SessionStart);
    expect(settings.hooks.Stop).toEqual(EXISTING.hooks.Stop);
  });

  it('drops the SessionStart key when ours was the only entry', () => {
    const installed = addSessionStartHook({ model: 'fable', hooks: { Stop: EXISTING.hooks.Stop } }, '/h/x/skilled-session-start.sh').settings;
    const { settings } = removeSessionStartHook(installed);
    expect(settings.hooks.SessionStart).toBeUndefined();
    expect(settings.hooks.Stop).toEqual(EXISTING.hooks.Stop);
  });

  it('drops the hooks key entirely when nothing else lives there', () => {
    const installed = addSessionStartHook({ model: 'fable' }, '/h/x/skilled-session-start.sh').settings;
    const { settings } = removeSessionStartHook(installed);
    expect(settings.hooks).toBeUndefined();
    expect(settings.model).toBe('fable');
  });

  it('reports no change when our hook was never installed', () => {
    const { settings, changed } = removeSessionStartHook(EXISTING);
    expect(changed).toBe(false);
    expect(settings).toEqual(EXISTING);
  });

  it('reports no change on settings with no hooks at all', () => {
    const { changed } = removeSessionStartHook({ model: 'fable' });
    expect(changed).toBe(false);
  });

  it('round-trips: install then uninstall is the identity', () => {
    const installed = addSessionStartHook(EXISTING, '/h/.claude/hooks/skilled-session-start.sh').settings;
    expect(removeSessionStartHook(installed).settings).toEqual(EXISTING);
  });

  it('keeps sibling commands inside the same group', () => {
    const shared = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              { type: 'command', command: 'echo hello' },
              { type: 'command', command: 'sh /h/.claude/hooks/skilled-session-start.sh' },
            ],
          },
        ],
      },
    };
    const { settings, changed } = removeSessionStartHook(shared);
    expect(changed).toBe(true);
    expect(settings.hooks.SessionStart[0].hooks).toEqual([{ type: 'command', command: 'echo hello' }]);
  });
});

describe('install.sh --uninstall', () => {
  it('removes our entry, our script, and nothing else', async () => {
    const f = await fixture();
    expect(install(f.env).status).toBe(0);

    const r = install(f.env, '--uninstall');
    expect(r.status, r.stderr).toBe(0);
    expect(await readSettings(f.settings)).toEqual(EXISTING);
    await expect(fs.stat(f.dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('backs up settings.json before removing', async () => {
    const f = await fixture();
    install(f.env);
    const before = (await fs.readdir(f.claudeDir)).filter((n) => n.startsWith('settings.json.bak.')).length;
    install(f.env, '--uninstall');
    const after = (await fs.readdir(f.claudeDir)).filter((n) => n.startsWith('settings.json.bak.')).length;
    expect(after).toBeGreaterThan(before);
  });

  it('is safe to run when nothing was installed', async () => {
    const f = await fixture();
    const r = install(f.env, '--uninstall');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('no skilled SessionStart hook found');
    expect(await readSettings(f.settings)).toEqual(EXISTING);
  });

  it('tells the user where the leftover state lives', async () => {
    const f = await fixture();
    install(f.env);
    const r = install(f.env, '--uninstall');
    expect(r.stdout).toContain('.skilled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hook-install.test.ts -t 'removeSessionStartHook'`
Expected: FAIL with `"removeSessionStartHook" is not exported by "hooks/patch-settings.mjs"`.

- [ ] **Step 3: Add the removal function**

Add to `hooks/patch-settings.mjs`, immediately after `addSessionStartHook`:

```js
/**
 * Remove only the entries this installer added, identified by MARKER. Groups
 * that still hold other commands keep them; a group left empty is dropped, and
 * so are the SessionStart and hooks keys once nothing is left in them — so an
 * install followed by an uninstall is the identity on the user's settings.
 */
export function removeSessionStartHook(settings) {
  if (!Array.isArray(settings?.hooks?.SessionStart)) return { settings, changed: false };

  let changed = false;
  const groups = [];
  for (const group of settings.hooks.SessionStart) {
    if (!Array.isArray(group?.hooks)) {
      groups.push(group);
      continue;
    }
    const kept = group.hooks.filter((h) => !(typeof h?.command === 'string' && h.command.includes(MARKER)));
    if (kept.length !== group.hooks.length) changed = true;
    if (kept.length > 0) groups.push(kept.length === group.hooks.length ? group : { ...group, hooks: kept });
  }
  if (!changed) return { settings, changed: false };

  const hooks = { ...settings.hooks };
  if (groups.length > 0) hooks.SessionStart = groups;
  else delete hooks.SessionStart;

  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;

  return { settings: next, changed: true };
}
```

Then replace `main` so it dispatches both actions:

```js
function main(argv) {
  const [action, file, commandPath] = argv;
  if ((action !== 'add' && action !== 'remove') || typeof file !== 'string') {
    process.stderr.write('usage: patch-settings.mjs add <settings.json> <hook-script-path>\n');
    process.stderr.write('       patch-settings.mjs remove <settings.json>\n');
    return 2;
  }
  if (action === 'add' && typeof commandPath !== 'string') {
    process.stderr.write('usage: patch-settings.mjs add <settings.json> <hook-script-path>\n');
    return 2;
  }

  const current = readSettings(file);
  const result = action === 'add' ? addSessionStartHook(current, commandPath) : removeSessionStartHook(current);

  if (!result.changed) {
    process.stdout.write(
      action === 'add'
        ? 'SessionStart hook already installed — settings.json left unchanged\n'
        : 'no skilled SessionStart hook found — settings.json left unchanged\n',
    );
    return 0;
  }

  fs.writeFileSync(file, `${JSON.stringify(result.settings, null, 2)}\n`);
  process.stdout.write(
    action === 'add'
      ? `updated ${file} — existing hooks kept, ours appended last\n`
      : `updated ${file} — removed the skilled hook, every other hook kept\n`,
  );
  return 0;
}
```

- [ ] **Step 4: Add the uninstall path to the installer**

In `hooks/install.sh`, change the option parsing to set a mode, and branch before the install steps. Replace the `case "${1:-}"` block with:

```sh
mode=install
case "${1:-}" in
  '') ;;
  --uninstall) mode=uninstall ;;
  --help | -h)
    echo "usage: install.sh [--uninstall]"
    echo
    echo "  installs $dest and appends a SessionStart hook to $settings"
    echo "  --uninstall  removes both, leaving every other hook alone"
    exit 0
    ;;
  *)
    echo "install.sh: unknown option: $1" >&2
    echo "  try: install.sh [--uninstall]" >&2
    exit 2
    ;;
esac
```

Then insert this block immediately after the backup step (after the `if [ -f "$settings" ] ... fi`):

```sh
if [ "$mode" = uninstall ]; then
  node "$here/patch-settings.mjs" remove "$settings"
  rm -f "$dest"
  echo "removed $dest"
  echo
  echo "Your collected files and skilled's own state were left alone. To remove"
  echo "those too:"
  echo "  rm -rf <managed-dir>/.skilled"
  echo "  rm -rf \"\${XDG_CONFIG_HOME:-\$HOME/.config}/skilled\""
  exit 0
fi
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hook-install.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 6: Commit**

```bash
git add hooks/patch-settings.mjs hooks/install.sh tests/hook-install.test.ts
git commit -m "feat(hook): uninstall removes only what install added"
```

---

### Task 12: The thin Claude Code skill

Wraps the CLI so the user can ask "are my skills stale?" in chat, and routes merge-conflict resolution to Claude — the one job a deterministic program cannot do.

**Two constraints that shape the whole file:**

1. **`allowed-tools` is `Bash` and `Read`, and nothing else.** No `Write`, no `Edit`. Conflict resolution therefore *proposes* merged content in chat and hands application back to the user or to `skilled update`'s own `[c]` option. That is deliberate: the contract forbids writing to a managed file without approval for that specific change, and a skill that cannot write cannot violate it. Do not "fix" this by adding `Write`.
2. **The skill must never run `skilled update` through Bash.** It is an interactive single-keypress flow; `isInteractive()` is false when stdin is not a TTY, so driving it from a tool call either stalls or produces a degraded run. The skill enumerates with `skilled --json` and asks the user to run the interactive command themselves.

**Files:**
- Create: `skill/SKILL.md`
- Test: `tests/skill-frontmatter.test.ts`

**Interfaces:**
- Consumes: the six-command CLI surface and the documented exit codes.
- Produces: `skill/SKILL.md`, shipped in the tarball by Task 15 and audited by Task 13.

- [ ] **Step 1: Write the failing test**

Create `tests/skill-frontmatter.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));

let text = '';
let raw = '';
let body = '';

beforeAll(async () => {
  text = await fs.readFile(SKILL, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (m === null) throw new Error('skill/SKILL.md has no YAML frontmatter block');
  raw = m[1];
  body = m[2];
});

function scalar(key: string): string | null {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(raw);
  return m === null ? null : m[1].trim();
}

function yamlList(key: string): string[] {
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === `${key}:`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s+-\s+(.+)$/.exec(line);
    if (m === null) break;
    out.push(m[1].trim());
  }
  return out;
}

function blockScalar(key: string): string[] {
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === `${key}: |`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    out.push(line.trim());
  }
  return out;
}

describe('skill/SKILL.md frontmatter', () => {
  it('starts with a frontmatter fence on line 1', () => {
    expect(text.startsWith('---\n')).toBe(true);
  });

  it('declares the skill name in the shape Claude Code expects', () => {
    expect(scalar('name')).toBe('skilled');
  });

  it('uses a multi-line block description, like the cso and retro skills do', () => {
    const lines = blockScalar('description');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.join(' ').length).toBeGreaterThan(120);
  });

  it('names the phrases that should trigger it', () => {
    const description = blockScalar('description').join(' ').toLowerCase();
    const triggers = ['stale', 'where did', 'update my skills', 'merge conflict'];
    for (const trigger of triggers) {
      expect(description, `description does not mention "${trigger}"`).toContain(trigger);
    }
  });

  it('grants exactly Bash and Read — nothing that can write a managed file', () => {
    expect(yamlList('allowed-tools')).toEqual(['Bash', 'Read']);
  });

  it('grants no write-capable tool anywhere in the frontmatter', () => {
    for (const forbidden of ['Write', 'Edit', 'NotebookEdit', 'MultiEdit']) {
      expect(raw, `frontmatter grants ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('skill/SKILL.md body', () => {
  it('opens with a single H1', () => {
    const h1s = body.split('\n').filter((l) => /^# \S/.test(l));
    expect(h1s).toHaveLength(1);
  });

  it('documents every command the user might be routed to', () => {
    for (const invocation of ['skilled --json', 'skilled update', 'skilled add ', 'skilled remove ', 'skilled config']) {
      expect(body, `body never mentions \`${invocation}\``).toContain(invocation);
    }
  });

  it('documents all five exit codes', () => {
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(body).toMatch(new RegExp(`\\|\\s*\`?${code}\`?\\s*\\|`));
    }
  });

  it('forbids driving the interactive update flow from a tool call', () => {
    expect(body.toLowerCase()).toContain('never run `skilled update` yourself');
  });

  it('states that it cannot write files and must hand application back', () => {
    expect(body.toLowerCase()).toContain('you cannot write files');
  });

  it('tells Claude not to invent a provenance guess', () => {
    expect(body.toLowerCase()).toContain('never invent a source');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/skill-frontmatter.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open '.../skill/SKILL.md'`.

- [ ] **Step 3: Write the skill**

Create `skill/SKILL.md` with exactly this content:

`````markdown
---
name: skilled
description: |
  Reports which collected skills and agents have fallen behind the upstream
  repos they were copied from, explains where a given file came from and how
  confidently, and helps resolve a merge conflict when an update collides with
  a local edit.
  Use when asked "are my skills stale?", "check my skills for updates",
  "where did this skill come from?", "update my skills", or "who wrote this
  agent?".
  Also use when a `skilled update` run reports a merge conflict and needs
  judgment about which side to keep.
  Proactively offer it when the session-start notice says something is behind
  upstream.
allowed-tools:
  - Bash
  - Read
---

# skilled

`skilled` vendors other people's skills and agents: it works out where each
collected file came from, tracks the upstream commit it was adopted at, and
merges upstream changes into your copy without discarding your edits.

This skill is a thin wrapper. The CLI owns every deterministic part. You are
here for the two things it cannot do: reading a report out loud, and using
judgment when a merge conflicts.

## Hard rules

1. **You cannot write files.** This skill grants `Bash` and `Read` only. Propose
   changes as text and let the user apply them. Never work around this.
2. **Never run `skilled update` yourself.** It is an interactive
   single-keypress flow that refuses to apply anything without a TTY. Ask the
   user to run it in their terminal.
3. **Never invent a source.** If the tool says an entry's origin is unknown,
   report it as unknown. A plausible-looking repo URL that turns out to be a
   fork means the user silently follows the wrong author from then on.
4. **Read before you conclude.** `skilled --json` is the source of truth for
   what is stale. Do not infer staleness from file dates.

## Is anything stale?

```bash
skilled --json
```

The output is a `StatusReport`. The exit code is the headline:

| Exit | Meaning |
|---|---|
| `0` | everything tracked is current |
| `1` | success, and something is behind upstream |
| `2` | user error — a bad flag, a bad path, an unknown entry name |
| `3` | operational failure — no network, no auth, or rate limited |
| `4` | a merge conflict was left unresolved |

Exit `1` is a **success**. Report it as news, not as an error.

Fields worth reading out: `behind` (how many are stale), `unknown` (how many
have no known origin), `total`, and `fetchedAt` — the timestamp of the last
successful upstream fetch. A `fetchedAt` of `null` means the network has never
been reached, so a report of "nothing is behind" only means "nothing is known
to be behind".

Add `--refresh` when the user wants live data rather than the cache:

```bash
skilled --json --refresh
```

Summarise like this, naming names:

> 3 of your 51 files are behind upstream: `skills/cso` (6 commits),
> `skills/git` (3), `skills/marketing-ads` (1). Two of those have local edits,
> so an update will be a three-way merge rather than an overwrite.
> 8 files still have no known origin.

On exit `3`, say plainly what could not be reached and that **no managed file
was modified** — the report may be showing cached data from `fetchedAt`.

## Where did this file come from?

```bash
skilled skills/cso
```

The name argument accepts a full id (`skills/cso`), a bare basename (`cso`), or
an agent filename (`ponytail`). This prints the source, the detection method,
a confidence score, and the evidence line.

When you relay it, keep two hazards in front of the user:

- **A reconstructed base is a guess.** It means the adopted commit was inferred
  after the fact by finding the upstream commit that best matches the local
  copy, not captured at download time. Correct in the common case; not certain.
- **Code search finds *a* repo containing the text, not necessarily *the*
  source.** A fork, or somebody else who copied from the same place, looks
  identical. Repo age, star count, and last-push date are the judgment aids.

If the guess is wrong, the fix is to record the right source by hand:

```bash
skilled add https://github.com/owner/repo skills/cso
```

Or to stop tracking it, leaving the file itself untouched:

```bash
skilled remove cso
```

## Something has no known origin

`skilled --json` lists these in `unknown`. There is nothing clever to do: the
user has to supply the URL. Help by reading the file for a clue first —
an "Adapted from …" line, an author name, a distinctive phrase worth searching:

```bash
skilled add <url> <path-within-the-managed-dir>
```

Report what you found and what you could not find. Do not guess a URL.

## Resolving a merge conflict

A conflict means upstream rewrote the region a local edit lives in, so neither
side can simply win. Nothing has been written to disk at that point.

Two routes, both driven by the user:

1. **Let the CLI hand it to Claude.** Ask the user to run
   `skilled update <name>` and press `[c]`. The tool passes base, local, and
   upstream to Claude and applies the result only after they accept it. Prefer
   this route — it has all three versions.
2. **Resolve it in conversation.** Ask the user to run `skilled update <name>`
   and press `[e]`, which writes conflict markers into a file and opens
   `$EDITOR`. Ask for that path, `Read` it, then propose the resolution as a
   fenced block for them to paste.

When you propose a resolution:

- Preserve the intent of the local edit. It is there on purpose, six months of
  memory ago.
- Prefer upstream's structure and local's substance when they collide.
- Call out anything that widens what an agent may do — a new `allowed-tools`
  entry, a new network call, a new shell command. Say it in a separate sentence,
  not buried in a diff summary. `allowed-tools: Bash` in a skill file means
  upstream can run commands on this machine.
- Never drop a conflict marker region silently. If you cannot tell which side
  is right, say so and ask.

## Pointing it at a different directory

`~/.claude` is the default, not an assumption:

```bash
skilled config                      # show the managed directory and where that was decided
skilled config dir ~/.codex         # manage a different directory
skilled config dir --add ./.claude  # manage another one as well
```

For a single command against a directory that is not configured, use the flag:

```bash
skilled --json --dir ./.claude
```
`````

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/skill-frontmatter.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add skill/SKILL.md tests/skill-frontmatter.test.ts
git commit -m "docs(skill): thin Claude Code wrapper with Bash and Read only"
```

---

### Task 13: Audit every command the docs tell people to run

The design doc's own hook snippet says `skilled refresh`, which is not a command. The same class of error in the README or the skill sends a user to a `BAD_FLAG` error on their first minute. This test makes that failure impossible to ship.

**Files:**
- Test: `tests/docs-commands.test.ts`

**Interfaces:**
- Consumes: `hooks/session-start.sh`, `hooks/install.sh`, `skill/SKILL.md`, and — once Task 14 and Task 16 land — `README.md` and `.github/workflows/ci.yml`.
- Produces: the guarantee that every `skilled <verb>` in shipped text exists.

- [ ] **Step 1: Write the failing test**

Create `tests/docs-commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Verbs that read like commands but are not part of the six-command surface.
 * `skilled refresh` is the trap: the design doc's hook snippet uses it, and it
 * has never existed — refreshing is the `--refresh` flag on bare `skilled`.
 */
const NOT_COMMANDS = [
  'refresh', 'scan', 'check', 'init', 'sync', 'diff', 'why', 'adopt', 'unlink',
  'note', 'status', 'list', 'audit', 'install', 'uninstall', 'upgrade', 'pull',
  'doctor', 'login', 'auth', 'clean', 'reset',
];

/** Files that ship to a user, or that a user copies out of. */
const SHIPPED = [
  'README.md',
  'skill/SKILL.md',
  'hooks/session-start.sh',
  'hooks/install.sh',
  '.github/workflows/ci.yml',
  'docs/naming.md',
];

async function readIfPresent(rel: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

describe('every skilled invocation in shipped text exists', () => {
  it.each(SHIPPED)('%s uses no invented verb', async (rel) => {
    const text = await readIfPresent(rel);
    expect(text, `${rel} is missing — it is required by this spec`).not.toBeNull();
    for (const verb of NOT_COMMANDS) {
      const found = new RegExp(String.raw`\bskilled\s+${verb}\b`).exec(String(text));
      expect(found, `${rel} invokes "skilled ${verb}", which is not a command`).toBeNull();
    }
  });

  it('README documents all six commands', async () => {
    const text = await readIfPresent('README.md');
    expect(text).not.toBeNull();
    const readme = String(text);
    for (const invocation of ['skilled <name>', 'skilled update', 'skilled add ', 'skilled remove ', 'skilled config']) {
      expect(readme, `README never shows \`${invocation}\``).toContain(invocation);
    }
    expect(readme).toMatch(/^\s*\$?\s*skilled\s*$/m);
  });

  it('README documents every flag on bare skilled', async () => {
    const readme = String(await readIfPresent('README.md'));
    for (const flag of ['--refresh', '--json', '--dir', '--no-color', '--help', '--version']) {
      expect(readme, `README never mentions ${flag}`).toContain(flag);
    }
  });

  it('README documents all five exit codes', async () => {
    const readme = String(await readIfPresent('README.md'));
    for (const code of ['0', '1', '2', '3', '4']) {
      expect(readme).toMatch(new RegExp(`\\|\\s*\`?${code}\`?\\s*\\|`));
    }
  });

  it('nothing shipped tells the user to install the taken npm name unscoped', async () => {
    for (const rel of SHIPPED) {
      const text = await readIfPresent(rel);
      if (text === null) continue;
      expect(text, `${rel} suggests \`npm i -g skilled\`, which installs somebody else's package`).not.toMatch(
        /npm\s+i(nstall)?\s+-g\s+skilled\b/,
      );
    }
  });
});
```

The last case encodes Task 1's finding: `skilled` on npm is somebody else's package, so an unscoped global install line is a real bug. On the branch where Step 1 of Task 1 found the name free, delete that case and note why in the commit message.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs-commands.test.ts`
Expected: FAIL — `README.md is missing — it is required by this spec` (four cases) and `.github/workflows/ci.yml is missing — it is required by this spec` (one case), because Tasks 14 and 16 have not run yet. The `skill/SKILL.md`, `hooks/session-start.sh`, `hooks/install.sh`, and `docs/naming.md` cases pass.

- [ ] **Step 3: Confirm the audit has teeth**

Temporarily append this line to `skill/SKILL.md`:

```markdown
Run `skilled refresh` to update the cache.
```

Run: `npx vitest run tests/docs-commands.test.ts -t 'skill/SKILL.md'`
Expected: FAIL with `skill/SKILL.md invokes "skilled refresh", which is not a command`.

Then delete the line and confirm `git diff --stat skill/SKILL.md` prints nothing.

- [ ] **Step 4: Commit the audit**

The README cases stay red until Task 14. Commit the test now so Task 14 is written against it.

```bash
git add tests/docs-commands.test.ts
git commit -m "test(docs): fail the build on invented skilled commands"
```

---

### Task 14: README

Gets a stranger from nothing to a true drift report. Order follows the design doc's Getting Started priorities: install in one command, the zero-arg first run, the six commands, then `skilled config` for anyone whose files are not in `~/.claude`.

The first-run and update transcripts are lifted from the design doc, which wrote them to be accurate — **except** its error-catalogue block, which shows `skilled diff git` and `skilled update git --claude`. Neither exists. The version below routes the same information through real commands.

**Files:**
- Create: `README.md`
- Test: `tests/docs-commands.test.ts` (written in Task 13; turns green here)

**Interfaces:**
- Consumes: the package name settled in Task 1; the hook and installer from Tasks 8–11; the skill from Task 12.
- Produces: `README.md`, shipped by npm automatically and audited by Task 13.

- [ ] **Step 1: Run the existing test to see it fail**

Run: `npx vitest run tests/docs-commands.test.ts -t 'README'`
Expected: FAIL with `README.md is missing — it is required by this spec` on the `README.md` file case and on each of the three README-specific cases.

- [ ] **Step 2: Write the README**

Create `README.md` with exactly this content:

`````markdown
# skilled

Vendoring for AI agent instructions. Finds out where the skills and agents in
your `~/.claude` came from, tells you which have gone stale, and merges upstream
changes into your copies without discarding your edits.

The problem it solves is not that updating is hard. It is that **checking** is so
expensive it never happens. If you have collected 50 files from strangers' repos
over a year, you have no idea which of them the author has improved since.

## Install

```bash
npm i -g @luctst/skilled
```

Node 20 or newer. The package name is scoped because `skilled` is taken on npm;
the binary is still `skilled`.

## First run

No configuration, no `init`, no arguments. Results stream as they land — the free
detections appear immediately, network lookups fill in live.

```
$ skilled
Scanning ~/.claude … 34 skills, 17 agents

  ✓ agents/ponytail.md        → DietrichGebert/ponytail             (named in file)
  ✓ skills/explain-code       → anthropics/claude-plugins-official  (named in file)
  ✓ skills/figma-*            → anthropics/claude-plugins-official  (plugin cache, 11 skills)
  … searching GitHub for 34 remaining …
  ✓ skills/marketing-ads      → <repo>  (+11 siblings inferred)
  ? skills/cso                → 2 candidates — needs your call
  ✗ skills/qa-only            → no match

  43 of 51 identified · 12 behind upstream · 8 unknown origin

  Next:  skilled update        review the 12
         skilled add <url>     tell me about the 8
         skilled cso           why it thinks that
```

The "8 unknown origin" line is the point, not a failure. Before this you did not
know the blind spot existed; now you know its exact size.

**Nothing was written.** The first run only reads your files and asks GitHub
questions. Nothing under `skills/` or `agents/` is modified until you approve a
specific change.

### GitHub access

If the `gh` CLI is authenticated, `skilled` borrows its token silently — no setup
step. Without it, the three offline detection strategies still run and the tool
says plainly which lookups it could not do.

## The six commands

| Command | What it does |
|---|---|
| `skilled` | scan and report: what is tracked, what is stale, what is unknown |
| `skilled <name>` | detail on one entry — where it came from, how it was detected, how confident, what changed since |
| `skilled update [<name>]` | review and apply, one entry at a time |
| `skilled add <url> [<path>]` | register a source by hand, or correct a wrong guess |
| `skilled remove <name>` | stop tracking; the file itself is left alone |
| `skilled config [dir <path>]` | show or set which directory is managed |

`<name>` accepts a full id (`skills/cso`), a bare basename (`cso`), or an agent
filename (`ponytail`). An ambiguous name lists the candidates instead of guessing.

### Flags

All valid on bare `skilled`:

| Flag | Effect |
|---|---|
| `--refresh` | hit the network instead of reading the cache |
| `--json` | emit machine-readable JSON, suppress all human output |
| `--dir <path>` | one-off managed-directory override, highest precedence |
| `--no-color` | disable color; `NO_COLOR` in the environment does the same |
| `--help`, `-h` | usage |
| `--version`, `-V` | version |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | success; everything is current |
| `1` | success, but something is stale |
| `2` | user error — bad flag, bad path, unknown entry name |
| `3` | operational failure — network unreachable, auth missing, rate limited |
| `4` | merge conflict left unresolved |

Exit `1` is a success. In a script, treat `0` and `1` as "it worked".

## Updating

Nothing is written without your approval, one entry at a time.

No local edits — a straight fast-forward:

```
$ skilled update
skills/cso — 6 commits behind (adopted May 12, upstream now Aug 09)
  Your edits:  none
  Upstream:    +142 −18 lines across 1 file

  [d] diff   [a] apply   [s] skip   [q] quit
```

You edited it — a three-way merge against the copy you originally adopted:

```
skills/git — 3 commits behind
  ⚠ You edited this file. Merging your 2 changes with their 4.
  Merged cleanly. Your edits preserved.

  [d] review the merged result   [a] accept   [s] skip
```

Upstream rewrote the region your edit lives in:

```
skills/explain-code — 5 commits behind
  ✗ Conflict: upstream rewrote the section your edit lives in.

  [c] let Claude resolve it
  [e] open in $EDITOR with conflict markers
  [s] skip
```

`[c]` hands base, local, and upstream to Claude and still requires you to accept
the result. Nothing reaches disk until you do.

## A different directory

`~/.claude` is the default, not an assumption. Project-local `.claude/`
directories are common, and other agent tools keep their instructions elsewhere.

```
$ skilled config
managed directory   ~/.claude            (auto-detected)
config file         ~/.config/skilled/config.json  (not created yet)
github auth         gh CLI               (borrowed)

$ skilled config dir ~/.codex
managed directory   ~/.codex             ✓ saved
  found 8 skills, 2 agents

$ skilled config dir --add ./.claude
managing 2 directories:
  ~/.codex          8 skills, 2 agents
  ./.claude         3 skills
```

Resolution order, highest first. `skilled config` prints which one actually
applied, so it is never a mystery:

1. `--dir <path>`
2. the `SKILLED_DIR` environment variable
3. `~/.config/skilled/config.json`
4. auto-detect `~/.claude`

A directory qualifies only if it exists and contains a `skills/` or `agents/`
subdirectory. A typo is reported, not accepted.

## Know without asking: the session-start hook

One line at the start of a Claude Code session when something is behind, silence
otherwise:

```
skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`
```

Install it:

```bash
sh "$(npm root -g)/@luctst/skilled/hooks/install.sh"
```

That copies `skilled-session-start.sh` into `~/.claude/hooks/`, backs up
`settings.json`, and **appends** one entry to `hooks.SessionStart`. Existing
hooks — a `git pull`, anything else — are kept in their existing order, and ours
runs last. Running it twice changes nothing.

Remove it:

```bash
sh "$(npm root -g)/@luctst/skilled/hooks/install.sh" --uninstall
```

That deletes only the entry it added, and leaves your collected files and
`skilled`'s own state alone.

**The hook does not slow your sessions down.** It is pure shell: it prints a
pre-written line and, at most once every twelve hours, spawns a detached
background refresh. It never starts Node in the foreground, and it always exits
`0` — a broken `skilled` install cannot break your Claude Code.

## Ask in chat: the skill

Copy the bundled skill into your skills directory to ask about staleness in
conversation and get help with a conflicted merge:

```bash
mkdir -p ~/.claude/skills/skilled
cp "$(npm root -g)/@luctst/skilled/skill/SKILL.md" ~/.claude/skills/skilled/
```

Then: *"are my skills stale?"*, *"where did cso come from?"*, or *"help me
resolve this conflict"*. The skill declares `Bash` and `Read` only — it can read
and report, and it proposes merges as text rather than writing your files.

The CLI never depends on the skill. The skill is a convenience layer over a tool
that works fine alone.

## In CI

`--json` plus the exit codes is the whole contract. Remember that `1` means
stale, which is a success:

```yaml
- name: check for upstream drift
  run: |
    set +e
    skilled --json --dir .claude > drift.json
    code=$?
    set -e
    cat drift.json
    case "$code" in
      0) echo "::notice::all tracked entries are current" ;;
      1) echo "::notice::something is behind upstream" ;;
      3) echo "::warning::could not reach upstream" ;;
      *) exit "$code" ;;
    esac
```

`--json` output for bare `skilled` is a serialized status report:

```json
{
  "dir": "/Users/you/.claude",
  "rows": [
    { "id": "skills/cso", "status": "behind", "behindBy": 6, "localEdits": false }
  ],
  "identified": 43,
  "total": 51,
  "behind": 12,
  "unknown": 8,
  "fetchedAt": "2026-08-27T09:14:02Z"
}
```

`fetchedAt` is `null` when the network has never been reached — in that case
"nothing is behind" only means "nothing is *known* to be behind".

## How it works

Three versions of every tracked entry, the standard vendoring triple:

| | What it is | Where it lives |
|---|---|---|
| **BASE** | pristine upstream copy as of the moment you adopted it | `<managed-dir>/.skilled/base/<id>/` |
| **LOCAL** | what is on disk now, including your edits | `<managed-dir>/skills/…`, `<managed-dir>/agents/…` |
| **UPSTREAM** | current state of the remote | fetched on demand |

Updating is a three-way merge of the three, via `git merge-file`. BASE is what a
two-way diff cannot replace: without it, "you added this line" and "the author
deleted this line" are indistinguishable.

For a file adopted before `skilled` existed there is no BASE, so once the source
is known it fetches the upstream commit whose content best matches your copy and
records that. `skilled <name>` flags such a base as reconstructed.

Provenance is found by six strategies, cheapest first, streamed as they land:

| # | Strategy | Cost | Catches |
|---|---|---|---|
| 1 | inline URLs in file bodies | free | files that name their own source |
| 2 | the local Claude Code plugin cache | free | anything installed from a marketplace, which already pins a commit sha |
| 3 | content hashes against a known-sources index | fast | well-known skill repos |
| 4 | GitHub code search on a rare n-gram | rate limited, needs a token | the long tail |
| 5 | cluster inference across sibling directories | free | a whole family from one hit |
| 6 | asking Claude to identify it | slow | last-resort stragglers |

State lives in `<managed-dir>/.skilled/` — manifest, BASE copies, cache, and the
one-line summary the hook reads. It travels with the files it describes, so if
your `~/.claude` is a git repo, every write `skilled` makes is versioned and
revertible for free.

## When it goes wrong

**`✗ Can't reach github.com/owner/repo (404)`** — the repo was deleted or went
private. Your file is untouched. `skilled <name>` shows how that source was
identified; `skilled remove <name>` stops tracking it; `skilled add <new-url>
<path>` points it somewhere new.

**`✗ GitHub search rate limit reached`** — code search is capped at 10 requests
per minute. Progress is saved and it resumes automatically. Authenticating `gh`
raises the ceiling.

**`⚠ merge conflict`** — upstream rewrote the region your edit lives in. Nothing
has been written to disk. Re-run `skilled update <name>` and pick `[c]` to let
Claude merge it, or `[e]` for conflict markers in `$EDITOR`.

**The candidate repo looks wrong.** It may be a fork, or somebody else who
copied from the same place you did. Repo age, stars, and last-push date are shown
as judgment aids. Reject it and record the real one with `skilled add`.

**The session-start line is out of date.** It is rewritten by the background
refresh, at most once every twelve hours, and immediately after any run that
changes the manifest. To force it now: `skilled-refresh`.

**Nothing detected at all.** Check that the directory is the one you think:
`skilled config`.

## Not in v1

Non-git sources (gists, raw URLs), publishing your own skills outbound,
auto-apply without review, commands and MCP config, Windows.
`````

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/docs-commands.test.ts -t 'README'`
Expected: PASS — all four README cases green.

Then run the whole file: `npx vitest run tests/docs-commands.test.ts`
Expected: one remaining failure, `.github/workflows/ci.yml is missing — it is required by this spec`. That is Task 16's job; every other case is green.

- [ ] **Step 4: Read it as a stranger**

Run:

```bash
grep -n 'skilled' README.md | grep -vE 'skilled($|[^a-z-])' || echo "no malformed mentions"
```

Expected: `no malformed mentions`. Then read the Install and First run sections top to bottom and confirm a reader with an empty machine can follow them in order without needing anything defined later in the file.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README from install to a first drift report"
```

---

### Task 15: Publishable tarball

`files`, `engines`, and `prepublishOnly`, plus a test that reads the actual pack manifest rather than trusting the globs.

**Files:**
- Modify: `package.json` (keys `files`, `engines`, `scripts.prepublishOnly` only)
- Test: `tests/package-publish.test.ts`

**Interfaces:**
- Consumes: `bin` and `scripts.build` from Task 6; the package name from Task 1.
- Produces: a tarball containing `dist/`, `hooks/`, `skill/`, `README.md`, and `package.json` — and nothing else.

`README.md`, `LICENSE`, and `package.json` are always included by npm, so they do not belong in `files`.

- [ ] **Step 1: Write the failing test**

Create `tests/package-publish.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Manifest {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  files?: string[];
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  type?: string;
}

let pkg: Manifest;
let packed: string[] = [];

beforeAll(async () => {
  pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;

  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`npm run build failed:\n${build.stdout}\n${build.stderr}`);

  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(`npm pack failed:\n${pack.stderr}`);
  const report = JSON.parse(pack.stdout) as Array<{ files: Array<{ path: string }> }>;
  packed = report[0].files.map((f) => f.path);
}, 180_000);

describe('package manifest', () => {
  it('requires Node 20 or newer', () => {
    expect(pkg.engines?.node).toBe('>=20.0.0');
  });

  it('is ESM', () => {
    expect(pkg.type).toBe('module');
  });

  it('exposes both binaries', () => {
    expect(Object.keys(pkg.bin ?? {}).sort()).toEqual(['skilled', 'skilled-refresh']);
  });

  it('builds and tests before publishing', () => {
    expect(pkg.scripts?.prepublishOnly).toBe('npm run build && npm test');
  });

  it('whitelists only what a user needs at runtime', () => {
    expect((pkg.files ?? []).sort()).toEqual(['dist', 'hooks', 'skill']);
  });

  it('does not list files npm always includes anyway', () => {
    for (const always of ['README.md', 'LICENSE', 'package.json']) {
      expect(pkg.files ?? []).not.toContain(always);
    }
  });
});

describe('npm pack contents', () => {
  it('ships the two entrypoints', () => {
    for (const file of Object.values(pkg.bin ?? {})) {
      expect(packed, `${file} is missing from the tarball`).toContain(file.replace(/^\.\//, ''));
    }
  });

  it('ships the hook, the installer, the settings patcher, and the skill', () => {
    for (const file of [
      'hooks/session-start.sh',
      'hooks/install.sh',
      'hooks/patch-settings.mjs',
      'skill/SKILL.md',
      'README.md',
      'package.json',
    ]) {
      expect(packed, `${file} is missing from the tarball`).toContain(file);
    }
  });

  it('ships no source, no tests, and no repo furniture', () => {
    const forbidden = packed.filter((p) =>
      p.startsWith('src/') ||
      p.startsWith('tests/') ||
      p.startsWith('.github/') ||
      p.startsWith('examples/') ||
      p.startsWith('skilled_registry/') ||
      p.startsWith('docs/') ||
      p.endsWith('.test.ts') ||
      p.endsWith('.ts') ||
      p === 'vitest.config.ts',
    );
    expect(forbidden, `tarball contains files it should not: ${forbidden.join(', ')}`).toEqual([]);
  });

  it('stays small — this is a CLI, not a bundle', () => {
    expect(packed.length).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/package-publish.test.ts`
Expected: FAIL on `requires Node 20 or newer` (`expected undefined to be '>=20.0.0'`), on `whitelists only what a user needs at runtime`, and on `ships no source, no tests, and no repo furniture` — with no `files` whitelist, `npm pack` includes `src/` and `tests/`.

- [ ] **Step 3: Add the publish fields**

Edit `package.json`, adding these three keys and leaving everything else as it is:

```json
{
  "files": [
    "dist",
    "hooks",
    "skill"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "prepublishOnly": "npm run build && npm test"
  }
}
```

`scripts.prepublishOnly` is an addition to the existing `scripts` object — keep `test` and `build` exactly as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/package-publish.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Inspect the real tarball once, by eye**

Run:

```bash
npm pack --dry-run 2>&1 | tail -30
```

Expected: a `Tarball Contents` listing of `dist/`, `hooks/`, `skill/`, `README.md`, `package.json` and nothing else, followed by a total file count and unpacked size. Confirm no `.env`, no `*.bak`, no `node_modules`.

- [ ] **Step 6: Commit**

```bash
git add package.json tests/package-publish.test.ts
git commit -m "chore: publish only dist, hooks, and skill"
```

---

### Task 16: CI demonstrates the `--json` exit-code contract

Runs the tests, builds, packs, installs the tarball globally, and produces a real drift report — offline and deterministic, against a committed fixture managed directory.

**Exit `1` must not fail the build.** It is the tool working correctly and finding drift. Only `2` and `4` are failures; `3` is a warning, because a rate limit is not a code defect.

**Files:**
- Create: `examples/managed/skills/demo-skill/SKILL.md`
- Create: `examples/managed/.skilled/manifest.json`
- Create: `examples/managed/.skilled/base/skills/demo-skill/SKILL.md`
- Create: `examples/managed/.skilled/cache/status.template.json`
- Create: `examples/prepare-cache.mjs`
- Create: `examples/assert-drift.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the packed tarball from Task 15; bare `skilled --json --dir <path>` with the documented exit codes.
- Produces: a green CI run that prints a real drift report.

**Why a template for the cache.** `StatusReport.dir` is an absolute path, and the checkout path differs between machines. `examples/prepare-cache.mjs` stamps the real path in before the report is read, so the fixture is honest instead of carrying a path that is wrong everywhere.

- [ ] **Step 1: Build the fixture managed directory**

Create `examples/managed/skills/demo-skill/SKILL.md`:

```markdown
---
name: demo-skill
description: |
  A fixture skill used by CI to demonstrate skilled's drift report offline.
  Not intended for real use.
---

# Demo skill

This file exists so `skilled --json --dir examples/managed` has something real
to report on without touching the network. The line below differs from the copy
in `.skilled/base/`, which is what makes it show up as locally edited.

Local edit: this sentence is not in the adopted base copy.
```

Create `examples/managed/.skilled/base/skills/demo-skill/SKILL.md` — the pristine adopted copy, identical except for the last line:

```markdown
---
name: demo-skill
description: |
  A fixture skill used by CI to demonstrate skilled's drift report offline.
  Not intended for real use.
---

# Demo skill

This file exists so `skilled --json --dir examples/managed` has something real
to report on without touching the network. The line below differs from the copy
in `.skilled/base/`, which is what makes it show up as locally edited.
```

Create `examples/managed/.skilled/manifest.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "skills/demo-skill",
      "source": {
        "type": "github",
        "repo": "example/demo-skills",
        "ref": "main",
        "subpath": "skills/demo-skill"
      },
      "base": {
        "commit": "0000000000000000000000000000000000000000",
        "adoptedAt": "2026-05-12",
        "reconstructed": true
      },
      "detection": {
        "method": "manual",
        "confidence": 1,
        "confirmedBy": "user",
        "evidence": "fixture entry, registered by hand for CI"
      }
    }
  ],
  "unknown": []
}
```

Create `examples/managed/.skilled/cache/status.template.json`:

```json
{
  "dir": "__DIR__",
  "rows": [
    {
      "id": "skills/demo-skill",
      "status": "behind",
      "source": {
        "type": "github",
        "repo": "example/demo-skills",
        "ref": "main",
        "subpath": "skills/demo-skill"
      },
      "behindBy": 4,
      "localEdits": true
    }
  ],
  "identified": 1,
  "total": 1,
  "behind": 1,
  "unknown": 0,
  "fetchedAt": "2026-08-20T11:30:00Z"
}
```

- [ ] **Step 2: Write the two helper scripts**

Create `examples/prepare-cache.mjs`:

```js
#!/usr/bin/env node
// Stamp the real checkout path into the fixture status cache. StatusReport.dir
// is absolute, so a committed cache would carry a path that is wrong on every
// machine. Run this before reading the fixture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const managed = path.join(here, 'managed');
const template = path.join(managed, '.skilled', 'cache', 'status.template.json');
const target = path.join(managed, '.skilled', 'cache', 'status.json');

const report = JSON.parse(fs.readFileSync(template, 'utf8'));
report.dir = managed;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`wrote ${target} for ${managed}\n`);
```

Create `examples/assert-drift.mjs`:

```js
#!/usr/bin/env node
// Assert the CI drift report is a well-formed StatusReport describing exactly
// the drift the fixture sets up. Exits non-zero with a readable message so a
// broken --json contract fails the build loudly.
import fs from 'node:fs';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: assert-drift.mjs <report.json>\n');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  process.stderr.write(`${file} is not valid JSON: ${err.message}\n`);
  process.exit(1);
}

const problems = [];
if (typeof report.dir !== 'string') problems.push('dir is not a string');
if (!Array.isArray(report.rows)) problems.push('rows is not an array');
if (report.total !== 1) problems.push(`expected total 1, got ${report.total}`);
if (report.behind !== 1) problems.push(`expected behind 1, got ${report.behind}`);
if (report.rows?.[0]?.id !== 'skills/demo-skill') problems.push(`unexpected row id: ${report.rows?.[0]?.id}`);
if (report.rows?.[0]?.status !== 'behind') problems.push(`unexpected row status: ${report.rows?.[0]?.status}`);
if (report.rows?.[0]?.localEdits !== true) problems.push('expected the fixture row to report local edits');

if (problems.length > 0) {
  process.stderr.write(`drift report is wrong:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}

process.stdout.write(`ok: ${report.behind} of ${report.total} behind upstream in ${report.dir}\n`);
```

- [ ] **Step 3: Ignore the generated cache**

Append to `.gitignore` (create it if it does not exist), skipping any line already present:

```gitignore
dist/
examples/managed/.skilled/cache/status.json
*.tgz
```

Verify: `git status --short examples/` prints nothing after running `node examples/prepare-cache.mjs`.

- [ ] **Step 4: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - run: npm ci

      - name: unit tests
        run: npm test

      - name: build
        run: npm run build

      - name: pack the tarball and install it globally
        run: |
          TARBALL=$(npm pack --silent)
          echo "packed $TARBALL"
          tar -tzf "$TARBALL"
          npm i -g "./$TARBALL"

      - name: both binaries are on PATH
        run: |
          skilled --version
          command -v skilled-refresh

      - name: prepare the fixture managed directory
        run: node examples/prepare-cache.mjs

      - name: drift report — exit 1 means stale, which is a success
        run: |
          set +e
          skilled --json --dir examples/managed > drift.json
          code=$?
          set -e
          cat drift.json
          case "$code" in
            0) echo "::notice::all tracked entries are current" ;;
            1) echo "::notice::something is behind upstream — a success state for skilled" ;;
            3) echo "::warning::skilled could not reach upstream (no token, rate limit, or network)" ;;
            *) echo "::error::skilled exited $code"; exit "$code" ;;
          esac

      - name: the report matches what the fixture sets up
        run: node examples/assert-drift.mjs drift.json

      - name: the session-start hook stays under its 10ms budget
        run: npx vitest run tests/hook-timing.test.ts
```

- [ ] **Step 5: Verify the CI steps locally, in order**

Run each command the workflow runs, from the repo root:

```bash
npm test \
  && npm run build \
  && node examples/prepare-cache.mjs \
  && node dist/cli.js --json --dir examples/managed > /tmp/drift.json; echo "exit: $?" \
  && cat /tmp/drift.json \
  && node examples/assert-drift.mjs /tmp/drift.json
```

Expected: `exit: 1`, the serialized report, then
`ok: 1 of 1 behind upstream in /Users/…/skilled/examples/managed`.

If the exit code is `0`, bare `skilled` is not reading the cache for a `--refresh`-less run against `--dir`; if it is `2`, the fixture directory failed validation — check that `examples/managed/skills/` exists.

- [ ] **Step 6: Run the full suite and the docs audit**

Run: `npm test`
Expected: PASS across every file, including the previously red
`.github/workflows/ci.yml uses no invented verb` case in `tests/docs-commands.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml examples .gitignore
git commit -m "ci: demonstrate skilled --json and honor exit 1 as a success"
```

---

## Definition of Done

Every command below runs from the repository root. None of them touch the real
`~/.claude`, the real `~/.config/skilled`, or the real `settings.json` — the
manual checks build a scratch `HOME` under `/tmp` and point the hook at it.

### 1. The whole suite is green

```bash
npm test
```

Expected: every test file passes, including `tests/statusline.test.ts` (16),
`tests/pointers.test.ts` (8), `tests/refresh.test.ts` (8),
`tests/hook-status.test.ts` (11), `tests/hook-refresh.test.ts` (13),
`tests/hook-timing.test.ts` (4), `tests/hook-install.test.ts` (25),
`tests/skill-frontmatter.test.ts` (12), `tests/docs-commands.test.ts` (10),
`tests/package-publish.test.ts` (10). No skipped tests.

### 2. The hook's measured cost is under 10ms

```bash
npx vitest run tests/hook-timing.test.ts 2>&1 | grep 'session-start hook:'
```

Expected, with the numbers varying by machine:

```
session-start hook: 6.41ms median of 20, /bin/sh baseline 4.02ms, hook overhead 2.39ms (budget 10ms)
```

The number that matters is **hook overhead** — the hook's cost above starting
`/bin/sh` at all. It must be under `10ms`, and the test fails the build if it is
not. `4 passed` must also appear.

### 3. Node is never invoked in the foreground

Static proof — no executable line in the script names an interpreter:

```bash
grep -vE '^\s*#' hooks/session-start.sh | grep -nE '\b(node|npx|npm)\b' || echo "no interpreter named in executable lines"
```

Expected: `no interpreter named in executable lines`.

Exactly one external command, and it is `find`:

```bash
grep -vE '^\s*#' hooks/session-start.sh | grep -cE '\bfind\b'
grep -vE '^\s*#' hooks/session-start.sh | grep -cE '\b(cat|grep|sed|awk|stat|date)\b'
```

Expected: `1`, then `0`.

Dynamic proof — the hook returns while the refresh is still running:

```bash
npx vitest run tests/hook-refresh.test.ts -t 'returns without waiting'
```

Expected: `1 passed`. That case points `refresh-cmd` at a script which sleeps for
a second; the hook must return in under 250ms and the marker file must appear only
afterwards.

### 4. The hook is silent when everything is current

```bash
export DOD_HOME="$(mktemp -d /tmp/skilled-dod-XXXXXX)"
mkdir -p "$DOD_HOME/.claude/skills" "$DOD_HOME/.claude/.skilled/cache"
echo '{"version":1}' > "$DOD_HOME/.claude/.skilled/cache/status.json"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh > "$DOD_HOME/out" 2> "$DOD_HOME/err"
echo "exit: $?  stdout bytes: $(wc -c < "$DOD_HOME/out")  stderr bytes: $(wc -c < "$DOD_HOME/err")"
```

Expected: `exit: 0  stdout bytes: 0  stderr bytes: 0`.

There is no `.skilled/status` file, because the writer deletes it when nothing is
behind. Silence is the whole behavior.

### 5. The hook speaks when there is news, and only then

```bash
printf 'skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`\n' \
  > "$DOD_HOME/.claude/.skilled/status"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh
echo "exit: $?"
```

Expected, exactly:

```
skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`
exit: 0
```

Now delete the line and confirm it goes quiet again:

```bash
rm "$DOD_HOME/.claude/.skilled/status"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh | wc -c
```

Expected: `0`.

### 6. The hook honors a configured directory, not a hardcoded `~/.claude`

```bash
mkdir -p "$DOD_HOME/codex/.skilled/cache" "$DOD_HOME/.config/skilled"
echo '{"version":1}' > "$DOD_HOME/codex/.skilled/cache/status.json"
printf 'skilled: 1 agent behind upstream (thomas) · run `skilled update`\n' \
  > "$DOD_HOME/codex/.skilled/status"
printf '# written by skilled-refresh\n%s\n' "$DOD_HOME/codex" > "$DOD_HOME/.config/skilled/dirs"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh
```

Expected: `skilled: 1 agent behind upstream (thomas) · run `skilled update`` — the
line from the pointed-at directory, with `$HOME/.claude` no longer consulted.

### 7. A broken install cannot break a session

```bash
printf '%s\n' "$DOD_HOME/deleted-dir" > "$DOD_HOME/.config/skilled/dirs"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh; echo "missing dir  -> exit: $?"

printf 'not-a-path\n' > "$DOD_HOME/.config/skilled/refresh-cmd"
env -i HOME="$DOD_HOME" XDG_CONFIG_HOME="$DOD_HOME/.config" PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh; echo "broken cmd   -> exit: $?"

env -i HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent/.config PATH=/usr/bin:/bin \
  /bin/sh hooks/session-start.sh; echo "no home      -> exit: $?"
```

Expected: three lines, each ending `exit: 0`, with no other output on stdout or
stderr.

### 8. Installation is additive, idempotent, and reversible

`HOME`, `CLAUDE_CONFIG_DIR`, and `XDG_CONFIG_HOME` all point into the scratch
directory. `XDG_CONFIG_HOME` matters: `install.sh` primes the cache by running
`skilled-refresh`, and without it a globally installed build would write to the
real `~/.config/skilled`.

```bash
export DOD_CLAUDE="$DOD_HOME/fake-claude"
mkdir -p "$DOD_CLAUDE"
cat > "$DOD_CLAUDE/settings.json" <<'JSON'
{
  "model": "fable",
  "hooks": {
    "SessionStart": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "cd ~/.claude && git pull --rebase" }] }
    ],
    "Stop": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "cd ~/.claude && git add -A && git commit -m sync && git push" }] }
    ]
  }
}
JSON
cp "$DOD_CLAUDE/settings.json" "$DOD_HOME/settings.before"

export DOD_ENV="CLAUDE_CONFIG_DIR=$DOD_CLAUDE HOME=$DOD_HOME XDG_CONFIG_HOME=$DOD_HOME/.config"
env $DOD_ENV sh hooks/install.sh
env $DOD_ENV sh hooks/install.sh
node -e "const h=require('$DOD_CLAUDE/settings.json').hooks;console.log('SessionStart entries:',h.SessionStart.length);console.log('first:',h.SessionStart[0].hooks[0].command);console.log('ours:',h.SessionStart[1].hooks[0].command);console.log('Stop intact:',h.Stop[0].hooks[0].command.includes('git push'))"
```

Expected:

```
SessionStart entries: 2
first: cd ~/.claude && git pull --rebase
ours: sh /tmp/skilled-dod-XXXXXX/fake-claude/hooks/skilled-session-start.sh
Stop intact: true
```

Two installs, one entry. The `git pull` hook still runs first.

Now reverse it and confirm the file is byte-identical to where it started:

```bash
env $DOD_ENV sh hooks/install.sh --uninstall
node -e "const a=require('$DOD_HOME/settings.before'),b=require('$DOD_CLAUDE/settings.json');console.log('identical:',JSON.stringify(a)===JSON.stringify(b))"
ls "$DOD_CLAUDE/hooks/skilled-session-start.sh" 2>&1 | tail -1
```

Expected: `identical: true`, then a `No such file or directory` message for the
removed script.

Clean up the scratch directory:

```bash
rm -rf "$DOD_HOME"
```

### 9. The skill is valid and minimal

```bash
head -20 skill/SKILL.md
npx vitest run tests/skill-frontmatter.test.ts
```

Expected: frontmatter opening on line 1 with `name: skilled`, a block
`description: |`, and `allowed-tools` listing exactly `Bash` and `Read`; then
`12 passed`.

### 10. No shipped text invents a command

```bash
npx vitest run tests/docs-commands.test.ts
grep -rnE '\bskilled\s+(refresh|scan|check|init|sync|diff|why|adopt|unlink|note)\b' \
  README.md skill/SKILL.md hooks/ .github/ || echo "no invented commands"
```

Expected: `10 passed`, then `no invented commands`.

### 11. The tarball contains only what is needed

```bash
npm run build && npm pack --dry-run 2>&1 | tail -30
```

Expected: a `Tarball Contents` listing containing `dist/`, `hooks/session-start.sh`,
`hooks/install.sh`, `hooks/patch-settings.mjs`, `skill/SKILL.md`, `README.md`, and
`package.json` — and no `src/`, `tests/`, `examples/`, `docs/`, `.github/`, or
`skilled_registry/` entries.

### 12. The end-to-end CI path works locally

```bash
npm run build \
  && node examples/prepare-cache.mjs \
  && node dist/cli.js --json --dir examples/managed > /tmp/drift.json; echo "exit: $?"
node examples/assert-drift.mjs /tmp/drift.json
```

Expected: `exit: 1`, then
`ok: 1 of 1 behind upstream in <repo>/examples/managed`.

Exit `1` is the tool succeeding at finding drift. If CI ever fails on it, the
`case` block in `.github/workflows/ci.yml` has regressed.

### 13. The package name is settled

```bash
node -e "const p=require('./package.json');console.log(p.name, JSON.stringify(p.publishConfig ?? null))" \
  && cat docs/naming.md
```

Expected: `@luctst/skilled {"access":"public"}` and the recorded decision — or, on
the branch where Step 1 of Task 1 found the name free, `skilled null` and a
`docs/naming.md` that says so.
