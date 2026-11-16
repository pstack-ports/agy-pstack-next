---
name: verify-gen
description: >-
  Create or maintain project-local behavioral E2E verification skills
  (.agents/skills/verify-<app>/) and formal invariant skills
  (.agents/skills/verify-<area>-formal/). Supports behavioral generation,
  --formal (TLA+, PBT, SMT), and --maintain drift upkeep. Use for
  /agy-pstack-next:verify-gen, /verify-gen, or building repo verification suites.
---

# Generate & Maintain Repo Verification Skills

Build and maintain self-contained, project-local verification skills under `.agents/skills/verify-<target>/` so future agents can prove behavior cold without human hand-holding.

Load built-in `swarm` before fanning out workers, and read [`references/harness-and-map.md`](references/harness-and-map.md) for parallel isolation rules and the `features/*.md` schema.

## Swarm Pipeline

1. **Read-only mappers (`workspace: "inherit"`):** Inspect startup commands, readiness signals, existing Playwright/Cypress/PTY/HTTP harnesses, invariants, or git diffs since `sync_commit`. Ask the user only what repository code cannot reveal.
2. **Skill author (`verify-author`, `workspace: "share"`):** Edit only `.agents/skills/verify-<target>/` inside its isolated worktree (unless asked to fix a broken repo startup first), commit locally, and post `[done] <sha> <cwd>`.
3. **Cold live verifier (`verifier`, `workspace: "share"` when running `--formal` scratch breaks, or `"inherit"` for `/tmp`-isolated behavioral drives):** Execute the generated skill cold end to end.
4. **Land & retire:** Coordinator audits `git -C <author_cwd> show --stat <sha>`, fetches and merges the verified commit (`git fetch <author_cwd> <sha> && git merge --no-edit FETCH_HEAD`), and kills all task workers (never merging scratch mutations from `verifier`).

## 1. Behavioral Create (Default: `.agents/skills/verify-<app>/`)

1. **Interview the repo across five axes:** **Surface** (web/Electron/CLI/TUI/API), **Run** (dev start command, migrations, seed data, usable readiness signal), **Drive** (existing harness first, else browser/CDP or tmux/PTY per [`references/harness-and-map.md`](references/harness-and-map.md)), **Observe** (ARIA snapshots, screenshots, stdout/exit codes, DB/file second views), and **Isolate** (`--port 0`, `/tmp/verify-<app>-$RUN_ID`, isolated `--user-data-dir` / tmux sockets; document explicit lock rules if parallel instances are impossible).
2. **Write `.agents/skills/verify-<app>/SKILL.md`** with YAML frontmatter (`name: verify-<app>`, concrete `description`) and **six required sections** with zero placeholders:
   - **`Launch`:** Startup from an empty disposable data dir, isolation env vars, readiness check, and teardown.
   - **`Doctor`:** Single read-only check confirming process health, expected revision, owned port, and disposable data path.
   - **`Drive`:** Real commands and stable handles (ARIA roles/names, `data-*`, routes, CLI flags—never coordinates).
   - **`Evidence`:** Real user entry point, action + resulting state, read-only second view of mutated state, and empirical check of any `--dry-run` mode.
   - **`Cleanup`:** Exact PID / session teardown started by this run (never broad `pkill`), keeping proof artifacts intact on disk.
   - **`Helpers`:** Every shipped script inside the skill folder must be `chmod +x` with its exact invocation shown.
3. **Seed `features/README.md` + 3 to 5 `features/<slug>.md` files** using the exact four-H2 contract in [`references/harness-and-map.md`](references/harness-and-map.md).
4. **Prove cold:** `verifier` launches on an ephemeral port and `/tmp` dir, runs `Doctor`, drives a mapped feature, runs `Cleanup`, and confirms proof files survive and zero child processes remain.

## 2. Formal Create (`--formal`: `.agents/skills/verify-<area>-formal/`)

1. **Pick the highest-consequence promise** (concurrency, retries, leases, state machines, parsers) and lowest-cost tool developers can run in seconds: TLA+ (TLC) paired with [`/statechart`](../statechart/SKILL.md) for event-ordering races, language-native SMT/bounded verifiers for input invariants, or property-based testing against real production functions (never a toy copy).
2. **Write `.agents/skills/verify-<area>-formal/SKILL.md`** with YAML frontmatter, plain-sentence invariant + user harm, indivisible source-step mapping, explicit bounds/assumptions, covered file/function paths, `sync_commit: <HEAD_SHA>`, and a reference to `/statechart` by name when TLA+ is used.
3. **Prove failure sensitivity:** Inside its isolated `share` worktree, `verify-author` (and then `verifier` independently in its own disposable `share` worktree) applies a temporary scratch break to guarded production code, confirms the formal check catches the bug, and reverts the product break so only `.agents/skills/verify-<area>-formal/` is committed. If `HEAD` already violates the invariant, keep the invariant intact and report the counterexample as a finding.

## 3. Upkeep (`--maintain`)

Edit only `.agents/skills/verify-<target>/`; never mask real product bugs by weakening the skill.

- **Behavioral `--maintain`:** Audit `features/README.md` and recent git churn across parallel `inherit` scouts, patch selector/doc drift in `verify-author` (`share`), and have `verifier` drive every mapped feature live (`Doctor` before drives and after errors, proof artifacts preserved, zero orphan processes). Report `clean`, `changed`, or `blocked`, surfacing app failures as `product regression`.
- **Formal `--maintain`:** Diff covered files from `sync_commit` to `HEAD` and classify each hunk as `no effect`, `verification drift`, `promise changed on purpose` (requires cited commit/doc evidence), or `promise may be broken`. Update the model from code structure (never by tuning assertions green), re-prove scratch-break failure sensitivity, replay any counterexample against real code to separate drift from real bugs, and advance `sync_commit` to `HEAD` only on verified checks.
