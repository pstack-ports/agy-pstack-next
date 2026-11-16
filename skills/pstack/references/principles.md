# Pstack Engineering Principles

Distill the 3 to 4 principles relevant to a slice into each worker's brief, and judge diffs against them before merging.

## 1. Core Execution & Architecture

1. **Laziness protocol.** Ship the smallest diff that solves the root problem. Consolidate repeated choices behind one source of truth. Three direct lines beat a premature abstraction.
2. **Subtract before you add.** Delete dead code, unused flags, single-caller pass-through wrappers, and obsolete stubs before adding new behavior.
3. **Foundational thinking.** Define core data structures, state transitions, and shared test scaffolds first. When the data model fits the domain, control flow becomes short and obvious.
4. **Redesign from first principles.** Integrate new requirements as if they had existed from day one instead of bolting special-case flags onto old assumptions.
5. **Migrate callers then delete legacy APIs.** When replacing an internal contract, migrate every caller and delete the old signature, compatibility shim, and obsolete tests in the same wave.
6. **Minimize reader load (30-second test).** Minimize indirection layers and mutable state scope. A new reader must find where a value originates and what mutates it within 30 seconds.
7. **Model the domain & type discipline.** Make illegal states unrepresentable via discriminated unions, explicit state machines, and branded IDs. Exhaust union variants with `never`.
8. **Boundary discipline.** Parse, validate, and narrow untrusted inputs once at system edges (CLI args, network payloads, env vars, disk files). Keep internal domain logic in pure functions without redundant defensive nil checks.
9. **Make operations idempotent.** Compute actions by diffing observed current state against target state. Write shared files via temp-file plus atomic rename so retries or crashes converge cleanly.
10. **Separate before serializing shared state.** Eliminate shared mutable targets across parallel workers first: disjoint file ownership in `workspace: "share"` worktrees, ephemeral ports (`--port 0`), and per-run `/tmp` directories.
11. **Experience first.** Choose caller and end-user clarity over implementation convenience. Ship three cohesive capabilities rather than ten rough ones.
12. **Outcome-oriented execution.** Converge directly on the target architecture across verifiable phase boundaries rather than maintaining throwaway intermediate shims.
13. **Exhaust the design space.** On novel architectural or UX forks with no clear precedent, compare 2 to 3 orthogonal designs or prototypes side by side (`/crucible`).
14. **Build the lever.** Confirm a non-trivial transformation or check manually on one unit, then write a deterministic script or codemod anyone can rerun.

## 2. Structural Design Red Flags

Screen designs and diffs against these eight traps (assume the next contributor copies the nearest compiling pattern):

- **Shallow module:** Wide interface hiding little policy, forcing callers to invoke multi-step ceremonies. Prefer deep modules behind narrow entry points.
- **Information leakage:** Re-exporting wire, ORM, or framework shapes across module boundaries so changes force lockstep edits.
- **Temporal decomposition:** Splitting packages by execution order (`load`, `validate`, `save`) instead of grouping code with the domain invariant it protects.
- **Pass-through method:** Forwarding arguments unchanged to another layer with no added policy or abstraction.
- **Split ownership:** Multiple modules mutating or caching parallel copies of the same state. Assign one owner per mutable state.
- **Two ways to do one task:** Leaving legacy and new code paths side by side. Keep one supported path.
- **Importable internals:** Allowing callers to import private helpers directly instead of locking exports at the boundary.
- **Hand-synced list:** Repeating enum cases, routes, or registries across files without a single canonical source or exhaustive compile check.

## 3. Verification, Debugging & Numbers

15. **Prove it works.** Never accept an author self-report or `"it compiles"` as proof. Gate every wave through an independent `verifier` running real behavioral checks (`.agents/skills/verify-*`, CLI/UI flows, and test suites).
16. **Fix root causes.** Reproduce deterministically first, then trace back to the earliest invalid state transition. Never mask bad internal state with nil guards, swallowed errors, or blind retries.
17. **Attack the premise.** When two fixes sharing one assumption fail the same check, stop editing production code, write that assumption down in one sentence, and run a direct probe to test it first.
18. **Test behavior, not implementation.** Drive public interfaces with realistic inputs. Tests must fail when observable behavior breaks and stay green when private internals are refactored. Never compute expected values using the code under test.
19. **Sequence verifiable units.** Order commits so history proves correctness step by step: failing reproduction test before fix, dead-code deletion before reshape, harness setup before optimization.
20. **Explain the number.** Vet every benchmark or latency claim against seven checks before trusting it: (1) profiled physical or code-path limiter ("why not 2x faster?"), (2) production flags and warm-up parity, (3) Amdahl arithmetic ceiling check, (4) zero silent errors, (5) at least 5 interleaved runs (`A, B, A, B, ...`) reporting median and full range, (6) end-to-end user path impact, and (7) verified work counters inside the timed window.

## 4. Swarm Delegation & Code/Prose Hygiene

21. **Guard the context window.** Keep bulk file sweeps, log parsing, and raw test dumps inside workers. Cite board posts by `#seq` number and write reports over `4` KB to `/tmp/<worker>-report.md` with a concise board summary.
22. **Never block on reversible work.** Settle empirical technical questions by running probes or prototypes rather than asking the user. Pause only for genuine product-taste choices or irreversible external actions (`git push`, opening PRs, deploys, destructive deletes).
23. **Encode lessons in structure.** Turn recurring mistakes into static types, linter checks, verification harnesses, or CI gates instead of adding more prompt prose (pair with `/learn` when capturing user preferences).
24. **Zero-slop comment & prose hygiene.**
    - **Delete disposable comments on sight:** Line-by-line narration, ASCII banners, commented-out dead code, and multi-sentence sermons apologizing for fragile internal code. When an internal trap needed a warning comment, delete the excuse and mark the symbol `MUST KILL` for structural repair.
    - **Five comment keep-exceptions only:** (1) license headers, (2) proven live foreign/OS/vendor quirks this repo cannot reshape, (3) valid formatter or buggy-rule lint directives, (4) public API contract docs not expressible in types, and (5) external RFC/issue/spec links.
    - **Clean prose:** Write short declarative sentences in active voice with concrete nouns. Label claims with their evidence tier (direct measurement vs inference). Avoid chatbot filler and buzzwords.
