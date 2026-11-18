---
name: understand
description: >-
  Explain how a subsystem works today (how), trace why it is shaped that way
  across git, PRs, tickets, and docs under strict epistemic confidence tiers
  (why), or walk through it interactively (teach), with warm fork handoff into
  implementation. Use for /agy-pstack-next:understand, /understand, "how does X
  work", "why is X shaped this way", or "teach me X".
---

# Understand

Build an accurate mental model of what code does, why it looks that way, and what constraints govern changing it.

Load built-in `swarm` (and `swarm_pane` when present) when fanning out a multi-scout mesh, and anchor all git and code lookups to the active target project/worktree (`TARGET_CWD`, verified via `git -C <TARGET_CWD> rev-parse --show-toplevel` — linked git worktrees share commit history while holding independent `HEAD`s and working trees). For a single-file question answerable in 1 or 2 local reads, inspect directly without spawning a swarm.

## 1. Parallel Clue-Sharing Mesh (`workspace: "inherit"`)

1. **Seed anchor.** Run 1 to 2 quick read-only lookups (`git -C <TARGET_CWD> log --follow --oneline -20 -- <path>`, `git -C <TARGET_CWD> blame`) and check `<mcp_servers>` for issue trackers, docs, chat, or telemetry tools.
2. **Spawn scouts (`workspace: "inherit"`).** Leave `model` unset on `swarm{action: "add"}` so scouts inherit the user's chosen model (unless the user requested specific models):
   - **`code`:** Execution paths, domain types, callers, boundaries, and test assertions in `TARGET_CWD` (`file:line` anchors).
   - **`git`:** `git -C <TARGET_CWD> log --follow -p`, `-S`/`-G` pickaxe back past mechanical renames to the introducing commit SHA, and `gh pr view <n> --json title,body,comments,reviews`.
   - **`context` (when external MCPs exist):** Trackers (Linear/GitHub Issues), docs (Roam/Notion/ADRs), incidents, and telemetry.
3. **Live `#seq` pivoting.** Scouts never stay siloed: as soon as `git` uncovers PR `#482` or ticket `ENG-910`, it posts a one-line clue and `@mentions` peers so they pivot immediately without repeating searches.

## 2. Epistemic Rigor & Mode Contracts

Code shows what runs today, never author intent. Defeat **sycophancy** (treat prompt guesses as hypotheses to test) and **recency bias** (trace past formatting/refactor commits), and surface conflicting historical sources side by side rather than inventing a tidy narrative.

- **Mode A · Mechanism (`how`):** Overview (1–2 paragraphs), core domain types & state owners, step-by-step control/data flow with `file:line` anchors (plus a Mermaid diagram when 3+ components interact), where new changes belong, and non-obvious gotchas.
- **Mode B · Provenance (`why`):** Tag every historical or causal claim with one of five strict confidence tiers:
  - **`[Direct]`:** Explicit author statement in a commit, PR, review, ticket, or doc (cite verbatim anchor).
  - **`[Supported]`:** Multiple independent artifacts converging on one conclusion (cite each).
  - **`[Inferred]`:** Reasonable deduction without an explicit statement (use `"appears to"` / `"suggests"` + reasoning chain).
  - **`[Speculative]`:** Thin evidence fitting multiple competing explanations (list alternatives).
  - **`[Unknown]`:** Searched relevant sources and found no record (name exact queries and sources checked).
  When preceding a code edit, end with **Preserve / Change / Avoid / Risk** constraints.
- **Mode C · Socratic Walkthrough (`teach`):** Ground facts first, then explain in plain spoken English. Build Mermaid diagrams progressively (adding one piece per step), preserve `[Inferred]`/`[Unknown]` hedges honestly, and pause after ~200 words with two concrete directions so the reader steers depth interactively.

## 3. Warm `fork` Into Action

If the user follows up with `"now fix/implement it"` (or inside [`/pstack`](../pstack/SKILL.md)), keep the scout holding the richest code context (`code`) in `waiting`, kill redundant scouts, and branch the author warmly via `swarm{action: "add", name: "fix", workspace: "share", fork: "code", brief: "..."}` so zero exploration is repeated cold.
