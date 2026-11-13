# Slack and team chat

## What this source contains

Team chat captures real-time engineering deliberation, review tradeoffs, and incident triage that never made it into a formal doc or ticket.

## How to search it

Inspect the active Slack (or Teams/Discord) MCP tool schema first. If authentication is missing or denied, stop immediately and record chat as an unavailable `[Unknown]` gap.

1. **Author-and-date bounded queries.** Search messages by the commit author within a narrow window around the PR merge date surfaced by `@ro-git`.
2. **PR and ticket link searches.** Search `/pull/<number>` and linked ticket IDs (`ENG-1234`) to locate review discussions and deploy coordination threads.
3. **Error literal and incident searches.** Search exact exception messages or `#sev-*` / `#inc-*` channels when target code is defensive.
4. **Always fetch full threads.** Single chat messages lose meaning outside their thread replies. Read the entire thread before quoting.

## Common pitfalls

- **Retention cliffs and private channels.** Workspace retention policies and unindexed DMs hide older or private conversations. Report retention cutoffs explicitly.
- **Casual banter vs real decisions.** Offhand jokes are not design rationale. Look for substantive technical agreement tied to the shipped diff.

## What to report

Report channel names, message timestamps, permalinks, speakers, and verbatim quotes from the thread alongside any cross-links to docs or tickets for peer `ro-*` scouts.
