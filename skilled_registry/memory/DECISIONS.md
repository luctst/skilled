# Decisions Log

Append-only. Newest at the bottom. One entry per decision that a future agent
would otherwise have to re-derive. Skip anything obvious from the code or git log.

Format:

```
## YYYY-MM-DD — <short title>
**Decision:** what was chosen.
**Why:** the reason, in one or two lines.
**Rejected:** the alternative and why it lost.
**Spec/Task:** where this came up.
```

---

## 2026-08-27 — Vendoring model, not sync

**Decision:** `skilled` is an inbound vendoring tool. Every tracked item keeps
three versions: BASE (pristine upstream at adopt time), LOCAL (on disk, with the
user's edits), UPSTREAM (current remote). Updating is a three-way merge.
**Why:** the upstream belongs to a stranger and the local copy is already edited.
A two-way diff cannot tell a local addition from an upstream deletion.
**Rejected:** the skill-sync model used by skillshare and skills-cli — one source
of truth you own, fanned out to targets. That is outbound; it solves the opposite
problem and explicitly does not merge locally-modified skills.
**Spec/Task:** DESIGN.md, spec 03.

## 2026-08-27 — Provenance must be discovered, not assumed

**Decision:** a six-strategy detection cascade runs cheapest-first and streams
results: inline-url, plugin-cache, known-index, code-search, cluster, claude.
**Why:** 49 of the 51 real files in `~/.claude` record no origin at all. Without
discovery, a first run finds nothing to sync and prints an empty list. Cluster
inference is load-bearing, not an optimization — it turns 51 lookups into ~8-12,
which is what fits GitHub code search's ~10/min limit inside the 2-minute target.
**Rejected:** requiring manual registration of all 51 sources up front. Certain
but tedious enough that it would not get done.
**Spec/Task:** DESIGN.md, spec 02.

## 2026-08-27 — Six commands, flags instead of verbs

**Decision:** `skilled`, `skilled <name>`, `update`, `add`, `remove`, `config`.
Everything else is a flag on bare `skilled`: `--refresh`, `--json`, `--dir`.
**Why:** an earlier draft had eleven commands including `scan`, `check`, and
`refresh` — three near-synonyms a developer could not choose between. Scanning is
what the tool does by default; looking at one thing needs no verb.
**Rejected:** keeping `diff`, `why`, `note`, `adopt`, `unlink` as top-level verbs.
`diff` lives inside `update` where you already are; `why` became `skilled <name>`.
**Spec/Task:** DESIGN.md, spec 01/02.

## 2026-08-27 — Config outside the managed dir, state inside it

**Decision:** config (which directories to manage) lives in
`~/.config/skilled/config.json`. State (manifest, BASE copies, cache) lives in
`<managed-dir>/.skilled/`.
**Why:** config defines where the managed directory is, so it cannot live inside
it. State describes the skills it sits next to, so it should travel with them —
and `~/.claude` is already a git repo with auto-commit hooks, which makes every
write versioned, backed up, and revertible for free.
**Rejected:** a single global state file. It would not travel with the skills and
would need its own backup story.
**Spec/Task:** spec 01.

## 2026-08-27 — Node chosen, so the session hook must be pure shell

**Decision:** the tool is Node/TypeScript; `hooks/session-start.sh` is pure shell
that `cat`s a pre-written status line and only spawns a detached background
refresh when the cache is stale.
**Why:** Node boots in ~80-150ms and the hook runs on every session start. Booting
Node in the foreground would make the tool a tax on opening a terminal.
**Rejected:** Go, which starts in ~5ms and would make this a non-issue, but is a
different language from the rest of the user's work.
**Spec/Task:** spec 04.

## 2026-08-27 — Risk-classified diffs deferred

**Decision:** an update that widens `allowed-tools` (e.g. adds `Bash`) is shown as
an ordinary diff line in v1, not flagged as a separate risk category.
**Why:** the user's explicit call, made after the risk was raised.
**Rejected:** flagging grant-widening changes and requiring separate approval.
Logged as TODO 1 in DESIGN.md — it remains the strongest differentiator versus
skillshare, and `skills/cso` and `skills/retro` already carry Bash grants, so this
is where it would bite first.
**Spec/Task:** DESIGN.md "NOT in scope".

## 2026-08-27 — Command registry: replace-on-duplicate, not magic keys

**Decision:** internal registry names are `RESERVED_COMMANDS = ['scan','show',
'update','add','remove','config']`. Bare `skilled` runs `scan`; an unrecognized
first positional runs `show`. `registerCommand` replaces any earlier command with
the same name, which is how specs 02–04 override spec 01's placeholders.
**Why:** spec 01 ships a working basic scan (each spec must be independently
shippable), and later specs need to supersede it without editing `cli.ts`.
**Rejected:** magic registry keys `''` for bare invocation and `'<name>'` for the
fallback. Spec 02 was written against those and had to be corrected — no magic
strings, and named commands are greppable.
**Spec/Task:** contract § "Command names, dispatch, and how later specs override";
spec 01 Tasks 17-18; spec 02 Task 21.

## 2026-08-27 — Extension registration is a guarded function call

**Decision:** `cli.ts`'s dispatch function opens with guarded dynamic imports:
`try { (await import('./commands/index.js')).registerCommands(); } catch {}`, and a
sibling line for `./update.js`.
**Why:** two independent spec authors hit the same hazard — a top-level
`registerCommand(...)` in an extension module runs while `cli.ts`'s registry array
is still initialising and throws a temporal-dead-zone error. The try/catch is what
lets spec 01 test green before specs 02/03 exist.
**Rejected:** module-level side-effect registration; static imports without guards.
**Spec/Task:** contract, spec 02 Task 21, spec 03 Task 22.

## 2026-08-27 — `skilled-refresh` as a second binary

**Decision:** `package.json` declares a second `bin`, `skilled-refresh`, spawned
detached by the session hook. It is not a seventh command and is never documented
as user-facing.
**Why:** the background refresh must hit the network, write the cache, AND write
the status line in one Node boot. Bare `skilled --refresh` does the first two but
cannot write the status line without spec 01 or 02 importing spec 04.
**Rejected:** adding a `refresh` verb (breaks the closed six-command surface);
having the hook call `skilled --refresh` then a second process for the status line
(two Node boots).
**Spec/Task:** spec 04 Tasks 5-6.

## 2026-08-27 — DESIGN.md contains three invalid commands

**Decision:** the contract carries a correction table, and specs 03 and 04 each
ship a test that greps `src/` and the docs for command strings outside the six-
command surface. Spec 04's version includes a mutation step that appends a bad line,
proves the audit fails, then reverts.
**Why:** `DESIGN.md` predates the command collapse from eleven verbs to six. Its
hook snippet says `skilled refresh`, and its error catalogue offers `skilled diff
git` and `skilled update git --claude`. None exist. Copying them would send a user
to a `BAD_FLAG` error in their first minute.
**Rejected:** editing DESIGN.md to match. It is the record of the design
conversation; the correction table keeps both the history and the truth.
**Spec/Task:** contract § "Errors in the design doc"; spec 03 Task 24; spec 04 Task 13.

## 2026-08-27 — `base.commit: ''` sentinel kept over `string | null`

**Decision:** "origin confirmed, BASE not yet captured" is represented as
`{ commit: '', reconstructed: true }`. `buildStatus` reports such an entry as
`'unknown'`; `skilled update` must reconstruct BASE before merging it and must not
persist a reconstruction during a dry run. `plugin-cache` is the only strategy that
skips the sentinel — it recovers a real pinned `gitCommitSha`.
**Why:** specs 02 and 03 independently converged on the same sentinel and both
already test it. Documenting it costs nothing.
**Rejected:** `commit: string | null`, which models the state more honestly but
would churn three finished specs — spec 01's zod schema and spec 03's merge paths —
for a type-purity win with no behavioral change.
**Spec/Task:** contract § BaseRecord sentinel; spec 02 `entryFromCandidate`;
spec 03 Task 14.

## 2026-08-27 — Cluster inference runs inside the code-search loop

**Decision:** sibling propagation fires immediately after each network hit, not as
a pass after code search completes. Plus a free pass before any network work and a
final sweep.
**Why:** running it afterwards lets each sibling in a family burn its own lookup
before the family's first hit reaches it — 51 lookups instead of 8-12, which blows
the GitHub code-search rate limit and the sub-2-minute target with it. Spec 02
caught this while implementing; the original brief had the ordering wrong.
**Rejected:** cluster as a post-pass, as originally briefed.
**Spec/Task:** spec 02, code-search task.

## 2026-08-27 — Certain provenance detections are auto-accepted

**Decision:** auto-accept (`confirmedBy: 'auto'`) when `confidence >= 0.95` AND the
method is `inline-url`, `plugin-cache`, or `known-index`. Always prompt for
`code-search` and `claude`, for any id with competing candidates, and for a
`cluster` candidate whose parent was prompted. `--confirm-each` forces prompting
for everything.
**Why:** "confirm every candidate" cost ~40 keypresses on a 51-file directory and
destroyed the sub-2-minute first run, which is the product's headline moment. The
three auto-accepted methods are assertions, not inferences — the file's own text
names its upstream, a pinned `gitCommitSha` matches, or a content hash matches
exactly. Confirming provenance writes only to the manifest, never to a skill file.
**Rejected:** confirming everything (the original brief — spec 02 flagged the cost
while implementing); a single batch yes-to-all (still one gate on certainties).
**Note the asymmetry:** applying updates remains review-then-choose in every case.
Detection records where a file came from; updating rewrites the file.
**Spec/Task:** contract § "Auto-accepting certain provenance detections";
spec 02 confirmation task.

## 2026-08-27 — Registry keys are `'scan'`/`'show'` (and how that got confused)

**Decision:** `RESERVED_COMMANDS = ['scan','show','update','add','remove','config']`.
Bare `skilled` → `'scan'`; unrecognized first arg → `'show'` with args unchanged.
Spec 01 `:4202`, `:4370-4377`, dispatch at `:4465-4471`.
**Why:** named keys are greppable and spec 01 pins them at `:29` as conventions
specs 02-03 are written against. `registerCommand` replaces by name, so later specs
override spec 01's placeholders without editing `cli.ts`, and `ensureCommands()`
does the guarded dynamic import of specs 02/03 itself — neither needs a wiring task.
**Rejected:** `''` and `'<name>'` magic keys.
**Process lesson worth keeping:** this took three corrections because the team lead
sent guidance to agents that were still writing. Spec 01 rewrote itself to match a
suggestion, spec 02 re-read spec 01 *mid-rewrite* and faithfully captured the
transient state with line citations that were already stale. Line-number citations
across sibling specs go stale the moment a sibling is edited.
**Do this instead:** let parallel authors finish, THEN reconcile against the settled
files. Cite section headings rather than line numbers when referring across specs.

## 2026-08-27 — The extension hook lives in cli.ts, and only there

**Decision:** `ensureCommands()` in spec-01-owned `cli.ts` loads specs 02/03 via
dynamic import guarded on module-not-found only. Specs 02-04 write no `cli.ts` code;
they verify the wiring with a grep instead.
**Why:** `cli.ts` is spec-01-owned. If a later spec adds the call it edits a file it
does not own; if no spec adds it, the registrars never run and those commands
silently never reach the registry. There is exactly one correct home for it.
**Rejected:** having spec 02 insert the guarded import (ownership violation);
a bare stub extension point (nothing would call it).
**Also settled:** the guard skips ONLY `ERR_MODULE_NOT_FOUND` (plus Vitest's message
form — Vite's module runner does not set the code). Any other import failure
propagates, so a syntax error in a sibling module is not silently swallowed.
**Gotcha for specs 02-04:** `ensureCommands()` is idempotent and registers once per
process. A test installing a double over a real command must `await ensureCommands()`
BEFORE its own `registerCommand(...)`, or the first `run()` overwrites the double.
**Spec/Task:** spec 01 Task 18; spec 02 Task 21 Step 5.

## 2026-08-27 — Ctrl-C during confirmation must stop the loop

**Decision:** `promptKey` resolves Ctrl-C and Escape to the exported constant
`PROMPT_CANCEL` (`'cancel'`), not to a key. `confirmCandidates` treats it as "stop
the loop", sets `cancelled: true`, leaves the remaining ids unasked, and the scan
reports how many confirmations were saved.
**Why:** spec 02's confirmation loop originally treated any unrecognised key as
"skip", so Ctrl-C would have walked the user through every remaining prompt instead
of stopping — infuriating on a 51-file first run. Found by spec 02 reading spec 01's
prompt contract properly rather than assuming its shape.
**Rejected:** treating cancel as skip; treating it as abort-without-saving (the
already-confirmed entries are flushed as they are answered, so they survive).
**Spec/Task:** spec 02 Task 19.

## 2026-08-27 — Cite section headings across specs, never line numbers

**Decision:** every cross-spec reference names a section or symbol ("spec 01 Task 18",
`registerOptionalCommands`), never a line number.
**Why:** the `scan`/`show` confusion cost four correction rounds almost entirely
because of stale line citations. Spec 02 cited `01-foundation.md:4187` and
`:4354-4361` in good faith; by the time anyone read them, 4187 was a bare code fence
and 4354-4361 was `CommandContext`. Two agents reasoned correctly from different
snapshots of the same moving file and reached opposite conclusions.
**Root cause was the team lead editing a moving target** — sending guidance to agents
that were still writing, so spec 01 complied with a bad suggestion, spec 02 read
during that window, and spec 01 then reverted.
**Do this instead:** let parallel authors finish before reconciling; reconcile against
the settled artifact; cite headings.
**Spec/Task:** applies to all specs; citations already converted in spec 02.

## 2026-08-27 — Adding a flag means touching four places, not one

**Decision:** `--confirm-each` is registered in spec 01's `BOOLEAN_FLAGS`, covered by
two `parseArgs` tests, and listed in `--help` — not just in the contract's flag table.
**Why:** the flag was added to the contract and to spec 02's logic, but spec 01's
`parseArgs` validates against a closed `BOOLEAN_FLAGS` set and rejects anything else
with `BAD_FLAG` exit 2. `skilled --confirm-each` would have failed before any command
ran. Spec 02's tests inject flags into `CommandContext` directly, so they passed
either way — only a real-binary check caught it.
**Generalize:** any new flag needs (1) `BOOLEAN_FLAGS` or `VALUE_FLAGS` in spec 01
Task 16, (2) a `parseArgs` test, (3) the `--help` text, (4) the contract flag table.
Miss (1) and the flag is dead on the real binary while every unit test stays green.
**Spec/Task:** spec 01 Task 16; spec 02 Task 20.

## 2026-08-27 — Auto-accept needed a cluster anchor to actually work

**Decision:** `Candidate` gains `clusterAnchorId`, and `shouldAutoAccept(candidate,
competing, autoAcceptedIds)` is the single home for the rule: competing > 1 → prompt;
assertion method at >= 0.95 → accept; `cluster` → accept only if its anchor was
auto-accepted; else prompt. `entryFromCandidate` takes the confirmer explicitly.
**Why:** the auto-accept decision was specified as prose with no mechanism behind it —
`entryFromCandidate` hardcoded `'user'`, so `'auto'` was unreachable, and cluster
candidates had no way to know whether their anchor had been auto-accepted. Without the
anchor the eleven `figma-*` siblings of an auto-accepted plugin-cache hit would each
have prompted, which is the exact case the design mock shows as already-confirmed.
**Also changed:** the on-screen trust line. "Nothing on disk has been modified" became
false the moment auto-accept could write the manifest unprompted; it now reads "No
skill or agent file has been modified — skilled only ever writes .skilled/."
**And:** the stream marker is provisional, because a competing candidate can arrive
later for the same id — the scan then prints "a second candidate turned up; I'll ask"
rather than leaving a stale checkmark on screen.
**Spec/Task:** spec 02 Tasks 9, 15, 20.

## 2026-08-28 — Prettier ignores the docs and the byte-sensitive fixture

**Decision:** `.prettierignore` gains `CLAUDE.md`, `AGENTS.md`, `skilled_registry`, and
`tests/fixtures/managed` on top of the three entries spec 01 Task 1 lists.
**Why:** `npm run check` starts with `format:check`, which runs over the whole repo.
Out of the box it failed on nine pre-existing markdown files (the specs, DESIGN.md,
DECISIONS.md, CLAUDE.md) and on the fixture's `channel-benchmarks.md` table. Neither is
formattable: rewriting the specs would edit files this spec does not own, and the
fixture mirrors a real `~/.claude` byte for byte — specs 02–04 hash and line-match it,
so a reflowed table would silently move ground truth under them.
**Rejected:** running `prettier --write .` once and committing the reformat. It touches
seven spec files to satisfy a formatter that exists for `src/`, and it makes the
ponytail line-13 invariant a formatter's problem rather than the fixture's.
**Spec/Task:** spec 01 Tasks 1 and 3.

## 2026-08-28 — Prettier reflows two unions in the verbatim types.ts

**Decision:** `src/types.ts` was copied verbatim from the contract, then run through
`prettier --write`, which collapsed `DetectionMethod` and `MergeOutcome` onto single
lines because both fit inside the 100-column limit.
**Why:** the contract says copy verbatim; spec 01 says the Prettier settings were
chosen so spec code is already Prettier-clean. Those two claims conflict for exactly
these two declarations. The change is whitespace only — no member is added, renamed, or
reordered — so the verbatim requirement survives in substance while `npm run check`
stays green.
**Rejected:** a `// prettier-ignore` comment above each union, which adds two lines the
contract does not have to a file whose whole point is that it matches the contract.
**Spec/Task:** spec 01 Task 1 Step 6.

## 2026-08-28 — Spec 01 Task 7's own commit message violates commitlint

**Decision:** Task 7's commit shipped as
`feat(config): resolve managed dir by precedence, report origin` (62 chars) instead of
the spec's `feat(config): resolve the managed directory by precedence and report the
origin` (79 chars).
**Why:** the `commit-msg` hook installed in Task 1 enforces
`@commitlint/config-conventional`, whose `header-max-length` is 72. The spec's literal
message is rejected at commit time, so it cannot be used as written. The shortened form
keeps both halves of the meaning — precedence, and reporting which source won.
**Rejected:** `--no-verify`. The hook exists precisely so a bad message is caught at
commit time; bypassing it to preserve a bad message inverts the point. Also rejected:
raising `header-max-length`, which would edit a Task 1 config to accommodate one
sentence and weaken the rule CLAUDE.md states.
**Spec/Task:** spec 01 Task 7 Step 5.

## 2026-08-28 — One test line in Task 7 reflowed by Prettier

**Decision:** `tests/config.resolve.test.ts` keeps the spec's code with one call
wrapped across four lines: the spec's single-line
`await resolveConfig({ dirFlag: flagDir, env: { ...env, SKILLED_DIR: envDir } })` is 102
columns, past the 100-column limit, so `format:check` failed on it.
**Why:** same conflict as the `types.ts` reflow — whitespace only, no assertion or value
changed, and `npm run check` runs `format:check` first.
**Rejected:** widening `printWidth`, which would reformat every file to satisfy one
line.
**Spec/Task:** spec 01 Task 7 Step 1.

## 2026-08-28 — Three more Prettier reflows in the Tasks 10–11 test code

**Decision:** `tests/manifest.io.test.ts` keeps the spec's code with two object literals
wrapped across several lines (the `entries: [{ ...makeEntry('skills/cso'), base: {...} }]`
and `... detection: {...} }]` lines are 122 and 133 columns), and
`tests/discover.test.ts` wraps its four-name import from `./fixtures/index.js` (101
columns).
**Why:** the same conflict already recorded for `types.ts` and Task 7 — Prettier's
100-column `printWidth` runs first in `npm run check`, and the spec's own text exceeds
it. Whitespace only: no assertion, value, key order, or name changed. Both files pass
their spec-stated test counts (8 and 9) before and after the reflow.
**Rejected:** `// prettier-ignore` on each literal, which adds lines the spec does not
have to files whose value is that they match the spec.
**Spec/Task:** spec 01 Task 10 Step 1, Task 11 Step 1.

## 2026-08-28 — Task 13's own commit message violates commitlint

**Decision:** Task 13's commit shipped as
`feat(render): render scan headers, status rows, totals, and hook line` (69 chars)
instead of the spec's `feat(render): render scan headers, status rows, totals, and the
hook line` (73 chars).
**Why:** same conflict already recorded for Task 7 — `header-max-length` is 72 and the
hook rejects the spec's literal message at commit time. Dropping one article keeps every
noun, so nothing about what the commit contains is lost.
**Rejected:** `--no-verify`, for the reason recorded under Task 7.
**Spec/Task:** spec 01 Task 13 Step 5.

## 2026-08-28 — Four more Prettier reflows in the Tasks 13–14 render code

**Decision:** `src/render/status.ts` keeps the spec's code with four statements
rewrapped: the Task 13 type import collapsed to one line and was re-split when Task 14
added `Entry` and `ResolvedConfig`; the `skilled add <url> <name>` step literal and the
`statusLineSummary` filter/map chain were split (102 and 101 columns); and the
`renderItemDetail` source `lines.push(...)` collapsed to one line (98 columns).
**Why:** the same conflict recorded for `types.ts` and Tasks 7 and 10–11 — Prettier's
100-column `printWidth` runs first in `npm run check` and the spec's own text is on both
sides of it. Whitespace only: no string, argument, or name changed, and both test files
are byte-identical to the spec.
**Rejected:** `// prettier-ignore` per statement, which adds lines the spec does not
have to the file whose value is that it matches the spec.
**Spec/Task:** spec 01 Task 13 Step 3, Task 14 Step 3.

## 2026-08-28 — PromptInput.setEncoding takes BufferEncoding, not string

**Decision:** `src/render/prompt.ts` declares `setEncoding(encoding: BufferEncoding):
void` where Task 15 wrote `setEncoding(encoding: string): void`.
**Why:** the spec's signature does not typecheck. `defaultPromptIO()` returns
`process.stdin`, whose `setEncoding(encoding?: BufferEncoding)` is neither assignable to
nor from `(encoding: string) => void`: the standard direction fails because `string` is
not a `BufferEncoding`, and the method-bivariance fallback fails too because the optional
parameter makes the source type `BufferEncoding | undefined`, and `undefined` is not a
`string` under `strictNullChecks`. `tsc` reported TS2322 at the `process.stdin` literal.
Narrowing the interface fixes it with one token: the only call site passes `'utf8'`,
which is a `BufferEncoding` literal, and the test's `FakeInput.setEncoding(encoding:
string)` still satisfies the interface by method bivariance, so Task 15's test file is
byte-identical to the spec.
**Rejected:** `process.stdin as PromptInput` in `defaultPromptIO`, which silences the
compiler about a genuine mismatch rather than resolving it; and making the interface
parameter optional, which would let a caller drop the encoding a raw-mode prompt depends
on.
**Spec/Task:** spec 01 Task 15 Step 3.

## 2026-08-28 — One more Prettier reflow in the Task 16 flag tables

**Decision:** `src/cli.ts` keeps the spec's code with `BOOLEAN_FLAGS` split one entry per
line, and `tests/cli.run.test.ts` keeps the spec's test with the `Capture.io` type literal
and the one-line `async run() { return 1; }` double expanded.
**Why:** the same 100-column `printWidth` conflict already recorded for `types.ts` and
Tasks 7, 10–11 and 13–14. The `BOOLEAN_FLAGS` line is 103 columns, the `Capture.io` line
107. Whitespace only — no flag name, string, or argument changed, and `src/cli.ts` for
Tasks 17–18 and `tests/cli.flags.test.ts` / `tests/cli.registry.test.ts` are
byte-identical to the spec.
**Rejected:** `// prettier-ignore`, for the reason recorded under Tasks 13–14.
**Spec/Task:** spec 01 Task 16 Step 3, Task 18 Step 1.

## 2026-08-28 — Adding a flag means editing BOOLEAN_FLAGS, not just the help text

**Decision:** `--confirm-each` is carried in `BOOLEAN_FLAGS` in `src/cli.ts` and covered by
its own test in `tests/cli.flags.test.ts`, even though no spec 01 command reads it.
**Why:** `parseArgs` rejects any token that is in neither `BOOLEAN_FLAGS` nor
`VALUE_FLAGS`, so a flag documented in `usage()` but missing from the set exits 2 on the
real binary while every unit test of the consuming command stays green. Spec 02 is the
first reader; the parser has to accept it before then.
**Rejected:** letting spec 02 add the flag when it adds the reader — spec 02 does not own
`cli.ts` and would be editing another spec's file.
**Spec/Task:** spec 01 Task 16 Step 3.
