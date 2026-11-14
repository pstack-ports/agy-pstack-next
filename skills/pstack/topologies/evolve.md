# Evolve topology

Use the `evolve` topology when authoring or refining `SKILL.md` workflows, `roles/*.md` capsules, or `hooks/guard.mjs` rules, and when evaluating how structural or prompt changes shift agent behavior across blinded holdout scenarios.

## Authoring and structural hygiene

Before running behavioral trials, enforce clean customization structure on every edited skill, capsule, or hook:

1. **Follow Antigravity customization conventions.** Consult the built-in `agy-customizations` skill when creating or restructuring skills, hooks, or plugin manifests:
   - Every `skills/<name>/SKILL.md` begins with YAML frontmatter containing lowercase hyphenated `name` and a concrete third-person `description` stating both what the skill does and when to activate it.
   - Keep `SKILL.md` concise and procedural. Push dense lookup catalogs into `references/*.md` and deterministic automation into executable `scripts/*` files (progressive disclosure).
2. **Keep only decision-changing prose.** Delete throat-clearing, motivational filler, em-dashes, and mid-sentence colons per [../../technical-writing/SKILL.md](../../technical-writing/SKILL.md). If removing a sentence cannot change a tool call, file boundary, or verification check, cut it.
3. **Prefer code guards over warning text.** Per `Encode Lessons in Structure` in [../references/principles.md](../references/principles.md), move enforceable invariants (forbidden tools, read-only role restrictions, worktree path confinement, push gates) into `hooks/guard.mjs` with unit tests in `hooks/guard.test.mjs` rather than repeating "NEVER do X" across prompts.
4. **Run static plugin validation first.** Execute `agy plugin validate --strict --json .` and verify exit code `0` with `findings: []`, plus zero broken relative markdown links, before spending tokens on sandboxed behavioral trials.

## Phase 1. Design behavioral holdout scenarios and blinding rules

Evaluate changes like controlled scientific experiments rather than anecdotal spot checks:

1. **Frame the hypothesis and hidden rubric.** State the exact change under test (baseline `A` vs candidate `B`) and define `3` to `6` binary or anchored behavioral criteria (such as "spawns `ro-*` before editing", "commits failing test before fix", "zero writes outside owned slice", "passes behavioral verification"). Hold this rubric back for `ro-judge` only.
2. **Maintain unseen holdout scenarios.** Split scenarios into development cases and unseen **holdout scenarios** whose domain, repository fixture, and phrasing never appear as examples inside `SKILL.md` or `roles/*.md`. A change promotes only if it improves or holds holdout performance without regressing baseline capabilities.
3. **Enforce strict blinding hygiene.**
   - Never put `eval`, `test`, `judge`, `rubric`, `score`, `benchmark`, `candidate`, `variant`, or `experiment` in any workspace path, fixture filename, branch name, or prompt visible to trial agents.
   - Write natural, organic user prompts ("Users report duplicate webhook deliveries when Redis reconnects. Track it down and fix it.") with zero chain-eliciting meta prompts (never ask the trial agent which skills or principles it read).
   - Assign randomized, neutral labels (`run-oak`, `run-pine`) before handing trial outputs to `ro-judge` so the judge sees neither variant identity (`baseline` vs `candidate`) nor model names.

## Phase 2. Run isolated headless `agy -p` trials (`impl-eval-*`)

Fan out trial execution across parallel `impl-eval-*` workers (`workspace: "share"`, passing `<plugin-root>/roles/poteto-agent.md` in each brief when global `hooks.json` is not active):

1. **Stage each trial arm's plugin pack and sanitized repo clone.** Each `impl-eval-<k>` creates a clean, standalone git repository clone or fixture under `/tmp/<project-slug>-<id>` containing the target fixture code, plus a neutral staged plugin tree under `/tmp/<pack-id>` (using neutral names such as `/tmp/pack-oak` and `/tmp/pack-pine` with zero banned blinding words) containing that arm's `roles/`, `hooks/`, and `skills/` directories and an empty state directory `/tmp/<state-id>` (such as `/tmp/state-oak` and `/tmp/state-pine`). Because `agy` has no `--plugin-dir` flag and skips external `../` symlinks during workspace discovery, also copy the arm's target skill files directly into `/tmp/<project-slug>-<id>/.agents/skills/<name>/SKILL.md` (along with any companion `references/`, `topologies/`, or `scripts/` files) and never create external `../` symlinks.
2. **Execute headless runs with `PSTACK_PLUGIN_ROOT`, `PSTACK_CACHE_DIR`, and `--mode auto`.** `PSTACK_PLUGIN_ROOT=/tmp/<pack-id>` delegates global and plugin hook invocations across the trial coordinator and every spawned native swarm worker or helper to the staged `/tmp/<pack-id>/hooks/guard.mjs` and `/tmp/<pack-id>/roles/*.md` (and anchors `<plugin-root>/skills/` brief paths to the staged pack), while `PSTACK_CACHE_DIR=/tmp/<state-id>` isolates capsule deduplication state (`injected-capsules.json`, `member-map.json`, and `non-worker-roots.json`) per arm without restricting full swarm execution. Non-interactive `agy -p` runs have no interactive approval prompt, so always pass `--mode auto`. Because `--sandbox` mounts `.git` read-only, choose the command by whether the trial commits code:
   - **Commit-producing trials** (bug fixes, features, refactors that stage or commit git changes) omit `--sandbox` inside the isolated `/tmp/<project-slug>-<id>` clone:
     ```sh
     PSTACK_PLUGIN_ROOT=/tmp/<pack-id> PSTACK_CACHE_DIR=/tmp/<state-id> agy -p "<organic_user_prompt>" --mode auto
     ```
   - **Read-only trials** (investigations, audits, plans, or reviews that make zero git commits) enable both flags:
     ```sh
     PSTACK_PLUGIN_ROOT=/tmp/<pack-id> PSTACK_CACHE_DIR=/tmp/<state-id> agy -p "<organic_user_prompt>" --sandbox --mode auto
     ```
   When measuring cross-model robustness, run paired trials across the model families configured via `/setup-pstack` ([../../setup-pstack/SKILL.md](../../setup-pstack/SKILL.md)).
3. **Collect objective trial artifacts.** Each `impl-eval-<k>` captures:
   - Exit code, wall-clock duration, and final stdout response.
   - `git log -p` and `git status --short` inside `/tmp/<project-slug>-<id>`.
   - Post-trial behavioral test suite results run against the trial repo.
   - The trial conversation's `transcript.jsonl` path so tool-call sequences and `read_file` chains can be audited directly.
4. **Post neutral receipts (`#seq`).** Each `impl-eval-<k>` opens its completion post with `@coordinator [done]` (or `@ro-judge [done]`) followed by its neutral run ID, artifact paths, and test exit codes without self-grading.

## Phase 3. Blind grading by `ro-judge` and transcript chain audit

1. **Spawn cross-family `ro-judge` (`workspace: "inherit"`).** Pin `ro-judge` to a strong reasoning model (ideally a different model family from the trial runners via `swarm{action: "add", name: "ro-judge", workspace: "inherit", model: "<model>", brief: "..."}`).
2. **Score all arms in one blinded pass.** Hand `ro-judge` the hidden rubric and the anonymized `run-<label>` artifact bundles (diffs, test results, final replies, and sanitized tool-call traces with model headers stripped). `ro-judge` scores every criterion with concrete `file` and `line` or tool-step citations (`#seq`).
3. **Verify chain-following from transcripts, never self-report.** Inspect which `SKILL.md`, `topologies/*.md`, or `references/*.md` files the trial agent actually opened in `transcript.jsonl` and whether its tool calls followed the workflow contract (for example, whether `ro-*` probes ran before `impl-*` edits).
4. **Coordinator spot-check.** Read raw diffs on any disagreement between `ro-judge` scores and objective test pass rates. Ambiguous rubric items get tightened before re-scoring.

## Phase 4. Cluster failures and iterate structurally

When holdout trials expose failures or regressions:

1. **Cluster failures by mechanism.** Group misses across scenarios into root causes rather than surface symptoms:
   - **Routing miss.** The agent never activated the skill because frontmatter `description` missed natural user phrasing.
   - **Boundary slip.** A worker edited out-of-scope files or skipped verification because a rule lived only in buried prose instead of `hooks/guard.mjs` or brief structure.
   - **Context dilution.** Long reference prose drowned out the critical step.
   - **Over-constraint.** Rigid instructions forced unnecessary ceremony on simple tasks.
2. **Iterate structurally without prompt overfitting.** Spawn `impl-evolve` (`workspace: "share"`, passing `<plugin-root>/skills/technical-writing/SKILL.md` in its brief, or combine with `/reflect` at [../../reflect/SKILL.md](../../reflect/SKILL.md)) to address the failure cluster at its structural root (sharpening `hooks/guard.mjs`, splitting bulky prose into `references/`, clarifying a topology step, or tightening frontmatter triggers). **Never** paste scenario-specific hints, fixture names, or narrow patches designed solely to pass one failed holdout prompt.
3. **Re-verify on holdouts and land.** Re-run the blinded holdout suite to confirm the fix lifts the target cluster without regressing other scenarios (`Explain the Number`). Fetch and merge `impl-evolve`'s commit before `swarm{action: "kill"}`, re-run `agy plugin validate --strict --json .` and `node --test hooks/guard.test.mjs`, and report baseline vs candidate rubric scores, transcript findings, and structural changes landed.
