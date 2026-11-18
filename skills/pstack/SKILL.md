---
name: pstack
description: >-
  Swarm-native engineering coordinator for features, bug fixes, caller-migrating
  refactors, performance hillclimbs, ambiguous or multi-phase programs, and
  opt-in PR shipping. Use for /agy-pstack-next:pstack, /pstack, "figure it out",
  or non-trivial engineering work across an Antigravity native swarm.
---

# Pstack Swarm Coordinator

Follow built-in `swarm`, [`references/swarm-contract.md`](references/swarm-contract.md), and [`references/principles.md`](references/principles.md) (plus [`/typescript-best-practices`](../typescript-best-practices/SKILL.md) on `.ts`/`.tsx` files).

## 1. Independent Verification & Deslop Gate

1. **Run repo `verify-*` skills first.** Instruct each `verifier` to check `$PWD/.agents/skills/verify-*/SKILL.md` first (passing `<plugin-dir>/skills/statechart/SKILL.md` when formal TLA+ checks exist) and execute its `Launch -> Doctor -> Drive -> Evidence -> Cleanup` flow cold in an isolated run directory. Refresh drifted suites via [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) or [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md). When none exist, run unit/integration suites and exercise the real CLI, UI, or API surface directly.
2. **Audit diff hygiene.** Reject disposable narration comments, dead shims, and red flags from [`references/principles.md`](references/principles.md). On comment-heavy diffs, run a comment-only `deslop` worker (`workspace: "share"`) and audit `git -C <deslop_cwd> diff` before landing.
3. **Protect gate integrity.** Require `@coordinator [done] PASS` (`PASS+NOTES`), `ISSUES` (routed directly to `@<author>` citing `#seq`), or `BLOCKED` (including inconclusive checks). Repair broken harnesses/gates in their own isolated commit rather than weakening or skipping them. Chain [`/interrogate`](../interrogate/SKILL.md) on high-risk concurrency, auth, or schema changes.

## 2. Five Composable Task Shapes

Pick or chain the shape matching the user's goal:

- **`diagnose` (bugs & incidents).** Fan out 2–3 `inherit` scouts on competing hypotheses (`Attack the Premise` after two failed attempts). Branch the author warmly from the winning scout (`workspace: "share"`, `fork: "<winning-scout>"`), commit a failing behavioral test before the root-cause fix, and gate with `verifier`.
- **`build` (features & caller-migrating refactors).** Ground unfamiliar invariants via [`/understand`](../understand/SKILL.md) or boundary forks via [`/crucible`](../crucible/SKILL.md). Land shared domain types and dead-code deletions first (`Subtract Before You Add`), then fan out disjoint `share` slices (`tasks: [...]` when homogeneous). On internal API refactors, pin behavior first, migrate every caller, and delete the legacy API and shims in the same wave.
- **`hillclimb` (performance & metric optimization).** Have `bench` (`inherit`) lock the baseline, noise floor, profiled bottleneck, and Amdahl ceiling (`Explain the Number`). Fan out parallel `share` lever trials, require 5+ interleaved runs (`A, B, A, B, ...`) with zero errors, discard deltas inside noise spread, and compound orthogonal winners via `git cherry-pick`.
- **`program` (ambiguous, high-blast-radius, or multi-phase programs).** Write the falsifiable done predicate, baseline check (`old vs new`), and phase sequence to `<appDataDir>/brain/<conversation-id>/task.md` (`UserFacing: true`; `RequestFeedback: true` once before multi-hour runs with one-way doors unless `/goal` autonomy was granted). De-risk the hardest unknown first in one `share` probe (or [`/crucible`](../crucible/SKILL.md)) and lock verification ([`/create-verification-skill`](../create-verification-skill/SKILL.md) or [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) when absent) before slice fan-out. Verify Phase N completely before Phase N+1, reverting missed experimental phases cleanly instead of stacking patches, and pair unattended runs with `/goal` or `schedule` on an executable exit check.
- **`ship` (local landing & opt-in PRs).** Default to landing verified commits onto `TARGET_CWD` and retiring task workers. Only when the user asks to push or open a PR, brief a `ship` worker to push, run `gh pr create` (`Why`, `What changed`, `Blast Radius`, `Verification`), and watch CI/review threads if requested.
