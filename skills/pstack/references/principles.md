# Engineering principles

These 24 principles govern design, implementation, verification, and swarm coordination across `/pstack` workflows. Apply the specific principles that match your active topology and name each principle that changed a concrete decision in your report.

## Core principles

### 1. Laziness protocol

Apply when sizing a diff, refactoring, or considering a new abstraction, wrapper, or flag path.

- Consolidate repeated choices behind one source of truth and pass the result as a plain value.
- Ship the smallest diff that solves the root problem.
- Prefer deleting code over adding layers, helpers, or configuration knobs.

### 2. Foundational thinking

Apply before writing logic, choosing types, or ordering multi-step work.

- Choose core data structures and domain types first. Trace dominant read and write paths so downstream code becomes straightforward.
- Unify shared types and schemas rather than deduplicating every three-line snippet. Three explicit lines beat a premature abstraction.
- Ask what happens if two actors touch shared state concurrently. Isolate the state whenever the answer is anything other than nothing.
- Sequence foundations before features. Land shared types, test harnesses, linters, and build checks first when every subsequent slice benefits from them.

### 3. Redesign from first principles

Apply when integrating a new requirement into an existing module.

- Read all affected files and understand the current invariants before editing.
- Ask what shape you would build today if this requirement had existed from day one, instead of bolting special cases onto the old design.
- Propagate the new model cleanly across types, runtime logic, tests, and docs.
- Design the whole target shape first, then sequence delivery in small verifiable commits.

### 4. Attack the premise

Apply whenever two or more attempted fixes sharing one assumption fail the same check.

- Stop writing fixes and write down the shared assumption in one declarative sentence.
- Build a rerunnable probe that tests that premise directly before attempting another code change.
- Inspect the distribution of failures across inputs, not just the failure count.
- When evidence refutes the premise, pivot to what the failures actually share. When evidence confirms the premise, trace one step further upstream and remove what creates the bad condition rather than compensating after it.

### 5. Subtract before you add

Apply before any feature addition, refactor, or migration.

- Remove dead code paths, unused parameters, redundant validators, and empty stubs before introducing new behavior.
- Design strictly for observed requirements rather than speculative future cases.
- Leave every touched module smaller or simpler behind the same or narrower interface.

### 6. Minimize reader load

Apply when shaping modules or reviewing diffs that feel hard to trace.

- Track two independent costs. Count indirection layers between a question and its answer, and count mutable state a reader must hold in working memory.
- Inline single-caller wrappers, pass-through adapters, and interfaces with only one implementation.
- Make every adjacent boundary change the level of abstraction.
- Shrink state scope. Prefer pure return values over mutation, local variables over instance fields, and derived values over synchronized state.
- Hold the 30-second test. A new reader must find where a value originates and what can mutate it within 30 seconds.

### 7. Outcome-oriented execution

Apply during multi-phase rewrites and migrations with explicit phase boundaries.

- Converge directly on the target architecture rather than preserving smooth intermediate compatibility shims that turn into permanent debt.
- Declare upfront where temporary breakage between internal phases is expected and reversible.
- Keep targeted checks green on converted slices during the migration, and require full static and behavioral verification before closing the program.

### 8. Experience first

Apply when weighing UX, API ergonomics, or scope tradeoffs.

- Choose user clarity and delight over implementation convenience.
- Ship three cohesive, polished capabilities rather than ten rough ones.
- Prototype visual and interactive choices cheaply before writing production code.
- Treat callers of an internal API and future maintainers of the module as real users. Frame every summary around what changes for them.

### 9. Exhaust the design space

Apply when facing a novel UI interaction or an architectural fork with no precedent in the repository.

- Build two or three distinct prototypes or concrete design candidates across orthogonal axes (see `/crucible`).
- Compare observed tradeoffs side by side on the real target before committing to one implementation.

### 10. Build the lever

Apply to any non-trivial edit, migration, trace analysis, or verification check.

- Execute one unit manually to confirm the pattern, then write a deterministic codemod, generator, SQLite loader, or verification script to run the rest.
- Verify the lever by rerunning it on the manual unit and checking that the diff matches.
- Run a deterministic lever directly instead of fanning out swarm workers to repeat mechanical edits by hand.
- Keep worker verification scripts outside author write scopes when independent checking matters. Commit durable levers alongside the code change.

## Architecture principles

### 11. Model the domain

Apply when stateful logic branches repeatedly or duplicates shape assumptions across files.

- Replace scattered boolean flags and lifecycle checks with explicit state machines or discriminated unions.
- Replace multi-file conditional chains with registries, lookup tables, or command reducers.
- Group modules by domain ownership and invariants rather than execution-order phases such as load, validate, transform, and save.
- Keep plain, direct code when the existing shape is local, total, and unlikely to branch further.

### 12. Boundary discipline

Apply when wiring CLI entrypoints, network handlers, config loaders, storage adapters, or IPC bridges.

- Parse, validate, and narrow untrusted inputs once at the system boundary into domain types.
- Never leak raw wire, transport, ORM, or `Record<string, unknown>` shapes past the boundary parser.
- Keep core domain logic in pure functions with zero framework dependencies so tests exercise behavior directly without heavy harnesses.
- Drop redundant defensive checks inside trusted internal call chains.

### 13. Type system discipline

Apply when designing signatures, domain models, or schemas in statically typed languages.

- Make illegal states unrepresentable in the type definition itself.
- Brand semantically distinct primitives (such as `PullRequestNumber` vs `IssueNumber`) at parse time so callers cannot transpose arguments.
- Treat external payloads as `unknown` until validated by a schema or verifying type guard.
- Exhaust all union variants using `never` in `default` branches, and derive subsets from authoritative schemas instead of duplicating interfaces.

### 14. Make operations idempotent

Apply to CLI commands, setup scripts, migrations, state transitions, and background loops that run across retries or crashes.

- Compute actions by diffing observed current state against desired target state, never by assuming where a previous run stopped.
- Ensure running an operation twice in a row or restarting after a mid-flight crash converges to the exact same end state.
- Write outputs to temporary paths and rename atomically, or key artifacts by content hash, so stale partial state never corrupts recovery.

### 15. Migrate callers then delete legacy APIs

Apply when replacing an internal function, module, hook, or schema whose callers live in the same repository.

- Migrate every caller to the new contract and delete the old API in the same wave.
- Rewrite tests against observable behavior on the new API and delete tests that only pinned retired internals.
- Never leave deprecation wrappers, dual code paths, or unused compatibility flags in internal code.

### 16. Separate before serializing shared state

Apply whenever parallel swarm workers or concurrent runtime tasks could touch the same file, git ref, port, database, or state file.

- Eliminate shared mutable targets first. Assign disjoint file ownership per `impl-*` worker, run authors in `workspace: "share"` worktrees, and isolate ports, temp directories, and browser profiles per worker.
- Merge independent outputs at an explicit integration step rather than letting multiple actors mutate one shared artifact.
- Introduce locks, single-writer queues, or sequential phases only when a single shared state object is a true domain requirement.

## Verification principles

### 17. Prove it works

Apply before declaring any slice, bug fix, refactor, or PR complete.

- Verify directly on the real running target using `/control-ui`, `/control-cli`, or executable tests, never by trusting typecheck alone or repeating a worker's summary.
- Inspect actual process output, DOM state, screenshots, database rows, or git commit trees rather than cached proxies.
- Script verification checks so `ro-verify` can rerun the exact command at the candidate commit SHA.
- When a check passes unexpectedly fast or fails mysteriously, audit the measurement or harness script before blaming the application.

### 18. Fix root causes

Apply during every bug hunt, flaky test diagnosis, or incident investigation.

- Reproduce the failure deterministically first, then trace backward from the symptom to the earliest wrong state transition in the system.
- Decide whether the triggering state is valid in the domain. Handle valid states cleanly at the consumer, and stop invalid states at the producer instead of masking them with nil guards, retries, or swallowed errors.
- Suspect persisted caches, lockfiles, or serialized config whenever a defect appears only after restart.
- Sweep the codebase for sibling occurrences of the same root fault and fix them together.

### 19. Sequence verifiable units

Apply to refactors, caller sweeps, bug fixes, and stacked PR series.

- Bracket every unit with a known-good baseline, one focused change, and an immediate check before starting the next unit.
- Order git commits so history proves correctness step by step. Commit the failing reproduction test before the bug fix, dead-code deletion before structural reshape, and harness setup before optimization.

### 20. Test behavior, not implementation

Apply whenever adding, editing, or reviewing automated tests.

- Drive code through its public caller or user interface with realistic inputs, and assert observable outputs, returned errors, persisted state, or external boundary payloads.
- Apply the two-edit litmus test. A good test fails when observable behavior breaks and stays green when internal helpers or data structures are refactored.
- Compute expected values from the specification, never by copying output from the implementation under test.

### 21. Explain the number

Apply before trusting, reporting, or acting on any benchmark, latency delta, memory reading, or eval score.

- Lock the decision threshold and measured noise floor before testing candidates.
- Profile a separate un-timed run to identify the true bottleneck ("why not double?"), whether CPU, I/O, lock contention, serialization, or the load generator itself.
- Answer seven checks on every performance claim:
  1. Name the measured physical or code-path limiter.
  2. Confirm both baseline and candidate ran with production tuning, flags, and warm states.
  3. Check Amdahl arithmetic so claimed savings never exceed the runtime share of the modified path.
  4. Count errors and verify output correctness inside the harness so fast failures never masquerade as speedups.
  5. Interleave at least 5 alternating runs (`A, B, A, B, ...`) and compare medians against the run-to-run range.
  6. Report end-to-end user path impact alongside any microbenchmark delta.
  7. Verify work counters inside the timed region so dead-code elimination, unawaited promises, or skipped queries are ruled out.

## Delegation and swarm principles

### 22. Guard the context window

Apply when planning swarm fan-out, reading logs, or auditing multi-slice work.

- Push bulk file exploration, trace SQLite queries, transcript mining, and test output parsing into `ro-*` or `impl-*` workers.
- Post compact findings on the swarm board with `#seq` message citations, commit SHAs, and exact file-and-line pointers rather than raw command dumps.
- Size worker briefs to focused slices so no worker degrades from context bloat.

### 23. Never block on the human

Apply whenever a technical question, missing local tool, or recoverable obstacle appears mid-run.

- Settle empirical questions about behavior, layout, timing, or API shape by running a probe or throwaway sketch rather than asking the user.
- Build missing local harnesses, fixtures, or scripts autonomously and keep driving toward the exit predicate.
- Escalate to the user only for irreversible external side effects (pushing or opening PRs when unrequested, force-pushing shared branches, production deploys, destructive data operations, external messages) or genuine product taste decisions no experiment can resolve.

## Meta principle

### 24. Encode lessons in structure

Apply whenever a review catch, user correction, or swarm failure mode repeats.

- Turn recurring rules into executable enforcement inside `hooks/guard.mjs`, schema types, linter rules, verification scripts, or CI gates instead of appending more prose instructions.
- Reserve skill or role-capsule prose for judgment calls that static or runtime checks cannot express, and pair each judgment rule with the concrete failure mode it prevents.
