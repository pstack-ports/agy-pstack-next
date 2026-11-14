---
name: understand
description: >-
  Unifies runtime mechanism walkthroughs (how), historical provenance and
  multi-source code archaeology (why), and interactive Socratic explanations
  (teach) over a parallel read-only ro-* clue-sharing swarm mesh, with warm fork
  handoff into implementation. Use for /understand, "how does X work", "where
  should this live", "why is X shaped this way", "where did this number come
  from", or "teach me X".
---

# Understand

Build an accurate model of what code does, why it is shaped that way, and how to reason about changing it.

## Pick the mode

Choose the mode from the user's question, or blend Modes A and B when both runtime flow and historical rationale matter:

1. **Mode A. Mechanism walkthrough (`how`).** Answers how a subsystem executes today, how data moves across boundaries, or which module should own new behavior.
2. **Mode B. Historical provenance and archaeology (`why`).** Answers why code, a guard, or a constant exists by cross-searching git, PRs, tickets, docs, chat, telemetry, and warehouse tables under [`references/epistemics.md`](references/epistemics.md).
3. **Mode C. Interactive Socratic walkthrough (`teach`).** Explains both mechanism and motivation in plain spoken English, chunked at the reader's pace with progressive diagrams and light mental-model checks.

For a narrow single-file or single-function question where git history and local code hold the whole answer, inspect directly or spawn one `ro-code` worker. For multi-file subsystems, cross-service flows, or historical `why` sweeps, launch the parallel `ro-*` clue-sharing mesh.

---

## Parallel `ro-*` clue-sharing mesh

### 1. Anchor the target first

Gather a compact seed anchor in 1 or 2 fast read-only commands before fanning out:

- Target files, line ranges, and primary symbols.
- Recent commits and merge PR numbers (`git log --follow --oneline -20 -- <file>`, `git blame -L <start>,<end> <file>`).
- Available MCP servers from `<mcp_servers>` mapped against [`references/source-playbook.md`](references/source-playbook.md).

### 2. Spawn the `ro-*` mesh (`workspace: "inherit"`)

Spawn parallel read-only workers via `swarm{action: "add", workspace: "inherit"}` using the `ro-*` model from `~/.gemini/config/rules/pstack-models.md` (default omit `model` for `inherit`). Because workers do not mount installed plugin skills in `<skills>`, pass explicit resolved paths such as `<plugin-root>/skills/understand/references/source-playbook.md`, `<plugin-root>/skills/understand/references/epistemics.md`, and relevant `<plugin-root>/skills/understand/references/sources/*.md` files in `ro-*` briefs for `read_file` rather than telling workers to invoke plugin skills by name. When global `~/.gemini/config/hooks.json` is active, `hooks/guard.mjs` injects `roles/research.md` and enforces read-only file, command, and MCP access automatically. When global `hooks.json` is not active, also pass `<plugin-root>/roles/research.md` in each `ro-*` brief.

Size the roster to the mode and available MCPs:

- **`ro-code`** traces execution paths, domain types, callers, module boundaries, and test assertions.
- **`ro-git`** runs `git log --follow`, `-S` and `-G` pickaxe searches, `git blame`, `git show`, and `gh pr view <num> --json title,body,author,createdAt,mergedAt,comments,reviews`.
- **`ro-tracker`** searches issue trackers (Linear, Jira, GitHub Issues) alongside runtime observability and error trackers (Sentry, Datadog) when available.
- **`ro-docs`** searches long-form design docs (Notion, Roam, Confluence, in-repo ADRs), team chat (Slack), and product analytics warehouses (Databricks, Snowflake, BigQuery) when available.

### 3. No single-MCP locks and live `#seq` clue pivoting

Every `ro-*` worker has unrestricted read-only access across code, git, GitHub PRs, Linear, Roam, Notion, Slack, Sentry, Datadog, and SQL warehouses simultaneously. Do not lock a worker inside one silo when following a hot lead saves a round-trip.

Instruct every `ro-*` worker to post high-signal clues immediately to the board before writing its final report:

- When `ro-git` uncovers PR `#482` referencing ticket `ENG-910` and incident channel `#sev-checkout`, it posts a one-line clue and rings `@ro-tracker @ro-docs`.
- Peers wake on the `@mention`, read the `#seq` clue, pivot their queries to those exact IDs and timestamps, and cite `#seq` in their findings rather than duplicating searches.
- When target code contains defensive guards (retries, timeouts, null checks, clamps, feature flags, rate limits), pass `<plugin-root>/skills/understand/references/sources/incident-postmortem.md` ([`references/sources/incident-postmortem.md`](references/sources/incident-postmortem.md)) in `ro-*` briefs so every scout checks incident history.

---

## Mode contracts

### Mode A. Mechanism walkthrough (`how`)

Reconcile overlaps across `ro-*` reports by checking the code directly. Deliver an onboarding-grade architectural explanation using only the sections that earn their keep:

- **Overview.** One or two short paragraphs naming what the subsystem is and what problem it solves.
- **Key concepts.** The core domain types, state holders, and boundaries needed to follow the flow.
- **How it works.** Step-by-step control and data flow naming real functions and `file:line` locations (`UserService.refresh()` calls `TokenStore.rotate()` in `src/auth/store.ts:84`). Include a Mermaid flowchart or sequence diagram when three or more components interact.
- **Where things live.** Focused directory and file map for a contributor about to edit this area, including where new logic belongs and why.
- **Gotchas and open gaps.** Surprising invariants, subtle ordering rules, or anything the mesh could not confirm.

### Mode B. Historical provenance and archaeology (`why`)

Follow [`references/epistemics.md`](references/epistemics.md) strictly. Mechanics in code never prove author intent. Separate what the record explicitly states from what you infer, surface contradictions without picking a tidy winner, and treat user hypotheses as candidates to test rather than conclusions to confirm.

Structure the output with strict confidence tags:

- **The question and code anchor.** Restate the question and list target `file:line` ranges and symbols.
- **What we found.** Explicit textual citations tagged `[Direct]` (single explicit author statement) or `[Supported]` (converging indirect evidence), citing exact PR numbers, commit SHAs, ticket IDs, doc URLs, chat permalinks, or telemetry queries.
- **What we can reasonably infer.** Hedged claims tagged `[Inferred]` (`appears to`, `likely`, `suggests`) with the reasoning chain stated explicitly.
- **Competing hypotheses.** Plausible alternatives tagged `[Speculative]` when thin evidence fits multiple explanations.
- **What we do not know.** Concrete `[Unknown]` gaps naming exact queries run, time windows checked, and unavailable MCP categories.
- **Sources consulted.** One line per evidence category from [`references/source-playbook.md`](references/source-playbook.md), including null results and skipped categories with reasons.
- **Confidence summary.** Two sentences calibrating overall certainty.
- **Change constraints (when preparing an edit).** Translate provenance into Preserve, Change, Avoid, and Risk rules for the upcoming diff.

### Mode C. Interactive Socratic walkthrough (`teach`)

Ground both mechanism and provenance with the `ro-*` mesh first, then teach in plain spoken English at the human's pace:

1. **Start small and concrete.** Open with a two-sentence plain definition of what the thing is and what happens when a real user or caller triggers it. Avoid meta labels ("key takeaway", "TL;DR", "here is the tricky part").
2. **Build diagrams progressively.** Never dump one dense diagram with every box at the end. When teaching a flow across three or more parts, draw a short sequence of small Mermaid diagrams where each step redraws the prior diagram and adds one new component or edge.
3. **Preserve epistemic honesty.** Reword freely for clarity, except keep Mode B's confidence hedges (`likely`, `appears to`, `no direct record`) intact because those hedges are factual findings.
4. **Chunk and check the mental model.** Stop after the core mental model lands (roughly 150 to 250 words) and offer two concrete directions or one brief Socratic check ("Want to trace what happens when the retry races a cancel, or inspect why the buffer cap is 64?") so the reader steers depth interactively. When invoked one-shot with no live back-and-forth, deliver the full progressive walkthrough cleanly and list the best follow-up threads at the end.

---

## Warm fork to action

When an `/understand` investigation leads into a bug fix, refactor, or feature implementation (either because the user says "now fix it" or inside `/pstack` `diagnose` and `build`), carry warm context straight into code without re-exploring cold:

1. Keep the `ro-*` scout holding the richest code trace (typically `ro-code`) in `waiting` (zero token cost while asleep) and retire the other finished `ro-*` scouts via `swarm{action: "kill"}`.
2. Branch an isolated author directly from that scout's conversation history:
   ```json
   {"action": "add", "name": "impl-fix", "workspace": "share", "fork": "ro-code", "brief": "Implement the fix in your share worktree, add a behavioral regression test, verify it passes, commit locally, and report your commit SHA and pwd."}
   ```
3. Because `impl-fix` uses the `impl-*` prefix, `hooks/guard.mjs` upgrades its injected role capsule to `roles/poteto-agent.md` on `PreInvocation` when global `hooks.json` is active (pass `<plugin-root>/roles/poteto-agent.md` and any needed `<plugin-root>/skills/<name>/SKILL.md` paths in `impl-fix`'s brief when global `hooks.json` is not active) and grants write confinement inside its `share` worktree while preserving every file read, blame trace, and `#seq` clue `ro-code` already gathered.
4. Once `impl-fix` finishes (or if no implementation follows), merge any verified work before calling `swarm{action: "kill"}` on `ro-code` and `impl-fix` (leaving `monitor` and `narrator` alive unless asked).
