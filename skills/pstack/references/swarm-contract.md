# Pstack Built-in `swarm` Contract

Multi-agent technical workflows in `agy-pstack-next` run through Antigravity's built-in `swarm`, while portable Layer 1 skills and generated `.agents/skills/verify-*` gates run inline in embedded or non-swarm contexts.

## 1. Built-in `swarm` First (Zero Overrides)

Before your first `swarm` call in a session, ensure Antigravity's built-in `swarm` instructions are loaded (plus `swarm_pane` if listed in `<skills>`) and follow them as written without overrides: if `/swarm` was not already expanded in this session and `swarm` is omitted from `<skills>` (built-in `swarm` sets `disable-model-invocation: true`), `read_file` `<appDataDir>/builtin/skills/native_swarm/SKILL.md` (using `App Data Directory` from `<user_information>`). If that read is unavailable or denied, ask the user to invoke `/swarm` (or approve reading that file) rather than guessing built-in swarm conventions. Never bypass `swarm` with `invoke_subagent` or `run_workflow` (except `image-generator` for visual assets).

- **Embedded & Non-Swarm Contexts (Layer 1 Portability).** When [`/typescript-best-practices`](../../typescript-best-practices/SKILL.md), [`/statechart`](../../statechart/SKILL.md), or a repo-local `.agents/skills/verify-*` skill is invoked inside `/boost`, `/teamwork`, an IDE extension, an existing swarm worker turn, or a single-file task, execute its rules and checks inline without spawning a nested `swarm`. When a task fits `/boost` or `/teamwork` better than `/swarm`, emit a grounded handoff brief per [`orchestrator-interop.md`](orchestrator-interop.md) rather than wrapping those commands programmatically.

## 2. Multi-Worktree & Process Isolation

- **Anchor `TARGET_CWD`.** Resolve the active target worktree via `git -C <TARGET_CWD> rev-parse --show-toplevel` (never `[ -d .git ]`, which is a file in linked worktrees, and never assume a single workspace root).
- **Workspaces.** Keep read-only scouts, mappers, blind `judge`, and diff/repro `verifier`s on `workspace: "inherit"`. Put authors, exploit writers, live drivers, and cold `verifier`s that check out unmerged commits or inject scratch breaks on `workspace: "share"` so `TARGET_CWD` stays untouched until `PASS`.
- **Detached checkouts & isolated runs.** In `share` worktrees, fetch peer commits onto detached `HEAD` (`git fetch <peer_cwd> <sha> && git checkout --detach FETCH_HEAD`—never shared branch names across linked worktrees). Allocate per-run state with `mktemp -d "${TMPDIR:-/tmp}/pstack-XXXXXX"` (never shell `$$` across `run_command` calls or static `/tmp` paths), bind `--port 0`, isolate browser profiles and `tmux -L` sockets, and tear down only recorded PIDs/sockets (never `pkill` or `killall`). Write worker reports `> 4` KB to `<appDataDir>/brain/<conversation-id>/scratch/<worker>-report.md`.

## 3. Worker Briefs, Plugin Paths & Verified Landing

- **Resolved plugin paths.** Swarm workers do not mount global plugin skills in `<skills>`. Never tell a worker to invoke `/statechart`, `/typescript-best-practices`, or `../` skill links by slash name; inline the 3–4 relevant rules from [`principles.md`](principles.md) and pass resolved absolute `<plugin-dir>/skills/...` paths for `read_file` or `<plugin-dir>/skills/statechart/scripts/statechart` (repo-local `$PWD/.agents/skills/verify-*` is read directly).
- **Brief contract.** State: (1) goal and `TARGET_CWD`, (2) owned files and forbidden paths (disjoint across concurrent authors), (3) inlined rules/paths above, and (4) handoff: *"Strip disposable comments, commit locally with clean `git status --short`, never `git push` or open PRs, and post `@<next-actor> [done] <sha> <cwd>` plus proof."*
- **Audit & land before `kill`.** Author self-tests never count as final proof. Before `swarm{action: "kill"}` deletes a `share` worktree: require an independent `verifier` `PASS`, audit `git -C <worker_cwd> show --stat <sha>` and `git -C <worker_cwd> diff <base>..<sha>` against [`principles.md`](principles.md), land via `git -C <TARGET_CWD> fetch <worker_cwd> <sha> && git -C <TARGET_CWD> merge --no-edit FETCH_HEAD` (or `cherry-pick`), and confirm `git -C <TARGET_CWD> log -1`.
