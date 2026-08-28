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
