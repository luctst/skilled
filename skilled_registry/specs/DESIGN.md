# `skilled` — a vendoring tool for AI agent instructions

**Status:** design only, no implementation
**Reviewed with:** `/devex-review`, DX EXPANSION mode
**Date:** 2026-08-14

---

## Context

You collect skills and agents from other people's public repos — GitHub, gists, blog posts — and drop them into `~/.claude`. Over months they go stale: the original author keeps improving the file, your copy stays frozen at download day. Some you've hand-edited, so you can't just re-download.

An audit of your actual `~/.claude` shows how bad the starting position is:

| Fact | Evidence |
|---|---|
| 51 collected files | 34 skills in `skills/`, 17 agents in `agents/` |
| **49 have no recorded origin** | Only `agents/ponytail.md:13` ("Adapted from github.com/DietrichGebert/ponytail") and `skills/explain-code/SKILL.md:8` name a source |
| Version metadata is not an option | Only the 12 `marketing-*` skills carry `metadata.version`; the other ~22 skills and all 17 agents have none |
| Local edits exist but are rare | Per-directory commit counts: most skills = 1 commit; `skills/git/` and `skills/explain-code/` = 2 |
| Sync unit is a directory, not a file | `marketing-ads/` = 12 files across `references/` and `evals/`; `cso/` = a single 36K file |
| Skills carry capability grants | `skills/cso/SKILL.md` and `skills/retro/SKILL.md` declare `allowed-tools: Bash` |

**The intended outcome:** checking whether your collected files are current drops from "an hour of manual archaeology" to "a line of text when you open a session." Updating them stops being a copy-paste operation that risks your edits.

### The reframing that drives the design

Every skill-sync tool on the market is **outbound**: you own one source of truth and fan it out to machines. Your problem is **inbound**: the upstream belongs to a stranger, you've already edited your copy, and you need their changes merged into yours without losing your edits.

That is not syncing. That is **vendoring**. The design follows vendoring tools (`vendir`, `git-vendor`, regraft) rather than skill-sync tools (`skillshare`, `skills-cli`) — and the closest prior art, regraft's "semantic vendoring," is where the three-version merge model below comes from.

### The product thesis

> The failure isn't that updating is hard. It's that **checking** is so expensive it never happens.

Any design where checking costs more than a few seconds fails, regardless of how good its merge is. This is the North Star for every decision below.

---

## Developer Perspective

```
TARGET DEVELOPER PERSONA
========================
Who:       The Collector — a developer who harvests skills and agents from
           strangers' repos, hand-tweaks some, and accumulates 20-100 files
           across ~/.claude over months.
Context:   Reaches for `skilled` after realizing a skill they rely on is stale,
           or suspecting it is and having no way to check.
Tolerance: HIGH for one-time setup (they already hand-curate).
           ZERO for anything that silently overwrites a local edit.
Expects:   That provenance is findable, because "I got it from GitHub" feels
           like it should be enough. It isn't — nothing on disk records it.
```

First-person narrative of the experience **today**, traced through real files:

> I found `ponytail` on someone's GitHub in June. Copied it to `~/.claude/agents/ponytail.md`, tweaked a couple of lines, moved on. Today I want to know if it's still current. I open the file — line 13 says *"Adapted from github.com/DietrichGebert/ponytail."* Lucky. I open the repo. There are commits since June. Which ones landed in my copy? I don't know what I started from. I `diff` my file against `main` and get 200 lines of noise — my edits and their edits, indistinguishable, with no way to tell a local addition from an upstream deletion.
>
> So I try the other 50. `skills/cso/SKILL.md` — 36K, added May 12, never touched. No URL, no version, no author. I genuinely cannot remember where I got it. I paste a sentence into GitHub search and get nothing useful. `marketing-ads` at least says `version: 2.2.0` — but 2.2.0 of *what*? I'd need to find the repo to know if 2.4 exists.
>
> I give up after four files. The honest state: I'm running 51 agent instruction files of unknown vintage from authors I can't name, and one of them declares `allowed-tools: Bash`. I don't check for updates because checking costs an hour. So I never check.

---

## Competitive benchmark

```
Tool                  | TTHW    | Notable DX choice                         | Direction
skillshare (runkids)  | ~2 min  | brew install; init/sync/audit;            | OUTBOUND
                      |         | `audit` scans skills before they reach     | (you own source)
                      |         | the agent. Does NOT merge local edits.     |
skills-cli (kcchien)  | ~3 min  | central git repo → Claude Code + Desktop   | OUTBOUND
Claude Code plugins   | ~1 min  | installed_plugins.json pins gitCommitSha   | INBOUND
                      |         | + marketplace source. Published only.      | (published only)
vendir (carvel)       | ~10 min | declarative yml + lock file, any source    | INBOUND
regraft ("semantic    | ~3 min  | Base/Local/Upstream 3-way merge;           | INBOUND + merge
vendoring")           |         | regraft.json pins base commit; LLM         |
                      |         | resolves semantic conflicts; ships as      |
                      |         | slash command + agent                      |
skilled (target)      | <2 min  | Auto-discovers provenance that was         | INBOUND + merge
                      |         | never recorded. Nobody else does this.     | + discovery
```

**The unoccupied gap:** every inbound tool assumes you already know where the file came from. `skilled` is the only one that works backwards from a file with no metadata. That is the differentiator and it is also the hardest part to build.

---

## Magical moment

**The moment:** first run, zero arguments, no config — the tool tells you something true about your files that you could not have found yourself, and it starts telling you within about one second.

**Delivery vehicle:** zero-arg first run with **streamed** results. Free detections (steps 1–3 below) land instantly; network detections fill in live. Nothing blocks on the slowest lookup.

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

Why this works: the honest "8 unknown" line is part of the magic, not a failure. Today you don't know your blind spot exists. After one second you know its exact size.

---

## Design

### State model

Three versions of every tracked entry — the standard vendoring triple:

| | What it is | Where it lives |
|---|---|---|
| **BASE** | Pristine upstream copy as of the moment you adopted it | `~/.claude/.skilled/base/<id>/` |
| **LOCAL** | What's on disk now, including your edits | `~/.claude/skills/…`, `~/.claude/agents/…` |
| **UPSTREAM** | Current state of the remote | fetched on demand |

Updating = three-way merge of (BASE, LOCAL, UPSTREAM) → new LOCAL + new BASE.

BASE is what makes this work and it's what a two-way diff can't replace: without it you cannot distinguish "you added this line" from "the author deleted this line."

**For the 49 files with no BASE:** once provenance is detected, fetch the upstream commit whose content best matches your local copy and record *that* as BASE. Imperfect but correct in the common case (you downloaded it and barely touched it). Flag reconstructed bases as such in `skilled <name>`.

### Config vs state — two different things, two different places

The config command below makes this distinction load-bearing, so it's worth stating plainly:

| | What it holds | Where | Why there |
|---|---|---|---|
| **Config** | which directory (or directories) `skilled` manages | `~/.config/skilled/config.json` | It *defines* where the managed dir is, so it cannot live inside it |
| **State** | manifest, pristine BASE copies, cache | `<managed-dir>/.skilled/` | Travels with the skills it describes — rides your existing git repo for free |

State layout:

```
<managed-dir>/.skilled/
  manifest.json         tracked entries: path, source, base commit, detection confidence
  base/<id>/…           pristine upstream copies (the merge bases)
  cache/status.json     last known upstream state + fetch timestamp
  status                one-line human summary, for the session hook to `cat`
```

**Reuses existing infrastructure:** `~/.claude` is already a git repo (`git@github.com:luctst/claude.git`) with `SessionStart: git pull` and `Stop: git add -A && commit && push` hooks in `settings.json`. Putting state there means the manifest and every BASE copy get versioned and backed up for free, and every write `skilled` makes is revertible via git. No new backup mechanism needed.

Manifest shape:

```json
{
  "version": 1,
  "entries": [{
    "id": "skills/cso",
    "source": { "type": "github", "repo": "owner/repo", "ref": "main", "subpath": "skills/cso" },
    "base":   { "commit": "abc123", "adoptedAt": "2026-05-12", "reconstructed": true },
    "detection": { "method": "code-search", "confidence": 0.92, "confirmedBy": "user" }
  }],
  "unknown": ["skills/qa-only", "agents/thomas.md"]
}
```

### Provenance detection cascade

Six strategies, cheapest first, results streamed as they land:

| # | Strategy | Cost | Catches |
|---|---|---|---|
| 1 | Scrape inline URLs from file bodies | free, no network | `ponytail.md:13`, `explain-code/SKILL.md:8` |
| 2 | Match local plugin cache | free | anything from `plugins/marketplaces/`, which already pins `gitCommitSha` |
| 3 | Content-hash against a known-sources index | fast | the popular head: awesome-claude-code lists, well-known skill repos |
| 4 | GitHub code search on a rare n-gram from the file | ~10 req/min, needs token | the long tail — small and obscure repos |
| 5 | Cluster inference across sibling directories | free | all 12 `marketing-*` from one hit; **this is what makes 51 files ≈ 8-12 lookups** and is what fits the rate limit inside 2 minutes |
| 6 | Ask Claude to identify it | slow | last-resort stragglers |

**Auth:** borrow `gh auth` silently if `gh auth status` succeeds — zero setup for this persona. Degrade to steps 1-3, 5-6 when absent and say so plainly rather than failing.

**Every auto-detection is a guess until confirmed.** Show the candidate with its evidence and let the user accept or reject:

```
? skills/cso — best match: github.com/owner/repo
    matched 14 consecutive lines of SKILL.md
    repo created 2026-02-11 · 340 stars · last push 2026-08-09
  [y] that's it  [n] wrong  [o] show other candidates  [s] skip
```

**Known hazard — wrong-direction matches.** Code search can find a *fork*, or a repo that copied *from* the same source you did, or from you. Mitigations: prefer the earliest repo containing the content, show repo age/stars/push date as judgment aids, and never track on a guess alone.

### Commands — six, and that's the whole surface

```
skilled                      scan and report: what's tracked, what's stale, what's unknown
skilled <name>               detail on one entry — where it came from, how it was
                             detected, how confident, what changed since
skilled update [<name>]      review and apply, one entry at a time
skilled add <url> [<path>]   register a source by hand, or correct a wrong guess
skilled remove <name>        stop tracking; the file itself is left alone
skilled config               show or set which directory skilled manages
```

Flags on bare `skilled`, rather than more verbs:

```
--refresh        hit the network instead of reading cache
--json           machine-readable output, for hooks and CI
--dir <path>     one-off override of the managed directory
                 exit 0 = everything current, 1 = something is stale
```

**What got folded in, and where it went.** An earlier draft had eleven commands including `scan`, `check`, `refresh`, `diff`, `why`, `note`, `adopt`, and `unlink`. Three of those were near-synonyms a developer could not have chosen between:

| Was | Now |
|---|---|
| `scan` | bare `skilled` — scanning *is* the default behavior |
| `check` | bare `skilled --json`, exit code signals staleness |
| `refresh` | `skilled --refresh` |
| `diff <name>` | the `[d]` option inside `update`, where you already are |
| `why <name>` | `skilled <name>` — no verb needed to look at one thing |
| `adopt <name>` | an option inside `update` ("keep mine, we're square") |
| `unlink` | `remove` — plainer word |
| `note` | dropped from v1 (TODO 6) |

### `skilled config` — pointing it at a different directory

`~/.claude` is the default, not an assumption. Other agent tools keep their instructions elsewhere, and project-local `.claude/` directories are common.

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

Resolution order, highest wins — and `skilled config` prints which one actually applied, so it's never a mystery:

1. `--dir <path>` flag
2. `SKILLED_DIR` environment variable
3. `~/.config/skilled/config.json`
4. auto-detect `~/.claude`

Validation on set: the path must exist and contain a `skills/` or `agents/` directory. If it doesn't, say what was expected and what was found rather than accepting a typo silently.

### Update journey

Nothing is written without your approval — you chose review-then-choose over auto-apply.

Clean case, no local edits:

```
$ skilled update
skills/cso — 6 commits behind (adopted May 12, upstream now Aug 09)
  Your edits:  none
  Upstream:    +142 −18 lines across 1 file

  [d] diff   [a] apply   [s] skip   [n] note   [q] quit
```

Merge case, you edited it:

```
skills/git — 3 commits behind
  ⚠ You edited this file. Merging your 2 changes with their 4.
  Merged cleanly. Your edits preserved.

  [d] review the merged result   [a] accept   [s] skip
```

Conflict case:

```
skills/explain-code — 5 commits behind
  ✗ Conflict: upstream rewrote the section your edit lives in.

  [c] let Claude resolve it
  [e] open in $EDITOR with conflict markers
  [s] skip
```

### Watching — session-start integration

You chose "quietly at Claude Code startup." Because the tool is Node, **the hook must never boot Node in the foreground** — Node's ~80-150ms startup would land on every session.

The `SessionStart` hook is pure shell (~1ms):

```sh
# print cached status if there's news
[ -s ~/.claude/.skilled/status ] && cat ~/.claude/.skilled/status
# refresh in the background if the cache is older than 12h
[ -n "$(find ~/.claude/.skilled/cache/status.json -mmin +720 2>/dev/null)" ] \
  && (skilled refresh >/dev/null 2>&1 &)
```

Output when there's news — one line, then silence until you act:

```
skilled: 3 skills behind upstream (cso, git, marketing-ads) · run `skilled update`
```

Silent when clean. This goes alongside your existing `git pull` hook in `settings.json`, not instead of it.

### Form factor — CLI core plus a thin Claude skill

You chose both, and the split is principled:

- **`skilled` CLI (Node/TypeScript)** owns everything deterministic: detection, manifest, fetch, diff, three-way merge, exit codes. Runs in hooks, in CI, offline, without an LLM.
- **A thin `skilled` skill in `~/.claude/skills/`** wraps it so you can ask "are my skills stale?" in chat, and — the real reason — so **Claude can resolve merge conflicts a plain program cannot**: the author renamed a section your edit referenced, or restructured around a behavior you'd customized. This is the split regraft arrived at, for the same reason.

The CLI never depends on the skill. The skill is a convenience layer over a tool that works fine alone.

---

## Files to create

Greenfield in `/Users/luctst/skilled` — nothing to modify.

```
src/
  cli.ts                 command dispatch, --help
  detect/                the six-strategy cascade, one module per strategy
    inline-url.ts        strategy 1
    plugin-cache.ts      strategy 2 — reads ~/.claude/plugins/installed_plugins.json
    known-index.ts       strategy 3
    code-search.ts       strategy 4 — gh auth borrowing, rate limiting
    cluster.ts           strategy 5
    ask-claude.ts        strategy 6
  manifest.ts            read/write .skilled/manifest.json, schema validation
  merge.ts               three-way merge; shells out to `git merge-file`
  fetch.ts               upstream retrieval, subpath extraction
  render/                terminal output, streaming, diff rendering
  errors.ts              error catalogue (see below)
hooks/session-start.sh   the shell snippet above
skill/SKILL.md           the thin Claude Code wrapper
```

**Reuse, don't reimplement:** `git merge-file` for the three-way merge (deterministic, battle-tested, already installed); `gh auth token` for GitHub credentials; `~/.claude/plugins/installed_plugins.json` and `known_marketplaces.json` as a free provenance source — they already pin `gitCommitSha` per plugin.

---

## Error catalogue

Every error states problem, cause, and fix. Three that will actually happen:

```
✗ Can't reach github.com/owner/repo (404)

  skills/cso points at a repo that no longer exists or went private.
  It was last seen 2026-05-12.

  Your file is untouched — nothing was changed.

  → skilled cso            see how this source was identified
  → skilled remove cso     stop tracking it
  → skilled add <new-url> skills/cso   point it somewhere new
```

```
✗ GitHub search rate limit reached (10/min)

  Identified 38 of 51 so far. 13 still unknown.
  Resuming automatically in 47s, or press Ctrl-C — progress is saved.
```

```
⚠ skills/git: merge conflict in SKILL.md

  Upstream rewrote the "Commit hygiene" section. Your edit added two
  lines inside it, so neither version can simply win.

  Nothing has been written to disk.

  → skilled update git --claude    let Claude merge using your note
  → skilled update git --editor    conflict markers in $EDITOR
  → skilled diff git               see both sides first
```

---

## Developer journey map

| Stage | Developer does | Friction found | Resolution |
|---|---|---|---|
| 1. Discover | Realizes a skill might be stale | No signal today that anything is stale | Session-start hook makes staleness push, not pull |
| 2. Install | `npm i -g skilled` | Node startup cost lands on every session | Hook is pure shell + cached file; Node only in background |
| 3. Hello world | `skilled` | A naive `init` would find nothing to sync — 49 files have no origin | Detection cascade; streamed so first true fact appears in ~1s |
| 4. Real usage | `skilled update` | Fear of losing local edits | BASE copies + three-way merge; nothing written without approval |
| 5. Debug | "Why does it think cso came from there?" | Auto-detection is opaque and can match a fork | `skilled <name>` shows method, confidence, evidence; hazards surfaced at confirm time |
| 6. Upgrade | Manifest format changes | — | Manifest is versioned (`"version": 1`); `~/.claude` git history makes every write revertible |

---

## First-time developer confusion report

Roleplayed as the Collector against this design. Items marked **[fixed]** are addressed above; **[deferred]** are in TODOs.

```
T+0:00  npm i -g skilled. Runs `skilled` because that's the obvious thing
        to type. Sees results streaming — doesn't have to learn a verb first.  [fixed]
T+0:20  "43 of 51 identified." Wonders what the other 8 are and whether
        that's his fault. Output names them explicitly.                        [fixed]
T+0:40  Hits a `?` candidate for cso. Has no idea whether that repo is the
        real source or a fork. Evidence line (age, stars, matched lines)
        is what makes the call answerable.                                     [fixed]
T+1:10  Wonders whether confirming will overwrite anything. Nothing has
        been written yet — but the tool never said so out loud.                [deferred → TODO 3]
T+2:00  Sees "12 behind upstream." Wants to know if any are urgent or if
        it's all typo fixes. No severity signal exists.                        [deferred → TODO 1]
T+3:00  Runs `skilled update`, approves 12 diffs one at a time. Tedious
        but he trusts it. Succeeds.
```

---

## What already exists — reuse, don't rebuild

- **`~/.claude` is a git repo with auto-commit/push hooks** (`settings.json`) → free versioning, backup, and undo for everything `skilled` writes. Do not build a backup system.
- **`plugins/installed_plugins.json`** already records `version`, `gitCommitSha`, `installedAt`, `lastUpdated` per plugin, and **`known_marketplaces.json`** records sources → both a free provenance source (cascade step 2) and the proven manifest shape to imitate.
- **`git merge-file`** → the three-way merge. Already installed, already correct.
- **`gh` CLI auth** → GitHub token without a setup step.
- **Two files already name their own upstream** (`ponytail.md:13`, `explain-code/SKILL.md:8`) → cascade step 1 is a regex, and it works on real data today.
- **`marketing-*` skills carry `metadata.version`** → a cheap corroborating signal for that family.

---

## NOT in scope

| Deferred | Rationale |
|---|---|
| **Risk-classified diffs** (flagging when an update grants `allowed-tools: Bash` or adds network egress) | You chose to show it as a normal diff line. Logged as TODO 1 — it's the single strongest differentiator versus skillshare, and `cso`/`retro` already carry Bash grants. |
| Publishing/outbound sync (push your skills to others) | Solved by skillshare and skills-cli. Different product. |
| Non-git sources (gists, raw URLs, blog HTML) | v1 is git-repo sources. Gists are a natural v2. |
| Auto-apply without review | Explicitly rejected — you chose review-then-choose. |
| Commands, MCP config, `CLAUDE.md` sync | Scope is skills + agents, as asked. Entry model generalizes if wanted. |
| TUI dashboard | Wrong shape for a tool used monthly. |
| Windows support | Shareable-later, not day one. |

---

## Proposed TODOS.md entries

Each needs your accept/skip before it's written anywhere.

**TODO 1 — Risk-classified diffs**
*What:* Tag each update by what it changes: prose-only / behavior / ⚠ new tool grant / ⚠ new network egress. Require an explicit yes for the flagged categories.
*Why:* `skills/cso/SKILL.md` and `skills/retro/SKILL.md` declare `allowed-tools: Bash`. An upstream update that adds that line to a skill without it silently widens what an agent may execute on your machine — and in a 200-line diff you skim, it's one line.
*Pros:* No competitor does merge **and** audit. Turns a vendoring tool into a supply-chain tool.
*Cons:* Needs a parser per grant type and will produce false alarms early.
*Depends on:* diff rendering.

**TODO 2 — Known-sources index**
*What:* A curated map of popular skill repos → content hashes, so cascade step 3 catches the head of the distribution without touching GitHub search.
*Why:* Every file resolved offline is one that doesn't burn the 10/min rate limit, directly protecting the sub-2-minute target.
*Pros:* Faster, works without a token, degrades the tool gracefully when GitHub is unreachable.
*Cons:* Needs maintenance; goes stale.
*Depends on:* cascade step 3.

**TODO 3 — "Nothing has been written yet" affordance**
*What:* State plainly during the initial scan that no file has been modified, and print a summary of exactly what will change before the first write.
*Why:* Confusion report T+1:10 — the developer doesn't know whether confirming a provenance guess also applies an update. It doesn't, but silence about it reads as risk.
*Pros:* Cheap; removes the biggest trust wobble in the first run.
*Cons:* None.

**TODO 4 — Fork/copy-direction heuristics**
*What:* Score candidate repos by first-commit date, star count, and whether one repo's history contains the other's content, to avoid tracking a fork or a downstream copy.
*Why:* Code search finds *a* repo containing your text, not necessarily *the* source. Tracking a fork means silently following the wrong author.
*Pros:* Directly protects correctness of the whole tool.
*Cons:* Heuristic; will sometimes be wrong regardless.
*Depends on:* cascade step 4.

**TODO 5 — CI usage**
*What:* Document the `skilled --json` exit-code contract and a sample GitHub Action.
*Why:* Only matters if you share the tool. Cheap to add once the exit codes exist.

**TODO 6 — `skilled note`**
*What:* Let the user record *why* they diverged from upstream, and feed that note to Claude when it resolves a conflict.
*Why:* Borrowed from regraft. A merge conflict is much easier to resolve correctly when you know the intent behind the local edit — six months later you won't remember it.
*Pros:* Turns conflict resolution from guessing into informed merging.
*Cons:* A seventh command, and it only pays off on files you've actually edited — currently 2 of 51.
*Depends on:* Claude-assisted merge.

---

## Verification

No code yet — this is a design. When built, verify end-to-end against real data:

1. **Detection accuracy.** Run `skilled` against the real `~/.claude`. Success = ≥2 hits from step 1 alone (`ponytail`, `explain-code` are known-good ground truth), all 11 figma skills from step 2 via the plugin cache, and the 12 `marketing-*` resolved as one cluster from a single lookup.
2. **Sub-2-minute target.** Time from `skilled` to the first fully-resolved staleness count. First streamed line must appear in under 1s.
3. **Merge safety.** Take `skills/git/` (has 2 local commits = real local edits), point it at its upstream, apply an update, confirm both local edits survive. Verify via `git diff` in `~/.claude`.
4. **Hook cost.** Time the `SessionStart` snippet. Must stay under 10ms, and must not spawn Node in the foreground.
5. **Graceful degradation.** Run with no `gh` auth and with the network off. Must still resolve steps 1-3 and say clearly what it couldn't do.
6. **Nothing written without consent.** Run `skilled` to completion, then `git status` in `~/.claude` — only `.skilled/` should appear, never a skill or agent file.
7. **Config redirection.** `skilled config dir <tmp>` against a scratch directory containing a `skills/` folder. Confirm state lands in `<tmp>/.skilled/`, not `~/.claude/.skilled/`, and that `skilled config` correctly reports which of the four resolution sources applied.

---

## Unresolved

- **Package name.** `skilled` is taken on npm by an unrelated package — needs checking before publish. Working name only.
- **Where the known-sources index lives** if TODO 2 is accepted — bundled with the package (stale but offline) or fetched (fresh but a network dependency).
