# pstack

Pstack-inspired workflows for Google Antigravity (`agy`), adapted from [pstack](https://github.com/cursor/plugins/tree/2f87c854fe/pstack) (`0.15.43`) by [Lauren Tan (poteto)](https://x.com/poteto).

If you want to go fast, go deep first. Throughput without verification only ships broken code faster. `pstack` layers disciplined engineering principles, orthogonal design bakeoffs, TLA+ statechart verification, adversarial exploit testing, and zero-slop code hygiene directly on top of Antigravity's built-in `swarm` runtime.

## Install

```bash
agy plugin install https://github.com/pstack-ports/agy-pstack-next
```

No setup command, hook registration, or model config file is required. Start immediately with `/agy-pstack-next:pstack` (or `/pstack` in the UI):

```text
/agy-pstack-next:pstack reproduce the idle scroll drift first, fix the root cause, and prove the fix in the browser.
```

## Architecture: Composable Layer 1 Kit + Built-in `swarm` Layer 2, Multi-Worktree Safe, Zero Hooks

- **Two composable layers (`swarm` + `/boost` + `/teamwork` interop).** Multi-agent Layer 2 protocols (`/pstack`, `/crucible`, `/interrogate`, `/understand`) load Antigravity's built-in `swarm` (`<appDataDir>/builtin/skills/native_swarm/SKILL.md` when `/swarm` wasn't invoked explicitly, plus `swarm_pane` when listed in `<skills>`) via [`swarm-contract.md`](./skills/pstack/references/swarm-contract.md) with zero overrides and zero global hooks. Portable Layer 1 artifacts ([`principles.md`](./skills/pstack/references/principles.md), [`/typescript-best-practices`](./skills/typescript-best-practices/SKILL.md), [`/statechart`](./skills/statechart/SKILL.md), and generated `.agents/skills/verify-*` gates) run inline inside `/boost`, `/teamwork`, IDE extensions, or single-file turns; see [`orchestrator-interop.md`](./skills/pstack/references/orchestrator-interop.md) for grounded handoff briefs and opt-in `.agents/rules/pstack-gates.md` usage.
- **Orthogonal axes without model overrides.** `/crucible` and `/interrogate` enforce independent thinking through orthogonal structural axes (`design-a..c`, blind `judge` reading git diffs without board authorship) and fault-surface splits (`adv-logic`, `adv-boundary`, `blast`) on your chosen session model unless you explicitly ask for other models.
- **Multi-worktree & process isolation.** Git operations anchor to `TARGET_CWD` (`rev-parse --show-toplevel`), peer checkouts use detached `HEAD`, and runs isolate scratch directories (`mktemp -d`), ephemeral ports (`--port 0`), profiles/`tmux -L` sockets, and PID-scoped teardown.
- **Self-contained briefs & `.agents/skills/verify-*` gates.** Briefs inline the 3–4 relevant rules from [`principles.md`](./skills/pstack/references/principles.md) plus resolved `<plugin-dir>/skills/...` paths (for [`typescript-best-practices`](./skills/typescript-best-practices/SKILL.md) and [`statechart`](./skills/statechart/SKILL.md)), and independent `verifier` workers execute behavioral or formal `.agents/skills/verify-*` suites cold before any commit lands in `TARGET_CWD`.

## Skills

| Skill | Purpose |
|---|---|
| [`/pstack`](./skills/pstack/SKILL.md) | Unified swarm coordinator covering diagnosis, features, caller-migrating refactors, benchmark hillclimbs, multi-phase programs, and opt-in PR shipping. |
| [`/crucible`](./skills/crucible/SKILL.md) | Competing architectural (`sketch`) or executable (`full`) prototypes across orthogonal design axes, blind `judge`, and warm `fork` + `cherry-pick` synthesis. |
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
