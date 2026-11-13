# Datadog telemetry

## What this source contains

Datadog records production runtime behavior, alerts, and operational incidents.

- **Metrics.** Counters, gauges, and histograms showing what engineers actively measured.
- **Monitors and alerts.** Paging thresholds that frequently match hardcoded clamps, rate limits, or retry budgets in code.
- **Dashboards.** Curated service views built by subsystem authors.
- **APM traces and spans.** Endpoint latency breakdowns, retry fan-out, and downstream bottlenecks.
- **Logs.** High-volume error patterns preceding defensive fixes.
- **Incidents and notebooks.** Incident timelines, severity records, and investigative notes.

## How to search it

Query read-only Datadog MCP tools starting broad and narrowing by service and commit window:

1. **Service ownership.** Run `search_datadog_services` and `search_datadog_service_dependencies` to map upstream and downstream boundaries.
2. **Dashboards and monitors.** Run `search_datadog_dashboards` and `search_datadog_monitors` for the feature, service, or symbol name. Compare monitor thresholds directly against constants in the target code.
3. **Metric trajectories.** Run `search_datadog_metrics`, `get_datadog_metric_context`, and `get_datadog_metric` across a bounded window around the commit date published by `@ro-git`.
4. **Time-bounded log patterns.** Run `search_datadog_logs` (`use_log_patterns=true`) or `analyze_datadog_logs` scoped tightly by service, error string, and a 30-day window around the change. Never dump unbounded raw logs.
5. **APM spans and incidents.** Run `aggregate_spans`, `search_datadog_spans`, `search_datadog_incidents`, and `get_datadog_incident` when investigating timeouts, circuit breakers, or incident mitigations.

## Common pitfalls

- **Correlation is not proof of causation.** Check neighboring commits in the same deploy window before attributing a metric drop to one PR.
- **Retention gaps.** Expired metrics or rotated logs are `[Unknown]` coverage gaps rather than evidence that zero errors occurred.
- **Chart framing bias.** A dashboard widget proves someone watched a metric, not why a specific branch was written.

## What to report

Record the item type (monitor, dashboard, metric, log pattern, span, incident), identifier or URL, owner and timestamp, exact query or threshold condition, and how it aligns with commit dates on the swarm board.
