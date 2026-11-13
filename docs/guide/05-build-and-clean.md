# Build the change and clean the diff

Every `/pstack` build, diagnosis, and optimization topology follows one core discipline. State what you observed and what must hold, and let the swarm demand runtime evidence from isolated workers before landing commits.

## Prompt each topology with concrete facts

### Bug fixes and forensics (`diagnose`)

Give the symptom, any known failure artifact, and `"reproduce first"`:

```text
/pstack this CLI emits duplicate summary lines when stdin closes mid-batch. reproduce first, fix the root cause, and prove the regression test passes.
```

In [`diagnose`](../../skills/pstack/topologies/diagnose.md), parallel `ro-*` workers probe competing hypotheses across code, logs, CPU profiles, or heap snapshots first. Once a probe isolates the root cause, the coordinator warm-forks that investigator (`fork: "ro-winner"`) into `impl-fix` (`workspace: "share"`), writes a failing behavioral test first whenever a fast local test path exists, applies the root-cause fix, and hands verification to `ro-verify`.

For live leaks, CPU spins, or captured `.cpuprofile` and trace files where you want diagnosis before any code edits, add `"do not change code yet"`:

```text
/pstack inspect /tmp/startup.cpuprofile, attribute the 1.8s stall to exact source lines, and report the bottleneck without changing code yet.
```

### Features, refactors, and visual parity (`build`)

State the target behavior alongside invariants that must not change:

```text
/pstack move query parsing into a single boundary module with zero behavior change. record baseline fixture outputs first and prove byte-identical output afterward.
```

In [`build`](../../skills/pstack/topologies/build.md), the coordinator slices disjoint file or module ownership across parallel `impl-*` (`workspace: "share"`) authors so two workers never touch the same file. Refactors migrate all callers and delete legacy APIs in the same wave rather than leaving compatibility shims behind. Visual parity tasks pair `impl-*` with [`/control-ui`](../../skills/control-ui/SKILL.md) to diff screenshots on ephemeral ports and isolated `--user-data-dir` profiles until layouts match.

### Sustained performance work (`hillclimb`)

State the measured baseline, the target, and the fixture:

```text
/pstack startup takes 1.8s on the 10k-file workspace fixture. lock a baseline noise floor, hillclimb cold-start latency below 600ms, and show the scoreboard.
```

In [`hillclimb`](../../skills/pstack/topologies/hillclimb.md), `ro-bench` locks a baseline median, range, and noise floor first, checking every number against physical limits and arithmetic sanity. Parallel `cand-*` (`workspace: "share"`) workers test orthogonal optimization levers, post `#seq` measurements to a live board scoreboard, discard sub-noise edits, and cherry-pick orthogonal wins onto the main branch.

## Drive UIs and CLIs without port collisions

When `impl-*`, `adv-*`, and `ro-verify` exercise apps concurrently on one machine, shared ports and profiles cause flaky false failures. Two specialist skills keep local harnesses isolated.

- **[`/control-ui`](../../skills/control-ui/SKILL.md).** Drives Playwright, Chromium, or Electron over ephemeral dev ports and per-worker `--user-data-dir=/tmp/ui-profile-<worker>-<run>` directories, selecting pages by stable ARIA roles and `data-*` markers.
- **[`/control-cli`](../../skills/control-cli/SKILL.md).** Drives interactive CLIs and TUIs inside worker-scoped `tmux -L` sockets or Python PTY harnesses with isolated `HOME`, `TMPDIR`, and `XDG_CONFIG_HOME` paths and `127.0.0.1:0` inspector ports.

## TypeScript and test-first discipline in the capsule

Every `impl-*`, `cand-*`, and `lead-*` worker receives [`roles/poteto-agent.md`](../../roles/poteto-agent.md) automatically via `hooks/guard.mjs`, backed by [`ts-patterns.md`](../../skills/pstack/references/ts-patterns.md).

- **Behavioral tests first.** Write the smallest test that fails for the intended user-observable reason before changing production code. Skip brittle mock-heavy unit scaffolding when running the real CLI or HTTP boundary proves more.
- **Illegal states unrepresentable.** Parse external data as `unknown` at boundaries, model state transitions with discriminated unions, enforce exhaustiveness with `never`, and derive types from authoritative schemas.

## Strip comments and AI slop with `sicko-*`

Authors defend their own narrating comments and defensive boilerplate. Before `ro-verify` signs off on a non-trivial diff in `build` or `ship`, `/pstack` spawns `sicko-clean` (`workspace: "share"`), which receives [`roles/comment-sicko.md`](../../roles/comment-sicko.md).

`hooks/guard.mjs` enforces `sicko-*` boundaries mechanically. It permits `edit_file` inside the worker's worktree while blocking `write_file` and `git push`, ensuring cleanup never invents new wrapper files or pushes unverified commits. `sicko-*` keeps only license headers, public API docstrings, external bug links, and genuine third-party quirk explanations. Every comment that apologizes for confusing internal code becomes either a root-cause simplification or a structural type, lint, or test check, and the comment comes out.

For standalone documentation, READMEs, RFCs, and PR bodies, invoke [`/technical-writing`](../../skills/technical-writing/SKILL.md) to enforce Diataxis mode discipline, crisp Global English syntax, zero AI filler, and `ro-*` technical accuracy checks.

**Pitfall.** Never treat diff cleanup as optional polish after review. Redundant guards, narrating comments, and dead compatibility branches hide bugs and slow down every reviewer who reads the PR.

Continue to [Verify and ship](./06-verify-and-ship.md).
