# Diagnose topology

Use the `diagnose` topology for bug fixes, read-only codebase and architecture investigations, live runtime forensics (leaks, CPU spins, UI glitches), and post-mortem trace or heap-snapshot analysis. Every claim and every shipped line must trace directly to observed runtime or artifact evidence.

## Declare the deliverable boundary first

Separate read-only diagnostic tasks from repair tasks at step 0:

- **Read-only investigation or forensics (`investigation`, `runtime-forensics`, `trace-forensics`).** The deliverable is a cited causal explanation, hot-path or retainer proof, or tradeoff recommendation. Spawn `ro-*` workers (`workspace: "inherit"`) only, touch zero repository files, and stop once the mechanism is proven or bounded. For broad architectural walkthroughs or git/issue archaeology, delegate directly to `/understand` ([../../understand/SKILL.md](../../understand/SKILL.md)).
- **Defect repair (`bug-fix`).** Carry the surviving root cause from `ro-*` investigation straight into an executable failing reproduction, a minimal root-cause fix via warm `fork` into `impl-fix` (`workspace: "share"`), and independent `ro-verify` proof.

## Phase 1. Parallel `ro-*` competing-hypothesis probes

Instead of testing guesses serially in one thread, partition the search space across `2` to `4` read-only `ro-*` workers (`workspace: "inherit"`):

1. **Seed distinct hypotheses.** Frame `2` to `4` falsifiable candidate mechanisms (such as state race in reducer vs stale persisted cache after restart vs boundary parser dropping a field) plus git regression history (`git log -S` / `git log -L`).
2. **Fan out `ro-probe-*` workers.** Assign one hypothesis or subsystem boundary per `ro-probe-*` worker (passing `<plugin-root>/roles/research.md` in each brief when global `hooks.json` is not active). Enforced by `hooks/guard.mjs`, `ro-*` workers cannot mutate repository files and may write temporary query artifacts only inside temp roots (`/tmp`).
3. **Share clues live on the board.** Each `ro-probe-*` posts concrete observations (`#seq`) with `file` and `line` pointers, command outputs, or falsifications as soon as found. When `ro-probe-2` proves the wire payload is already corrupt on ingress, peers immediately pivot upstream instead of auditing downstream UI rendering.
4. **Attack failed premises.** If two candidate explanations sharing one assumption both fail empirical checks, invoke `Attack the Premise` from [../references/principles.md](../references/principles.md). Write down the shared assumption and test it directly before spawning another probe.

## Phase 2. Trace, runtime, and boundary correlation

### Live runtime forensics (`control-ui` and `control-cli`)

When diagnosing a live symptom (idle CPU spin, memory growth, layout flicker, hung PTY):

1. Pass the resolved `<plugin-root>/skills/control-ui/SKILL.md` ([../../control-ui/SKILL.md](../../control-ui/SKILL.md)) or `<plugin-root>/skills/control-cli/SKILL.md` ([../../control-cli/SKILL.md](../../control-cli/SKILL.md)) path in `ro-runtime`'s brief rather than telling the worker to invoke plugin skills by name. Have `ro-runtime` drive the target on an isolated port or PTY session and capture a real signal (CPU profile, heap snapshot, CDP performance trace, syscall summary, or structured event stream).
2. Reduce bulky captures inside an `ro-runtime` worker (`Guard the Context Window`) down to the exact hot stack frame, GC root retainer chain, or unthrottled timer loop.
3. Confirm the mechanism empirically (for example via read-only CDP expression evaluation or comparing controlled input runs) and map it to exact source file, symbol, and line.

### Captured trace forensics (fixed dataset artifacts)

When handed an existing `.cpuprofile`, `.json.gz` trace, `.heapsnapshot`, or spindump file:

1. Treat the capture as an immutable dataset inside `ro-trace` (`workspace: "inherit"`). Do not re-run the app in place of reading the capture.
2. Load structured traces or heap graphs into a temporary SQLite database (`/tmp/trace-<id>.db`) with one row per sample, frame, or heap edge so `ro-trace` queries exact aggregates instead of eyeballing megabytes of JSON (`Build the Lever`).
3. Walk top self-time frames, blocked thread wait states, or retainer paths back to symbol-resolved source lines. If symbols are stripped, resolve source maps first or report explicitly that the capture lacks symbols.
4. Diff paired `before` and `after` captures when both exist. Without a paired capture or live repro, label the conclusion explicitly as the strongest artifact-supported hypothesis rather than a proven live cause.

### Cross-boundary correlation

Trace state transitions across CLI/UI input, IPC/RPC serialization, worker queues, and persisted storage to pinpoint the **first place state went wrong** (`Fix Root Causes`). Ask whether the triggering state is legitimate in the domain:

- If legitimate, the consumer that crashed on it is the root fault.
- If illegitimate, the upstream producer that emitted it is the root fault, and adding a downstream nil guard or retry only hides the bug.

If the request is read-only, synthesize the `ro-*` `#seq` evidence and reply to the user here.

## Phase 3. Failing reproduction and warm `fork` into `impl-fix`

Once one `ro-*` investigator (`ro-winner`) isolates and proves the root mechanism with runtime evidence:

1. **Warm-fork the author.** Spawn `impl-fix` with `swarm{action: "add", name: "impl-fix", workspace: "share", fork: "ro-winner", brief: "..."}`. Forking carries every file read, stack trace, and boundary invariant already in `ro-winner`'s context straight into an isolated writable worktree, upgrading its capsule from `roles/research.md` to `roles/poteto-agent.md` automatically on next turn when global `hooks.json` is active (pass `<plugin-root>/roles/poteto-agent.md` explicitly in the brief when global `hooks.json` is not active).
2. **Prove failure before touching production code.** Inside `impl-fix`'s `share` worktree:
   - When the defect has a clear, fast behavioral test path, write the focused regression test first (`Test Behavior, Not Implementation`) and run it to confirm it fails for the exact expected reason.
   - When unit harnesses would require brittle mocks or heavy synthetic setup, pass the resolved `<plugin-root>/skills/control-ui/SKILL.md` or `<plugin-root>/skills/control-cli/SKILL.md` path in `impl-fix`'s brief so it reproduces the failure directly on the real surface or via a targeted reproduction script and captures verbatim failing output. Do not hand reproduction back to the human unless a hardware or external-credential barrier is documented after driving automation to its limit.
3. **Fix the root cause minimally.** Make the smallest production edit that eliminates the fault, sweep the repository for sibling occurrences of the same bug pattern, and revert any exploratory logging or belt-and-suspenders tweaks that did not contribute to fixing the repro.
4. **Sequence commits cleanly.** When an automated regression test was added, commit the failing test first and the production fix second (`Sequence Verifiable Units`) so anyone replaying git history can watch the test fail at `HEAD~1` and pass at `HEAD`.

## Phase 4. Independent `ro-verify` regression proof

1. Once `impl-fix` commits cleanly and posts its commit SHA, worktree path, and failing-then-passing output (`#seq`), dispatch an independent `ro-verify` worker (`workspace: "inherit"`).
2. `ro-verify` inspects the diff in `<impl_fix_cwd>`, verifies that the test fails without the fix (or checks `HEAD~1` vs `HEAD`), reruns the original surface reproduction plus surrounding test suites, and posts `PASS` or `ISSUES` (`#seq`).
3. After `ro-verify` posts `PASS`, fetch and merge `impl-fix`'s commits into the coordinator worktree (`git fetch <impl_fix_cwd> <sha> && git merge --no-edit FETCH_HEAD`) **before** calling `swarm{action: "kill", name: "impl-fix"}` and retiring `ro-*` task workers (leaving `monitor` and `narrator` alive unless asked).
4. Include the broken behavior, proven root cause, minimal fix, and verbatim failing-before and passing-after reproduction output in your reply (or chain into [ship.md](ship.md) when a PR was requested).
