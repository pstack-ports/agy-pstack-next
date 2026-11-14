# Verify the result and ship cleanly

`"It compiles"` is not verification. In Swarm-Centric Pstack v2, no author worker grades its own homework. Independent `ro-verify` workers check the real artifact against your finish condition, [`/verify-gen`](../../skills/verify-gen/SKILL.md) turns manual verification into reusable repo infrastructure, and the [`ship`](../../skills/pstack/topologies/ship.md) topology gates PRs and CI triage with mechanical push rules.

![A prototype plane flies a real test course while an engineer times it with a stopwatch and robots film and checklist the run.](./images/verification.jpg)

## State a falsifiable finish condition up front

Put what `"done"` means in your opening prompt so `ro-verify` has concrete predicates to execute:

```text
/agy-pstack-next:pstack add --format json to the audit command. plain text stays byte-identical, JSON output parses cleanly, and both run against the sample fixture. show the command outputs.
```

Match the required proof artifact to the surface you changed.

- **CLI or TUI changes.** Run the real binary via [`/control-cli`](../../skills/control-cli/SKILL.md) and capture stdout, stderr, and exit codes.
- **Web or Electron changes.** Walk the real user flow via [`/control-ui`](../../skills/control-ui/SKILL.md) and capture ARIA snapshots plus before-and-after screenshots.
- **Storage or schema changes.** Query a read-only second view to prove persisted values rather than trusting an `"OK"` toast.
- **Performance changes.** Compare alternating baseline and candidate runs with `ro-bench`.
- **Cross-cutting changes.** Run [`/interrogate`](../../skills/interrogate/SKILL.md) so `adv-*` probes edge cases and `ro-blast` audits downstream callers and rollout order.

## Vet every measured number before citing it

Benchmarks lie easily through warm caches, untuned debug builds, or timed regions that omit async work. Inside `hillclimb` (and distilled in [`principles.md`](../../skills/pstack/references/principles.md) under Explain the Number), `ro-bench` answers seven mandatory questions from real runs before any speedup claim survives.

1. What hardware or algorithmic bottleneck limits the number right now, and why is it not twice as fast?
2. Did baseline and candidate both run with production flags and warm-up parity?
3. Does the claimed throughput respect physical limits (disk bandwidth, memory bus, core count, network RTT)?
4. Did every run produce valid output with zero silent errors?
5. Does the delta hold across alternating runs with reported median and range?
6. Does the speedup move an end-to-end path a user actually waits on?
7. Did all real work finish inside the measured timer window?

Any measurement that cannot name its limiter or reproduce across alternating runs is marked `inconclusive`.

## Generate and maintain behavioral verification skills with `/verify-gen`

Agents can verify your app autonomously only when the repo gives them a repeatable way to launch, health-check, and drive it. Bootstrap that capability once with [`/verify-gen`](../../skills/verify-gen/SKILL.md):

```text
/agy-pstack-next:verify-gen
```

`/verify-gen` runs a three-stage swarm pipeline. Parallel `ro-*` mappers interview your codebase for launch commands, readiness signals, harnesses, and port or data-dir isolation flags. `impl-verify` (`workspace: "share"`) authors `.agents/skills/verify-<app>/SKILL.md` (with `Launch`, `Doctor`, `Drive`, `Evidence`, `Cleanup`, and executable `Helpers`) plus a `features/` directory modeled on [`feature-map-example`](../../skills/verify-gen/references/feature-map-example/README.md). Finally, `ro-verify` executes the skill cold end to end and confirms proof artifacts survive cleanup before the commit lands.

Commit `.agents/skills/verify-<app>/` to git so every teammate and every future swarm worker drives the app identically. As features evolve, keep the map honest with `--maintain` (on demand or on a daily `/schedule` cron):

```text
/agy-pstack-next:verify-gen --maintain
```

`--maintain` fans out `ro-map-*` readers across every feature file, patches doc or selector drift in `impl-verify`, runs a full live `ro-verify` session under strict health-check and cleanup invariants, and reports `clean`, `changed`, or `blocked` while flagging real product regressions without masking them in docs.

## Prove invariants and state machines with `--formal` and `/statechart`

Behavioral E2E drives exercise common journeys, while costly bugs often hide in rare retry interleavings, lock expirations, or parser edge cases. Generate a formal check for those promises with `--formal`:

```text
/agy-pstack-next:verify-gen --formal verify job lease renewal so one job never executes on two workers simultaneously
```

`/verify-gen --formal` picks the lowest-cost tool that answers the question (TLA+ model checking via TLC for event ordering, language-native SMT or code-level verifiers, or property-based testing with generated inputs against real functions). `impl-verify` maps indivisible code steps faithfully, proves the check catches an injected scratch bug in its isolated worktree, records covered files plus `sync_commit`, and hands off to `ro-verify`.

After refactors or merges touch covered files, bring the formal model back in sync and separate stale-model drift from real code bugs:

```text
/agy-pstack-next:verify-gen --maintain --formal
```

Whenever a stakeholder needs to inspect a TLA+ protocol or UI flow visually without reading TLA+ syntax, pair with [`/statechart`](../../skills/statechart/SKILL.md) to render checked Mermaid or Pele SVG statecharts showing shortest counterexample paths in user terms.

## Land locally, open PRs on request, and babysit CI (`ship`)

Pstack v2 never pushes to a remote repository unless you ask. `hooks/guard.mjs` enforces that boundary mechanically by blocking force-pushes to `main` or `master`, forbidding `git push` for `adv-*` and `sicko-*`, and requiring `PSTACK_ALLOW_PUSH=1` for authorized push steps.

When you want a verified branch turned into a clean PR and driven to green CI, invoke `/pstack` (`ship` topology):

```text
/agy-pstack-next:pstack verify this branch, open a crisp PR with evidence in the body, and babysit CI and review comments until merge-ready.
```

In [`ship`](../../skills/pstack/topologies/ship.md), `/pstack` runs `ro-verify` and `/interrogate` pre-flight checks, orders commits cleanly, formats the PR briefing under `/technical-writing` rules, pushes with `PSTACK_ALLOW_PUSH=1`, and monitors checks and review threads using [`watch-pr`](../../skills/pstack/scripts/watch-pr) and [`bugbot-triage.md`](../../skills/pstack/references/bugbot-triage.md). Real defects route to `impl-fix` (`workspace: "share"`), false-positive bot comments get concise factual replies backed by evidence, and stacked PRs verify independently from bottom to top before landing.

Continue to [Run work while you sleep](./07-overnight.md).
