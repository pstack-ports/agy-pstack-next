---
name: reflect
description: >-
  Unifies session post-mortems (reflect), mid-session user correction and
  repeated-mistake elimination (correct), and prompt or rule tightening
  (sharpen). Mines transcript.jsonl and swarm board.jsonl across parallel
  ro-judgment, ro-tooling, and ro-divergent reviewers, then dispatches
  impl-sharpen (workspace: "share") to encode approved fixes structurally in
  architecture, types, linters, hooks/guard.mjs, tests, role capsules, or
  skills. Use for /reflect, "reflect on this session", "stop repeating this
  mistake", "correct", or "sharpen this prompt".
---

# Reflect

Turn session mistakes, operator corrections, and weak prompts into structural guardrails that prevent future agents from repeating the failure.

## Pick the workflow

Route by what the user asked:

1. **Session post-mortem (default `/reflect`).** Mine the active session's transcript and swarm board with three parallel `ro-*` lenses, synthesize durable fixes on the board, get user approval, and encode approved fixes with `impl-sharpen`.
2. **Repeated-mistake elimination (`/reflect --correct` or mid-session operator correction).** Scan recent commits, reverts, review threads, active transcripts, and repo instruction files for mistake classes (2+ occurrences or an explicit user correction) and eliminate each class at the highest structural rung that works.
3. **Prompt or specification tightening (`/reflect --sharpen <draft>`).** Make a draft prompt, swarm brief, or skill deeper rather than longer before running it, leaving genuine user policy choices open.

Skip `/reflect` when a session was trivial or already worked cleanly under existing rules. One-off typos are not durable learnings.

---

## Mode 1 and Mode 2. Post-mortem and structural correction

### Step 1. Locate session and repository evidence

Gather exact workspace-scoped paths before spawning reviewers (never glob unrelated projects):

- **Active transcript.** `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (read specific lines in `transcript_full.jsonl` only when `truncated_fields` is set).
- **Swarm board and roster.** `<appDataDir>/brain/<conversation-id>/.system_generated/swarm/board.jsonl` and `members.json` (plus worker transcripts referenced by `conversation_id` inside `members.json` when worker-internal friction occurred).
- **Repository correction history (for `--correct`).** Recent `git log -n 30`, revert commits, PR review comments, `AGENTS.md` / `GEMINI.md`, `hooks/guard.mjs`, and `roles/*.md`.

### Step 2. Fan out `ro-judgment`, `ro-tooling`, and `ro-divergent`

Spawn three parallel read-only reviewers (`workspace: "inherit"`, enforced read-only by `hooks/guard.mjs` with full read-only MCP access for referenced tickets, chat threads, and traces), using the `ro-*` model in `~/.gemini/config/rules/pstack-models.md` (or `inherit`). Because workers do not mount installed plugin skills in `<skills>`, pass explicit resolved reference paths in each reviewer's brief rather than bare relative paths or plugin skill names, plus `<plugin-root>/roles/research.md` when global `~/.gemini/config/hooks.json` is not active:

- **`ro-judgment`** reads `<plugin-root>/skills/reflect/references/judgment-reviewer.md` ([`references/judgment-reviewer.md`](references/judgment-reviewer.md)) to extract generalizable engineering decisions, operator corrections, and swarm coordination mistakes on `board.jsonl` (overlapping file ownership, noisy `@mention` wakeups, killing `share` workers before merging, missed warm `fork`).
- **`ro-tooling`** reads `<plugin-root>/skills/reflect/references/tooling-reviewer.md` ([`references/tooling-reviewer.md`](references/tooling-reviewer.md)) to extract CLI flags, test and build quirks, port or worktree isolation traps, and agent self-sufficiency gaps where the human pasted context an agent should have fetched via MCP or CLI.
- **`ro-divergent`** reads `<plugin-root>/skills/reflect/references/divergent-reviewer.md` ([`references/divergent-reviewer.md`](references/divergent-reviewer.md)) to uncover second-order blind spots, lucky passes, skipped verification, architectural smells, and missed skill triggers (`tune description: <skill path>`).

Each `ro-*` reviewer posts its numbered findings to the board (`#seq`) and parks in `waiting`.

### Step 3. Synthesize and rank by the structural enforcement ladder

The coordinator synthesizes `#seq` findings from all three reviewers directly without spawning a separate prose synthesizer. Filter every candidate finding against six gates:

1. **Durability.** Still true in six months after SHAs, line numbers, and temporary branches change.
2. **Specificity.** Concrete enough to change an agent's next action. Reject vague platitudes ("be careful with types") and ephemeral trivia.
3. **Convergence.** Findings surfaced independently by 2+ reviewers or across 2+ past commits carry high confidence; singletons must clear a high bar.
4. **Scope discipline.** Route skill edits only to skills, hooks, or role capsules used in the session, or route missed triggers as `tune description: <skill path>`.
5. **Already-covered check.** Read the target file before proposing prose. If clear guidance already exists there and an agent ignored it, prose failed. Escalate up the structural ladder instead of duplicating the sentence.
6. **Structural enforcement ladder (highest rung wins).** Always enforce at the highest rung that works, because prose rules fail silently when an agent skips reading them:
   - **Rung 1. Architecture.** Give each state one owner and each task one supported path. Hide private internals so bad imports fail compilation. Derive lists from one canonical source and delete dead legacy APIs agents might copy.
   - **Rung 2. Types, linters, and runtime hooks.** Make invalid states unrepresentable in types, add a lint or CI check whose error message names the replacement API, or enforce tool boundaries in `hooks/guard.mjs`.
   - **Rung 3. Behavioral regression tests.** Add or repair a test that fails on the real mistake and survives internal refactors.
   - **Rung 4. Role capsules, skills, and repo rules.** Edit `roles/*.md`, `skills/*/SKILL.md`, or `AGENTS.md` last, strictly for judgment calls no compiler, linter, or hook can check. When updating repo instruction files under `--correct`, maintain a compact rule table pairing each rule with the check or hook that enforces it, and delete prose rules once architecture makes the mistake impossible.

### Step 4. Present Accepted, Rejected, and Backlog for approval

Present a crisp synthesis before changing shared skills, role capsules, or hooks:

- **Accepted table.** Columns for `Problem`, `Rung (Architecture / Hook-Lint-Type / Test / Skill-Role)`, `Proposal`, and `Target path`.
- **Rejected list.** One line per dropped finding naming the gate it failed (`durability`, `specificity`, `skill-not-used`, `already-covered`, `duplicate`).
- **Backlog.** Larger devex items suited for an issue tracker rather than immediate session edits.

Wait for explicit user approval when modifying skills, role capsules, or global rules (unless running an explicit mid-session `--correct` code/test fix requested by the user). Never edit installed plugin cache files under `~/.gemini/config/plugins/` directly. When customizing an installed plugin skill outside the plugin repository itself, copy the skill into `.agents/skills/<skill>/` or `~/.gemini/config/skills/<skill>/` and edit that override copy.

### Step 5. Encode and prove with `impl-sharpen` (`workspace: "share"`)

Once approved, retire `ro-judgment`, `ro-tooling`, and `ro-divergent` with `swarm{action: "kill"}` and spawn `impl-sharpen` (`workspace: "share"`):

1. Pass explicit resolved paths such as `<plugin-root>/skills/technical-writing/SKILL.md` (and `<plugin-root>/roles/poteto-agent.md` when global `hooks.json` is not active) in `impl-sharpen`'s brief rather than telling it to invoke plugin skills by name. `impl-sharpen` implements the approved architectural refactors, type or lint rules, `hooks/guard.mjs` + `hooks/guard.test.mjs` guards, `roles/*.md` capsule updates, or `SKILL.md` improvements (following Antigravity's built-in `agy-customizations` skill for frontmatter and structure).
2. **Prove every check catches the real mistake.** Run the new lint, typecheck, `node --test hooks/guard.test.mjs`, or `agy plugin validate --strict` against the past failure shape to confirm it fails when broken and passes when fixed.
3. Fetch and merge `impl-sharpen`'s clean commit into the coordinator workspace (`git fetch <sharpen_cwd> <sha> && git merge --no-edit FETCH_HEAD`) before calling `swarm{action: "kill", name: "impl-sharpen"}` (leaving `monitor` and `narrator` alive unless asked). Never `git push` unless the user asks.

---

## Mode 3. Prompt and brief sharpening (`--sharpen`)

When the user invokes `/reflect --sharpen <draft prompt or brief>` before starting a task, make the ask **deeper rather than bigger** and return the rewritten prompt without executing the task itself:

1. **Expert gap.** State in 2 to 3 bullets what a top domain specialist would verify or control here that the draft leaves unstated.
2. **Primary raw material.** Name the rawest ground-truth artifacts to inspect directly (`transcript.jsonl`, `board.jsonl`, wire traces, `git log -S`, flamegraphs, DB query plans) instead of pre-digested summaries.
3. **Concrete methods and harnesses.** Name the exact verification mechanisms (`/crucible` `full`, `/interrogate`, `/control-ui`, `/statechart`, property tests, noise-locked benchmarks) suited to the problem.
4. **External falsifiable check.** Define what independent command, measurement, or invariant outside agent prose proves the output is right.
5. **Rewritten prompt.** Output a tight, copyable prompt incorporating those four upgrades while leaving genuine product or policy choices open for the user to decide.
