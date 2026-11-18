# pstack

Pstack-inspired workflows for Google Antigravity (`agy`), adapted from [pstack](https://github.com/cursor/plugins/tree/2f87c854fe/pstack) (`0.15.43`) by [Lauren Tan (poteto)](https://x.com/poteto).

If you want to go fast, go deep first. Throughput without verification only ships broken code faster. `pstack` pairs Antigravity's native `swarm` runtime and git worktree isolation with disciplined engineering principles, cross-family design bakeoffs, TLA+ statechart verification, adversarial exploit testing, and zero-slop code hygiene.

## Install

```bash
agy plugin install https://github.com/pstack-ports/agy-pstack-next
```

No setup command, hook registration, or model config file is required. Start immediately with `/agy-pstack-next:pstack` (or `/pstack` in the UI):

```text
/agy-pstack-next:pstack reproduce the idle scroll drift first, fix the root cause, and prove the fix in the browser.
```

## Architecture: Swarm-Centric, Multi-Worktree Safe, Zero Hooks

- **Native `swarm` orchestration with zero global hooks.** `swarm` (`workspace: "share"` git worktrees, `fork` warm handoffs, `#seq` board citations, and `#channel` area splits) provides isolation directly through git. The coordinator audits `git -C <worker_cwd> diff` and requires an independent `verifier` gate before landing any slice into the active worktree.
- **Multi-project & multi-worktree concurrent safety.** Every skill anchors git operations to the active target worktree (`git -C <TARGET_CWD> rev-parse --show-toplevel` rather than `[ -d .git ]`), checks out candidate revisions via detached `HEAD` (avoiding git's shared-branch lock across linked worktrees), allocates per-run scratch directories with `mktemp -d`, binds ephemeral ports (`--port 0`), verifies PID and worktree build ownership in `Doctor`, and tears down only owned PIDs and dedicated `tmux -L` sockets—so multiple `agy` sessions can work across different projects and different git worktrees simultaneously without colliding.
- **Native model inheritance with opt-in cross-family bakeoffs.** Routine `/pstack`, `/understand`, and `verify-*` waves omit `model` so workers inherit the user's chosen model by default (using `swarm{action: "model"}` for live quota hot-swaps or explicit user overrides), while `/crucible` and `/interrogate` explicitly override built-in `swarm`'s single-model rule to select cross-family `high`/`xhigh` models via `swarm{action: "models"}`.
- **Inline worker briefs & resolved plugin paths.** Workers use plain job names (`parser`, `verifier`, `design-a`, `deslop`) and receive the 3 to 4 task-relevant rules from [`principles.md`](./skills/pstack/references/principles.md) inline, plus resolved `<plugin-dir>/skills/...` paths when reading [`typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) or running the bundled zero-npm-dependency [`statechart`](./skills/statechart/SKILL.md) TLA+ compiler (`skills/statechart/scripts/statechart`).
- **Upstream-aligned `.agents/skills/verify-*` lifecycle.** Dedicated skills create and maintain both behavioral feature-map suites (`.agents/skills/verify-<app>/`) and formal invariant suites (`.agents/skills/verify-<area>-formal/`), which `verifier` workers discover and execute cold on every task.

## Skills

| Skill | Purpose |
|---|---|
| [`/pstack`](./skills/pstack/SKILL.md) | Unified swarm coordinator covering diagnosis, features, caller-migrating refactors, benchmark hillclimbs, multi-phase programs, and opt-in PR shipping. |
| [`/crucible`](./skills/crucible/SKILL.md) | Competing architectural (`sketch`) or executable (`full`) prototypes across distinct model families, blind cross-family `judge`, and warm `fork` + `cherry-pick` synthesis. |
| [`/interrogate`](./skills/interrogate/SKILL.md) | Adversarial exploit hunting (`workspace: "share"` failing repros) paired with transitive caller, wire-schema, and rollout-skew blast-radius proof. |
| [`/understand`](./skills/understand/SKILL.md) | Parallel clue-sharing scouts for mechanism walkthroughs (`how`), historical provenance under 5 epistemic confidence tiers (`why`), and interactive walkthroughs (`teach`). |
| [`/typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) | TypeScript type-system and boundary discipline grounded in concrete syntax and [`patterns.md`](./skills/typescript-best-practices/references/patterns.md) when reading or editing `.ts`/`.tsx` files. |
| [`/statechart`](./skills/statechart/SKILL.md) | Full TLA+ (TLC) model checker and Mermaid statechart compiler (`scripts/statechart` + Pele SVG rendering) with user-language state/step views and shortest bug paths. |
| [`/create-verification-skill`](./skills/create-verification-skill/SKILL.md) | Interview a repo, generate a `.agents/skills/verify-<app>/` behavioral harness + `features/` map, and prove it cold end to end. |
| [`/maintain-verification-skill`](./skills/maintain-verification-skill/SKILL.md) | Parallel source-drift audit + single-owner live pass across every mapped feature (`clean`, `changed`, or `blocked`) under strict edit scope. |
| [`/create-formal-verification-skill`](./skills/create-formal-verification-skill/SKILL.md) | Formally verify a high-consequence concurrency, state-machine, parser, or input invariant (TLA+, SMT, prover, or PBT), prove failure sensitivity, and generate `.agents/skills/verify-<area>-formal/`. |
| [`/maintain-formal-verification-skill`](./skills/maintain-formal-verification-skill/SKILL.md) | Sync formal checks with `sync_commit..HEAD` code changes, re-prove failure sensitivity, and separate verification drift from real product bugs (`in sync`, `updated`, `bug`, or `blocked`). |
| [`/bro`](./skills/bro/SKILL.md) | Restate the last reply or a named passage in plain everyday language with zero jargon. |

## Validate

```bash
agy plugin validate --strict --json .
```

## License

MIT
