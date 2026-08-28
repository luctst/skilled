# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`skilled` — a CLI that keeps AI agent skills and subagent definitions in sync with the
upstream repos they were copied from.

The framing matters, because it's the opposite of every similar tool: this is **inbound
vendoring**, not sync. The upstream belongs to a stranger, your local copy may be
hand-edited, and updates get three-way merged rather than overwritten. Tools like
`skillshare` and `skills-cli` are outbound — you own one source and fan it out. If you
find yourself designing an outbound feature, you've lost the plot.

**There is no source code yet.** The repo contains only `skilled_registry/` — the specs
to build from.

## Start here

Read in this order. Do not skip the contract.

| File | What it is |
|---|---|
| `skilled_registry/specs/00-CONTRACT.md` | Every shared type, path, command, flag, exit code. **Fixed.** |
| `skilled_registry/specs/DESIGN.md` | The reasoning. Error wording and terminal transcripts are normative. |
| `skilled_registry/specs/0{1..4}-*.md` | The task-by-task plans. 83 tasks, 440 steps. |
| `skilled_registry/memory/DECISIONS.md` | Why things are the way they are, with rejected alternatives. |

Four specs were written independently against the contract — it is the only thing
keeping them compatible. If something in it is genuinely wrong, flag it; don't diverge.

`DESIGN.md` contains three commands that don't exist (`skilled refresh`, `skilled diff`,
`skilled update --claude`), left over from an earlier eleven-verb draft. The contract has
the correction table. Specs 03 and 04 each ship a test that greps for them.

## Architecture

**Three versions of every tracked item.** This is the core idea and everything else
follows from it:

- **BASE** — pristine upstream copy as of adoption, in `<managed-dir>/.skilled/base/<id>/`
- **LOCAL** — what's on disk now, including the user's edits
- **UPSTREAM** — current remote state, fetched on demand

Update = `mergeFile(BASE, LOCAL, UPSTREAM)`. A two-way diff cannot substitute — it can't
tell a local addition from an upstream deletion.

**Config and state live in different places, deliberately.** Config (which directories to
manage) is in `~/.config/skilled/config.json`, because it *defines* where the managed
directory is and so can't live inside it. State (manifest, BASE copies, cache) lives in
`<managed-dir>/.skilled/`, so it travels with the skills it describes.

**The hard problem is provenance, not fetching.** Most collected skill files record no
origin at all, so a naive `init` finds nothing to sync. `src/detect/` is a six-strategy
cascade run cheapest-first and streamed: inline-url → plugin-cache → known-index →
code-search → cluster → claude. Cluster inference is load-bearing, not an optimization —
it turns ~51 lookups into ~8-12, which is what fits inside GitHub code search's rate limit.

**Six commands, closed set.** `skilled`, `skilled <name>`, `update`, `add`, `remove`,
`config`. Everything else is a flag. Internally they're keyed
`['scan','show','update','add','remove','config']`; bare `skilled` dispatches to `scan`,
an unrecognized first argument to `show`. `registerCommand` replaces by name, which is how
later specs override spec 01's placeholders without editing `cli.ts`.

**Implementation order is strictly forward** — each spec ends with working software:

```
01-foundation → 02-detection → 03-update → 04-integration
```

Don't start a spec before its predecessors pass.

## Commands

Spec 01 Task 1 creates `package.json`. Until then there is nothing to run.

```bash
npm test                                        # all tests
npx vitest run tests/config.test.ts             # one file
npx vitest run tests/config.test.ts -t 'name'   # one test
npm run typecheck                               # tsc, includes tests
npm run lint                                    # eslint
npm run format                                  # prettier --write
npm run check                                   # format:check + lint + typecheck + test
```

Run `npm run check` before any commit that closes a task.

## Conventions

**Git**

- Micro commits — one per task step that says commit. The specs already mark them.
- Never commit or push to `main`. Branch per spec: `spec-01-foundation`, etc.
- Push only when asked.

**Commit messages are enforced by commitlint**, via a `commit-msg` git hook — a bad
message is rejected at commit time, not discovered later. `npm install` wires the hook up
through the `prepare` script (`git config core.hooksPath .githooks`); it's a plain shell
hook, not husky, so there's no extra dependency in the hook path.

```
<type>(<scope>): <subject>

feat(config): resolve managed directory by precedence
test(detect): cover cluster inheritance from an auto-accepted anchor
fix(merge): count conflict regions from git merge-file exit status
```

- **Types** (`@commitlint/config-conventional`): `feat`, `fix`, `test`, `refactor`,
  `docs`, `chore`, `build`, `ci`, `perf`, `revert`, `style`.
- **Scope** is the module or area, kebab-case, optional: `config`, `merge`, `detect`.
- **Subject**: imperative mood, lower case, no trailing period. Header ≤ 72 chars.

Every `git commit` written into the specs already conforms. If the hook rejects one, the
message is wrong — not the rule.

**Style** — Prettier owns formatting, ESLint owns correctness. Don't hand-format; run
`npm run format`. Settings (single quotes, semicolons, trailing commas, 100 columns) are
chosen so the code in the specs is already Prettier-clean.

**Dependencies** — runtime deps are `zod` and `picocolors`, and that's the whole list. No
CLI framework, no HTTP client, no git library: use `node:*` builtins, global `fetch`, and
shell out to `git merge-file`. Adding a runtime dependency needs justification in the task.

## Rules that are easy to violate

- **TDD, no exceptions.** Failing test first, run it, watch it fail, then implement.
- **One file, one owning spec.** The contract's ownership table is authoritative. Need
  behavior from another spec's file? Consume its exported interface; don't edit it.
- **Never touch the real `~/.claude`, `~/.config`, or `settings.json` in a test.** Use
  `fs.mkdtemp` and clean up. The user's live configuration is not a fixture.
- **No network in tests.** Inject fakes for `GitHubClient` / `ClaudeClient`. A test that
  reaches github.com is a broken test.
- **Never write to a managed skill or agent file without explicit approval for that
  specific change.** Writing under `<managed-dir>/.skilled/` is always fine.
- **Every error is a `SkilledError`** stating problem, cause, and fix — and saying no
  managed file was modified, whenever that's true. A bare `throw new Error(...)` in `src/`
  is a defect.
- **Adding a CLI flag touches four places:** `BOOLEAN_FLAGS`/`VALUE_FLAGS` in spec 01 Task
  16, a `parseArgs` test, the `--help` text, and the contract's flag table. Miss the first
  and the flag is dead on the real binary while every unit test stays green.
- **Cite section headings and symbol names across specs, never line numbers.** Sibling
  specs shift on every edit; stale line citations already caused four rounds of confusion.

## When you finish a task

Append to `skilled_registry/memory/DECISIONS.md`: the decision, the reason, and the
alternative you rejected. Skip anything already obvious from the code or git log.
