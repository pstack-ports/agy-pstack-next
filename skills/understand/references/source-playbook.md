# Source playbooks

In `/understand`, parallel `ro-*` scouts (`ro-code`, `ro-git`, `ro-tracker`, `ro-docs`) search every available evidence category below and post `#seq` clues on the swarm board as soon as identifiers (commit SHAs, PR numbers, ticket IDs, incident dates, error strings, table names) appear. Unlike siloed single-tool runners, any `ro-*` scout may cross-query git, `gh`, Linear, Notion, Roam, Slack, Datadog, Sentry, or SQL warehouses directly whenever chasing a live clue is faster than handing it off.

| Evidence category | Playbook | Typical tools and MCPs |
|---|---|---|
| Source control and code archaeology | [`sources/code-archaeology.md`](./sources/code-archaeology.md) | `git`, `gh`, `rg`, repository tests and ADRs |
| Issue and project trackers | [`sources/linear.md`](./sources/linear.md) | Linear (adapt for Jira, GitHub Issues, Plane, Shortcut) |
| Long-form documents and knowledge graphs | [`sources/notion.md`](./sources/notion.md) | Notion and Roam (adapt for Confluence, Google Docs, Coda) |
| Real-time team chat | [`sources/slack.md`](./sources/slack.md) | Slack (adapt for Discord, Microsoft Teams, Mattermost) |
| Infrastructure observability | [`sources/datadog.md`](./sources/datadog.md) | Datadog (adapt for Honeycomb, Grafana, New Relic, Splunk) |
| Error and exception tracking | [`sources/sentry.md`](./sources/sentry.md) | Sentry (adapt for Rollbar, Bugsnag, Airbrake) |
| Product analytics warehouse | [`sources/databricks.md`](./sources/databricks.md) | Databricks SQL (adapt for Snowflake, BigQuery, ClickHouse, dbt) |

## Cross-cutting playbook for defensive code

- [`sources/incident-postmortem.md`](./sources/incident-postmortem.md). Apply across every active `ro-*` worker whenever the target code contains null guards, retries, timeouts, clamps, rate limits, feature flags, circuit breakers, or OOM fallbacks.

## Coverage accounting

Record every category in Sources consulted, including categories where no MCP is configured in `<mcp_servers>` (marked as an environment gap, not a silent skip) and categories where concrete queries returned zero matches.
