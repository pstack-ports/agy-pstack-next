# Databricks analytics and system tables

## What this source contains

Databricks records product analytics, warehouse pipelines, and usage telemetry. While infrastructure tools show runtime service behavior, the analytics warehouse shows user behavior, experiment exposures, billing volume, and empirical distributions behind threshold constants.

- **Product analytics events.** Raw `your_warehouse.events.analytics_track_event` tables and typed deduplicated dbt models in `<your_analytics_db>.<schema>.<table>`.
- **Usage and billing events.** `your_warehouse.events.usage_event`, `<your_analytics_db>.<schema>.stg_usage_events`, and model usage tables for cost-driven or volume-driven decisions.
- **Experiment and feature-flag tables.** Exposure and variant outcome tables. Always probe with `SHOW TABLES` first because schemas vary per workspace.
- **System tables.** `system.query.history`, `system.compute.warehouses`, `system.billing.*`, and `system.access.audit` for expensive query or warehouse load investigations.
- **dbt lineage.** Models in `<your_analytics_db>.<schema>` showing upstream and downstream pipeline dependencies.
- **Databricks notebooks.** Exploratory notebooks are not queryable through SQL MCP tools. Flag suspected notebook rationale as an explicit `[Unknown]` gap.

## How to search it

Use read-only SQL execution tools (`execute_sql_read_only`, polling with `poll_sql_result` when a `statement_id` is returned).

Orient on real table schemas before writing aggregations:

```sql
SHOW TABLES IN <your_analytics_db>.<schema> LIKE '*<keyword>*';
DESCRIBE TABLE <your_analytics_db>.<schema>.stg_<event>;
```

Time-bound every query around the commit or PR merge date (typically 30 days before and after) on `_timestamp` or `start_time` so warehouse scans never time out. Prefer typed `stg_<source>_<event_name>` dbt models (`_timestamp`, `_id`, `_auth_id`, `_request_id`, `event_name`, `properties_*`, `context_*`) over raw `analytics_track_event` unless querying inside the recent dbt refresh lag.

## High-yield query patterns

1. **Event trajectory.** Daily counts across a 60-day window around PR merge to confirm feature launch ramps or deprecation drops.
2. **Threshold origin.** Median, p99, and max of `properties_<name>` in the 14 days prior to a PR to test whether a clamp constant came from empirical percentiles.
3. **Experiment variant lookup.** Exposure counts by variant for the target feature-flag key near the ship date.
4. **Expensive query history.** `system.query.history` filtered by `statement_text ILIKE '%<table_or_symbol>%'` sorted by `total_duration_ms` or `read_bytes`.
5. **dbt model history.** When a target depends on a dbt model checked into git, inspect `git log` directly or post a `#seq` clue to `@ro-git`.

## Common pitfalls

- **Instrumentation is not causation.** Logging an event proves someone measured it, not that target code exists because of it. Pair warehouse shifts with commit or PR citations.
- **Silent logging changes.** A sudden count jump can reflect a newly shipped logging call rather than changed user behavior.
- **Schema drift and retention cliffs.** Older events may live only in `properties_json` or predate table retention. Report retention cutoffs as explicit gaps, not zero activity.

## What to report

Report the table name, exact SQL query, time window, compact numeric summary (counts, percentiles, first and last timestamps rather than raw row dumps), temporal alignment with the PR merge date, and confidence tier.
