# Build topology

Use the `build` topology to ship features, execute behavior-preserving refactors, run rapid empirical prototypes, and drive pixel-exact visual parity migrations across parallel `impl-*` workers.

## Select the build mode

Match the request to one of four execution contracts before slicing files:

- **`feature`.** Add or change observable behavior starting from an explicit domain model and typed boundary contract.
- **`refactor`.** Reshape internal structure, module boundaries, or internal APIs while holding observable behavior strictly invariant against a pre-change characterization pin. Split any newly discovered bug or feature request into its own follow-up slice rather than mixing behavior changes into a refactor.
- **`prototype`.** Build a fast throwaway sketch in an isolated scratch directory or `cand-*` worktree to settle an empirical UX, layout, or runtime timing question before committing to production architecture.
- **`visual-parity`.** Migrate components, styling systems, or rendering engines to pixel-exact equivalence verified by automated screenshot diffs against a frozen baseline.

## Phase 1. Ground, model, and checkpoint

1. **Ground non-obvious invariants.** Run `/understand` ([../../understand/SKILL.md](../../understand/SKILL.md)) when subsystem contracts or historical constraints are unclear. When a change crosses module boundaries with multiple viable designs, run `/crucible` ([../../crucible/SKILL.md](../../crucible/SKILL.md)) in `sketch` or `full` mode first, or model complex lifecycle state with `/statechart` ([../../statechart/SKILL.md](../../statechart/SKILL.md)).
2. **Choose the data shape first.** Define core domain types, discriminated unions, branded IDs, and state transitions per `Model the Domain` in [../references/principles.md](../references/principles.md) and [../references/ts-patterns.md](../references/ts-patterns.md) before any worker writes implementation code.
3. **Write the four-part throughput checkpoint.** Record these four items in `<appDataDir>/brain/<conversation-id>/task.md` (marking `n/a` with a concrete reason only when a single-file task needs one author):
   - **Blocking foundations.** Shared types, schemas, characterization pins, or primitive components that must land before fan-out.
   - **Disjoint workstreams.** Exact file or directory globs assigned to each `impl-*` worker so zero files overlap.
   - **Shared mutable state.** How shared registries, exports, ports, or test fixtures are split first (`Separate Before Serializing Shared State`) and integrated at the merge step.
   - **Smallest safe decomposition.** Exact author count (`impl-1` .. `impl-k`) and verifier count (`1` `ro-verify` worker per `2` to `4` authors).

## Phase 2. Mode-specific execution rules

### Feature slices (`impl-*`, `workspace: "share"`)

- Subtract dead code and obsolete flags in touched files before adding new branches (`Subtract Before You Add`).
- Give every `impl-*` brief the user's goal, exact owned file paths, forbidden paths, agreed domain types, behavioral test expectations (`Test Behavior, Not Implementation`), and exact verification command. Because workers do not mount plugin skills in `<skills>`, pass explicit resolved `SKILL.md` paths (such as `<plugin-root>/skills/control-ui/SKILL.md`, `<plugin-root>/skills/control-cli/SKILL.md`, or `<plugin-root>/skills/statechart/SKILL.md`) whenever a slice needs them, plus `<plugin-root>/roles/poteto-agent.md` when global `hooks.json` is not active.
- Keep one coupled feature inside one `impl-1` worktree when splitting it would force speculative mocks across unfinished halves. Fan out across `impl-1` .. `impl-k` when modules, layers, or consumers partition cleanly.

### Caller-migrating refactors (`refactor`)

1. **Pin behavior before moving structure.** Have `ro-contract` (`workspace: "inherit"`) map all callers and observable outputs. If behavioral test coverage is missing, land a characterization test or output-diff snapshot commit first. Typecheck and lint alone never qualify as a behavior pin.
2. **Subtract first.** Delete dead exports, collapse single-caller pass-through wrappers, and remove redundant internal checks in a dedicated commit.
3. **Migrate callers then delete legacy APIs in one wave.** Across disjoint `impl-*` slices (or via a deterministic codemod script per `Build the Lever`), update every internal caller to the new API and delete the old signature, shim, and obsolete implementation-pinned tests in the same wave. Spot-check string literals, config files, and docs for stale symbol names.
4. **Enforce the reader-load gate.** Compare indirection depth and mutable state scope before and after (`Minimize Reader Load`). Revert any structural change that fails to make the module easier to trace within 30 seconds.

### Throwaway empirical sketches (`prototype`)

- Scope the exact empirical fork the sketch exists to settle (interaction feel, layout density, frame timing, protocol behavior). If no decision is open, skip straight to `feature`.
- Build inside an isolated scratch directory (`/tmp/proto-<slug>`) or disposable `cand-*` worktree using the lightest runnable stack without production abstractions. Put competing UI or interaction variants behind one live toggle so they can be compared side by side (`Exhaust the Design Space`).
- Drive and capture evidence on the real target using [../../control-ui/SKILL.md](../../control-ui/SKILL.md) or [../../control-cli/SKILL.md](../../control-cli/SKILL.md) (passing the resolved `<plugin-root>/skills/control-ui/SKILL.md` or `<plugin-root>/skills/control-cli/SKILL.md` path in the worker brief rather than naming plugin skills). Present screenshots or measured timings, tradeoffs, and a clear recommendation, then delete or retire the throwaway prototype before implementing the production slice cleanly under `feature`.

### Visual parity loops (`visual-parity`)

1. **Lock the visual baseline first.** Before editing any component or stylesheet, capture reference screenshots across every interactive state (default, hover, focus, empty, error, responsive breakpoints) following [../../control-ui/SKILL.md](../../control-ui/SKILL.md). Store baseline hashes outside author write fences.
2. **Hold strict anti-shortcut rules.** Workers must never overwrite baseline PNGs, loosen pixel-diff thresholds, crop regions, or alter the comparison script to pass. If a baseline capture looks broken, halt and ask the user rather than editing the reference.
3. **Migrate primitives first, then fan out components.** Land shared tokens and base primitives as a blocking first commit. Then assign one component per `impl-*` worker (`workspace: "share"`), passing the resolved `<plugin-root>/skills/control-ui/SKILL.md` path in each brief so every worker reads the isolation rules directly and runs its own ephemeral dev-server port and isolated browser `--user-data-dir` without colliding.
4. **Loop to zero diff.** Each `impl-*` iterates on its component and reruns the automated image diff until pixel delta reaches zero (using `schedule` or `/goal` on large component sweeps).

## Phase 3. Integrate and run `sicko-*` surgical cleanup

1. Fetch and merge each completed `impl-*` slice into your integration worktree (`git fetch <impl_cwd> <sha> && git merge --no-edit FETCH_HEAD`) while keeping `impl-*` workers parked in `waiting` until verification clears.
2. Spawn `sicko-clean` (`workspace: "share"`) on the integrated tree (passing `<plugin-root>/roles/comment-sicko.md` in its brief when global `hooks.json` is not active). Enforced by `hooks/guard.mjs`, `sicko-*` can call `edit_file` only (`write_file`, shell file redirects, and `git push` are denied) to strip narrating comments, AI code slop, redundant try/catch guards on trusted paths, and unexamined lint suppressions, flagging any load-bearing constraint comments that should be encoded structurally instead.
3. Audit `sicko-clean`'s diff to confirm zero behavioral mutations, fetch and merge its commit into the integration tree, and retire `sicko-clean` with `swarm{action: "kill", name: "sicko-clean"}`.

## Phase 4. Independent `ro-verify` behavioral gate

Maintain a ratio of **`1` `ro-verify` worker (`workspace: "inherit"`) per `2` to `4` `impl-*` authors**. Never let an author's self-test count as the final gate.

1. Pass `ro-verify` the integrated worktree path, exact `HEAD` commit SHA, user goal, required surface checks, and resolved `<plugin-root>/skills/control-ui/SKILL.md` or `<plugin-root>/skills/control-cli/SKILL.md` paths (plus `<plugin-root>/roles/research.md` when global `hooks.json` is not active).
2. `ro-verify` reads the passed `SKILL.md` path directly and executes unit/integration suites, typecheck/lint gates, and live behavioral scenarios for web/Electron/IDE or CLI/TUI surfaces using isolated ports and temp state directories.
3. `ro-verify` opens its final report on the board (`#seq`) with `@<target> [done]` followed immediately by `PASS` (or `PASS+NOTES` when non-blocking notes apply), `ISSUES`, or `BLOCKED`, citing exact commands and observed outputs. Route `ISSUES` back to the owning `impl-*` worker for a targeted fix and re-verification at the new SHA. An inconclusive check reports `BLOCKED` and never counts as `PASS`. Resolve or surface any `BLOCKED` prerequisite before closing.
4. For contested architectures, auth or security boundaries, or subtle state transitions, run `/interrogate` ([../../interrogate/SKILL.md](../../interrogate/SKILL.md)) before closing.
5. Once `ro-verify` posts `PASS` (or `PASS+NOTES`) at the integrated `HEAD` SHA, kill all task workers (`impl-*` and `ro-*`, leaving `monitor` and `narrator` alive unless asked) via `swarm{action: "kill"}` (their commits are already merged locally). Stop at the clean local branch, or chain into [ship.md](ship.md) if the user asked to open or land a PR.
