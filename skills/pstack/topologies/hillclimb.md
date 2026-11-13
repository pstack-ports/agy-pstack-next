# Hillclimb topology

Use the `hillclimb` topology for both single-bottleneck performance fixes and sustained iterative optimization against a quantitative target (latency, throughput, memory footprint, bundle size, or benchmark score). Every claim rests on interleaved measurements, explicit noise floors, and arithmetic sanity checks. Never claim a win from reading code alone.

## Choose single-fix vs sustained loop

- **Targeted performance fix.** Trace one reported slowdown, hit the agreed latency or resource budget with the cheapest effective lever, verify zero regressions, and stop.
- **Sustained hillclimb.** Pair a numeric target with a minimum attempt floor (for example, at least 40% lower p50 latency across at least 8 tested hypotheses) so an easy initial win does not stop systematic optimization early.

## Phase 1. Lock baseline, noise floor, and limiter with `ro-bench`

Before spawning any code-writing worker, spawn `ro-bench` (`workspace: "inherit"`) to build or validate the measurement procedure:

1. **Ground realistic workload dimensions.** Use `/understand` ([../../understand/SKILL.md](../../understand/SKILL.md)) when needed to map dataset scale, cache state, concurrency, and end-to-end user paths. Confirm the benchmark workload reproduces the actual bottleneck and separates fast inputs from slow inputs.
2. **Profile an un-timed run to name the limiter.** Capture a CPU profile, allocation trace, or syscall profile outside timed trials (because profilers perturb wall time) and map the bottleneck to exact source symbols. Answer why the system is not already twice as fast.
3. **Run the seven `Explain the Number` checks.** Verify every requirement from [../references/principles.md](../references/principles.md):
   - Named physical or code-path limiter (CPU core, memory bandwidth, I/O wait, lock contention, serialization, or load-generator saturation).
   - Production flags, release mode, realistic connection pools, and matched warm/cold cache states on every side.
   - Arithmetic ceiling check (removing a step that consumes 12% of runtime can speed up the whole run by at most ~13.6%).
   - Explicit error counter and output correctness check inside the benchmark script so fast rejections cannot masquerade as speedups.
   - At least `5` interleaved runs (`A, B, A, B, ...`) reporting both median and min-to-max range (check `uptime` and core count first).
   - End-to-end user metric measured alongside any microbenchmark.
   - Explicit work-done counter inside the timed region proving that the expected rows, bytes, or frames actually executed.
4. **Freeze the benchmark and regression gates.** If the repo lacks a repeatable benchmark script, have a dedicated setup `impl-bench` (`workspace: "share"`) land the script first (`Build the Lever`), merge it locally, and freeze it outside `cand-*` write fences so candidates cannot game the meter.
5. **Post the baseline lock (`#seq`).** `ro-bench` records the frozen command, baseline median, run-to-run spread (noise floor), work count, error count (`0`), limiter, and green behavioral test suite on the board.

## Phase 2. Rank levers and fan out `cand-*` experiments

Order candidate hypotheses by the seven performance levers, cheapest and safest first:

1. **Stop doing it.** Eliminate work whose output no caller uses.
2. **Do it once.** Hoist or memoize invariant work out of loops and hot paths.
3. **Do it less often.** Batch, coalesce, debounce, or index repeated lookups.
4. **Do it later.** Defer non-critical work off startup or interaction critical paths.
5. **Do it when idle.** Precompute or flush outside user-visible frames.
6. **Do it concurrently.** Parallelize independent CPU or I/O slices across workers.
7. **Do it cheaper.** Optimize data layout, allocations, or inner-loop algorithms last.

### Parallel candidate execution (`cand-*`, `workspace: "share"`)

- Spawn `2` to `4` parallel `cand-*` workers (`cand-1`, `cand-2`, `cand-3`, `workspace: "share"`) when orthogonal mechanisms target the bottleneck.
- Give each `cand-*` **one falsifiable mechanism** ("pre-index node IDs in a `Map` to eliminate O(N) scan in `resolveEdges`"), the frozen benchmark command, the behavioral test command, and strict instructions never to edit the benchmark harness or bundle unrelated tweaks.
- Each `cand-*` commits its minimal change cleanly in its `share` worktree, runs a sanity check, and posts its commit SHA, `pwd` worktree path, and observed numbers to the board (`#seq`).

## Phase 3. Maintain the `#seq` board scoreboard

Independent `ro-bench` (`workspace: "inherit"`) evaluates candidate worktrees interleaved against the current baseline (`baseline, cand-1, cand-2, baseline, ...`) so thermal drift and background load affect all arms equally.

Record every tested lever on the swarm board as a compact `#seq` scoreboard update:

| Attempt `#seq` | Worker / SHA | Mechanism | Before (median / range) | After (median / range) | Delta | Work / Errors | Tests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `#14` | `cand-1` (`a1b2c3d`) | Hoist schema compile | `48.2ms (47.5-49.1)` | `34.0ms (33.6-34.5)` | `-29.5%` | `10000 / 0` | `PASS` | `KEPT` |
| `#15` | `cand-2` (`e4f5a6b`) | Custom string pool | `48.2ms (47.5-49.1)` | `47.8ms (47.1-48.9)` | `-0.8%` | `10000 / 0` | `PASS` | `DISCARDED (noise)` |

### Keep vs discard rules

- **Discard sub-noise changes.** Any candidate whose median improvement does not clear the run-to-run spread is discarded in full. Never keep speculative "might help" code.
- **Discard broken or implausible wins.** Reject any candidate that fails behavioral tests, increments error counts, alters work counts unexpectedly, or violates Amdahl arithmetic against the profiled share.
- **Keep pure simplifications that hold the number.** A deletion that removes code complexity without regressing the metric earns its place (`Laziness Protocol`).

## Phase 4. Compound orthogonal wins and push past plateaus

1. **Keep `cand-*` parked until cherry-picked.** Leave winning `cand-*` workers asleep in `waiting` (zero token cost, `share` worktree preserved) during integration.
2. **Compound one commit at a time.** Fetch each `KEPT` commit into your integration branch and apply it individually (`git fetch <cand_cwd> <sha> && git cherry-pick <sha>`). After each cherry-pick, have `ro-bench` re-measure interleaved against the prior accepted tip and run behavioral tests (`Sequence Verifiable Units`).
   - If two wins targeted the same underlying cost and the second adds zero incremental gain on top of the first, drop the second (`git reset --hard HEAD~1`) to keep the codebase lean.
   - Keep each accepted lever as its own atomic commit so git history documents exact per-commit gains.
3. **Retire evaluated `cand-*` workers.** Once winning commits are cherry-picked onto the integration branch and discarded runs are recorded on the `#seq` scoreboard, call `swarm{action: "kill", name: "cand-..."}` to clean up their worktrees.
4. **Break plateaus deliberately.** When consecutive candidates land inside noise, re-profile the new tip with `ro-bench` to find where the bottleneck shifted, attack a shared premise (`Attack the Premise`), or run `/crucible` for a deeper data-structure redesign rather than relaxing the target predicate.
5. **Close cleanly.** Run `sicko-*` cleanup and final `ro-verify` check on the compounded stack. Report the metric, baseline vs final median and range, percent improvement, kept vs discarded attempt counts, one-line summary per accepted commit, `#seq` scoreboard summary, and the highest-leverage next bottleneck if pushed further.
