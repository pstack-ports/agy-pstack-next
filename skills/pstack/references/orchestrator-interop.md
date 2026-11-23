# Cross-Orchestrator Interop (`/swarm`, `/boost`, `/teamwork`)

`agy-pstack-next` stays strictly on built-in `swarm` for multi-agent Layer 2 protocols (`/pstack`, `/crucible`, `/interrogate`, `/understand`), while exporting portable Layer 1 discipline ([`rules/AGENTS.md`](../../../rules/AGENTS.md), [`/typescript-best-practices`](../../typescript-best-practices/SKILL.md), [`/statechart`](../../statechart/SKILL.md), and `.agents/skills/verify-*`) into regular mode, `/boost`, `/teamwork`, and IDE extensions per [`swarm-contract.md`](swarm-contract.md). Whenever `agy-pstack-next` is enabled, `rules/AGENTS.md` is merged automatically into the active rule set across all modes.

## 1. Runtime Fit Guide

| Orchestrator | Best Problem Shape | Surface & Plan | Pstack Role |
|---|---|---|---|
| `/swarm` | Parallel slices, competing designs (`/crucible`), adversarial repros (`/interrogate`), benchmarks | App & CLI · All plans | Native Layer 2 execution engine |
| `/boost` | Hard coupled bugs, races, intricate single-area refactors | App, CLI, IDE · Paid plans | Layer 1 skills/rules run inline; hand off via brief |
| `/teamwork` | Multi-day migrations, simulators, milestone campaigns | App, CLI, IDE · Paid plans | Ground Phase 1 via brief; audit outputs via Stage 3 |

## 2. Grounded Handoff Brief Template

When `/pstack` recommends `/boost` or `/teamwork` (or hands off after `/understand` or `/crucible`), emit a copy-ready brief containing:

1. **Target & Scope:** `TARGET_CWD` (`git rev-parse --show-toplevel`), target files or branch, and the falsifiable done predicate.
2. **Verification Oracle:** Exact path to `.agents/skills/verify-*` (or formal `verify-*-formal`) plus baseline command.
3. **3–4 Tailored Principles:** Cite the relevant rules and Structural Design Red Flags from [`rules/AGENTS.md`](../../../rules/AGENTS.md) (for example, *Subtract before you add*, *Boundary discipline*, and *Zero-slop comment hygiene*).
4. **Landing Target (for `/teamwork`):** Instruct Teamwork to produce changes against a dedicated branch or patch anchored to `TARGET_CWD` so `/interrogate` and a cold `verify-*` pass can gate landing.

## 3. Optional Repo Rule (`.agents/rules/pstack-gates.md`)

`rules/AGENTS.md` already loads Pstack's engineering principles automatically whenever `agy-pstack-next` is enabled. For repositories whose contributors run `/boost` or `/teamwork` without the plugin installed, add an opt-in `.agents/rules/pstack-gates.md`:

```markdown
- Before claiming a task done, run any matching `.agents/skills/verify-*/SKILL.md` cold and report real command output.
- Screen diffs for shallow modules, split ownership, parallel legacy paths, and unparsed boundary inputs.
- Strip disposable line-by-line narration comments before final handoff.
```
