---
name: statechart
description: >-
  Check a TLA+ model of a stateful flow, protocol, or concurrency boundary with
  TLC and render a plain-language Mermaid statechart with shortest counterexample
  paths. Use for /agy-pstack-next:statechart, /statechart, or reading TLA+
  results in /pstack, /crucible, /interrogate, and /verify-gen --formal.
---

# Statechart

Check a stateful flow or protocol formally with TLA+ (TLC) and render the verified state transitions and shortest bug paths as a Mermaid `stateDiagram-v2` in user-facing domain words.

## 1. Model & Run TLC in an Isolated Scratch Directory

Work inside `/tmp/statechart-${WORKER_NAME:-local}-$$` so parallel swarm workers never collide:

1. **Write `Spec.tla` and `Spec.cfg`.**
   - Express each user-visible promise as an `INVARIANT` (never weaken an invariant to force a pass).
   - Write `Next` as a disjunction of named actions (`PressPlay \/ PressStop \/ LoseNetwork`) so traces name exact transitions rather than generic `Next`.
   - Add an explicit stuttering step for valid terminal states (`Done == phase \in {"complete", "canceled"} /\ UNCHANGED vars`) so intended termination does not trip `DEADLOCK`.
2. **Execute TLC.** Use `tlc` on `PATH` or a cached `tla2tools.jar` (`java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -workers auto -dump dot states.dot Spec.tla > tlc.out 2>&1`). Bound `CONSTANTS` tightly (aiming under `500` distinct states when rendering full state graphs).

## 2. Render in Plain Domain Language (`stateDiagram-v2`)

Translate raw TLA+ variable tuples and action identifiers into words an operator or product owner recognizes immediately:

- **States:** Name what the user or caller observes (`"Lease held, write pending"`, `"Offline, retry queued"`), coarsening transient internal counters that do not change observable behavior—while **never** merging a valid state with an invariant-breaking state or hiding states along a counterexample trace.
- **Arrows:** Label transitions with the trigger and any guard in brackets (`user clicks pay [card valid]`, `worker crashes [before ack]`).
- **Broken states & shortest bug paths:** Highlight invariant-violating states clearly in the `mermaid` `stateDiagram-v2` block (`classDef breaks fill:#fcebec,stroke:#8f2328,color:#8f2328`) and list one numbered, plain-English shortest path from the initial state to each broken invariant.

## 3. Replay Counterexamples Against Real Code

> **Migration note:** This plugin ships `0` scripts. If an older v2 `.agents/skills/verify-*-formal/` skill calls a removed `scripts/statechart` binary (or `control-ui`/`control-cli` plugin paths), run the direct `tlc` command from step 2 above instead, or refresh the skill with `/verify-gen --maintain`.

Whenever a spec models repository code (including `.agents/skills/verify-*-formal/` suites), replay every step of a failing TLC trace against the real production implementation via a test or harness before reporting a product bug. An un-reproducible step indicates `verification drift` in the model; a reproducible trace proves a real defect.
