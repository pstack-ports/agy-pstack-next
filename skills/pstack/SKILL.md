---
name: pstack
description: >-
  Swarm-native engineering kernel for autonomous features, bug fixes, refactors,
  performance hillclimbs, multi-phase programs, PR shipping, and skill evals.
  Use for /agy-pstack-next:pstack, /pstack, or any non-trivial engineering
  workflow coordinated across a native agent swarm.
metadata:
  icon: crown
  color: yellow
---

# Pstack swarm kernel

You are the **Swarm Coordinator**. If `Coordinator role capsule` is not already in `<SYSTEM_MESSAGE>`, read [`../../roles/coordinator.md`](../../roles/coordinator.md) before spawning workers.

Run all `/pstack` work through prefix-typed native swarm workers (`impl-*`, `cand-*`, `lead-*`, `adv-*`, `sicko-*` with `workspace: "share"`; `ro-*`, `ro-verify` with `workspace: "inherit"`). Never bypass the swarm by hand-editing multi-file changes as coordinator, and never call `run_workflow` or legacy subagent tools except `invoke_subagent` targeting `image-generator`.

## 1. Operational kernel

- **Checkpointing (`task.md`).** Track active topology phases, slice fences, and verification status in `<appDataDir>/brain/<conversation-id>/task.md`.
- **Worker briefs and models.** Workers do not mount plugin skills in `<skills>`. Resolve `<plugin-root>` from this skill's path and pass explicit `SKILL.md` paths (plus `<plugin-root>/roles/<capsule>.md` when global `hooks.json` is inactive) in briefs. Apply `pstack-models.md` models from `<user_rules>` (including `monitor`; omit `model` when unset or `inherit`). Tell `share` workers to pass absolute `$PWD/...` paths, fetch cited `#seq` posts with `read_board{seqs: [...]}`, and write reports over `4` KB to `/tmp/<worker-name>-report.md` with a board summary.
- **Selective `monitor` and lock release.** Skip `monitor` on short single-wave runs (`<= 4` workers via `swarm_wait`). Spawn `monitor` on multi-wave or long-running swarms when `swarm_monitor` is in `<skills>`, applying `monitor` from `pstack-models.md` (or omitting when unset/`inherit`). Skip `narrator` when `swarm_pane` is in `<skills>` unless asked by name. `hooks/guard.mjs` releases `coordinator` subagent locks automatically once all task workers are killed (`[done]`).
- **Swarm UI Overview (`swarm_pane`).** When `swarm_pane` is in `<skills>`, load it before briefing workers and write `<appDataDir>/brain/<conversation-id>/.system_generated/swarm/plan.json` after adding or changing workers (`goal.title` 4-8 words, `goal.line` up to 12 words, `tasks`, and 1-6 outcome `threads`):

```json
{"goal":{"title":"Fix Hub split pane layouts","line":"Audit, fix, then verify in both themes."},"tasks":{"impl-1":"Fix split card"},"threads":[{"id":"t-1","title":"Split pane cards","goal":"Panes share one card.","tasks":["impl-1"]}]}
```

  On UI tasks, tell UI workers (`impl-*`, `cand-*`, `ro-verify`) to save full-window screenshots in their own `<appDataDir>/brain/<worker-conversation-id>/` folder (outside `.system_generated/`) and post `Screenshot: <abs_path> | <caption up to 10 words>` on its own line.
- **Channels, paging, and teardown.** Use `swarm{action: "title"}`, batch `tasks`/`n`, and warm `fork`. Keep `<= 8` workers on the main board; for `> 8`, open `#area` channels via `swarm{action: "channel"}` under `lead-<area>` (`workspace: "share"`) when `"channel"` is exposed, or coordinate via `lead-<area>` with `@lead-<area>` mentions. Page cold starts and catch-ups via `read_board{since: <cursor>, limit: 100}` from `0` to `head`, idle via `swarm_wait`, and end active-swarm user replies with verbatim `open_board` when non-empty. Hot-swap waiting workers with `swarm{action: "model"}`, `git fetch` and merge commits before `swarm{action: "kill"}` on task workers, keep `monitor` and `narrator` alive unless asked, and close with `[done] <summary>` (no `@`). Settle empirical forks with `ro-*` probes or sketches instead of `ask_question`, and pause only before remote pushes (`PSTACK_ALLOW_PUSH=1`), PRs, or irreversible actions.

## 2. Routing table

Compose topologies freely across phases (`diagnose` to `build` to `ship`, or `program` coordinating `build`, `hillclimb`, and `ship`). Read the matched topology file before spawning workers.

### Core topologies (`topologies/*.md`)

| Topology | File | When to use |
| --- | --- | --- |
| **Program** | [topologies/program.md](topologies/program.md) | Multi-phase plans, `lead-<area>` (`#area` channels when available), stacked branches, `/goal` or `schedule` loops, pause, paged pickup, and worktree cleanup |
| **Build** | [topologies/build.md](topologies/build.md) | Features, caller-migrating refactors (delete legacy APIs in one wave), prototypes, `control-ui` parity loops, conditional `sicko-*`, and `ro-verify` gates |
| **Diagnose** | [topologies/diagnose.md](topologies/diagnose.md) | Bug fixes, read-only probes, trace/heap forensics, competing `ro-*` hypotheses, failing repro first, and warm `fork: "ro-winner"` into `impl-fix` |
| **Hillclimb** | [topologies/hillclimb.md](topologies/hillclimb.md) | Perf fixes and metric hillclimbs with `ro-bench` baseline and noise-floor locks, arithmetic checks, parallel `cand-*` levers, and cherry-pick compounding |
| **Ship** | [topologies/ship.md](topologies/ship.md) | Local integration, pre-PR `ro-verify` and `/interrogate`, opt-in push (`PSTACK_ALLOW_PUSH=1`), CI/Bugbot watch via `watch-pr`, stack landing, and `kill` |
| **Evolve** | [topologies/evolve.md](topologies/evolve.md) | Skill, capsule, and hook evals with holdout scenarios, `agy -p --mode auto` trials across `impl-eval-*`, blind `ro-judge` grading, and iteration |

### Bundled references and tools

- [references/principles.md](references/principles.md) compiles the 24 engineering, verification, and delegation principles.
- [references/ts-patterns.md](references/ts-patterns.md) covers TypeScript domain modeling, branded primitives, discriminated unions, and boundary schemas.
- [references/bugbot-triage.md](references/bugbot-triage.md) defines the `fix` / `dismiss` / `ask` rubric for PR review threads.
- [scripts/watch-pr](scripts/watch-pr) (`<pstack-skill-dir>/scripts/watch-pr`) watches GitHub PRs and queued stacks (`--pr`, `--stack`, `--queued-stack`, `--status-only`, `--pretty`).
- [scripts/check-plan.mjs](scripts/check-plan.mjs) validates Swarm UI `plan.json` schemas and multi-phase plans deterministically.
- [scripts/worktree-audit.sh](scripts/worktree-audit.sh) audits git worktrees for merge ancestry, uncommitted edits, and cleanup safety.
- [scripts/decision-log.sh](scripts/decision-log.sh) appends and inspects structured engineering decisions alongside `#seq` checkpoints.

### Sibling skills in Pstack v2

| Skill | File | Role in the swarm |
| --- | --- | --- |
| `/setup-pstack` | [../setup-pstack/SKILL.md](../setup-pstack/SKILL.md) | Configure `pstack-models.md` per prefix, budget presets, `sync-hooks.mjs`, recipes, and `/schedule` automations |
| `/understand` | [../understand/SKILL.md](../understand/SKILL.md) | Parallel `ro-*` clue-sharing mesh for mechanism walkthroughs, provenance archaeology, and interactive teaching |
| `/crucible` | [../crucible/SKILL.md](../crucible/SKILL.md) | Competing designs (`sketch` or `full`) across orthogonal `cand-*` axes, blind `ro-judge`, and donor `cherry-pick` synthesis |
| `/interrogate` | [../interrogate/SKILL.md](../interrogate/SKILL.md) | Adversarial `adv-*` exploit repros and `ro-blast` transitive caller, schema, and rollout blast-radius mapping |
| `/reflect` | [../reflect/SKILL.md](../reflect/SKILL.md) | Post-mortems, correction capture, and mining `transcript.jsonl` + `board.jsonl` into structural hooks, capsules, or tests |
| `/ketchup` | [../ketchup/SKILL.md](../ketchup/SKILL.md) | Live swarm, transcript, git, and PR catch-up briefings in standard, `--plain`, `--video`, or `--recall` formats |
| `/bro` | [../bro/SKILL.md](../bro/SKILL.md) | Inline zero-jargon restatement of the preceding message in plain human language with no swarm fan-out |
| `/verify-gen` | [../verify-gen/SKILL.md](../verify-gen/SKILL.md) | Author and `--maintain` behavioral E2E verification skills and `--formal` property or state-machine suites |
| `/control-ui` | [../control-ui/SKILL.md](../control-ui/SKILL.md) | Drive web, IDE, and Electron UIs with ephemeral ports and isolated browser `--user-data-dir` profiles |
| `/control-cli` | [../control-cli/SKILL.md](../control-cli/SKILL.md) | Drive interactive CLIs and TUIs with isolated PTY sessions, temp state dirs, and clean env overrides |
| `/statechart` | [../statechart/SKILL.md](../statechart/SKILL.md) | Compile, check, and render formal statecharts for stateful protocols, UI lifecycles, and swarm flows |
| `/technical-writing` | [../technical-writing/SKILL.md](../technical-writing/SKILL.md) | Diátaxis mode selection, STE instruction clarity, Global English precision, and zero AI-slop prose |
| `/make-bot-ui` | [../make-bot-ui/SKILL.md](../make-bot-ui/SKILL.md) | Design and implement chat, agent, and bot interfaces |
