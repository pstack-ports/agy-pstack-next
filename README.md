# pstack

Swarm-centric engineering workflows for Antigravity (`agy` v2.0), adapted from [pstack](https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack) by [Lauren Tan (poteto)](https://x.com/poteto).

Read the [pstack guide](./docs/guide/README.md) for a step-by-step walkthrough from model setup to autonomous multi-branch programs.

If you want to go fast, go deep first. Throughput without verification only ships broken code faster. `pstack` turns Antigravity's native swarm runtime into an engineering team with mechanical guardrails, isolated git worktrees, cross-model verification, and zero-slop code hygiene.

## Install

Install the plugin with the Antigravity CLI:

```bash
agy plugin install https://github.com/pstack-ports/agy-pstack-next
```

Verify the installed plugin:

```bash
agy plugin list
```

## Quick Start

Run two commands to start working.

1. Run [`/setup-pstack`](./skills/setup-pstack/SKILL.md) to discover your available models, set per-role defaults, and optionally generate a project verification skill.
2. Start engineering tasks with [`/pstack`](./skills/pstack/SKILL.md), stating the goal and a checkable finish condition.

```text
/pstack the scroll container drifts every 750ms while idle. reproduce it first, fix the root cause, and verify in the browser.
```

```text
/pstack migrate every caller to the new async store in isolated slices, delete the legacy store, and prove all integration suites pass.
```

New to the toolkit or unsure which workflow fits a task? Ask [`/setup-pstack`](./skills/setup-pstack/SKILL.md) for a workflow recommendation or open the [guide](./docs/guide/README.md).

## Hook-Enforced Swarm Architecture

Pstack v2 replaces prompt-only delegation rules with mechanical enforcement via root [`hooks.json`](./hooks.json), [`hooks/guard.mjs`](./hooks/guard.mjs), and four role capsules under `roles/`.

### Prefix-Typed Roster Contract

Every swarm member's prefix determines its workspace isolation, injected role capsule, and runtime permissions.

| Member Prefix | Default Workspace | Role Capsule | Enforced Permissions |
|---|---|---|---|
| Coordinator (root chat) | Primary checkout | [`roles/coordinator.md`](./roles/coordinator.md) | Plans slices, manages swarm lifecycle, judges `#seq` evidence, and merges verified commits. |
| `impl-*`, `cand-*`, `lead-*` | `workspace: "share"` | [`roles/poteto-agent.md`](./roles/poteto-agent.md) | Edits strictly inside its own worktree. `git push` blocked unless `PSTACK_ALLOW_PUSH=1` is set. |
| `adv-*` | `workspace: "share"` | [`roles/poteto-agent.md`](./roles/poteto-agent.md) | Writes executable repros and exploit probes inside its own worktree. `git push` always blocked. |
| `ro-*` | `workspace: "inherit"` | [`roles/research.md`](./roles/research.md) | Strictly read-only. Blocks `edit_file`, `write_file`, mutating shell or git commands, and mutating MCP calls. Allows `/tmp` probes. |
| `sicko-*` | `workspace: "share"` | [`roles/comment-sicko.md`](./roles/comment-sicko.md) | Comment and slop surgeon. Allows `edit_file` inside its own worktree. Blocks `write_file` and `git push`. |
| `monitor*`, `narrator*` | Built-in | None (skipped) | Native stall detection and board narration with zero extra capsule tokens. |

### Mechanical Guardrails in `hooks/guard.mjs`

- **One-time capsule injection.** `SessionStart` and `PreInvocation` resolve each conversation against `<appDataDir>/brain/*/.system_generated/swarm/members.json` and inject its matching `roles/*.md` capsule once per role, upgrading cleanly if a worker's roster entry appears after startup.
- **Native swarm exclusivity.** `PreToolUse` blocks legacy subagent tools across all roles so every multi-agent workflow runs on the shared `#seq` message board.
- **Symlink-safe worktree confinement.** `PreToolUse` resolves `realpathSync` on the nearest existing ancestor of every `edit_file` and `write_file` path, blocking `../` traversal and symlink escapes into sibling worktrees.
- **Read-only research integrity.** `ro-*` workers can inspect code, run tests, query read-only MCPs, and write temporary probes under `/tmp`, while `hooks/guard.mjs` denies repository mutations.
- **Push gating.** Force-pushes to `main` or `master` are always denied. Adversarial (`adv-*`) and cleanup (`sicko-*`) workers can never push, and author workers push only when explicitly authorized with `PSTACK_ALLOW_PUSH=1`.

### Native Swarm Mechanics

- **Warm context forks.** Pass `fork: "<member>"` in `swarm{action: "add"}` to branch an implementation worker directly from a winning `ro-*` investigator or `cand-*` prototype without re-reading the repo cold.
- **Safe landing before teardown.** Because `swarm{action: "kill"}` permanently deletes a worker's `share` worktree, the coordinator always runs `git fetch <worker_cwd> <sha> && git merge` (or `cherry-pick`) before killing a worker.
- **Board `#seq` citations and doorbell `@mentions`.** Workers cite earlier findings by `#seq` number instead of re-quoting logs and `@mention` only the specific peer who acts next.
- **Live quota hot-swap.** If a worker hits rate limits or low quota, `swarm{action: "model"}` switches its model in place while preserving its conversation history and worktree.

## The 13 Skills

`/pstack` orchestrates most end-to-end tasks automatically and composes with the other 12 skills whenever you want a focused workflow directly.

| Skill | Purpose |
|---|---|
| [`/pstack`](./skills/pstack/SKILL.md) | Swarm coordinator kernel with 6 composable topologies (`program`, `build`, `diagnose`, `hillclimb`, `ship`, `evolve`), distilled engineering principles, TypeScript patterns, and PR babysitting. |
| [`/setup-pstack`](./skills/setup-pstack/SKILL.md) | Live `swarm{action: "models"}` configuration for `~/.gemini/config/rules/pstack-models.md`, budget presets, workflow and prompt advisor, and `/schedule` automation setup. |
| [`/understand`](./skills/understand/SKILL.md) | Parallel `ro-*` clue-sharing mesh unifying mechanism walkthroughs, historical git and tracker provenance, and interactive Socratic explanations, with warm `fork` into implementation. |
| [`/crucible`](./skills/crucible/SKILL.md) | Parallel multi-candidate design (`sketch`) and prototype (`full`) arena across orthogonal axes (`cand-*`), cross-family `ro-judge` scoring, and donor `cherry-pick` synthesis. |
| [`/interrogate`](./skills/interrogate/SKILL.md) | Adversarial bug hunting (`adv-*` executable repros) combined with transitive caller, schema, and rollout blast-radius mapping (`ro-blast`), gated by `ro-verify`. |
| [`/reflect`](./skills/reflect/SKILL.md) | Post-mortem, user-correction mining, and structural tightening across transcripts and `board.jsonl`, encoding fixes into hooks, capsules, types, lints, tests, or skills. |
| [`/ketchup`](./skills/ketchup/SKILL.md) | Catch-up briefings across live swarm `view.json`, `#seq` board deltas, prior sessions, `git log`, and PR status in standard, `--plain`, and `--video` formats. |
| [`/verify-gen`](./skills/verify-gen/SKILL.md) | Create and `--maintain` project-local behavioral E2E verification skills (`features/` maps) and `--formal` invariant or TLA+ verification skills, proven live by `ro-verify`. |
| [`/control-ui`](./skills/control-ui/SKILL.md) | Local Playwright, browser, and CDP harness craft with per-worker ephemeral ports and isolated `--user-data-dir` profiles so parallel swarm workers never collide. |
| [`/control-cli`](./skills/control-cli/SKILL.md) | Local `tmux`, PTY, and runtime-inspector harness craft with isolated sockets, temp home directories, and deterministic terminal dimensions per worker. |
| [`/statechart`](./skills/statechart/SKILL.md) | Check a TLA+ state machine with TLC and render user-facing Mermaid or Pele SVG statecharts showing shortest counterexample paths. |
| [`/technical-writing`](./skills/technical-writing/SKILL.md) | Four-layer documentation standard (Diataxis, Google developer style, STE, Global English) with zero-slop hygiene and `ro-*` technical accuracy checks. |
| [`/make-bot-ui`](./skills/make-bot-ui/SKILL.md) | Build local or Tailscale web UIs whose buttons wake Antigravity agents via `agy agentapi` or webhooks while keeping secrets strictly server-side. |

## The 6 `/pstack` Topologies

[`/pstack`](./skills/pstack/SKILL.md) routes tasks across six composable swarm topologies under `skills/pstack/topologies/`.

| Topology | What It Orchestrates |
|---|---|
| [`program`](./skills/pstack/topologies/program.md) | Multi-phase plans, stacked branches, `#area` swarm channels, `lead-<area>` sub-coordinators, autonomous overnight runs, board checkpointing, session resume, and safe worktree cleanup. |
| [`build`](./skills/pstack/topologies/build.md) | Features, caller-migrating refactors, prototypes, and visual parity loops across disjoint `impl-*` worktrees, `sicko-*` diff cleanup, and `ro-verify` behavioral proof. |
| [`diagnose`](./skills/pstack/topologies/diagnose.md) | Bug fixes, read-only investigations, live runtime forensics, and trace profiling via parallel `ro-*` hypothesis probes, warm `fork` into `impl-fix`, and regression verification. |
| [`hillclimb`](./skills/pstack/topologies/hillclimb.md) | Sustained metric optimization with `ro-bench` baseline and noise-floor locking, explain-the-number checks, parallel `cand-*` lever trials, and compounding cherry-picked wins. |
| [`ship`](./skills/pstack/topologies/ship.md) | Pre-PR `ro-verify` and `/interrogate` gates, local branch landing, opt-in PR creation and push (`PSTACK_ALLOW_PUSH=1`), CI and review triage via [`watch-pr`](./skills/pstack/scripts/watch-pr) and [`bugbot-triage.md`](./skills/pstack/references/bugbot-triage.md), and clean worker teardown. |
| [`evolve`](./skills/pstack/topologies/evolve.md) | Skill and role-capsule authoring plus blind behavioral evaluations in isolated `agy -p --sandbox` runs scored by `ro-judge` without prompt overfitting. |

## Engineering Principles and References

All 24 core, architecture, verification, delegation, and meta principles are compiled into [`skills/pstack/references/principles.md`](./skills/pstack/references/principles.md) and distilled into the four role capsules (`roles/*.md`), alongside [`skills/pstack/references/ts-patterns.md`](./skills/pstack/references/ts-patterns.md) for strict TypeScript boundary and union modeling. See [Steer with principle names](./docs/guide/08-principles.md) in the guide for how to redirect a live swarm in one sentence.

## Validation and Testing

Validate the plugin manifest, hooks, and skills strictly with the Antigravity CLI, and run the hook guard unit test suite with Node:

```bash
agy plugin validate --strict --json .
node --test hooks/guard.test.mjs
```

## License

MIT
