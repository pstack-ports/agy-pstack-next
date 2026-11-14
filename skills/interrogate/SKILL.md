---
name: interrogate
description: >-
  Unifies adversarial bug hunting and transitive blast-radius proof. Spawns
  isolated adv-* exploit authors (workspace: "share") alongside read-only
  ro-blast caller, schema, and rollout mappers (workspace: "inherit"), uses live
  #seq board deduplication and cross-boundary exploit chaining, and gates every
  surviving finding through ro-verify. Use for /interrogate, "adversarial
  review", "break this", "stress test this diff", "blast radius", or "what could
  this break".
---

# Interrogate

Break a change or design with executable reproductions and prove what happens across transitive callers, wire schemas, migrations, and mixed-version rollouts. Report verified defects and blast-radius evidence without modifying the coordinator's working tree.

## Phase 1. Frame scope, intent, and the core safety fact

1. **Lock the scope.** Use the files, commits, PR, or design artifact named by the user. When none is named, inspect the branch diff from merge-base through uncommitted working-tree changes (`git merge-base HEAD main` and `git status --short`).
2. **Restate the behavioral intent.** Summarize in plain words what the change must accomplish and what existing invariants must hold, reading commit messages, PR descriptions, and linked tickets first. Ask the user only when intent itself is ambiguous.
3. **Name the primary safety hypothesis.** Most risky changes look safe because of one load-bearing assumption (for example, "this eviction path only drops entries with refcount zero" or "old readers ignore unknown JSON fields"). Write that assumption down explicitly so the swarm tests it rather than reciting it.

---

## Phase 2. Fan out `adv-*` adversaries and `ro-blast`

### 1. Adversarial exploit hunters (`adv-*`, `workspace: "share"`)

Apply the `adv-*` model setting from `~/.gemini/config/rules/pstack-models.md` already loaded in `<user_rules>` via `always_on` without calling `read_file` on disk (read the file from disk only when absent from `<user_rules>`, defaulting to two distinct model families when available or `inherit`). Spawn parallel `adv-*` workers (`adv-logic`, `adv-boundary`, and optionally `adv-concurrency`) in `workspace: "share"`:

- `hooks/guard.mjs` confines `adv-*` file writes strictly inside each worker's isolated `share` worktree and temp roots and blocks `git push` unconditionally. When global `~/.gemini/config/hooks.json` is not active, pass `<plugin-root>/roles/poteto-agent.md` in every `adv-*` brief and `<plugin-root>/roles/research.md` in `ro-blast` and `ro-verify` briefs.
- Because workers do not mount installed plugin skills in `<skills>`, pass explicit resolved `SKILL.md` paths (such as `<plugin-root>/skills/control-ui/SKILL.md`, `<plugin-root>/skills/control-cli/SKILL.md`, and `<plugin-root>/skills/statechart/SKILL.md`) in worker briefs for `read_file` rather than telling workers to invoke plugin skills by name.
- When the target includes uncommitted edits in the coordinator workspace, pass a patch path or `git diff` fetch instruction so each `adv-*` reproduces against the exact working state.
- Assign distinct attack angles so workers do not crowd the same obvious branch:
  - **`adv-logic`** attacks state invariants, off-by-one bounds, error recovery, partial-failure rollback, and idempotency (reading `<plugin-root>/skills/statechart/SKILL.md` when modeling ordering or protocol races).
  - **`adv-boundary`** attacks untrusted inputs, auth and permission checks, resource leaks, timeouts, and UI or CLI flows (reading the passed `<plugin-root>/skills/control-ui/SKILL.md` or `<plugin-root>/skills/control-cli/SKILL.md` path on worker-isolated ports when needed).
- Every `adv-*` worker writes and executes real failing tests, fuzz scripts, or CLI probes inside its own `share` worktree. Style opinions, naming critiques, and hypothetical future-code risks are banned.

### 2. Transitive blast-radius mapper (`ro-blast`, `workspace: "inherit"`)

Spawn `ro-blast` (`workspace: "inherit"`, read-only via `hooks/guard.mjs`) alongside `adv-*` to trace everything symbol `grep` misses:

- **Transitive callers and pinned dependencies.** Walk 2 to 3 hops upstream and downstream, including pinned third-party library source and local patches.
- **Lifecycle and async ordering.** Check microtask queues, cancellation, unmount or shutdown order, retry loops, and shared caches.
- **Wire formats, storage schemas, and flags.** Trace JSON API payloads, protobuf or RPC contracts, database columns and migrations, analytics events, feature-flag combinations, and other languages reading the same bytes.
- **Mixed-version rollout skew.** Trace what happens during deploy when an old reader consumes a new writer's output and when a new reader consumes an old writer's state.
- **Five-rung proof ladder for the core safety fact.** Push the primary safety hypothesis as far up this ladder as possible and record the exact rung reached:
  1. Unverified assertion (worthless alone).
  2. Exact `file:line` citation in repository or library source.
  3. Step-by-step state walkthrough proving the bad path is unreachable.
  4. Executed read-only probe or existing test proving the invariant against real code.
  5. Verified end-to-end in the running application (handed to an `adv-*` worktree when a throwaway harness script is required).

---

## Phase 3. Live `#seq` deduplication and exploit chaining

Require `adv-*` and `ro-blast` to coordinate live on the swarm board rather than working in silence until the end:

1. **Immediate `#seq` bug claims.** As soon as a worker spots a concrete bug or broken downstream contract, it posts a short claim (`[CLAIM] src/sync/queue.ts:142 duplicate ack under retry`) before polishing its test.
2. **Board deduplication.** Before building a repro, each `adv-*` calls `read_board{since}` and skips defects already claimed in an earlier `#seq` post unless proving a wider impact.
3. **Cross-boundary exploit chaining.** Whenever `ro-blast` posts a suspicious caller assumption, schema mismatch, or rollout skew (`#seq`), it tags `@adv-boundary` or `@adv-logic`. That `adv-*` worker chains the `ro-blast` trace into an executable test in its `share` worktree (`Chaining #9 into failing wire-compat test in test/rollout.repro.ts`) so prose blast-radius theories turn into hard reproductions.

---

## Phase 4. Gate through `ro-verify` and tear down cleanly

Keep `adv-*` workers parked in `waiting` (zero token cost, `share` worktrees still on disk) while `ro-verify` audits their claims.

1. Spawn `ro-verify` (`workspace: "inherit"`, read-only) once `adv-*` and `ro-blast` post final summaries.
2. `ro-verify` inspects each `adv-*` worktree repro script, reruns the exact reproduction command (or checks the recorded execution output and test code), and audits every `ro-blast` trace.
3. **Strict survival gate.** A finding survives **only** when:
   - An executed test, script, or command reproduces the failure against real code and violates the stated intent, **or**
   - For multi-version rollout skew, external migration order, or pure pre-code design specs where single-tree execution cannot run two deploys at once, an exact `file:line` state trace on both sides of the boundary proves the break.
4. `ro-verify` merges duplicate root causes, drops unverified speculation, and records per-worker dropped counts with explicit reasons.
5. After `ro-verify` posts its `#seq` audit (and only if no immediate `impl-fix` needs to cherry-pick a repro test from an `adv-*` worktree), call `swarm{action: "kill"}` on every `adv-*` worker, `ro-blast`, and `ro-verify` while leaving built-in `monitor` and `narrator` alive unless the user asks. Never merge throwaway `adv-*` exploit hacks into the coordinator branch.

---

## Output contract

Deliver one concise report with five sections:

- **Intent.** Plain restatement of what the change does and must preserve.
- **Core safety fact.** The load-bearing safety invariant, the proof rung reached (1 to 5), and the command output or `file:line` trace proving it (or `unproven` if refuted or unverified).
- **Verified findings.** Each surviving defect or rollout break ordered by severity, naming `file:line`, the exact repro command and actual vs required output (or two-sided boundary trace), downstream blast radius, and `#seq` worker attribution. Write `No verified findings` when zero survive.
- **Cleared blast-radius paths.** Callers, wire contracts, migrations, and rollout edges checked by `ro-blast` and confirmed safe.
- **Dropped claims.** Count and reason per worker for claims rejected by `ro-verify`.
