# The pstack guide

`pstack` works best when you stop micromanaging individual steps. State what you want changed and how to check that it works. [`/pstack`](../../skills/pstack/SKILL.md) selects the matching swarm topology, spawns isolated workers under mechanical hook guardrails, verifies behavior against the real artifact, and brings back concrete proof.

This guide walks through the complete Swarm-Centric Pstack v2 workflow for the Antigravity CLI (`agy` `1.5.8+`) and Antigravity 2.0 in ten short pages.

1. [Set up pstack](./01-setup.md). Install the plugin, configure per-role swarm models and global guard hooks, and generate a project verification skill.
2. [Route work through `/pstack`](./02-pstack.md). Understand the 6 topologies, prefix-typed swarm workers, worktree isolation, and crisp prompting.
3. [Understand the code](./03-understand.md). Run parallel read-only investigations with `/understand`, rebuild context with `/ketchup`, and fork findings straight into code.
4. [Design the change](./04-design.md). Explore competing designs in `/crucible`, check state machines with `/statechart`, and stress-test diffs with `/interrogate`.
5. [Build and clean the change](./05-build-and-clean.md). Drive `build`, `diagnose`, and `hillclimb` topologies, local UI and CLI harnesses, and `sicko-*` diff cleanup.
6. [Verify and ship](./06-verify-and-ship.md). Generate E2E and formal verification skills with `/verify-gen`, vet numbers, open crisp PRs, and babysit CI to merge-ready.
7. [Run work while you sleep](./07-overnight.md). Pair `/pstack` (`program` topology) with `/goal` and `/schedule`, audit `#seq` board checkpoints, and catch up in the morning.
8. [Steer with principle names](./08-principles.md). Use the 24 engineering principle names to redirect a swarm in one sentence.
9. [Make it yours](./09-make-it-yours.md). Capture structural lessons with `/reflect`, blind-test skill edits with `evolve`, polish docs with `/technical-writing`, and build wake UIs with `/make-bot-ui`.
10. [Recipes and pitfalls](./10-recipes-and-pitfalls.md). Copy-ready prompts and common mistakes to avoid.

Read the pages in order once. After that, each page stands on its own as a reference. In the `agy` CLI, plugin slash commands are namespaced as `/agy-pstack-next:<skill>` (used in the copy-ready prompt blocks throughout this guide), while built-in Antigravity commands such as `/goal` and `/schedule` stay unprefixed.

When you are unsure which skill or topology fits a problem, ask [`/setup-pstack`](../../skills/setup-pstack/SKILL.md) for a recommendation before spending swarm tokens:

```text
/agy-pstack-next:setup-pstack which workflow should i use to audit and migrate our webhook retry queue?
```

It recommends the matching skill or `/pstack` topology, sharpens a copy-ready prompt, and waits for your go-ahead before launching workers.

## If you only remember one thing

Give `/pstack` a clear outcome and a check that can fail:

```text
/agy-pstack-next:pstack the export writes duplicate rows when a retry lands mid-run. reproduce first, fix the root cause, and prove the 60k-row fixture exports zero duplicates.
```

You never need to list sub-skills or micromanage worker names. `/pstack` routes that prompt to the [`diagnose`](../../skills/pstack/topologies/diagnose.md) topology, probes hypotheses with read-only `ro-*` workers, forks the winning trace into an isolated `impl-fix` worktree, and proves the fix with `ro-verify`.

Continue to [Set up pstack](./01-setup.md).
