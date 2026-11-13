---
name: crucible
description: >-
  Explore competing architectures or working implementations across orthogonal
  design axes in isolated share worktrees, evaluate via peer #seq critique and a
  cross-family ro-judge against design red flags, and synthesize via warm fork
  and donor cherry-pick. Supports sketch and full fidelity modes. Use for
  /crucible, "design this", "architect this", "race prototypes", or comparing
  structural options before locking in a shape.
---

# Crucible

Explore structurally distinct designs or working prototypes across parallel `cand-*` workers, stress-test them against [`references/design-red-flags.md`](references/design-red-flags.md), and graft the strongest elements into one coherent winner.

## Phase 1. Ground constraints and pick fidelity

### 1. Ground existing boundaries first

Skip grounding only for greenfield code with zero surrounding callers. Otherwise run [`/understand`](../understand/SKILL.md) (or dispatch a fast `ro-code` scout) to map current module boundaries, callers, domain invariants, and historical constraints before framing candidates.

### 2. Choose `sketch` or `full` fidelity

Pick the fidelity mode from the user's request or task risk:

- **`sketch` mode (fast design exploration).** Default when settling module boundaries, public APIs, or data models before writing full bodies. Each `cand-*` worker (`workspace: "share"`) produces caller usage snippets first, concrete domain types and signatures (`not implemented` bodies allowed), a state transition table, a failure matrix (retry, crash halfway, concurrent actor, invalid input), a diff sketch showing touched files, and a draft rationale per [`references/rationale-template.md`](references/rationale-template.md).
- **`full` mode (executable prototypes).** Default when comparing algorithms, UI ergonomics, refactoring strategies, or performance levers where paper sketches hide real friction. Each `cand-*` worker (`workspace: "share"`) builds a working implementation in its isolated worktree, runs real behavioral tests (plus benchmarks or [`/control-ui`](../control-ui/SKILL.md) / [`/control-cli`](../control-cli/SKILL.md) captures when relevant), commits cleanly on its local branch, and posts its commit SHA, worktree `pwd`, measured output, and rationale.

### 3. Define a concrete grading rubric

Write 3 to 6 task-specific, falsifiable rubric criteria before spawning candidates (interface depth, single-owner state, boundary validation, failure recovery, caller ergonomics, measured latency or test coverage).

---

## Phase 2. Fan out orthogonal `cand-*` axes on the board

Because every swarm brief on the board is public to all members, never attempt fake blind-brief workarounds. Use board visibility deliberately by assigning **explicit orthogonal design axes** to `cand-a`, `cand-b`, and `cand-c` (minimum two candidates, typically three):

- **`cand-a`** explores Axis A (for example, a pure data-transform pipeline with immutable value types and stateless callers).
- **`cand-b`** explores Axis B (for example, a deep stateful module owning lifecycle, caching, and idempotent transitions behind one narrow handle).
- **`cand-c`** explores Axis C (for example, a subtractive extension of an existing boundary with zero new public modules).

Spawn all `cand-*` workers with `workspace: "share"`. Assign models from the `cand-*` line in `~/.gemini/config/rules/pstack-models.md` (defaulting to multi-family diversity when available, or `inherit`).

### Candidate design discipline

Include these rules in every `cand-*` brief:

1. **Caller usage first.** Write 2 or 3 realistic caller snippets before writing types, and reconcile signatures to the caller experience.
2. **Data structures before control flow.** Trace dominant read and write paths through the core types without bolting on secondary caches later.
3. **Deep modules over shallow wrappers.** Hide substantial policy and complexity behind a small public interface. Never re-export wire, storage, or framework types across the boundary.
4. **Separate state before serializing.** Prefer per-actor state merged at read boundaries over shared mutable state guarded by locks.
5. **Encode invariants in types.** Prefer unrepresentable invalid states over runtime checks, and runtime checks at boundaries over prose comments.
6. **Commit cleanly in your `share` worktree.** Post your `#seq` submission with `pwd`, branch HEAD SHA, test or sketch evidence, and key tradeoffs, then wait (`swarm_wait`).

---

## Phase 3. Peer `#seq` critique, `ro-judge`, and optional `ro-steward`

Keep `cand-a`, `cand-b`, and `cand-c` parked in `waiting` after they post. Waiting workers consume zero tokens while keeping their `share` worktrees intact on disk for inspection and cherry-picking.

### 1. Peer `#seq` critique round

Wake `@cand-a @cand-b @cand-c` for one bounded critique turn when trade-offs are subtle. Each candidate cites its peers' `#seq` submissions and names the sharpest concrete failure mode, caller leak, or invariant gap in each rival axis. Ban generic praise.

### 2. Cross-family `ro-judge` evaluation

Spawn `ro-judge` (`workspace: "inherit"`, read-only) on a model from `ro-judge pool` in `~/.gemini/config/rules/pstack-models.md` whose model family differs from both the coordinator and winning contenders (`inherit` never judges).

`ro-judge` inspects every candidate's worktree files and git diff directly, screens each candidate against every item in [`references/design-red-flags.md`](references/design-red-flags.md), grades the rubric criterion by criterion, and posts a `#seq` verdict naming:

- Recommended base candidate (`cand-winner`) and why its core boundary ages best.
- Specific donor artifacts (edge-case tests, benchmarks, type refinements, helper functions) worth porting from losing `cand-*` branches.
- Red flags detected in each candidate.

### 3. Optional `ro-steward` boundary audit

When the task modifies public package exports, wire protocols, database schemas, or cross-service contracts, also spawn `ro-steward` (`workspace: "inherit"`). `ro-steward` audits caller migration cost, backward compatibility, and importable-internals leakage across the repository.

---

## Phase 4. Synthesize via warm `fork` and donor `cherry-pick`

Read the candidate diffs and `#seq` verdicts from `ro-judge` (and `ro-steward`) yourself before deciding. Agreement confirms the base. Disagreement means checking the exact lines each cited. When two shapes tie on capability, pick the deeper interface with fewer public concepts.

### Optional human checkpoint

Check `crucible checkpoint` in `~/.gemini/config/rules/pstack-models.md` and whether the user asked for a checkpoint (`with checkpoint` or `stop before implementing`). When active, present the chosen base, planned donor grafts, and [`references/rationale-template.md`](references/rationale-template.md) summary, and pause for sign-off before running `impl-synth` or filling in `sketch` bodies.

### Graft and verify in `impl-synth`

**Critical worktree rule.** Keep all `cand-*` workers alive in `waiting` throughout synthesis. Calling `swarm{action: "kill"}` deletes a worker's `share` worktree immediately, which destroys donor commits before `impl-synth` can fetch them.

1. Spawn `impl-synth` branched warmly from the winning candidate:
   ```json
   {"action": "add", "name": "impl-synth", "workspace": "share", "fork": "cand-a", "brief": "Fetch cand-a HEAD, cherry-pick specified donor tests/helpers from cand-b and cand-c worktrees, unify under cand-a's mental model, write rationale per references/rationale-template.md, run full verification, commit, and report SHA and pwd."}
   ```
2. Inside `impl-synth`, fetch the winning branch (`git fetch <winner_cwd> <winner_sha> && git checkout -B crucible-synth FETCH_HEAD`) and pull targeted tests or helpers from donor worktrees (`git fetch <donor_cwd> <donor_sha>` with `git cherry-pick --no-commit` or path checkout). Rewrite grafted pieces so names, types, and invariants fit one unified mental model rather than mechanical Franken-code.
3. If Phase 2 ran in `sketch` mode and no checkpoint paused execution, `impl-synth` (or downstream `impl-*` slices under [`/pstack`](../pstack/SKILL.md) `build`) replaces `not implemented` bodies with production code and behavioral tests.
4. **Scrap rule when implementation fights the sketch.** If filling in a `sketch` triggers repeated structural workarounds across unrelated callers, type casts (`any`), or surprise locks on supposedly isolated state, stop bolting on patches. Scrap the sketch, fold the newly discovered constraint into Phase 1, and re-run Phase 2 smaller and cleaner.

---

## Phase 5. Merge locally and retire the swarm

1. Verify `impl-synth`'s tests, types, benchmarks, and [`references/rationale-template.md`](references/rationale-template.md) decision record.
2. Fetch and merge `impl-synth` into the coordinator workspace first:
   ```bash
   git fetch <impl_synth_cwd> <impl_synth_sha> && git merge --no-edit FETCH_HEAD
   ```
3. Only after `git status` and `git log -1` confirm the synthesized commit landed in the coordinator workspace, call `swarm{action: "kill"}` on `cand-a`, `cand-b`, `cand-c`, `ro-judge`, `ro-steward`, and `impl-synth`. Do not `git push` unless the user explicitly requested it.
