# Recipes and pitfalls

Copy-ready prompts for everyday Swarm-Centric Pstack v2 tasks in the `agy` CLI (`1.5.8+`) and Antigravity 2.0, followed by the mistakes worth skipping once and for all. Swap in your own paths, fixtures, and finish predicates.

![An engineer tastes a finished dish while robots cook from a recipe box with workflow cards pinned above the counter.](./images/recipes.jpg)

## Understand a thorny subsystem and its history

```text
/agy-pstack-next:understand how does lease heartbeating work in worker-pool, and why did we switch away from advisory locks?
```

Parallel `ro-*` workers cross-check live code, `git blame`, PR discussions, and issue trackers simultaneously, separating cited evidence from inference.

## Restate a noisy bug thread before editing code

```text
/agy-pstack-next:pstack read this issue thread and restate the underlying failure in plain English. list what is proven vs assumed. do not change code yet.
```

Misreadings surface in one fast read-only turn instead of after three wrong patches.

## Reproduce, root-cause, and fix with proof (`diagnose`)

```text
/agy-pstack-next:pstack webhook retries write duplicate audit rows when Postgres restarts. reproduce first, fix the root cause in an isolated worktree, and prove zero duplicates across 50 injected restarts.
```

Parallel `ro-*` probes race competing hypotheses, `impl-fix` forks warm from the winner (`fork: "ro-winner"`), and `ro-verify` proves the fix live.

## Compare competing designs before locking an API (`crucible`)

```text
/agy-pstack-next:crucible sketch three orthogonal designs for the plugin event bus. write caller usage first and audit against design red flags.
```

Switch `sketch` to `full` whenever you want working prototypes benchmarked side by side in isolated `share` worktrees before `impl-synth` cherry-picks the best pieces.

## Model a race or protocol visually (`statechart`)

```text
/agy-pstack-next:statechart model our two-step checkout retry flow and prove a customer is never charged twice when the network drops mid-commit.
```

TLC checks every reachable interleaving and renders user-readable Mermaid or Pele SVG charts with shortest counterexample paths.

## Stress-test a branch and map blast radius (`interrogate`)

```text
/agy-pstack-next:interrogate adversarially test this branch and map downstream callers and schema migration risks. report only reproducible bugs.
```

`adv-*` workers write executable exploit repros in isolated worktrees while `ro-blast` traces transitive callers, gated by `ro-verify`.

## Hillclimb a slow path scientifically (`hillclimb`)

```text
/agy-pstack-next:pstack cold bundle analysis takes 4.2s on monorepo-fixture. lock a noise floor with ro-bench, test parallel levers across cand-* worktrees, and get median runtime under 1.2s.
```

Every claimed win must clear noise across alternating runs and explain its physical limiter.

## Generate and maintain repo verification skills (`verify-gen`)

```text
/agy-pstack-next:verify-gen
```

```text
/agy-pstack-next:verify-gen --formal prove the token bucket limiter never grants above burst capacity under concurrent callers
```

```text
/agy-pstack-next:verify-gen --maintain
```

Create behavioral E2E feature maps and formal invariant checks once, then run `--maintain` after refactors so drift never rots silently.

## Ship a PR and babysit CI (`ship`)

```text
/agy-pstack-next:pstack verify this branch, open a concise PR, and babysit CI and review threads until merge-ready. do not merge yet.
```

Author pushes use `PSTACK_ALLOW_PUSH=1` only because you asked to open and update the PR, while `watch-pr` and `bugbot-triage.md` separate real defects from noisy bot comments.

## Leave an autonomous program running overnight (`program`)

```text
/agy-pstack-next:pstack i am stepping away. convert every package under packages/* to strict boundary schemas. done means zero raw JSON.parse calls outside boundary modules and all package test suites green. commit locally per slice.
/goal keep going until done or genuinely blocked.
```

## Catch up in seconds (`ketchup`)

```text
/agy-pstack-next:ketchup
```

```text
/agy-pstack-next:ketchup --plain
```

```text
/agy-pstack-next:ketchup --video
```

Get a structured `#seq` delta briefing, a zero-jargon plain-language summary, or a subtitled slide walkthrough without interrupting running workers.

## Encode repeated corrections into structure (`reflect`)

```text
/agy-pstack-next:reflect mine this session and encode checks so workers never bind hardcoded port 3000 in UI probes again.
```

## Ask which workflow fits before starting (`setup-pstack`)

```text
/agy-pstack-next:setup-pstack what is the cleanest way to benchmark and migrate three competing serializer libraries?
```

## Common pitfalls

- **Scripting skill chains by hand.** Prompts like `"run /understand then /crucible then /interrogate"` fight `/pstack`'s built-in topology gates. State the goal, constraints, and finish predicate instead.
- **Vague finish conditions.** `"make it faster"` or `"work for three hours"` gives `ro-verify` and `/goal` nothing falsifiable to test. Name a command, metric, or observable state.
- **Killing a `share` worker before merging.** `swarm{action: "kill"}` deletes that worker's `share` worktree permanently. Always `git fetch <worker_cwd> <sha> && git merge` (or `cherry-pick`) before killing.
- **Sharing ports or browser profiles across parallel workers.** Concurrent UI and CLI runs collide on port `3000`, CDP sockets, and `tmux` panes unless isolated via [`/control-ui`](../../skills/control-ui/SKILL.md) and [`/control-cli`](../../skills/control-cli/SKILL.md).
- **Broadcast `@all` spam on the board.** Every `@mention` wakes an agent and spends tokens. Cite prior posts by `#seq` and tag only the specific peer who acts next.
- **Trusting unvetted speedups.** One warm-cache run is noise, not a speedup. Require alternating baseline/candidate medians and a named bottleneck limiter.
- **Repeating the same chat correction three times.** Chat reminders vanish in the next session. Run `/reflect` so `impl-sharpen` encodes the rule into types, lints, `hooks/guard.mjs`, or capsules.
- **Reporting done off a green build.** Compiling proves syntax, not behavior. Require `ro-verify` output from the real CLI, UI, database, or formal checker.

Ready to run your first swarm? Head back to [Set up pstack](./01-setup.md) or return to the [guide index](./README.md).
