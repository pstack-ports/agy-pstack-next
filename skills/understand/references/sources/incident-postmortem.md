# Incident and postmortem context

Apply these cross-source checks whenever target code contains defensive patterns such as null guards, retries, timeouts, clamps, rate limits, feature flags, circuit breakers, or OOM handlers:

- **Issue trackers.** Search for tickets labeled `incident`, `sev-*`, `postmortem`, `followup`, or `reliability` near the commit date.
- **Team chat.** Search `#sev-*`, `#inc-*`, and `#ops-*` channels in a 14-day window around the commit timestamp, plus exact error message literals.
- **Git and PR history.** Check commit chains containing `revert`, `mitigate`, `hotfix`, `guard`, or `clamp`, and post any incident IDs to the swarm board with `#seq` so `@ro-tracker` and `@ro-docs` pull the matching postmortem doc.
- **Observability and error trackers.** Check Datadog incidents and Sentry issue first-seen and resolved timestamps against the merge date.
