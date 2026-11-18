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

Answer single-file questions resolvable in 1–2 quick read-only lookups inline. Otherwise follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md) to build a grounded model of `TARGET_CWD`.

## 1. Parallel Clue-Sharing Mesh (`workspace: "inherit"`)

1. **Spawn scouts (`workspace: "inherit"`):**
   - **`code`:** Execution paths, domain types, callers, boundaries, and test assertions in `TARGET_CWD` (`file:line` anchors).
   - **`git`:** `git -C <TARGET_CWD> log --follow -p`, `-S`/`-G` pickaxe past mechanical renames to the introducing commit SHA, and `gh pr view <n> --json title,body,comments,reviews`.
   - **`context` (when `<mcp_servers>` expose trackers/docs/telemetry):** Issues, ADRs/docs, incidents, and runtime signals.
2. **Live `#seq` pivoting.** When a scout uncovers a key PR, commit, or ticket, it posts a one-line clue and `@mentions` only the peer scout(s) who can pivot on it (citing `#seq`), tagging `@coordinator` with `[done]` once its angle is complete.

## 2. Epistemic Rigor & Mode Contracts

Code shows what runs today, never author intent. Defeat **sycophancy** (treat user guesses as hypotheses to test) and **recency bias** (trace past formatting/refactor commits), and surface conflicting historical sources side by side rather than inventing a tidy narrative.

- **Mode A · Mechanism (`how`):** Overview (1–2 paragraphs), core domain types & state owners, step-by-step control/data flow with `file:line` anchors (plus a Mermaid diagram when 3+ components interact), where changes belong, and non-obvious gotchas.
- **Mode B · Provenance (`why`):** Tag every historical or causal claim with one of five confidence tiers:
  - **`[Direct]`:** Explicit author statement in a commit, PR, review, ticket, or doc (cite verbatim anchor).
  - **`[Supported]`:** Multiple independent artifacts converging on one conclusion (cite each).
  - **`[Inferred]`:** Reasonable deduction without an explicit statement (`"appears to"` / `"suggests"` + reasoning chain).
  - **`[Speculative]`:** Thin evidence fitting competing explanations (list alternatives).
  - **`[Unknown]`:** Searched relevant sources and found no record (name exact queries and sources checked).
  When preceding an edit, close with **Preserve / Change / Avoid / Risk** constraints.
- **Mode C · Socratic Walkthrough (`teach`):** Ground facts first, then explain in plain spoken English. Build Mermaid diagrams progressively (one piece per step), keep `[Inferred]`/`[Unknown]` hedges honest, and pause after ~200 words with two concrete directions so the reader steers depth.

## 3. Warm `fork` Handoff or Clean Finish

When chained inside [`/pstack`](../pstack/SKILL.md) or when implementation follows, keep `code` in `waiting`, retire other scouts, and branch the author via `swarm{action: "add", name: "fix", workspace: "share", fork: "code", brief: "..."}`. When standalone `/understand` finishes, retire all task scouts per built-in `swarm` before replying.
