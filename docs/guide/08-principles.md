# Steer with principle names

Pstack v2 compiles 24 battle-tested engineering principles into [`skills/pstack/references/principles.md`](../../skills/pstack/references/principles.md) and distills them directly into the four hook-injected role capsules ([`coordinator.md`](../../roles/coordinator.md), [`poteto-agent.md`](../../roles/poteto-agent.md), [`research.md`](../../roles/research.md), and [`comment-sicko.md`](../../roles/comment-sicko.md)).

You never invoke principles as separate slash commands. Instead, you name a principle mid-conversation to redirect the coordinator or a worker in one crisp sentence. Because every role capsule already carries these definitions, naming the rule changes concrete engineering decisions immediately without a three-paragraph lecture.

## Steering a live swarm in one line

When an author starts bolting a fourth compatibility wrapper onto three legacy ones:

```text
apply subtract before you add. delete the dead legacy adapters first, then build on what remains.
```

When a worker reports `"done"` because `tsc` exited zero:

```text
apply prove it works. drive the real import endpoint against the sample payload and show the persisted rows.
```

When two fix attempts fail the same integration gate:

```text
attack the premise. write down the assumption both fixes shared and test that assumption directly with ro-probe before writing a third patch.
```

When an agent proposes adding a mutex around shared temp state across workers:

```text
separate before serializing shared state. give each worker its own /tmp data dir and ephemeral port instead of a lockfile.
```

## All 24 principles at a glance

Read [`skills/pstack/references/principles.md`](../../skills/pstack/references/principles.md) for the full operational triggers and anti-patterns behind each rule.

### Core (what to build and when to rethink)

- **Laziness Protocol.** Prefer deletion and the smallest change that solves the real problem.
- **Foundational Thinking.** Settle core data structures and ownership boundaries before writing control-flow logic.
- **Redesign from First Principles.** Integrate new requirements as if they existed on day one instead of bolting on special-case flags.
- **Attack the Premise.** After two failed fixes sharing one assumption, test that assumption directly before attempting a third fix.
- **Subtract Before You Add.** Remove dead code, unused shims, and redundant checks before building new behavior.
- **Minimize Reader Load.** Collapse single-caller indirection layers and shrink mutable state a reader must track mentally.
- **Outcome-Oriented Execution.** Converge multi-phase migrations directly onto the target design without preserving throwaway intermediate APIs.
- **Experience First.** Optimize for user clarity and polish over internal implementation convenience.
- **Exhaust the Design Space.** Explore two or three orthogonal candidates in `/crucible` when precedent does not settle the shape.
- **Build the Lever.** Build a reusable script, codemod, generator, or `/verify-gen` harness that any reviewer or worker can rerun instead of performing repetitive steps by hand.

### Architecture (boundaries, types, and state)

- **Model the Domain.** Encode domain rules once in data structures and types rather than scattered `if` branches.
- **Boundary Discipline.** Parse and validate untrusted inputs at system edges (CLI, HTTP, config, DB) and trust typed values inside pure core functions.
- **Type System Discipline.** Make illegal states unrepresentable with discriminated unions, branded IDs, `unknown` boundary parsing, and exhaustive switches ([`ts-patterns.md`](../../skills/pstack/references/ts-patterns.md)).
- **Make Operations Idempotent.** Ensure retries and re-runs converge on the exact same end state without duplicating side effects.
- **Migrate Callers Then Delete Legacy APIs.** Update every caller and delete the deprecated function in the same wave.
- **Separate Before Serializing Shared State.** Eliminate shared mutable state (via `workspace: "share"`, ephemeral ports, and isolated temp dirs) before reaching for locks or queues.

### Verification (what counts as evidence)

- **Prove It Works.** Verify behavior against the real running artifact rather than compiler exit codes, mocks, or self-reports.
- **Fix Root Causes.** Trace every symptom back to the first place an invariant broke and fix it there. Add a defensive guard only when the guarded state is genuinely valid.
- **Sequence Verifiable Units.** Slice large changes into small commits or stacked PRs that each compile and pass behavioral checks independently.
- **Test Behavior, Not Implementation.** Assert observable outputs and side effects so tests catch user-visible breakage and survive internal refactors.
- **Explain the Number.** Identify the physical or algorithmic limiter behind every benchmark or eval delta and verify repeatability across alternating runs before trusting it.

### Delegation (swarm scale and autonomy)

- **Guard the Context Window.** Keep heavy source reading, trace crunching, and raw command output inside `ro-*` and `impl-*` workers, posting concise `#seq` evidence on the board so the coordinator stays sharp.
- **Never Block on the Human.** Execute reversible engineering choices autonomously, verify them, and present evidence, pausing only for irreversible actions or external policy calls.

### Meta (compounding improvements)

- **Encode Lessons in Structure.** Whenever agents repeat a mistake twice, encode the rule into architecture, types, `hooks/guard.mjs`, lints, or tests via [`/reflect`](../../skills/reflect/SKILL.md) rather than repeating chat reminders.

Skim this list once, then return whenever an agent drifts. Having exact shared names turns vague frustration into a one-sentence course correction.

Continue to [Make it yours](./09-make-it-yours.md).
