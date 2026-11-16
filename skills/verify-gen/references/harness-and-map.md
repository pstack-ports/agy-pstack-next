# Parallel Harness Isolation & Feature-Map Contract

Reference guide for driving web, Electron, CLI, and TUI surfaces safely across concurrent swarm workers and structuring `.agents/skills/verify-<app>/features/` maps.

## 1. Parallel Swarm Isolation Rules

Multiple swarm workers (`author`, `verifier`, `adv-*`) often run simultaneously on one machine. Isolate every run using `RUN_ID="${WORKER_NAME:-local}-$$"`:

### Web, Electron & CDP Harnesses
- **Ephemeral ports:** Bind dev servers and debug targets dynamically (`--port 0`, `--remote-debugging-port=0`) and read the assigned port from stdout or a readiness file in `/tmp/<app>-$RUN_ID/`. Never hardcode `3000` or `5173` when the app supports dynamic ports.
- **Disposable state & profiles:** Pass per-run app storage (`DATA_DIR=/tmp/<app>-$RUN_ID/data`) and a dedicated browser profile (`--user-data-dir=/tmp/<app>-$RUN_ID/profile`).
- **Stable selectors & observable proof:** Drive via ARIA roles, accessible names, and `data-testid` handles rather than CSS paths or pixel coordinates. Capture both an ARIA snapshot and a full-window screenshot alongside console/network error checks.

### Interactive CLI & TUI Harnesses (`tmux` / PTY)
- **Socket & home isolation:** Use a dedicated tmux socket (`tmux -L "verify-$RUN_ID" -f /dev/null new-session -d -x 120 -y 36 ...`) and temp home/config overrides (`HOME=/tmp/<app>-$RUN_ID/home`, `XDG_CONFIG_HOME=...`, `NO_COLOR=1` or fixed `TERM=xterm-256color`) so terminal dimensions and user dotfiles stays deterministic.
- **Readiness over `sleep`:** Poll `tmux -L "verify-$RUN_ID" capture-pane -p` until the expected prompt or screen marker appears rather than sleeping fixed durations.

### Cleanup & Mutation Proof Invariants
- **Targeted teardown only:** Record exact child PIDs (`echo $! > "/tmp/<app>-$RUN_ID/server.pid"`) or kill the dedicated `tmux -L "verify-$RUN_ID" kill-server` socket. Never run `pkill -f node` or `killall` by binary name.
- **Preserve evidence:** Store screenshots, ARIA dumps, and transcripts in `/tmp/<app>-$RUN_ID/artifacts/` (or `<appDataDir>/brain/<conversation-id>/` when requested for Swarm UI timelines) and confirm proof files still exist **after** cleanup runs.
- **Second-view mutation proof:** Never trust an `"OK"` toast or exit code `0` alone—reopen the list view, query the CLI/API read path, or inspect the disposable SQLite/JSON file to confirm persisted state.

---

## 2. Behavioral `features/` Directory Contract

Every `.agents/skills/verify-<app>/features/` directory contains `README.md` (index, baseline preconditions, driving conventions, and links to feature files) plus one markdown file per user-facing journey.

Each `features/<feature>.md` file starts with an `# <Feature Title>` heading and a one-paragraph user-POV summary, followed by **these exact four `##` sections in order**:

### `## Sub-features`
Bullet list of short kebab-case IDs with one sentence per behavior:
- `create-open` opens a blank editor from each browser entry point.
- `create-save` persists a title and body across reloads.
- `create-cancel` discards an unfinished draft without saving.

### `## How to get to it (user POV)`
Every real user entry point (toolbar button, keyboard shortcut, route, or CLI command).

### `## Driving it with <harness>`
Starts with a `Preconditions:` list (server healthy via `doctor`, disposable data dir, required seed fixtures), followed by labeled bullets pairing each user action with the exact literal command and observable result:
- **Open editor.** Run `<harness> click --role button --name "New note"`. A form named `Note editor` appears with focus in `Title`.
- **Save & confirm persistence.** Fill fields, click `Save`, navigate back to `All notes`, and reopen the item to confirm stored values from a second view.

### `## Gotchas`
Concrete traps that waste or invalidate a run (focus traps on keyboard shortcuts, input trimming, async indexing delays, fixture cleanup rules). Never weaken a journey when a precondition is missing—record the exact unmet precondition here.
