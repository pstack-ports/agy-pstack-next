---
name: statechart
description: "Check a TLA+ model of a stateful flow, protocol, or service with TLC and render it as a Mermaid statechart in user terms. Marks every state that breaks an invariant and gives the shortest path to each bug. Pairs with /pstack, /crucible, /interrogate, and /verify-gen --formal."
---

# Statechart

A statechart shows how a system moves between states in the words of the person who owns the behavior. Because the chart comes straight from a checked TLA+ model, the diagram and the formal check cannot drift apart.

## Where It Fits in Pstack

- **`/pstack` (`diagnose` and `build`).** Model concurrency, retries, leases, or offline UI flows in a per-worker `/tmp` folder before writing or changing stateful code.
- **`/crucible`.** Have competing `cand-*` workers attach checked statecharts so `ro-judge` and the user compare exact state graphs and invariants across candidate designs.
- **`/interrogate`.** Let `adv-*` workers encode suspected ordering or race bugs in TLA+, extract the shortest `bugPath` counterexample, and replay each action against real code.
- **[`/verify-gen --formal`](../verify-gen/SKILL.md).** Project-local TLA+ verification skills invoke `/statechart` so future agents read invariant violations and state graphs in plain domain words.

## Run

Work in an isolated per-worker scratch folder outside the repository, such as `/tmp/statechart-${WORKER_NAME:-local}-${RUN_ID}`, so parallel swarm workers never overwrite each other's `.tla`, `.cfg`, or `--out` files. Write a TLA+ spec and config, then run the script below.

```sh
<skill dir>/scripts/statechart SPEC.tla [--config FILE] [--view FILE] [--out DIR]
```

`scripts/statechart.ts` is TypeScript, so run `scripts/statechart` with a runtime that executes TypeScript. The first run installs TLC and Java with `mise` and requires network access.

## Write the Spec

- Write each rule that the reader agrees to as an `INVARIANT`. A rule can describe a screen, a return value, a stored record, or an emitted message. Add a model variable whenever a rule needs state the model does not yet track. Never weaken an invariant to make it pass.
- Write `Next` as a top-level disjunction of named actions, such as `YouPressPlay \/ YouPressStop`. Otherwise TLC labels every transition `Next`.
- A terminal state with no outgoing step violates `NoDeadlock`, even when stopping there is intended. When an `INVARIANT` or `PROPERTY` already uses the name `NoDeadlock`, TLC uses `CHECK_DEADLOCK` instead. Add an explicit stuttering action for valid terminal states, such as `Done == phase \in {"paid", "failed"} /\ UNCHANGED vars`, and label it in `step()`.

## Pick the Chart View

You supply the judgment in a JavaScript view module passed via `--view` (state labels, arrow labels, phase groups, colors, and chart title).

Export `state(vars)` to map raw TLA+ variables into reader-facing state names. Its return shape selects the chart structure.

- Return a `string` for a flat chart, such as `export const state = (v) => (v.paid ? "Paid" : "Paying");`.
- Return an `Array<string>` for nested parent states, such as `export const state = (v) => v.main.split(".");`.
- Return a plain `object` for parallel regions, one key per region, such as `export const state = (v) => ({ Playback: v.playback, Volume: v.volume });`.

Label each state with what a user or operator observes or cares about, such as `"Paying"` or `"Lease held, write pending"`. Keep raw variable identifiers out of labels. In `vars`, a TLA+ sequence is an object indexed from `1` (`v.pc[1]` corresponds to `pc[1]`), and a TLA+ set is an array.

Optionally export `step(action, from, to)` to name transitions. It receives the TLC action name plus the `vars` snapshot before and after the step, and returns the arrow label in user words, such as `"you press play"` or `"the connect fails"`. Do not expose internal function or TLA+ action identifiers. Give equivalent transitions the same label so they merge onto one arrow.

When a transition fires only under a guard, end its label with the condition in brackets in the reader's words, such as `you press play [while the file loads]`. In a parallel regions chart, the tool automatically appends cross-region conditions in region-label words, such as `[when Offline]`. Manual brackets override that automatic condition and can make distinct arrows look identical, so omit brackets for conditions owned by sibling regions. When hidden state determines the target state, name the outcome in the arrow label, such as `"the roster read fails"`.

Optional view exports refine presentation.

- `group(vars)` returns a phase name used to color each chart state. When model states merged into one chart state belong to different groups, that chart state receives no group color.
- `colors` maps each group name to a color class (`blue`, `orange`, `purple`, `yellow`, `teal`, `tan`, or `pink`).
- `title` sets the heading rendered at the top of the chart.

The runner calls `state()` and `group()` at most once per distinct model state and `step()` at most once per transition, feeding both the Mermaid chart and the plain-text report. Keep all view functions pure functions of their arguments.

Self-transitions within a single state label are omitted from the chart. Split the label when the reader needs to see that transition.

Aim for roughly 20 arrows or fewer so the diagram stays legible. Coarsen `state()` first by merging states that behave identically and dropping transient in-flight details whose completion changes no visible outcome. Never merge away states on a bug path or convert a definite `breaks` mark into an ambiguous `mayBreak` mark. Never merge two states that violate different invariants. If the chart remains too dense, return `null` from `step()` for noisy transitions while obeying four invariants.

- Keep every chart state reachable by visible arrows from an initial state.
- Keep at least one visible outgoing arrow from every chart state that has an outgoing model transition.
- Hide either all underlying steps of an arrow or none of them, so its guard condition stays accurate.
- Disclose every hidden step category in the handoff.

## Read the Report

- States that violate an invariant in every underlying model state carry class `breaks`. States where only some underlying model states fail carry class `mayBreak`. The legend lists violated rules per mark. When multiple rules fail on one mark, state in your handoff which state breaks which rule. In a regions chart, a region state is marked when every reachable combination containing it can fail, or all participating region states are marked when no single component owns the failure alone.
- TLC continues exploring past invariant violations, so the chart shows downstream states reachable after a bug. Bound constants tightly or add a `CONSTRAINT` so buggy models terminate quickly.
- With `VIEW` or `SYMMETRY`, TLC collapses symmetric states into one representative state and notes redirected transitions in the report.
- TLC evaluates invariants on states just past a `CONSTRAINT` or `ACTION_CONSTRAINT` (and draws shortest bug paths ending there) without exploring further or checking deadlock past the bound.
- After the initial TLC pass on the config as written, whenever a rule breaks, the runner removes that broken rule and reruns TLC up to a `100,000` distinct-state safety cap to uncover additional broken rules. Any rule left unverified after hitting that cap or an error appears under `Rules not checked` and remains unmarked on the chart. Remove broken rules or shrink bounds to check remaining rules.
- `tlc.out` holds raw output from the initial run, and `tlc-RULE.out` holds output from follow-up runs when needed.

## Show and Render the Chart

Present `chart.mmd` in a `mermaid` fenced code block. Full graphs render up to a budget of `500` distinct TLC states. Above `500` states, `chart.mmd` draws only shortest bug paths (and omits `chart.mmd` when zero rules break, while still writing state counts and results in the report). Shrink model constants when the reader needs the full state graph.

When the user asks for a rendered SVG image or the Mermaid block is too large to scan as text, render with Pele following [`references/render.md`](references/render.md). Do not substitute another renderer unless requested.

## Hand Off and Replay Against Code

Give the decision-maker each rendered chart, its Mermaid source, one plain-English line per broken rule with its numbered shortest path, explicit model scope exclusions, and the exact command to regenerate into a fresh `--out` folder.

Whenever the spec models real repository code, replay every counterexample path step by step against the real implementation via a test or live harness before reporting a bug. Treat any un-reproducible path as a modeling error until proven otherwise.
