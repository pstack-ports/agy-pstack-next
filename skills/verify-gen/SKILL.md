---
name: verify-gen
description: "Create or maintain project-local behavioral E2E verification skills and formal property or state-machine verification skills. Supports default behavioral generation, --formal invariant checking (TLA+, PBT, SMT, statecharts), and --maintain diff-driven drift upkeep."
---

# Generate and Maintain Verification Skills

Every serious repository needs an executable way for agents to prove behavior without human hand-holding. `/verify-gen` builds and maintains project-local verification skills under `.agents/skills/verify-<target>/` using a three-stage native swarm pipeline. Write every generated skill for an agent reading it cold mid-task.

## Modes

Select the mode from the user's flags or request intent.

- **Behavioral create (default).** Generate `.agents/skills/verify-<app>/SKILL.md`, executable helper scripts, and a `features/` map that drives the real UI, CLI, or service the way a user does.
- **Formal create (`--formal`).** Generate `.agents/skills/verify-<area>-formal/SKILL.md` plus a model, property-based test suite, or code-level verifier that checks a high-consequence invariant across every reachable case within explicit bounds.
- **Behavioral upkeep (`--maintain`).** Audit an existing behavioral verification skill and its `features/` map against current source, run a full live verification pass, fix doc or harness drift, and report product regressions separately.
- **Formal upkeep (`--maintain --formal`, or `--maintain` on a formal target).** Diff covered code from its recorded `sync_commit` to `HEAD`, bring the model or property harness back in line with current code, re-prove failure sensitivity, and classify every failure as verification drift or a real code bug.

## Swarm Pipeline

Run the workflow across three prefix-enforced worker roles on the native swarm board. Never use legacy subagent tools. Because native `Swarm Worker` subagents do not mount installed plugin skills in `<skills>`, pass explicit resolved file paths (such as `<plugin-root>/skills/statechart/SKILL.md`, `<plugin-root>/skills/control-ui/SKILL.md`, `<plugin-root>/skills/control-cli/SKILL.md`, and `<plugin-root>/skills/verify-gen/references/feature-map-example/README.md`) in worker briefs for `read_file` rather than telling workers to invoke plugin skills by name. When global `~/.gemini/config/hooks.json` is not active, also pass `<plugin-root>/roles/research.md` or `<plugin-root>/roles/poteto-agent.md` in each brief.

1. **Read-only mappers (`ro-*`, `workspace: "inherit"`).** Spawn parallel `ro-*` workers to inspect source, startup commands, existing harnesses, invariants, or commit diffs since `sync_commit`. `ro-*` workers never edit repository files and write any temporary probe output strictly inside temp roots (`/tmp`). Each worker posts concise findings on the board and cites peer posts by `#seq`.
2. **Skill and harness authors (`impl-*`, `workspace: "share"`).** Spawn `impl-verify` (or disjoint `impl-*` authors per target) in isolated `share` worktrees. Authors edit only the verification skill directory (`.agents/skills/verify-<target>/`) unless the user explicitly asked to repair a broken project build first.
3. **Independent live verifier (`ro-verify`, `workspace: "inherit"`).** After `impl-verify` commits in its `share` worktree and posts the worktree path and commit SHA, `ro-verify` executes the skill's own instructions cold against that worktree using isolated `/tmp` directories, ephemeral ports, and disposable profiles.
4. **Coordinator landing.** Fetch and merge the verified commit from `impl-verify`'s worktree (`git fetch <worker_cwd> <sha> && git merge --no-edit FETCH_HEAD`) before calling `swarm{action: "kill"}` on any task worker (leaving `monitor` and `narrator` alive unless asked).

## 1. Behavioral Creation (Default)

### Interview the repository first

Have `ro-surface` and `ro-harness` answer five questions from the codebase and ask the user only what source cannot reveal.

- **Surface.** Identify what a user touches (web UI, Electron app, CLI, TUI, HTTP API, or library). Pick the primary surface and note secondary entry points.
- **Run.** Locate the documented local startup command, migrations, seed fixtures, auth setup, and readiness signal. Ready means usable from an empty data directory, not merely an open socket.
- **Drive.** Reuse checked-in Playwright, Cypress, PTY, or HTTP harnesses first. Otherwise pair with [`control-ui`](../control-ui/SKILL.md) for browser and CDP surfaces or [`control-cli`](../control-cli/SKILL.md) for interactive terminals, passing the resolved `<plugin-root>/skills/control-ui/SKILL.md` or `<plugin-root>/skills/control-cli/SKILL.md` path in `ro-harness` and `impl-verify` briefs.
- **Observe.** List concrete proof artifacts such as ARIA snapshots, screenshots, terminal transcripts, exit codes, HTTP payloads, and stored database or filesystem state.
- **Isolate.** Determine how parallel swarm workers avoid collisions via ephemeral ports (`--port 0`), disposable data directories (`/tmp/verify-<app>-${RUN_ID:-$$}`), isolated browser `--user-data-dir` paths, and per-run tmux or PTY session names. If two instances cannot run side by side safely, state that lock constraint explicitly in the generated skill.

If the checkout fails to build or start on `HEAD`, report the exact failure or fix startup first before generating a skill. Never encode broken startup workarounds as normal steps.

### Author the behavioral skill and feature map

`impl-verify` writes `.agents/skills/verify-<app>/SKILL.md` with valid YAML frontmatter (`name: verify-<app>` and a concrete `description`) and six required sections with zero placeholders.

- **Launch.** Exact build or startup command from an empty disposable data directory, environment variables for port and state isolation, readiness check, and teardown. For short-lived CLIs, launch builds once and runs each drive in a fresh PTY or tmux session.
- **Doctor.** One read-only check verifying that the process is healthy, runs the expected revision, owns the target port, and points at the disposable data directory.
- **Drive.** Real commands and stable handles from this repository (ARIA roles, accessible names, `data-*` markers, CLI flags, or routes). Avoid raw coordinates and tab counts.
- **Evidence.** Proof standards requiring the real user entry point, action plus resulting state, a read-only second view of mutated state, and empirical verification of what any `--dry-run` mode actually touches.
- **Cleanup.** Teardown by exact PID or session name started by this run. Never run broad `pkill` by binary name, and never delete captured proof artifacts during cleanup.
- **Helpers.** Every shipped helper script must have `chmod +x` and show its exact CLI invocation in `SKILL.md`.

Seed `.agents/skills/verify-<app>/features/README.md` plus 3 to 5 core user-facing feature files following [`references/feature-map-example/`](references/feature-map-example/README.md). Every feature file uses the exact four H2 sections (`Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, and `Gotchas`). Never weaken a journey when seed data lacks a precondition. Record the failure and document the precondition under `Gotchas`.

### Prove behavioral generation

`ro-verify` runs the generated skill end to end once. It launches the app on an ephemeral port and `/tmp` data dir, runs `doctor`, drives one mapped feature, captures proof artifacts in `/tmp`, runs `cleanup`, and confirms both that proof artifacts still exist on disk and that zero child processes remain. If proved in a local stand-in for a remote target, list every unverified target-specific setup step in the handoff.

## 2. Formal Creation (`--formal`)

### Choose the strongest invariant and fitting tool

`ro-invariants` scans the codebase (starting at any user-named module) for promises where a violation harms users and conventional tests rarely hit the interleaving or input edge case, such as concurrency, retries, leases, state machines, parsers, or unsafe blocks. Pick the highest-value promise rather than the easiest target.

Match the question to the lowest-cost verifier that developers in this repo can install and run in seconds.

- **Event-ordering and protocol races.** Model-check a small faithful state model in TLA+ (TLC) and pair result inspection with [`statechart`](../statechart/SKILL.md) by passing `<plugin-root>/skills/statechart/SKILL.md` in `ro-invariants`, `impl-verify`, and `ro-verify` briefs.
- **Code-level invariants across inputs.** Use a language-native SMT or bounded verifier when available. When none exists for the language, run property-based testing with generated inputs against the real production functions, never against a hand-transcribed toy copy.
- **Unbounded structural properties.** Use a proof assistant when finite bounds cannot establish the guarantee.

### Author and mutation-test the formal skill

`impl-verify` writes `.agents/skills/verify-<area>-formal/SKILL.md` with YAML frontmatter and real repository paths, commands, and symbol names.

- **True to code.** Every model action or harness step maps to one indivisible step in production source that a reviewer can open.
- **Readable without formalism.** State the invariant and the user-visible harm in one plain sentence each. Express counterexamples as ordered steps in the repository's own domain words.
- **Explicit scope and sync anchor.** Record exact bounds, assumptions, unmodeled behavior, covered file and function paths, and `sync_commit: <HEAD_SHA>`. Instruct future agents to advance `sync_commit` only after confirming the model matches code at the new SHA.
- **Statechart integration.** When the check uses TLA+, pass the resolved `<plugin-root>/skills/statechart/SKILL.md` path in `impl-verify` and `ro-verify` briefs rather than telling workers to invoke `/statechart` by name. Inside the generated `.agents/skills/verify-<area>-formal/SKILL.md`, instruct future coordinators and workers to read the resolved `statechart/SKILL.md` path (for example `~/.gemini/config/plugins/agy-pstack-next/skills/statechart/SKILL.md` when installed as a plugin, passing that resolved `SKILL.md` path in any swarm worker brief) and run `<statechart-skill-dir>/scripts/statechart` rather than assuming `/statechart` is mounted by name in worker `<skills>`.
- **Proven able to fail.** A check that has never failed proves nothing. Inside `impl-verify`'s isolated `share` worktree, apply a temporary scratch mutation to production code (such as dropping a lock check or reordering two writes), run the generated check to confirm it catches the bug, and revert the product-code mutation before committing only `.agents/skills/verify-<area>-formal/`.

If the current `HEAD` code already violates the invariant, keep the invariant intact, do not touch product code unless asked, and report the counterexample trace as a finding. `ro-verify` independently reruns the one-command check and verifies a scratch break before coordinator lands the skill.

## 3. Upkeep Loop (`--maintain`)

Edit only the target verification skill directory during `--maintain`. Never edit product code to mask a broken feature or violated invariant. If no verification skill exists yet, stop and run creation mode instead.

### Behavioral `--maintain`

1. **Index check.** Audit `features/README.md` against `features/*.md` to fix dead, duplicate, or missing links and sweep recent git churn for unmapped user-facing surfaces backed by concrete source paths.
2. **Parallel source wave.** Spawn `ro-map-*` workers across feature files. Each worker traces current source entry points, flags doc or selector drift with `file:line` citations, and posts one minimal live verification recipe (`#seq`).
3. **Drift patch (`impl-verify`).** Apply confirmed map or helper fixes inside `.agents/skills/verify-<app>/` in a `share` worktree.
4. **Live verification pass (`ro-verify`).** Required even when source looks clean. Drive every mapped feature while holding three strict invariants throughout the pass.
   - Run `doctor` before the first drive, on every fresh session, and after any failed or surprising step. Reset wedged state or relaunch before continuing.
   - Confirm captured proof artifacts survive on disk after every cleanup step.
   - Leave zero orphan processes, ports, or tmux sessions behind any failed or completed iteration.
5. **Triage and outcome.** Fix `doc drift` and `harness gaps` inside the skill and re-drive every harness edit live before finishing. Mark `verified-unreachable` paths only with the exact unmet prerequisite and attempted command. Report broken app behavior as a `product regression` without weakening the map. Declare one outcome (`clean`, `changed`, or `blocked`).

### Formal `--maintain` (`--maintain --formal`)

1. **Baseline run and diff audit.** `ro-audit` runs each formal check as-is first (noting that a pass on a stale model proves nothing) and diffs every covered file from `sync_commit` to `HEAD`, tracking renamed or split functions and new functions mutating guarded state. Classify each diff hunk into one of four buckets.
   - `no effect` when only formatting, comments, or uncovered paths changed.
   - `verification drift` when an atomic code step split, a branch moved, or a value range changed.
   - `promise changed on purpose` only when commit messages, docs, or tests explicitly document the new contract (cite the evidence).
   - `promise may be broken` when code changed without evidence of a contract change.
2. **Code-first update (`impl-verify`).** Update models or harnesses strictly from current source structure before rerunning, never by tuning assertions until TLC or the runner turns green. Update a property only when the promise changed on purpose, recording old wording, new wording, and cited evidence.
3. **Failure-sensitivity and counterexample replay (`ro-verify`).**
   - On **pass**, break the updated code along the guarded failure mode in a scratch check to prove the updated verification still fails when it should, then revert the scratch break.
   - On **fail**, replay every counterexample step against real code. Impossible steps indicate `verification drift` for `impl-verify` to fix. Feasible steps prove a real `bug`. Report the introducing commit SHA, plain-language step trace, user harm, and optional standalone repro output without committing product edits.
4. **Sync commit and report.** Advance `sync_commit` to `HEAD` only for checks that pass or have confirmed current models, never for `blocked` checks. Report one outcome per check (`in sync`, `updated`, `bug`, or `blocked`), listing commits audited, model changes, failure-sensitivity proof, real bugs vs stale-model passes, and uncovered paths.
