---
name: interrogate
description: >-
  Break a diff or design with executable failing reproductions in isolated share
  worktrees and prove transitive caller, wire-schema, and mixed-version rollout
  safety. Use for /agy-pstack-next:interrogate, /interrogate, "break this",
  "adversarial review", "stress test this diff", or "blast radius".
---

# Interrogate

Break a change or design with real executed reproductions and prove what happens across transitive callers, wire schemas, migrations, and mixed-version rollouts—without modifying the coordinator's checkout.

Load built-in `swarm` (and `swarm_pane` when present) before spawning workers.

## Phase 1. Lock Scope, Intent & Primary Safety Fact

1. **Scope.** Inspect the user-named files, commits, or PR (default: `git merge-base HEAD main` plus `git status --short`). If uncommitted edits exist, export a patch to `/tmp` so `share` workers test the exact working state.
2. **Behavioral intent.** Restate in plain sentences what the change must accomplish and preserve.
3. **Primary safety hypothesis.** Write down the single load-bearing assumption making the change look safe (e.g., *"old readers ignore unknown enum variants"* or *"eviction only runs at refcount zero"*) so workers test it directly.

## Phase 2. Fan Out Exploit Authors & Blast-Radius Scout

Call `swarm{action: "models"}` and pick distinct `high`/`xhigh` model families across adversaries and the verifier when available:

1. **Adversarial exploit writers (`adv-logic`, `adv-boundary`, optional `adv-race` in `workspace: "share"`):**
   - **`adv-logic`:** State invariants, off-by-one bounds, partial-failure rollback, idempotency, and ordering races (when protocol interleavings matter, pass the resolved absolute `<plugin-dir>/skills/statechart/SKILL.md` path in `adv-logic`'s brief for `read_file`, not `/statechart` by slash name, since swarm workers do not mount plugin skills).
   - **`adv-boundary`:** Untrusted inputs, auth/permission gates, resource leaks, timeouts, and live UI/CLI journeys on isolated `/tmp` dirs and `--port 0`.
   - Every `adv-*` writes and executes real failing tests, fuzz probes, or CLI reproductions inside its disposable `share` worktree. Style opinions and hypothetical prose critiques are banned. Never `git push`.
2. **Transitive blast-radius mapper (`blast` in `workspace: "inherit"`):**
   - Walk 2 to 3 hops upstream/downstream across callers and pinned dependencies.
   - Check async cancellation, shutdown order, wire/RPC/DB schemas, feature-flag combinations, and **mixed-version rollout skew** (old reader + new writer, new reader + old writer).
   - Push the primary safety hypothesis as far up the proof ladder as possible: (1) unverified claim -> (2) `file:line` citation -> (3) state walkthrough -> (4) executed read-only probe -> (5) live E2E reproduction.

## Phase 3. Live `#seq` Deduplication & Exploit Chaining

- Workers post one-line `[CLAIM] <file:line> <bug>` messages immediately on spotting a defect and check `read_board{since}` before duplicating a peer's target.
- Whenever `blast` spots a suspicious caller assumption or schema mismatch, it posts the trace and rings `@adv-boundary` or `@adv-logic` to chain that trace into an executed failing test in its `share` worktree.

## Phase 4. `verifier` Survival Gate & Clean Teardown

Keep `adv-*` workers parked in `waiting` while an independent `verifier` (`workspace: "inherit"`) audits every claim:

1. `verifier` reruns each `adv-*` reproduction command and checks every `blast` trace.
2. **Strict survival rule:** A finding survives **only** when (a) an executed command/test reproduces the failure against real code and violates stated intent, or (b) for multi-version deploy skew / pre-code specs where one tree cannot execute two versions at once, an exact `file:line` trace on both sides of the boundary proves the break.
3. Merge duplicate root causes, drop unproved speculation with per-worker counts, then call `swarm{action: "kill"}` on `adv-*`, `blast`, and `verifier` (never merge throwaway exploit hacks into the primary branch).
4. Report five concise sections: **Intent**, **Core Safety Fact** (with proof rung 1–5), **Verified Findings** (ordered by severity with repro commands), **Cleared Blast-Radius Paths**, and **Dropped Claims**.
