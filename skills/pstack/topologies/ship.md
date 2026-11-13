# Ship topology

Use the `ship` topology for pre-PR verification, local branch integration, pull request creation, CI and Bugbot babysitting, bottom-up stack landing, and final swarm teardown.

## Local-first default and explicit push gate

1. **Never push or open a PR unasked.** By default, every `/pstack` workflow finishes on a clean, verified local git branch. Push to a remote, open or update a pull request, babysit remote checks, or merge **only** when the user explicitly requests that step (or grants `full` / `stack` PR autonomy).
2. **Understand the `hooks/guard.mjs` push gate.**
   - `ro-*`, `adv-*`, and `sicko-*` workers are permanently blocked from `git push`.
   - Force-pushing (`--force` or `-f`) to `main` or `master` is permanently blocked across all roles.
   - Author workers (`impl-*`, `cand-*`, `lead-*`) are blocked from `git push` unless the user explicitly requested remote publication and the command sets `PSTACK_ALLOW_PUSH=1` (for example, `PSTACK_ALLOW_PUSH=1 git push -u origin <branch>`). Use `--force-with-lease` only when restacking an owned feature branch, never bare `--force`.

## Phase 1. Land `share` branches locally and verify

Before any remote action or final handoff:

1. **Fetch and integrate before `kill`.** Confirm every active `impl-*`, `cand-*`, `lead-*`, or `sicko-*` worker has a clean worktree (`git -C <worker_cwd> status --short` empty). Fetch and merge or cherry-pick each commit into your local branch (`git fetch <worker_cwd> <sha> && git merge --no-edit FETCH_HEAD`) **before** calling `swarm{action: "kill"}`, because `kill` deletes `share` worktrees immediately.
2. **Shape clean commits.** Order commits into small, self-proving steps (`Sequence Verifiable Units` in [../references/principles.md](../references/principles.md)) with `/technical-writing` ([../../technical-writing/SKILL.md](../../technical-writing/SKILL.md)) discipline. Commit bodies add context rather than restating subjects.
3. **Run `sicko-*` and `ro-verify` gates.** Run a `sicko-*` pass (`workspace: "share"`) when diffs carry unnecessary comments or AI slop, merge its edit, then gate the final `HEAD` SHA with an independent `ro-verify` (`workspace: "inherit"`) running unit, build, and live surface checks (`/control-ui` or `/control-cli`). Run `/interrogate` ([../../interrogate/SKILL.md](../../interrogate/SKILL.md)) on security-sensitive, concurrent, or contested changes.

If the user did not ask to push or open a PR, retire all workers via `swarm{action: "kill"}`, post `[done] <summary>`, and present your local branch and verification evidence.

## Phase 2. Open a pull request (when requested)

1. **Resolve the forge once.** Default to GitHub CLI (`gh`). If `command -v origin` succeeds and resolves the repository, use `origin pr` consistently for create, view, thread, check, and merge operations. Never require Graphite (`gt`). If the runtime provides a native PR creation tool, use it with `draft: false`.
2. **Open ready, never draft.** Create PRs ready for review (`gh pr create --base <base>` without `--draft`, or `origin pr create --status open --base <base>`), unless the user explicitly requested a draft PR. Stack children target their parent PR branch, and independent PRs target trunk.
3. **Format title and concise body.**
   - **Title.** Conventional Commits format `type(scope): imperative subject` with no trailing period (such as `feat(guard): block symlink path escapes in share worktrees`).
   - **Body.** Keep under roughly 40 lines using `/technical-writing` so squash-merge commit history stays crisp. Include `##` sections in this exact order, dropping optional sections that have nothing real to say:
     - `## Why` (1 to 3 short sentences opening with the user's goal and problem)
     - `## What changed` (1 to 3 bullets naming load-bearing symbols or paths)
     - `## Scope` (1 to 3 items stating what is covered and what is intentionally out of scope)
     - `## Tradeoffs` (only when a non-obvious alternative was rejected)
     - `## Blast Radius` (1 to 2 sentences on affected callers or runtime boundaries)
     - `## Verification` (1 to 3 bullets naming exact commands or surface checks and outcomes, with one primary `before -> after` metric for perf PRs)
   - Never dump swarm `#seq` transcripts, full SHA tables, or verbose checklists into the PR body.
4. **Do not auto-babysit on creation.** Opening a PR posts the verified URL (`gh pr view <n> --json url`) and returns unless the user also asked to babysit checks/reviews or ship to merged.

## Phase 3. CI and review babysitting (`scripts/watch-pr`)

When asked to check on a PR, get a PR or stack green, or address Bugbot/review comments:

1. **Declare babysit mode first.**
   - `drive` polls until merge-ready ("babysit this", "get PR X green").
   - `background` triages asynchronously alongside active build phases.
   - `threads-only` triages and resolves review comments only ("address Bugbot comments").
   - `check` runs one snapshot pass (`--status-only`) and reports ("check on PR X").
2. **Work strictly at the merge frontier.** In a stack, the lowest unmerged PR is the frontier. Read and batch upstack review threads, but never push upstack fixes that restart frontier CI while the frontier is unresolved. Handle blockers in strict priority order:
   1. Merge conflicts (report exact branch needing rebase to the branch owner `impl-*` / `lead-*` along with a caller-drift check against trunk).
   2. Unresolved review threads.
   3. Failing CI checks.
   4. Merge gates (`draft-pr` or `changes-requested`).
3. **Drive wakeups with `scripts/watch-pr`.** On GitHub, run the zero-dependency watcher at [../scripts/watch-pr](../scripts/watch-pr) (`./skills/pstack/scripts/watch-pr --pr <n>`, `--stack`, `--queued-stack --stack-prs <bottom-to-top>`, or `--status-only`, adding `--pretty` for human tables). On Origin, use `origin pr view <pr> --checks --comments`, `origin pr thread list <pr>`, and `origin pr checks <pr> --watch`. Pair long watches with `schedule` or `/goal` rather than shell sleep loops, and rearm after every push wave.
4. **Classify CI before retrying.**
   - Never blindly rerun failed jobs. Inspect failing child logs via `ro-ci` (`workspace: "inherit"`).
   - Genuine infrastructure flake earns at most **one** fresh build rerun. An identical second failure proves a deterministic defect.
   - Check `git merge-base --is-ancestor` when unrelated tests fail so stale-base trunk drift is fixed by rebasing rather than spurious code edits.
5. **Triage Bugbot and security bots skeptically.** Evaluate every automated review comment against `HEAD` using `ro-triage` and the rubric in [../references/bugbot-triage.md](../references/bugbot-triage.md) (`fix`, `dismiss`, or `ask`):
   - Route `fix` items to `impl-fix` (`workspace: "share"`) on the lowest owning unmerged PR (or a new follow-up PR on top of the stack if the owning PR already merged), prove with a regression test, verify via `ro-verify`, merge into the PR branch, and push one batched wave (`PSTACK_ALLOW_PUSH=1`).
   - Reply to threads safely using JSON payload files (`gh api --method POST "repos/<owner>/<repo>/pulls/<pr>/comments/<comment-id>/replies" --input <payload.json>` or `origin pr thread reply <id> <pr> --body-file <file>`), never interpolating untrusted comment text into shell strings.
   - Stop `drive` at merge-ready (`READY` in single/stack mode, or blocker-free `WAITING` with `merge-queue` in queued mode). Babysitting never merges without an explicit shipping request. Offer reusable new dismissal patterns as updates to [../references/bugbot-triage.md](../references/bugbot-triage.md).

## Phase 4. Bottom-up stack shipping and swarm teardown

Run this phase **only** when the user explicitly asks to land, merge, or ship:

1. **Verify every PR independently.** Green CI and bot approvals do not substitute for behavioral proof. Confirm each PR has an independent `ro-verify` verdict (`PASS` or `PASS+NOTES`) on its current `HEAD` (or an unchanged `git patch-id --stable` after a clean restack whose fast gates passed).
2. **Compute the contiguous verified run.** Walk upward from the bottom unmerged PR and stop before the first PR lacking a valid `PASS` verdict. Never land an upper PR across an unverified parent unless it has zero code dependency on that parent, is rebased directly onto trunk, and earns a fresh `ro-verify` pass on trunk.
3. **Merge bottom-up one PR at a time.**
   - Merge the lowest PR (`gh pr merge <pr> --squash` or `origin pr merge <pr>`), then read back `gh pr view <pr> --json state,mergedAt,baseRefName` to confirm actual merge into trunk (queued auto-merge is not yet merged). Arm `--auto` only when `ro-verify` already cleared the exact current `HEAD`.
   - Once merged, retarget the immediate child PR to trunk (`gh pr edit <child> --base <trunk>` or `origin pr edit <child> --base <trunk>`), rebase onto trunk, verify patch-id continuity and checks, push with `PSTACK_ALLOW_PUSH=1 git push --force-with-lease`, and watch queued stacks with `./skills/pstack/scripts/watch-pr --queued-stack --stack-prs <bottom-to-top>` until `COMPLETE`.
4. **Teardown with `swarm{action: "kill"}`.** Once all local branches or requested PRs have landed, check `swarm{action: "status"}`, call `swarm{action: "kill", name}` on every active or waiting worker you spawned, post `[done] <summary>` on the board, and deliver the final report with live PR states and verification receipts.
