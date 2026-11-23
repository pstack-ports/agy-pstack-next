---
name: interrogate
description: >-
  Break a diff or design with executable failing reproductions in isolated share
  worktrees and prove transitive caller, wire-schema, and mixed-version rollout
  safety. Use for /agy-pstack-next:interrogate, /interrogate, "break this",
  "adversarial review", "stress test this diff", or "blast radius".
---

# Interrogate

Follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md) to break a change or design with executed reproductions and prove transitive caller, wire-schema, and rollout safety without modifying `TARGET_CWD`.

## Phase 1. Lock Scope, Intent & Primary Safety Fact

1. **Scope.** From a quick read-only check on `TARGET_CWD` (`merge-base HEAD origin/HEAD`—or `main`—plus `status --short`), state the target commits/files, behavioral intent, and the single **primary safety hypothesis** making the change look safe (e.g., *"old readers ignore unknown enum variants"*). If `TARGET_CWD` has uncommitted edits, instruct `share` workers to apply `git -C <TARGET_CWD> diff HEAD | git apply` (plus any untracked target files) inside their disposable worktrees. External diffs, branches, or patch sets produced in `/boost` or `/teamwork` (including `~/teamwork_projects/*` exports) can likewise be checked out or applied inside disposable `share` worktrees against `TARGET_CWD` before landing.

## Phase 2. Fan Out Orthogonal Fault Surfaces

Split workers across orthogonal failure surfaces:

1. **Adversarial exploit writers (`adv-logic`, `adv-boundary`, optional `adv-race` in `workspace: "share"`):**
   - **`adv-logic`:** State invariants, off-by-one bounds, partial-failure rollback, idempotency, and ordering races (pass `<plugin-dir>/skills/statechart/SKILL.md` when protocol interleavings warrant a TLA+ statechart).
   - **`adv-boundary`:** Untrusted inputs, auth/permission gates, resource leaks, timeouts, and live UI/CLI journeys in isolated per-run dirs and ephemeral ports.
   - Every `adv-*` executes real failing tests, fuzz probes, or CLI reproductions in its `share` worktree; style opinions and unexecuted prose critiques are banned.
2. **Transitive blast-radius mapper (`blast` in `workspace: "inherit"`):**
   - Walk 2–3 hops upstream/downstream across callers and pinned dependencies in `TARGET_CWD`.
   - Check cancellation, shutdown order, wire/RPC/DB schemas, feature-flag combinations, and **mixed-version rollout skew** (`old reader + new writer`, `new reader + old writer`), pushing the primary safety hypothesis up the 5-rung proof ladder: `(1) claim -> (2) file:line -> (3) state walkthrough -> (4) executed read-only probe -> (5) live E2E repro`.

## Phase 3. `#seq` Deduplication & Peer Exploit Chaining

- Workers post unaddressed `[CLAIM] <file:line> <bug>` lines on discovery and check `read_board{since}` before starting a new target so peers deduplicate without extra wakeups.
- When `blast` spots a caller or schema hazard, it rings `@adv-boundary` or `@adv-logic` directly (citing `#seq`) to turn the trace into an executed failing test.

## Phase 4. `verifier` Survival Gate & Report

Keep `adv-*` in `waiting` while an independent `verifier` (`workspace: "inherit"`) reruns each `<adv_cwd>` reproduction and audits each `blast` trace:

1. **Survival rule:** Keep a finding **only** when (a) an executed command/test reproduces the failure against real code and violates intent, or (b) for multi-version skew / pre-code specs, exact `file:line` traces on both sides prove the break.
2. Merge duplicate root causes, drop unproved claims with per-worker counts, `kill` `adv-*`, `blast`, and `verifier` without merging exploit code into `TARGET_CWD`, and report: **Intent**, **Core Safety Fact** (proof rung 1–5), **Verified Findings** (severity-ordered with repro commands), **Cleared Blast-Radius Paths**, and **Dropped Claims**.
