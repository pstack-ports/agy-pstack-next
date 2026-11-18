# Pstack Built-in `swarm` Contract

All technical work in `agy-pstack-next` runs through Antigravity's built-in `swarm`.

## 1. Built-in `swarm` First (Zero Overrides)

Before your first `swarm` call in a session, `read_file` the built-in `swarm` skill in `<skills>` (and `swarm_pane` if present in `<skills>`). Follow every built-in `swarm` rule as written—coordinator-only role (`Do not do the work`), turn-1 setup (`title`, task workers, `monitor`, `swarm_pane` `plan.json` or `narrator`, `open_board`), default conversation-model inheritance and quota hot-swaps, board/channel etiquette (`@name` only for the next actor, `#seq` citations, `swarm_wait{since}`), `1` independent `verifier` per `2–4` authors, and `[done] <summary>` shutdown. Never override built-in `swarm` rules or bypass `swarm` with `invoke_subagent` / `run_workflow` (except `image-generator` for visual assets).

## 2. Multi-Worktree & Process Isolation

- **Anchor `TARGET_CWD`.** Resolve the active target worktree via `git -C <TARGET_CWD> rev-parse --show-toplevel` (never `[ -d .git ]`, which is a file in linked worktrees, and never assume a single workspace root).
- **Workspaces.** Keep read-only scouts, mappers, blind `judge`, and diff/repro `verifier`s on `workspace: "inherit"`. Put authors, exploit writers, live drivers, and cold `verifier`s that check out unmerged commits or inject scratch breaks on `workspace: "share"` so `TARGET_CWD` stays untouched until `PASS`.
- **Detached checkouts & isolated runs.** In `share` worktrees, fetch peer commits onto detached `HEAD` (`git fetch <peer_cwd> <sha> && git checkout --detach FETCH_HEAD`—never shared branch names across linked worktrees). Allocate per-run state with `mktemp -d "${TMPDIR:-/tmp}/pstack-XXXXXX"` (never shell `$$` across `run_command` calls or static `/tmp` paths), bind `--port 0`, isolate browser profiles and `tmux -L` sockets, and tear down only recorded PIDs/sockets (never `pkill` or `killall`). Write worker reports `> 4` KB to `<appDataDir>/brain/<conversation-id>/scratch/<worker>-report.md`.

## 3. Worker Briefs, Plugin Paths & Verified Landing

- **Resolved plugin paths.** Swarm workers do not mount global plugin skills in `<skills>`. Never tell a worker to invoke `/statechart`, `/typescript-best-practices`, or `../` skill links by slash name; inline the 3–4 relevant rules from [`principles.md`](principles.md) and pass resolved absolute `<plugin-dir>/skills/...` paths for `read_file` or `<plugin-dir>/skills/statechart/scripts/statechart` (repo-local `$PWD/.agents/skills/verify-*` is read directly).
- **Brief contract.** State: (1) goal and `TARGET_CWD`, (2) owned files and forbidden paths (disjoint across concurrent authors), (3) inlined rules/paths above, and (4) handoff: *"Strip disposable comments, commit locally with clean `git status --short`, never `git push` or open PRs, and post `@<next-actor> [done] <sha> <cwd>` plus proof."*
- **Audit & land before `kill`.** Author self-tests never count as final proof. Before `swarm{action: "kill"}` deletes a `share` worktree: require an independent `verifier` `PASS`, audit `git -C <worker_cwd> show --stat <sha>` and `git -C <worker_cwd> diff <base>..<sha>` against [`principles.md`](principles.md), land via `git -C <TARGET_CWD> fetch <worker_cwd> <sha> && git -C <TARGET_CWD> merge --no-edit FETCH_HEAD` (or `cherry-pick`), and confirm `git -C <TARGET_CWD> log -1`.
