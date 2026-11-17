---
name: crucible
description: >-
  Explore competing designs (sketch) or working prototypes (full) across
  orthogonal axes and distinct model families in isolated share worktrees, grade
  blind against design red flags, and synthesize via warm fork and cherry-pick.
  Use for /agy-pstack-next:crucible, /crucible, "design this", "architect this",
  or comparing structural options before committing to one shape.
---

# Crucible

Explore structurally distinct designs or executable prototypes in parallel, stress-test them blind against the Structural Design Red Flags in [`../pstack/references/principles.md`](../pstack/references/principles.md), and graft the strongest parts into one coherent implementation.

Load built-in `swarm` (and `swarm_pane` when present) before spawning workers.

## Phase 1. Ground Constraints & Pick Fidelity

1. **Ground existing boundaries.** Skip only for greenfield modules with zero callers. Otherwise run [`/understand`](../understand/SKILL.md) (or one fast `inherit` scout) to map current callers, domain invariants, and constraints.
2. **Choose `sketch` or `full` fidelity.**
   - **`sketch` (fast boundary & API design):** Default when settling module boundaries, data shapes, or public signatures. Each candidate writes 2 to 3 realistic caller snippets first, concrete domain types (`not implemented` bodies allowed), a state transition table, a failure matrix (retry, crash mid-flight, concurrent actor, bad input), and a touched-file diff sketch.
   - **`full` (executable prototypes):** Default when comparing algorithms, UI feel, refactor strategies, or perf levers where paper sketches hide friction. Each candidate builds a working prototype in its `share` worktree, runs behavioral tests or benchmarks, and commits cleanly.
3. **Lock a falsifiable rubric.** Define 3 to 6 concrete criteria before fan-out (interface depth, single-owner state, boundary parsing, failure recovery, caller ergonomics, measured latency/coverage).

## Phase 2. Fan Out Orthogonal Axes Across Model Families

1. Call `swarm{action: "models"}` to inspect live models and remaining quota, and pick 2 to 3 `high`/`xhigh` models from **distinct provider families** when available (unless the user requested specific models).
2. Because the swarm board is public, assign **explicit orthogonal design axes** to `design-a`, `design-b`, and `design-c` (`workspace: "share"`):
   - **`design-a`:** e.g. pure immutable data-transform pipeline with stateless callers.
   - **`design-b`:** e.g. deep stateful module hiding lifecycle, caching, and idempotent transitions behind one narrow handle.
   - **`design-c`:** e.g. subtractive extension of an existing module with zero new public surface.
3. Require each brief to: write caller usage before types, prefer deep modules over shallow wrappers, encode invariants in types, commit locally (never push), and post `[done] <sha> <cwd>` plus key tradeoffs.

## Phase 3. Peer Critique & Blind Cross-Family `judge`

Keep `design-a..c` parked in `waiting` (zero cost while keeping their `share` worktrees on disk for inspection and `cherry-pick`).

1. **Optional `#seq` critique round.** When tradeoffs are subtle, wake `@design-a @design-b @design-c` once to cite peers' `#seq` posts and name the sharpest concrete failure mode or caller leak in each rival axis.
2. **Blind cross-family `judge`.** Spawn `judge` (`workspace: "inherit"`) on a `high` model from a family **different** from the leading contenders. Pass anonymized labels (`option-oak`, `option-pine`, `option-cedar`) without model IDs. `judge` inspects each worktree diff directly, screens against all 8 Structural Design Red Flags (pass the resolved absolute `<plugin-dir>/skills/pstack/references/principles.md` path in `judge`'s brief, never a relative `../` path or slash name, since swarm workers do not mount plugin skills), scores the rubric, and posts:
   - Recommended base option and why its boundary ages best.
   - Specific donor artifacts (edge-case tests, helpers, benchmarks) worth porting from rival worktrees.

## Phase 4. Synthesize via Warm `fork`, Verify & Retire

1. Inspect the winning diff and `judge` citations yourself. Pause for user sign-off here only if the user asked to review before implementation.
2. Spawn `synth` (`workspace: "share"`, `fork: "<winning-design>"`):
   - `git fetch <winner_cwd> <winner_sha> && git checkout -B crucible-synth FETCH_HEAD`
   - Pull targeted donor tests/helpers via `git fetch <donor_cwd> <donor_sha>` and rewrite grafted pieces so names, types, and invariants fit **one** unified mental model (scrap and re-sketch if filling in `sketch` bodies causes caller leaks across boundaries).
3. Gate `synth` with an independent `verifier` (running `.agents/skills/verify-*` when present), `git fetch` and `merge` `synth` into your checkout, and only **after** `git log -1` confirms landing, call `swarm{action: "kill"}` on all task workers. Never `git push` unasked.
