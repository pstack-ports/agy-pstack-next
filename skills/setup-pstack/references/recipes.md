# Prompts worth copying

Swap in your real paths, targets, and pass/fail checks. Plain informal wording works best. In the `agy` CLI (`1.5.8+`), plugin slash commands use the `/agy-pstack-next:<skill>` namespace shown below (drop the `agy-pstack-next:` prefix only when a skill is installed standalone under `.agents/skills/` or `~/.gemini/config/skills/`). Built-in Antigravity commands such as `/goal` and `/schedule` stay unprefixed.

## Understand and recall

- `/agy-pstack-next:understand how <subsystem> routes requests and where <new behavior> belongs.`
- `/agy-pstack-next:understand why <file or threshold> is shaped this way. check git, PRs, tickets, and docs.`
- `/agy-pstack-next:understand teach me how <module> works and convince me this change fixes the root cause.`
- `/agy-pstack-next:ketchup --recall <topic> across the last week, including open PRs and recurring errors.`

## Build, diagnose, and optimize

- **Bug fix.** `/agy-pstack-next:pstack <symptom> when <input>. reproduce with a failing test first, warm-fork the fix, and prove it passes.`
- **UI bug or parity.** `/agy-pstack-next:pstack reproduce <ui bug> with /control-ui, fix it, and show before-and-after screenshots.`
- **Feature.** `/agy-pstack-next:pstack add <behavior>. existing <command> output must stay byte-identical. verify both.`
- **Refactor.** `/agy-pstack-next:pstack consolidate <modules> behind one interface with zero behavior change. migrate all callers and delete the old exports.`
- **Performance hillclimb.** `/agy-pstack-next:pstack <operation> takes <ms> on <fixture>. lock noise floor first, explain the math, race parallel levers, and report measured wins.`

## Design and architecture

- `/agy-pstack-next:crucible sketch <feature> across 3 orthogonal designs. screen for shallow modules and pause with checkpoint before implementing.`
- `/agy-pstack-next:crucible full <subsystem rewrite>. build working prototypes with benchmarks in separate worktrees, cross-judge, and cherry-pick the best tests into the winner.`
- `/agy-pstack-next:statechart model <workflow or protocol>, check invariants in TLA+, and show the shortest path to any broken state.`

## Break, verify, and ship

- `/agy-pstack-next:interrogate this branch. hunt reproducible exploits with adv-* and prove transitive caller and rollout safety with ro-blast.`
- `/agy-pstack-next:verify-gen build a behavioral verification skill for <app> so workers can prove user flows end to end.`
- `/agy-pstack-next:verify-gen --formal prove <invariant> holds across retries and concurrent writes in <module>.`
- `/agy-pstack-next:verify-gen --maintain sync our verification skill with recent changes on main.`
- `/agy-pstack-next:pstack babysit PR <number> until CI and review threads are clean. do not merge.`

## Away, catch up, and improve

- `/agy-pstack-next:pstack I am stepping away. finish <goal> across stacked branches. done means <checks>. commit locally and do not push. /goal until checks pass.`
- `/agy-pstack-next:ketchup` (or `/agy-pstack-next:ketchup --video` for a short subtitled slide walkthrough, or `/agy-pstack-next:ketchup --plain` to restate the last technical message in plain words).
- `/agy-pstack-next:reflect mine this session's transcript and swarm board, then encode the top lessons into hooks, tests, or skills.`
- `/agy-pstack-next:reflect --correct find the mistakes agents keep repeating in this repo and block them with types, lints, or hooks.`
- `/agy-pstack-next:reflect --sharpen <draft prompt>`
- `/agy-pstack-next:setup-pstack configure models and quota fallbacks` (or `/agy-pstack-next:setup-pstack schedule a daily verification drift check`).
