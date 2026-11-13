# Linear and issue trackers

## What this source contains

Issue trackers hold the product, customer, and compliance forcing functions behind engineering work:

- Issues and bug reports stating external customer or business requirements.
- Project documents and attached PRDs or specs.
- Parent initiatives and sub-issue hierarchies where parent issues hold the motivation and sub-issues hold tactical steps.
- Issue comments recording mid-flight scope changes and rejected approaches.
- Labels (`customer-request`, `compliance`, `incident-followup`, `perf`) and milestone deadlines.

## How to search it

Use read-only Linear MCP tools (or the workspace's equivalent tracker MCP):

1. **Fetch linked ticket IDs first.** Pull every ticket ID (`ENG-1234`, `BUG-567`) surfaced in commit trailers, PR descriptions, or `#seq` board clues using `get_issue`, including all comments.
2. **Search by keyword and symbol.** Run `list_issues` across multiple phrasings of the feature name, domain concept, and error text.
3. **Climb parent chains.** Whenever a match is a sub-issue, fetch its parent issue and owning project (`get_project`) because high-level rationale usually sits on the parent.
4. **Follow duplicate chains.** Trace `duplicate-of` links back to the original report.

## Common pitfalls

- **Scope drift.** Tickets reopened or repurposed mid-sprint may describe an earlier plan. Cross-check issue comment timestamps against the PR merge date.
- **Template filler.** Generic phrases such as "improve reliability" do not explain a specific design choice. Keep digging in comments or parent initiatives.
- **Restricted teams.** Record inaccessible private team issues as an explicit `[Unknown]` gap rather than guessing.

## What to report

Report each relevant ticket ID, title, URL, author, created and closed timestamps, parent initiative, labels, and verbatim quotes of the motivating problem statement.
