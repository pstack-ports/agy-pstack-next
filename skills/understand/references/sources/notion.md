# Notion, Roam, and long-form docs

## What this source contains

Long-form document stores and knowledge graphs hold pre-implementation thinking that rarely fits inside a commit message:

- Product requirement documents, RFCs, and technical specs.
- Architectural decision records and rejected-alternatives tables.
- Roam daily notes, backlinked concept pages, and engineering decision logs.
- Design review notes, incident postmortems, and operational runbooks.

## How to search it

Use read-only Notion, Roam, Confluence, or Google Docs MCP tools:

1. **Search across concepts, symbols, and authors.** Query feature names, domain types, error literals, PR author handles, and ticket IDs posted on the swarm board (`notion-search` or Roam graph/page search).
2. **Read full pages and block trees.** Fetch complete candidate pages (`notion-fetch` or Roam page/block fetch) rather than relying on short search snippets because trade-off sections sit mid-document.
3. **Traverse backlinks and child pages.** Follow linked sub-pages, backlinked Roam UIDs, and meeting-note databases around the commit date.

## Common pitfalls

- **Spec-to-code drift.** Design docs are frequently written before coding and left unedited when implementation pivots. Flag discrepancies between the doc and merged PR explicitly so both appear in the provenance report.
- **Multiple drafts.** Check last-updated dates and status headers to distinguish superseded drafts from approved specs.
- **Permission boundaries.** Record restricted pages as explicit `[Unknown]` coverage gaps.

## What to report

Report the document title, URL or page identifier, authors, last-updated date, draft vs final status, linked pages, and verbatim quotes from Motivation or Alternatives considered sections.
