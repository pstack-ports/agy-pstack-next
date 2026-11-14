---
name: ketchup
description: >-
  Unifies live chat and swarm catch-up briefings (standard), zero-jargon
  plain-language restatements (--plain), subtitled slide walkthrough videos
  (--video), and cross-session transcript and swarm recall (--recall). Parallel
  read-only ro-* gatherers inspect board.jsonl #seq deltas, members.json,
  optional narrator swarm_view/view.json, prior swarm boards, git log, and gh pr
  state. Use for /agy-pstack-next:ketchup, /ketchup, "catch me up",
  "ketchup --plain", "explain that in plain words", "ketchup --video", "recall
  my work on X", or "where did I leave off".
---

# Ketchup

Catch the human up on what changed, what stands in flight across transcripts, swarms, branches, and pull requests, and what decisions genuinely wait on them.

## Route by mode

Pick the output mode from flags or phrasing:

1. **Standard catch-up (default `/ketchup`).** Summarizes everything that happened in this conversation and its active swarm since the last message the human wrote (timer wakeups, background tasks, and swarm board posts are not human messages). Uses plain human speech, compact visuals, and self-contained **Action items**.
2. **Zero-jargon restatement (`/ketchup --plain` or "restate that in plain English").** Restates the previous technical reply (or current catch-up) in everyday conversational speech with zero jargon, acronyms, file paths, or commit hashes. Runs inline with no swarm fan-out when restating a single message.
3. **Subtitled slide video (`/ketchup --video`).** Renders what changed since the human's last message as a short silent landscape MP4 slide walkthrough above the remaining autonomous work line and text **Action items**.
4. **Cross-session and shared-record recall (`/ketchup --recall [topic]` or "what have I been working on / where did I leave off").** Reconstructs working state across recent workspace transcripts, prior swarm boards, git branches, PRs, and team trackers into a tight resume capsule.

Keep the repository completely read-only in every mode. Rendering the MP4 into `<appDataDir>/brain/<conversation-id>/` (or `/tmp`) during `--video` is the sole artifact-write exception.

---

## Gather ground truth with parallel `ro-*` scouts

Never trust stale prose in chat when live state can be checked. For small single-turn catch-ups, inspect directly. Whenever a swarm ran, multiple PRs or branches moved, or `--recall` spans prior sessions, spawn parallel read-only `ro-*` gatherers (`workspace: "inherit"`, enforced read-only by `hooks/guard.mjs`) using the `ro-*` model from `~/.gemini/config/rules/pstack-models.md` (or `inherit`):

- **`ro-swarm` (live swarm and board delta).** Inspects `<appDataDir>/brain/<conversation-id>/.system_generated/swarm/` (`members.json` roster states and worktree paths, `swarm.json`, and `board.jsonl` `#seq` deltas since the human's last message) alongside `swarm{action: "status"}`. When `members.json` records a `narrator` member (`members.narrator.conversation_id`), also reads `<appDataDir>/brain/<narrator-conversation-id>/swarm_view/view.json` if present. Because `swarm_narrator` is optional and absent in `agy` CLI sessions, `ketchup` falls back cleanly to `board.jsonl` and `members.json` whenever no `narrator` or `view.json` exists. Verifies claimed worker completions against real commits and test runs.
- **`ro-repo` (live git, PR, and CI state).** Runs `git status --short`, `git branch`, `git log`, and `gh pr list` / `gh pr view` / `gh pr checks` to confirm branch cleanliness, review threads, merge readiness, and exact numbers behind any metric before reporting it.
- **`ro-history` (cross-session transcripts, prior swarms, and shared record for `--recall`).** Orders `<appDataDir>/brain/*` directories strictly within the active workspace by real modification time (`ls -t`, default 7-day window unless another window is named). Filters matching topics first, reads `<appDataDir>/brain/<id>/.system_generated/logs/transcript.jsonl` (`transcript_full.jsonl` only on `truncated_fields` lines), prior `<appDataDir>/brain/<id>/.system_generated/swarm/` (`members.json` and `board.jsonl`), and `<appDataDir>/brain/<narrator-conversation-id>/swarm_view/view.json` when prior `members.json` includes a `narrator` entry, skipping unrelated workspaces or eval noise. When `--recall` names a feature, module, or bug, also queries issue trackers, docs, chat, and error telemetry per [`../understand/references/source-playbook.md`](../understand/references/source-playbook.md) to surface reverts and recurring user reports.

Retire all `ro-*` gatherers via `swarm{action: "kill"}` once their `#seq` reports arrive.

---

## Mode contracts

### 1. Standard catch-up (`/ketchup`)

Write in plain spoken English like one teammate catching up another. Say "the tests pass", not "CI is green". Omit commit SHAs, file paths, CLI commands, and internal worker roster names (`impl-2`, `ro-verify`) unless the human needs one to decide. Refer to PRs, branches, and features by names the human recognizes.

#### Structure and word discipline

1. **Opening line.** One short sentence naming what waits on the human right now, or stating that nothing waits on them. If nothing changed and nothing waits, say so in one sentence and stop.
2. **Visuals first, then tight summary (under 100 words excluding visuals and action items).**
   - Embed real screenshots and recordings captured during the work inline. Mark any visible UI change lacking a capture with `No screenshot yet` and state plainly what changed on screen.
   - Draw a small Mermaid diagram (`<=6` boxes, `<=8` words per box, conversational labels rather than `Status: pass` tags) or `xychart-beta` chart when connections, PR stacks, or measured numbers read faster visually than in prose. Markdown tables are not visuals. Never draw an uncaptured screen, invent a number, or repeat a fact across visuals and bullets.
   - Give one short spoken-style bullet per thing the human asked for ("Checkout was timing out from an unindexed lookup and is fixed now"), naming whether it is done, running, failed, or unchecked, plus any bug caught and fixed along the way. Never mark an item done while a human decision still blocks it.
   - Add one line naming any remaining work the coordinator or swarm can finish autonomously without human input.
3. **Action items (~30 words per item, never truncate or replace items with a count).**
   - An action item is **strictly** a decision or step only the human can take (product tradeoff, approval checkpoint, permission to push or merge, missing credential). Work you can finish yourself is never an action item.
   - For a single-item call, write one bullet containing the call (`Approve`, `Merge`, `Pick`), your recommended pick, the PR or branch name and link, what changes for users, the evidence behind your pick, and the concrete risk (even when low, such as "Low risk, only button spacing changes").
   - When several items share one call (such as three PRs ready to merge), state the call and overall recommendation once, then list each item riskiest-first with its name and link, user impact, evidence, and risk.
   - For a choice between options, state every option weighed, what each gains and costs the user, and your recommendation without adding a duplicate risk line.

### 2. Zero-jargon restatement (`/ketchup --plain`)

Restate the preceding message (or active catch-up) in clear, everyday human language with zero engineering jargon:

- Replace internal mechanics, type names, protocol acronyms, and tool names with what actually happens and why it matters.
- Keep sentences short, direct, and concrete. If a technical detail needs two paragraphs of backstory and changes no human decision, drop it.

### 3. Subtitled slide walkthrough (`/ketchup --video`)

Follow all gathering and action-item rules of Standard catch-up, replacing the summary prose and static diagrams with one rendered silent landscape MP4 (`<=10` slides, fewer when possible):

1. **Progressive slide design.** Plan one core takeaway and one visual point per slide from real screenshots, diffs, and verified numbers. Mutate one visual canvas progressively across slides using consistent colors, arrows, and highlights rather than cutting between unrelated layouts. Never render bullet lists, status tables, or disconnected boxes as slides.
2. **Dedicated subtitle strip.** Place one conversational subtitle (`~10` words) in a fixed-height empty strip below the slide frame so subtitles never cover visual content. State what the picture means rather than reading out box labels.
3. **Hold timing and verification.** Burn subtitles directly into slide frames (never screen-record). Hold each slide fully visible (excluding transition motion) for at least **1 second per 3 newly added words** (counting the subtitle plus new or changed slide labels, while words inside embedded screenshots do not count). Before embedding, inspect one rendered frame per slide at chat size to verify subtitle legibility and measure frame holds directly, re-rendering any slide that clips or flashes too fast.
4. **Reply layout.** Output the one-sentence opening line, the inline MP4 artifact, one line of remaining autonomous work, and the text **Action items** (matching option names shown in the video). If rendering fails, state that in one line and deliver the text Action items cleanly.

### 4. Cross-session recall (`/ketchup --recall`)

State the locked search window and active workspace scope upfront (never silently shrink "all" to "last 7 days" without saying so). Synthesize `ro-history` and `ro-repo` findings into four tight sections:

- **Capsule.** At most 5 bullets stating what this body of work is and where it stands today.
- **Threads.** One line per workstream prefixed with one ground-truth tag verified via `git` and `gh` (`[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or `[planned, not started]`), citing conversation UUIDs and PR or ticket IDs.
- **Problems.** At most 5 recurring obstacles, production symptoms users still report, or prior fixes that shipped and were reverted so the next run does not repeat a failed approach.
- **Next move.** One concrete, highest-leverage action to run next.
