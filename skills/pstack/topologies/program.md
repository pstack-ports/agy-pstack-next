# Program topology

Use the `program` topology for multi-phase plans, multi-area initiatives, stacked branch series, long autonomous runs, safe mid-run pauses, cold-start session pickups, and local worktree cleanup. Work that one author slice and one verifier can finish inside a single session belongs in [build.md](build.md) or [diagnose.md](diagnose.md), not here.

## Select the program mode

Declare the operating mode before spawning workers so every member holds the same stop line:

- **`plan-only`.** Produce an auditable multi-phase or multi-PR checklist document with explicit dependencies, file ownership fences, unit/live/perf verification blocks, and operator review gates. Settle open technical questions first with cheap prototypes via [build.md](build.md) and record their commit SHAs and screenshots in an appendix. Stop and hand the plan path to the user without implementing production code.
- **`autonomous`.** Drive one complex multi-step objective continuously to a falsifiable exit predicate (such as all migration slices green, zero pixel diff across components, or full suite passing) using `schedule` timers or `/goal`. Fix supporting obstacles in flight, commit only units that advance the predicate, and revert changes that fail to move it.
- **`stack`.** Build and independently verify a dependency-ordered chain of branches or PRs across `impl-*` and `lead-*` workers (`workspace: "share"`), then stop at verified local branches (or ready PRs when requested) so the human operator controls landing.
- **`full`.** Execute a multi-PR queue or multi-area DAG end to end through independent swarm verification and bottom-up landing via [ship.md](ship.md), strictly within an explicit user grant to push and merge.

## Multi-area `lead-<area>` delegation and optional channels

1. **Size the hierarchy.** Stay flat (coordinator plus leaf workers) when `8` or fewer workers are active. When a program exceeds `8` concurrent workers or spans multiple coupled subsystems, spawn one `lead-<area>` worker (`workspace: "share"`) per subsystem. Check whether the live `swarm` tool declaration includes `"channel"` in `action`. When `"channel"` is available, create dedicated channels with `swarm{action: "channel"}` (such as `#auth`, `#storage`, `#ui`) and assign each `lead-<area>` and its leaf workers to that channel. When `"channel"` is absent, coordinate on the main board through `lead-<area>` coordinators with strict `@mention` discipline so leaf workers mention only `@lead-<area>` and never wake unrelated slices or `@all`.
2. **Hold the three-tier ceiling.** Never nest deeper than coordinator, `lead-<area>`, and leaf workers (`impl-*`, `ro-*`, `adv-*`, `sicko-*`). Each `lead-<area>` manages roughly `4` to `8` leaf workers in its area (inside `#<area>` when channels exist, or on the main board via targeted `@lead-<area>` mentions when channels are absent), verifies slice diffs, merges passing leaf commits into its area branch, and posts a single consolidated `#seq` rollup back to `@coordinator`. Pass explicit resolved `<plugin-root>/skills/<name>/SKILL.md` paths (and `<plugin-root>/roles/<capsule>.md` paths when global `hooks.json` is not active) in `lead-<area>` and leaf briefs rather than naming plugin skills.
3. **Run one canary unit first.** Before fanning out across dozens of similar modules or PRs, take one representative slice all the way through `impl-1`, `ro-verify`, and branch integration. Fix any flaw in the brief, harness, or file fence while the mistake costs one worker instead of twenty.
4. **Enforce disjoint write fences.** Assign non-overlapping directories or files to every `impl-*` and `lead-*` brief per `Separate Before Serializing Shared State` in [../references/principles.md](../references/principles.md). Coordinator and `lead-*` own decomposition, boundary checks, and merge integration rather than hand-editing application files.

## Stacked branches and patch-id continuity

1. **Branch from trunk by default.** Independent slices branch directly from `main` (or the repository's base branch) so they can verify and land in any order without cascading rebases.
2. **Stack only on true code dependencies.** Base slice `B` on slice `A`'s branch tip only when `B` imports types, schemas, or helpers introduced by `A`.
3. **Carry verdicts across clean restacks.** When a lower branch updates and upper branches rebase onto its new tip, compare `git diff <old_base> <old_head> | git patch-id --stable` against `git diff <new_base> <new_head> | git patch-id --stable`. If the patch-id is identical and fast checks pass, the prior `ro-verify` behavioral verdict carries forward. If conflict resolution or drift changed the patch-id, trigger a fresh `ro-verify` pass at the new SHA.
4. **Countersign gate changes.** An author or area lead cannot unilaterally raise a perf budget, widen an allowlist, or soften a lint rule. Any gate relaxation requires independent `ro-verify` proof plus explicit `@coordinator` countersign on the board. Disabled or skipped checks are always rejected.

## Board checkpointing, heartbeat audits, pause, and pickup

### Continuous board checkpoints

Treat the swarm board as the authoritative operational ledger. At the end of every completed unit, post an unaddressed checkpoint message recording:

- Unit identifier and goal slice.
- Exact commit SHA and `share` worktree path (`pwd`).
- Verification commands run, `ro-verify` `#seq` citation, and verdict (`PASS`, `ISSUES`, or `BLOCKED`).
- Next pending unit or open dependency.

### Heartbeat supervision on long runs

For unattended multi-hour programs, arm a recurring `schedule` job (such as `CronExpression: "0 * * * *"` with jitter left enabled) until all units finish:

1. Call `swarm{action: "status"}` and page `read_board{since: <last_seen_seq>, limit: 100}` until `<last_seen_seq>` reaches `head`.
2. Judge active workers by side effects (`git log`, commits, test artifacts, PR state) rather than prose promises.
3. Hot-swap waiting workers hitting quota or capacity limits via `swarm{action: "model", name, model}`. If a worker stalls or loops without side effects, harvest any useful partial commit from its worktree first, `swarm{action: "kill"}` it, and spawn a fresh replacement with consolidated scope (narrowing slice size if context overflowed).
4. Emit a concise `/ketchup` delta to the user only when a tracked milestone, blocker, or operator-gated decision changed since the previous tick. Stay silent on no-op ticks.

### Pause safely

Run this procedure only when the operator explicitly asks to pause, hold, or prepare for offline handoff (never on "keep going" or "going to bed"):

1. Broadcast `@all` ordering an immediate zero-writes hold after the current atomic edit completes.
2. Take zero irreversible external actions (`git push`, PR creation, merges).
3. In each active `share` worktree with uncommitted tracked edits, save a local `wip: <slice> checkpoint` commit (noting in the commit body if tests are mid-flight) and fetch/record those SHAs into the coordinator's local ref namespace so nothing can be lost.
4. Post a `#seq` pause summary on the board and write `<appDataDir>/brain/<conversation-id>/resume.md` listing the goal, landed SHAs, active `wip:` branches, verified vs unverified slices, and the exact first command to run on resume.

### Session pickup

When resuming a paused swarm, prior conversation transcript, or existing branch stack:

1. Reconstruct state by paging `read_board{since: <cursor>, limit: 100}` from `<cursor> = 0` until `<cursor>` reaches `head` (because `read_board` defaults to `limit: 20`), alongside `swarm{action: "status"}`, `git worktree list`, and `git log --oneline -n 20`. If resuming from a prior session's `<appDataDir>/brain/<prior-id>/.system_generated/logs/transcript.jsonl`, spawn a single `ro-pickup` worker (`workspace: "inherit"`) to extract the decision timeline without flooding coordinator context.
2. Treat prior `#seq` verdicts and landed commits as authoritative inputs rather than redoing completed slices from scratch.
3. Diff completed units against the remaining plan, verify inherited end-state claims once against the real artifact, and dispatch workers starting at the exact unfinished frontier.

## Clean worktree landing and disk cleanup

### Land before `kill`

`swarm{action: "kill", name}` permanently deletes that worker's `share` or `branch` worktree. Follow this exact teardown sequence at phase or program end:

1. Confirm each finished worker (`impl-*`, `lead-*`, `sicko-*`) committed cleanly (`git -C <worker_cwd> status --short` empty).
2. Fetch and integrate each verified commit into the coordinator or integration branch (`git fetch <worker_cwd> <sha> && git merge --no-edit FETCH_HEAD` or `git cherry-pick <sha>`).
3. Run final verification on the integrated tree.
4. Call `swarm{action: "kill", name}` on every task worker (`impl-*`, `cand-*`, `lead-*`, `ro-*`, `adv-*`, `sicko-*`) while leaving built-in `monitor` and `narrator` (`*-N`) alive unless the user asks, then post `[done] <summary>` with no `@` so `monitor` goes quiet.

### Standalone worktree and simulator cleanup

When the user asks to reclaim disk space or prune stale git worktrees:

1. Record baseline disk free space with `df -h /` and enumerate every worktree from `git worktree list --porcelain` (never from guessed directory globs).
2. Spawn `ro-audit` (`workspace: "inherit"`) to classify each candidate worktree by disk size, age, merge ancestry against base (`git merge-base --is-ancestor`), open/merged PR state (`gh pr list`), tracked uncommitted edits (`wip:N`) vs untracked throwaways (`scratch:N`), and recent references in `<appDataDir>/brain/*/.system_generated/logs/transcript.jsonl`.
3. Cross-check active or pinned user chats before touching anything. Pause and show the diff for any `wip:N` worktree with uncommitted tracked edits, because deleting uncommitted work is irreversible.
4. Prune only confirmed merged, clean, inactive worktrees (`git worktree remove --force <path>` followed by `git worktree prune`). When requested on macOS, reclaim simulator clutter with `xcrun simctl --set testing delete all` and `xcrun simctl delete unavailable`.
5. Report `df -h /` before and after, space reclaimed, pruned paths, and a one-line hold reason for every retained worktree.
