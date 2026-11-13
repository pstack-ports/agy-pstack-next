# Prompts worth copying

Swap in your real paths, targets, and pass/fail checks. Plain informal wording works best.

## Understand and recall

- `/understand how <subsystem> routes requests and where <new behavior> belongs.`
- `/understand why <file or threshold> is shaped this way. check git, PRs, tickets, and docs.`
- `/understand teach me how <module> works and convince me this change fixes the root cause.`
- `/ketchup --recall <topic> across the last week, including open PRs and recurring errors.`

## Build, diagnose, and optimize

- **Bug fix.** `/pstack <symptom> when <input>. reproduce with a failing test first, warm-fork the fix, and prove it passes.`
- **UI bug or parity.** `/pstack reproduce <ui bug> with /control-ui, fix it, and show before-and-after screenshots.`
- **Feature.** `/pstack add <behavior>. existing <command> output must stay byte-identical. verify both.`
- **Refactor.** `/pstack consolidate <modules> behind one interface with zero behavior change. migrate all callers and delete the old exports.`
- **Performance hillclimb.** `/pstack <operation> takes <ms> on <fixture>. lock noise floor first, explain the math, race parallel levers, and report measured wins.`

## Design and architecture

- `/crucible sketch <feature> across 3 orthogonal designs. screen for shallow modules and pause with checkpoint before implementing.`
- `/crucible full <subsystem rewrite>. build working prototypes with benchmarks in separate worktrees, cross-judge, and cherry-pick the best tests into the winner.`
- `/statechart model <workflow or protocol>, check invariants in TLA+, and show the shortest path to any broken state.`

## Break, verify, and ship

- `/interrogate this branch. hunt reproducible exploits with adv-* and prove transitive caller and rollout safety with ro-blast.`
- `/verify-gen build a behavioral verification skill for <app> so workers can prove user flows end to end.`
- `/verify-gen --formal prove <invariant> holds across retries and concurrent writes in <module>.`
- `/verify-gen --maintain sync our verification skill with recent changes on main.`
- `/pstack babysit PR <number> until CI and review threads are clean. do not merge.`

## Away, catch up, and improve

- `/pstack I am stepping away. finish <goal> across stacked branches. done means <checks>. commit locally and do not push. /goal until checks pass.`
- `/ketchup` (or `/ketchup --video` for a short subtitled slide walkthrough, or `/ketchup --plain` to restate the last technical message in plain words).
- `/reflect mine this session's transcript and swarm board, then encode the top lessons into hooks, tests, or skills.`
- `/reflect --correct find the mistakes agents keep repeating in this repo and block them with types, lints, or hooks.`
- `/reflect --sharpen <draft prompt>`
- `/setup-pstack configure models and quota fallbacks` (or `/setup-pstack schedule a daily verification drift check`).
