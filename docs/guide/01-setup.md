# Set up pstack

In this page you install `agy-pstack-next` in the Antigravity CLI (`agy` `1.5.8+`) or Antigravity 2.0, map swarm worker prefixes to models, register the global swarm guard hook, optionally bootstrap project verification skills, and run your first swarm task.

## Install the plugin

Install the plugin from the terminal with the `agy` CLI (`1.5.8+`):

```bash
agy plugin install https://github.com/pstack-ports/agy-pstack-next
```

Installing registers root [`hooks.json`](../../hooks.json), [`hooks/guard.mjs`](../../hooks/guard.mjs), the four role capsules under `roles/`, and all 13 skills automatically.

In the `agy` CLI (`1.5.8+`), installed plugin slash commands use the `/agy-pstack-next:<skill>` namespace (for example `/agy-pstack-next:setup-pstack` and `/agy-pstack-next:pstack`). Drop the `agy-pstack-next:` prefix only when a skill is installed standalone under `.agents/skills/` or `~/.gemini/config/skills/`. Built-in Antigravity commands such as `/goal` and `/schedule` always stay unprefixed. Throughout this guide, prose refers to skills concisely as `/<skill>`, while copy-ready prompt blocks include `/agy-pstack-next:<skill>` so they paste cleanly into `agy`.

## Configure swarm models, budgets, and global guard hooks

Run the setup skill inside Antigravity:

```text
/agy-pstack-next:setup-pstack
```

[`/setup-pstack`](../../skills/setup-pstack/SKILL.md) queries `swarm{action: "models", all: true}` to discover every model currently available in your Antigravity environment across Claude, Gemini, and GPT-OSS families, alongside `inherit` (which runs workers on your active session model). It asks for your budget preset and performs two machine-local setup steps.

1. **Writes `~/.gemini/config/rules/pstack-models.md` with `trigger: always_on` frontmatter.** Named rule files under `~/.gemini/config/rules/*.md` require `trigger: always_on` YAML frontmatter in `agy` so every coordinator turn receives your model and autonomy settings automatically.
2. **Registers `pstack-swarm-guard` in global `~/.gemini/config/hooks.json`.** Root plugin [`hooks.json`](../../hooks.json) covers top-level sessions, whereas `agy` native `Swarm Worker` subagents do not inherit user-plugin hooks. `/setup-pstack` reads any existing `~/.gemini/config/hooks.json` object first (preserving entries such as `herdr`) and registers `pstack-swarm-guard` as `test ! -f '<abs_guard_path>' || node '<abs_guard_path>'`. Both hook paths share `<appDataDir>/plugin_data/agy-pstack-next` state (`injected-capsules.json` and `member-map.json`), so swarm workers enforce capsules and tool confinement without duplicate injections in the root coordinator.

That global entry stays inert outside active pstack runs. Guarding the command with `test ! -f '<abs_guard_path>' ||` keeps `~/.gemini/config/hooks.json` a clean exit-0 no-op if `agy plugin uninstall agy-pstack-next` removes the plugin directory. `hooks/guard.mjs` also inspects `~/.gemini/config/config.json` (`plugins["agy-pstack-next"].enabled`), so running `agy plugin disable agy-pstack-next` suspends capsule injection and `PreToolUse` gating across global hooks too. Plain built-in `/swarm` sessions that do not invoke a pstack skill or pstack worker prefixes (`impl-*`, `cand-*`, `lead-*`, `ro-*`, `adv-*`, `sicko-*`) pass through `hooks/guard.mjs` unmanaged.

Every swarm workflow reads `pstack-models.md` to pin models by role prefix.

- **`coordinator`.** Plans slices, manages the board, and synthesizes results.
- **`impl-*`, `cand-*`, `lead-*`.** Author code, prototypes, and sub-area slices in `workspace: "share"` worktrees.
- **`ro-*` and `ro-verify`.** Run read-only exploration, trace probes, and independent behavioral verification in `workspace: "inherit"`.
- **`adv-*` and `ro-judge`.** Run adversarial bug repros and cross-family design or eval judging so a model family does not grade its own blind spots.
- **`sicko-*`.** Runs post-pass comment and slop surgery across diffs.

You override only the roles you care about. Roles omitted from `pstack-models.md` fall back to `inherit` or the skill's preset defaults. If a worker hits rate limits or low quota mid-run, `/pstack` hot-swaps its model live via `swarm{action: "model"}` without losing its conversation or worktree.

`/setup-pstack` also handles two companion jobs whenever you ask for them. It recommends the right v2 skill or prompt for an unfamiliar task, and it configures standing `/schedule` automations.

## Generate project verification skills

At the end of setup, `/setup-pstack` checks whether your repository already has a `.agents/skills/verify-*` skill or local E2E harness. When none exists, it offers to run [`/verify-gen`](../../skills/verify-gen/SKILL.md).

Say yes on any project you work in regularly. `/verify-gen` interviews the codebase with `ro-*` mappers, writes `.agents/skills/verify-<app>/` with a `features/` map in an isolated `impl-verify` worktree, and proves the new skill end to end with `ro-verify` before landing it. An agent that can launch and verify your app autonomously loops until checks pass instead of handing half-tested diffs back to you.

When your repository has concurrency, retries, leases, state machines, or parsers where unit tests miss interleavings, run [`/verify-gen --formal`](../../skills/verify-gen/SKILL.md) as well. It models or property-tests your highest-risk invariant and proves the check catches a real injected break. [Verify and ship](./06-verify-and-ship.md) covers both modes in detail.

Start a fresh chat after updating `pstack-models.md` and `~/.gemini/config/hooks.json` so new sessions and newly spawned workers pick up both files.

## Keep token spend predictable

Parallel swarms trade tokens for wall-clock speed and independent verification. Four levers control spend.

- Pick a leaner budget preset in `/setup-pstack` so `ro-*` explorers and `sicko-*` cleanup workers use fast, inexpensive models while `coordinator` and `ro-judge` keep frontier reasoning models.
- Leave roles on `inherit` when your active session already uses the exact model you want.
- Right-size candidate counts in `/crucible` and `/interrogate` (`2` or `3` candidates for routine boundaries, more only for irreversible interfaces).
- Use `/pstack` for multi-file, risky, or verifiable engineering tasks rather than single-line typo edits.

## Run your first task

Give `/pstack` a small, concrete change with an explicit invariant:

```text
/agy-pstack-next:pstack add a --json flag to this CLI command. plain-text output must stay byte-identical. verify both modes.
```

`/pstack` matches the [`build`](../../skills/pstack/topologies/build.md) topology, implements the change in an isolated `impl-*` worktree, runs `ro-verify` against both CLI modes, merges the verified commit locally, and tears down its workers cleanly.

Continue to [Route work through `/pstack`](./02-pstack.md).
