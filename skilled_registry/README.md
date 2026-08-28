# skilled_registry

Central store for everything a coding agent needs to build and maintain `skilled`:
specs, the interface contract, and accumulated agent memory.

```
skilled_registry/
  README.md              you are here
  specs/
    DESIGN.md            product design + rationale — WHY the tool is shaped this way
    00-CONTRACT.md       fixed interface contract — read before any implementation
    01-foundation.md     21 tasks · config, manifest, discovery, errors, CLI
    02-detection.md      22 tasks · the six-strategy provenance cascade
    03-update.md         24 tasks · fetch, three-way merge, the update flow
    04-integration.md    16 tasks · session hook, Claude skill, README, publish
  memory/
    DECISIONS.md         append-only log of decisions made during implementation
    <topic>.md           durable findings worth carrying between sessions
```

## Reading order for an implementing agent

1. **`specs/00-CONTRACT.md`** — every type, path, command, flag, and exit code is
   fixed here. This is the only thing keeping four independently-built specs
   compatible. Never rename or restructure anything in it.
2. **`specs/DESIGN.md`** — the reasoning. Read it when a task's *why* is unclear;
   the error-message wording and terminal transcripts in it are normative, not
   illustrative.
3. **Your assigned spec**, top to bottom.

## Execution order

Dependencies run strictly forward. Each spec ends with working, testable software.

```
01-foundation  →  02-detection  →  03-update  →  04-integration
```

- **01** depends on nothing. Ends with `skilled config` and a bare `skilled` that
  reports what's on disk.
- **02** depends only on 01's exports — including the client *interfaces*, never
  their implementations. Ends with working detection; network strategies degrade
  to a clear `NO_AUTH` message until 03 lands.
- **03** depends on 01 and 02. Ends with `skilled update` doing real merges.
- **04** depends on a working binary. Ends with the session hook, the Claude skill
  wrapper, and a publishable package.

Do not start a spec before its predecessors are green. Do not edit a file another
spec owns — the contract's ownership table is authoritative.

## Rules that survive every task

- **TDD.** Failing test first, run it, watch it fail, then implement. No exceptions.
- **No network in tests.** Inject fakes for `GitHubClient` / `ClaudeClient`.
- **Never touch the real `~/.claude`, `~/.config`, or `settings.json` in a test.**
  Use `fs.mkdtemp` and clean up. The user's live configuration is not a fixture.
- **Never write to a managed skill or agent file without explicit user approval**
  for that specific change. Writing under `<managed-dir>/.skilled/` is always fine.
- **Every error states problem, cause, and fix** — and says that no managed file
  was modified, whenever that is true.

## When you finish a task

Append what a future agent would want to know to `memory/DECISIONS.md`: the
decision, the reason, and the alternative you rejected. Skip anything already
obvious from the code or the git history.
