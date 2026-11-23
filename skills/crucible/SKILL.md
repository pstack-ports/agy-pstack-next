---
name: crucible
description: >-
  Explore competing designs (sketch) or working prototypes (full) across
  orthogonal structural axes in isolated share worktrees, grade blind against
  design red flags, and synthesize via warm fork and cherry-pick. Use for
  /agy-pstack-next:crucible, /crucible, "design this", "architect this", or
  comparing structural options before committing to one shape.
---

# Crucible

Follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md) to explore structurally distinct designs in parallel, grade them blind against [`../../rules/AGENTS.md`](../../rules/AGENTS.md), and synthesize the strongest boundary.

## Phase 1. Ground Constraints & Pick Fidelity

1. **Ground boundaries.** Skip only for greenfield modules with zero callers; otherwise run [`/understand`](../understand/SKILL.md) (or one `inherit` scout on `TARGET_CWD`) to map callers, invariants, and constraints.
2. **Pick fidelity:**
   - **`sketch` (default for boundaries & APIs):** 2–3 realistic caller snippets first, concrete domain types (`not implemented` bodies allowed), state transition table, failure matrix (retry, mid-flight crash, concurrency, bad input), and touched-file diff sketch.
   - **`full` (default for algorithms, UI feel, refactors & perf):** Working prototype in each `share` worktree with executed behavioral tests or benchmarks committed cleanly.
3. **Lock a falsifiable rubric.** Define 3–6 concrete criteria before fan-out (interface depth, single-owner state, boundary parsing, failure recovery, caller ergonomics, measured latency/coverage).

## Phase 2. Fan Out Orthogonal Design Axes

1. Because the swarm board is public, enforce genuine structural divergence by assigning **explicit orthogonal axes** to `design-a`, `design-b`, and `design-c` (`workspace: "share"`):
   - **`design-a`:** Pure immutable data-transform pipeline with stateless callers.
   - **`design-b`:** Deep stateful module hiding lifecycle, caching, and idempotent transitions behind one narrow handle.
   - **`design-c`:** Subtractive extension of an existing module with zero new public surface.
2. Require each brief to write caller usage before types, prefer deep modules, encode invariants in types (passing `<plugin-dir>/skills/typescript-best-practices/SKILL.md` for `.ts`/`.tsx` or `<plugin-dir>/skills/statechart/SKILL.md` when stateful flows warrant a TLA+ statechart), commit locally, and post `[done] <sha> <cwd>` plus key tradeoffs.

## Phase 3. Peer Critique & Blind `judge`

Keep `design-a..c` in `waiting` so their `share` worktrees remain available for inspection and `cherry-pick`.

1. **Optional `#seq` critique.** When tradeoffs are subtle, wake `@design-a @design-b @design-c` once to cite peers' `#seq` posts and name the sharpest failure mode or caller leak in each rival axis.
2. **Blind `judge` (`workspace: "inherit"`).** Pass anonymized labels (`option-oak`, `option-pine`, `option-cedar`) mapped only to `<cwd>` and `<sha>` without worker names or axis prompts. Instruct `judge` not to call `read_board{since: 0}` so authorship stays hidden; inspect each git diff directly, screen against all 8 Structural Design Red Flags (`<plugin-dir>/rules/AGENTS.md`), score the rubric, and post the winning base option plus specific donor tests/helpers worth porting.

## Phase 4. Synthesize via Warm `fork`, Verify & Land

1. Review the winning diff and `judge` citations; pause here only if the user asked to approve before synthesis.
2. Spawn `synth` (`workspace: "share"`, `fork: "<winning-design>"`) to check out `<winner_cwd> <winner_sha>` detached, fetch targeted donor commits, and rewrite grafted pieces into **one** unified mental model (re-sketching if filling `sketch` bodies leaks internals across boundaries).
3. Gate `synth` with an independent `verifier` (running `.agents/skills/verify-*` when present), then audit, land into `TARGET_CWD`, and retire task workers per [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md).
