# Sentry error history

## What this source contains

Sentry and sibling exception trackers preserve the exact production crashes, stack traces, breadcrumbs, and release regressions that motivated defensive guards or bug fixes.

## How to search it

Use read-only Sentry MCP tools:

1. **Identify organization and project slugs.** Run `find_organizations` and `find_projects` when slugs are not yet known.
2. **Query matching issues.** Run `search_issues` with exception class names, target function or module names, file paths, and guarded error strings.
3. **Correlate release and timeline.** Run `search_issue_events`, `get_issue_tag_values`, and `find_releases` around the commit timestamp posted by `@ro-git`. Check `firstSeen`, `lastSeen`, affected release versions, and whether event volume dropped after the PR shipped.
4. **Inspect full stack traces.** Run `get_sentry_resource` on top candidate issues to verify the stack trace actually passes through the target code path and matches the guarded condition.
5. **Treat automated root-cause guesses as hypotheses.** If an AI summary tool (`analyze_issue_with_seer`) exists, treat its output strictly as a candidate lead, never as `[Direct]` evidence. Primary stack traces and event tags remain authoritative.

## What to report

Report the issue ID, title, URL, project slug, `firstSeen` and `lastSeen` dates, event count, affected releases, alignment with PR merge dates, and a verbatim stack-trace excerpt through the target file.
