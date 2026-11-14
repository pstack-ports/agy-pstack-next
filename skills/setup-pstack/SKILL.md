---
name: setup-pstack
description: >-
  Configure per-prefix swarm role models, reasoning budgets, autonomy gates, and
  quota hot-swapping in ~/.gemini/config/rules/pstack-models.md, and register
  pstack-swarm-guard in global ~/.gemini/config/hooks.json. Also recommends
  pstack v2 skills and topologies, shapes prompts, and sets up standing /schedule
  automations or personal -mode convention skills. Use for
  /agy-pstack-next:setup-pstack, /setup-pstack, "configure pstack models",
  "pstack budget", "pstack help", "which skill should I use", or "automate me".
---

# Setup pstack

Configure Swarm-Centric Pstack v2 models, global guard hooks, and autonomy rules, pick the right skill or topology for a task, or automate recurring workflows.

## Route by intent

Infer which of the three workflows the user wants from their prompt:

1. **Configure models, guard hooks, budget, and autonomy.** Default for `/agy-pstack-next:setup-pstack` (or `/setup-pstack`), model changes, cost tuning, or quota rules. Run Mode 1.
2. **Pick a skill, topology, or prompt shape.** Triggered by "which skill", "how do I use pstack", or `/agy-pstack-next:setup-pstack help`. Run Mode 2. Do not start executing engineering work on a help question because swarm runs spend real tokens. If the user asks to perform an engineering task directly, open [`../pstack/SKILL.md`](../pstack/SKILL.md) and execute it.
3. **Automate recurring schedules or personal conventions.** Triggered by "automate me", "set up a cron check", "schedule a sweep", or creating a `<handle>-mode` skill. Run Mode 3.

If the intent remains unclear, ask one `ask_question` prompt with those three choices before acting.

---

## Mode 1. Configure models, budgets, and autonomy

Write `~/.gemini/config/rules/pstack-models.md` as an always-applied global rule (`trigger: always_on`) and register `pstack-swarm-guard` in global `~/.gemini/config/hooks.json` so native swarm workers enforce role capsules and tool boundaries across every pstack swarm.

### Step 1. Discover live models and quotas

Call `swarm{action: "models", all: true}` to inspect every model ID, display name, and remaining quota active in the current Antigravity workspace. Call `swarm{action: "models"}` when you also want the suggested subset.

Antigravity supports `inherit` (omit `model` in `swarm{action: "add"}` so the worker runs on the coordinator's active session model) alongside multi-family pinned models:

- **Claude family.** `claude-opus-5-5-high`, `claude-opus-5-5-medium`, `claude-opus-5-5-low`, `claude-sonnet-5-5-high`, `claude-sonnet-5-5-medium`, `claude-sonnet-5-5-low`.
- **Gemini Hydrogen, Carbon, Argon, and Orchestrator.** `gemini-4-hydrogen-xhigh`, `gemini-4-hydrogen-high`, `gemini-4-hydrogen-medium`, `gemini-4-hydrogen-low`, `gemini-4-carbon-high`, `gemini-4-carbon-medium`, `gemini-4-carbon-low`, `gemini-4-argon-high`, `gemini-4-argon-medium`, `gemini-4-argon-low`, `gemini-pro-orchestrator`, `gemini-pro-orchestrator-argon`.
- **Gemini Flash.** `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`.
- **GPT-OSS.** `gpt-oss-120b-medium`.

Validate every model ID written to the rule against `inherit` or the live `models` array returned by `swarm{action: "models", all: true}`. Never hardcode a model ID that the current workspace rejected.

### Step 2. Load current rule state

Check whether `~/.gemini/config/rules/pstack-models.md` exists. If present, read its `# budget`, role lines, and gate settings as the current baseline, and note whether `trigger: always_on` YAML frontmatter is missing so Step 4 restores it. Drop any retired v1 role keys (such as `how explorer`, `why investigators`, `arena runners`, or `architect runners`) and list dropped keys so the user sees the cleanup.

### Step 3. Choose budget preset, role prefixes, and autonomy gates

Use `ask_question` rather than free-text prompts.

**(a) Budget preset.** Offer four presets and note which one is currently active:

- `(Recommended) balanced - frontier coordinator and fast workers`
- `inherit - match session model across workers`
- `frontier - multi-family high reasoning`
- `lean - flash and oss economy`

Preset behavior:

- `inherit` sets worker prefixes to `inherit` while keeping a live cross-family `ro-judge pool` from the discovered catalog.
- `frontier` pins high-reasoning models (`claude-opus-5-5-high`, `gemini-4-hydrogen-high`, or `gemini-pro-orchestrator`) on `coordinator`, `cand-*`, `adv-*`, and `ro-judge pool`, mid-high models (`claude-sonnet-5-5-high` or `gemini-4-carbon-high`) on `impl-*`, `lead-*`, and `ro-*`, and `gemini-3.8-flash-medium` on `sicko-*`.
- `balanced` pins a high-reasoning model on `coordinator` and `ro-judge pool`, capable mid-tier models (`claude-sonnet-5-5-medium`, `gemini-4-carbon-medium`, or `gemini-4-argon-high`) on `impl-*`, `cand-*`, `lead-*`, and `adv-*`, and fast models (`gemini-3.8-flash-medium` or `gemini-3.8-flash-low`) on `ro-*` and `sicko-*`.
- `lean` assigns `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, or `gpt-oss-120b-medium` to high-volume worker prefixes and reserves one stronger tier for `ro-judge pool`.

**(b) Per-prefix swarm role models.** Show the resolved table and ask whether to accept or customize individual prefixes:

- `coordinator` runs the root planning and integration loop (`roles/coordinator.md`).
- `impl-*, cand-*, lead-*` run isolated `workspace: "share"` implementation, candidate prototype, and area-lead branches (`roles/poteto-agent.md`). `cand-*` also accepts a comma-separated multi-family list when `/crucible` explores orthogonal axes across distinct model families.
- `ro-*` runs read-only scouts, trace investigators, blast-radius mappers, and verifiers (`roles/research.md`, `workspace: "inherit"`).
- `adv-*` runs adversarial repro and exploit authors in `/interrogate` (`roles/poteto-agent.md`, `workspace: "share"`). A comma-separated multi-family list fans out one adversary per entry.
- `sicko-*` runs surgical comment and slop cleanup passes (`roles/comment-sicko.md`, `workspace: "share"`, `edit_file` only).
- `ro-judge pool` lists ordered cross-family models for `/crucible` and `/pstack` `evolve` grading. The coordinator picks the first available model from a family different from the candidate authors and coordinator. `inherit` never judges.

**(c) Autonomy gates and quota hot-swap.** Confirm three operational policies:

- `push gate` defaults to `manual`. `hooks/guard.mjs` blocks worker `git push` unless `PSTACK_ALLOW_PUSH=1` is explicitly passed after the user asks to push or ship.
- `crucible checkpoint` defaults to `none` (proceed directly to `impl-synth` after judging). Set `before-implement` if the user wants `/crucible` to pause for human sign-off before implementation.
- `quota hotswap` defaults to `auto`. When `swarm{action: "models"}` shows low remaining quota, a turn fails on capacity, or a `[quota]` warning arrives, the coordinator calls `swarm{action: "model", name: "<worker>", model: "<fallback>"}` on the `waiting` worker. Hot-swapping keeps the worker's conversation history and worktree intact. Never call `kill` and `add` to change a worker's model.

### Step 4. Write `~/.gemini/config/rules/pstack-models.md`

Named rule files under `~/.gemini/config/rules/*.md` require `trigger: always_on` YAML frontmatter in `agy` (unlike standalone `AGENTS.md` or `GEMINI.md` files). Without `trigger: always_on`, `agy` logs `CORTEX_MEMORY_TRIGGER_UNSPECIFIED` and drops the rule on every turn. Overwrite `~/.gemini/config/rules/pstack-models.md` with `trigger: always_on` frontmatter and total size well under 24 KB:

```markdown
---
trigger: always_on
---
# pstack v2 swarm model and autonomy configuration.
# Re-run /agy-pstack-next:setup-pstack to update. Delete any line to fall back to skill defaults.
# Values must be `inherit` or live model IDs from `swarm{action: "models", all: true}`.
# budget: balanced
coordinator: inherit
impl-*, lead-*: claude-sonnet-5-5-medium
cand-*: claude-opus-5-5-high, gemini-4-hydrogen-high, gpt-oss-120b-medium
ro-*: gemini-3.8-flash-high
adv-*: claude-opus-5-5-high, gemini-4-hydrogen-high
sicko-*: gemini-3.8-flash-low
ro-judge pool: gemini-4-hydrogen-high, claude-opus-5-5-high, gpt-oss-120b-medium
push gate: manual
crucible checkpoint: none
quota hotswap: auto (fallback: gemini-4-argon-medium, gemini-3.8-flash-high, gpt-oss-120b-medium)
```

### Step 4b. Register `pstack-swarm-guard` in global `~/.gemini/config/hooks.json`

In `agy`, synthetic `Swarm Worker` subagent specs do not inherit user-plugin `hooks.json` bundles, whereas global `~/.gemini/config/hooks.json` runs across both root sessions and every swarm worker. Register `pstack-swarm-guard` globally so worker role capsules and tool confinement execute on every worker turn. Because `hooks/guard.mjs` stores `injected-capsules.json` and `member-map.json` in `<appDataDir>/plugin_data/agy-pstack-next` whether invoked from the plugin hook or `~/.gemini/config/hooks.json`, both registrations share deduplication state and never double-inject the coordinator.

1. Read `~/.gemini/config/hooks.json` first if it exists and parse its top-level JSON object, preserving every existing hook entry (such as `herdr`). Start from `{}` only when `~/.gemini/config/hooks.json` does not exist.
2. Resolve `<abs_guard_path>` to the canonical absolute filesystem path of `hooks/guard.mjs` (expand `$HOME` into a full path rather than writing `~` inside single quotes). Prefer `~/.gemini/config/plugins/agy-pstack-next/hooks/guard.mjs` when installed, and otherwise resolve `../../hooks/guard.mjs` relative to this `SKILL.md` file. Verify `<abs_guard_path>` exists on disk.
3. Set `"pstack-swarm-guard"` on the parsed JSON object using this exact structure while leaving sibling keys untouched:

```json
{
  "pstack-swarm-guard": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node '<abs_guard_path>'",
        "timeout": 10
      }
    ],
    "PreInvocation": [
      {
        "type": "command",
        "command": "node '<abs_guard_path>'",
        "timeout": 10
      }
    ],
    "PreToolUse": [
      {
        "matcher": "(invoke|define)_subagent|manage_subagents|send_message|run_workflow",
        "hooks": [
          {
            "type": "command",
            "command": "node '<abs_guard_path>'",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "(edit|write)_file|run_command|call_mcp_tool|mcp_.*",
        "hooks": [
          {
            "type": "command",
            "command": "node '<abs_guard_path>'",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

4. Write the merged JSON object back to `~/.gemini/config/hooks.json` with 2-space indentation.

Tell the user that `~/.gemini/config/rules/pstack-models.md` and `~/.gemini/config/hooks.json` were saved and take effect on new conversations and newly spawned workers, while `swarm{action: "model"}` can hot-swap waiting workers immediately in the active swarm.

### Step 5. Offer project verification harnesses once

Inspect the workspace for an existing `verify-*` skill or automated E2E harness. If none exists, ask once whether to generate a behavioral verification harness with [`/verify-gen`](../verify-gen/SKILL.md), or a formal state/property checker with `/verify-gen --formal` for concurrent or stateful modules. Do not push if declined.

---

## Mode 2. Workflow and topology recommender

Answer help questions concisely. Recommend the single best v2 skill or `/pstack` topology, explain why in two sentences, and include one copyable prompt in a code block adapted from [`references/recipes.md`](references/recipes.md) and [`references/prompting.md`](references/prompting.md). Prefix plugin slash commands in CLI prompts with `/agy-pstack-next:<skill>` (for example `/agy-pstack-next:pstack`), while leaving built-in Antigravity commands such as `/goal` and `/schedule` unprefixed. Provide a link to [`../../README.md`](../../README.md) or the matching chapter in `docs/guide/`.

### The 13 pstack v2 skills

In the `agy` CLI (`1.5.8+`), invoke any plugin skill as `/agy-pstack-next:<skill>` (shown concisely as `/<skill>` in the table below).

| User goal | Skill |
|---|---|
| Execute features, refactors, bug fixes, perf hillclimbs, multi-PR programs, PR shipping, or skill evals with a coordinated swarm | [`/pstack`](../pstack/SKILL.md) |
| Configure swarm models, budgets, autonomy gates, schedules, or personal `-mode` skills, or get workflow help | [`/setup-pstack`](SKILL.md) |
| Understand how code works, trace historical provenance (`why`), or walk through a subsystem interactively (`teach`) | [`/understand`](../understand/SKILL.md) |
| Explore competing designs (`sketch`) or isolated working prototypes (`full`) across orthogonal axes and graft the best parts | [`/crucible`](../crucible/SKILL.md) |
| Break a diff or design with executable exploits (`adv-*`) and prove transitive caller, schema, and rollout safety (`ro-blast`) | [`/interrogate`](../interrogate/SKILL.md) |
| Mine transcripts and swarm boards for post-mortems, eliminate repeated repo mistakes structurally, or sharpen a draft prompt | [`/reflect`](../reflect/SKILL.md) |
| Catch up since your last message (`standard`), in zero-jargon speech (`--plain`), as a subtitled slide video (`--video`), or across recent sessions (`--recall`) | [`/ketchup`](../ketchup/SKILL.md) |
| Create or `--maintain` behavioral E2E verification skills and `--formal` property or TLA+ verification skills | [`/verify-gen`](../verify-gen/SKILL.md) |
| Drive and inspect web, IDE, or Electron UIs with worker-isolated ports and browser profiles | [`/control-ui`](../control-ui/SKILL.md) |
| Drive, inspect, and profile interactive CLIs and TUIs in isolated PTY harnesses | [`/control-cli`](../control-cli/SKILL.md) |
| Model stateful protocols or UI flows in TLA+ and render Mermaid statecharts with shortest counterexample paths | [`/statechart`](../statechart/SKILL.md) |
| Write or edit RFCs, READMEs, docs, PR descriptions, and commit messages with zero AI slop | [`/technical-writing`](../technical-writing/SKILL.md) |
| Build a web control panel that wakes an Antigravity agent over `agy agentapi` or webhooks | [`/make-bot-ui`](../make-bot-ui/SKILL.md) |

### The 6 topologies inside `/pstack`

`/pstack` selects and composes six topologies automatically from the task description (see [`../../docs/guide/02-pstack.md`](../../docs/guide/02-pstack.md)):

- **`program`** ([`../pstack/topologies/program.md`](../pstack/topologies/program.md)). Multi-phase plans, `#area` channels (when `swarm` exposes `channel`) or `lead-<area>` main-board delegation, stacked branches, board checkpointing, session pickup, and safe pause or teardown.
- **`build`** ([`../pstack/topologies/build.md`](../pstack/topologies/build.md)). Disjoint `impl-*` slicing, caller-first refactors, visual parity loops with `/control-ui`, `sicko-*` cleanup, and `ro-verify` gates.
- **`diagnose`** ([`../pstack/topologies/diagnose.md`](../pstack/topologies/diagnose.md)). Competing `ro-*` hypothesis probes, runtime/trace forensics, failing repro before fix, and warm `fork` into `impl-fix`.
- **`hillclimb`** ([`../pstack/topologies/hillclimb.md`](../pstack/topologies/hillclimb.md)). `ro-bench` baseline and noise-floor lock, explain-the-number math checks, parallel `cand-*` lever trials, and compounding orthogonal wins.
- **`ship`** ([`../pstack/topologies/ship.md`](../pstack/topologies/ship.md)). Pre-PR `/interrogate` and `ro-verify`, landing `share` commits locally, gated `PSTACK_ALLOW_PUSH=1` push when requested, and CI/review babysitting with `watch-pr`.
- **`evolve`** ([`../pstack/topologies/evolve.md`](../pstack/topologies/evolve.md)). Holdout behavioral scenarios, isolated `agy -p --mode auto` runs (`--sandbox` on read-only trials), blind `ro-judge` grading, and skill or role-capsule iteration.

### Troubleshooting common swarm issues

| Symptom | Fix |
|---|---|
| Parallel workers edited overlapping files | Assign disjoint file ownership per `impl-*` worker in `workspace: "share"` and let the coordinator merge slices. |
| Worker branch vanished before merge | Fetch and merge the worker commit (`git fetch <worker_cwd> <sha>`) before calling `swarm{action: "kill"}`. |
| Worker `git push` was denied by guard | `hooks/guard.mjs` blocks pushes by default. Land locally first and pass `PSTACK_ALLOW_PUSH=1` only when the user asked to push. |
| A worker stalled on model quota or capacity | Run `swarm{action: "models"}` to check quota and hot-swap the waiting worker via `swarm{action: "model", name, model}`. |
| Overnight `/goal` or `/schedule` spun without finishing | Give `/goal` or `/schedule` an executable pass/fail check rather than a duration. Read [`references/prompting.md`](references/prompting.md). |

---

## Mode 3. Standing `/schedule` automations and personal `-mode` skills

### Path A. Standing `/schedule` cron and timer jobs

When the user wants recurring checks (PR babysitting, nightly `/verify-gen --maintain` drift sweeps, issue triage, or benchmark regression watches), configure a standing job with Antigravity's `schedule` tool (or recommend `/schedule` in the chat UI):

1. **Require a falsifiable predicate.** Every scheduled prompt must name an executable condition for taking action and a quiet exit when nothing changed (`git rev-parse`, `gh pr checks`, or test exit code).
2. **Default to jittered polling.** Keep `ExactTiming: false` unless the user explicitly demands an exact wall-clock minute. Set `IsDaemon: true` only for standing background jobs meant to outlive the current task, and set `MaxIterations` whenever a bounded watch suffices.
3. **Keep scheduled scouts read-only first.** Scheduled runs should inspect state directly or via `ro-*` workers (`workspace: "inherit"`) and spawn an isolated `impl-*` (`workspace: "share"`) branch only when a real failure or drift check fires. Never auto-push without explicit user authorization.
4. **Show how to cancel.** Remind the user or coordinator that `manage_task{Action: "list"}` and `manage_task{Action: "kill", TaskId}` stop active schedules. Avoid shell `sleep` loops.

### Path B. Personal `<handle>-mode` convention skill

When the user says "automate me" or wants agents to follow their personal engineering habits across sessions:

1. **Check for an existing mode skill.** Inspect `.agents/skills/**/*-mode/SKILL.md` and `~/.gemini/config/skills/*-mode/SKILL.md`. If found, ask via `ask_question` whether to update incrementally since its last git commit or start fresh.
2. **Mine workspace history with `ro-*` scouts.** Locate `<appDataDir>/brain/` from the system prompt and filter strictly to conversations matching the active workspace. Spawn 2 to 3 parallel `ro-history-*` workers (`workspace: "inherit"`) over recent `transcript.jsonl` and `.system_generated/swarm/board.jsonl` slices. Hunt for recurring response preferences, swarm sizing habits, verification standards, code/prose rules, and git/PR conventions. Keep only signals observed across 2 or more slices.
3. **Interview concisely.** Ask 1 or 2 `ask_question` prompts (`is_multi_select: true`, 4 to 6 options) to confirm priorities and capture preferences that never appeared in logs.
4. **Draft and validate in a `share` worktree.** Spawn `impl-mode` (`workspace: "share"`) to author `.agents/skills/<handle>-mode/SKILL.md` (or `~/.gemini/config/skills/<handle>-mode/SKILL.md` for global scope) following Antigravity's `agy-customizations` rules. Reference pstack skills by path rather than pasting their bodies. Keep rules concrete and cut generic filler.
5. **Review, land locally, and retire.** Present the draft for feedback, iterate until it reads cleanly, merge `impl-mode`'s commit into the workspace before calling `swarm{action: "kill", name: "impl-mode"}`, and open a PR only if the user asks.
