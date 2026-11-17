# pstack

Pstack-inspired workflows for Google Antigravity (`agy`), adapted from [pstack](https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack) by [Lauren Tan (poteto)](https://x.com/poteto).

If you want to go fast, go deep first. Throughput without verification only ships broken code faster. `pstack` pairs Antigravity's native `swarm` runtime and git worktree isolation with disciplined engineering principles, autonomous multi-model selection, adversarial verification, and zero-slop code hygiene.

## Install

```bash
agy plugin install https://github.com/pstack-ports/agy-pstack-next
```

No setup command, hook registration, or model config file is required. Start immediately with `/agy-pstack-next:pstack` (or `/pstack` in the UI):

```text
/agy-pstack-next:pstack reproduce the idle scroll drift first, fix the root cause, and prove the fix in the browser.
```

## Architecture: Pure Philosophy, Zero Hooks

- **Zero runtime scripts or global hooks.** Native `swarm` (`workspace: "share"` git worktrees, `fork` warm handoffs, `#seq` board citations, and `swarm_pane`) provides isolation directly through git. The coordinator audits `git -C <worker_cwd> diff` and requires an independent `verifier` gate before merging any slice into your checkout.
- **Autonomous model and effort selection.** The coordinator inspects live models and remaining quota via `swarm{action: "models"}` and assigns each worker a fitting `<model>-<effort>` (fast `flash` for scouts, strong coding models for slice authors, cross-family `high`/`xhigh` models for `/crucible`, `/interrogate`, and blind `judge`s, plus live `swarm{action: "model"}` hot-swaps on low quota).
- **Inline worker briefs.** Workers use plain job names (`parser`, `verifier`, `design-a`, `deslop`) and receive the 3 to 4 task-relevant rules from [`principles.md`](./skills/pstack/references/principles.md) directly in their `swarm` brief with zero startup file-read overhead.
- **Works with `.agents/skills/verify-*` suites.** Independent `verifier` workers automatically discover and run project-local behavioral skills (`.agents/skills/verify-<app>/`) and upstream formal skills directly. If an older v2 `verify-<area>-formal` skill calls the removed `scripts/statechart` binary or `control-ui`/`control-cli` plugin paths, follow the direct `tlc` command in [`statechart/SKILL.md`](./skills/statechart/SKILL.md) or refresh it with [`/verify-gen --maintain`](./skills/verify-gen/SKILL.md). This plugin ships `0` scripts.

## Skills

| Skill | Purpose |
|---|---|
| [`/pstack`](./skills/pstack/SKILL.md) | Unified swarm coordinator covering diagnosis, features, caller-migrating refactors, benchmark hillclimbs, multi-phase programs, and opt-in PR shipping. |
| [`/crucible`](./skills/crucible/SKILL.md) | Competing architectural (`sketch`) or executable (`full`) prototypes across distinct model families, blind cross-family `judge`, and warm `fork` + `cherry-pick` synthesis. |
| [`/interrogate`](./skills/interrogate/SKILL.md) | Adversarial exploit hunting (`workspace: "share"` failing repros) paired with transitive caller, wire-schema, and rollout-skew blast-radius proof. |
| [`/understand`](./skills/understand/SKILL.md) | Parallel clue-sharing scouts for mechanism walkthroughs (`how`), historical provenance under 5 epistemic confidence tiers (`why`), and interactive walkthroughs (`teach`). |
| [`/verify-gen`](./skills/verify-gen/SKILL.md) | Create and `--maintain` repo-local `.agents/skills/verify-<app>/` behavioral suites and `.agents/skills/verify-<area>-formal/` invariant suites. |
| [`/statechart`](./skills/statechart/SKILL.md) | Check TLA+ models with TLC and render user-facing Mermaid `stateDiagram-v2` charts and shortest counterexample paths (used by formal `verify-*` skills). |
| [`/bro`](./skills/bro/SKILL.md) | Restate the last reply or a named passage in plain everyday language with zero jargon. |

## Validate

```bash
agy plugin validate --strict --json .
```

## License

MIT
