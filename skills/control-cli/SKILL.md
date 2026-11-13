---
name: control-cli
description: "Build or adapt an isolated local PTY or tmux harness to drive, inspect, and profile an interactive CLI or TUI. Use for deterministic CLI bug repros, keyboard and prompt flows, startup or memory profiling, and parallel swarm verification."
---

# Control CLI

Drive interactive CLIs and TUIs through a repeatable local PTY or `tmux` harness instead of ad-hoc one-shot shell commands. Reuse checked-in test or demo harnesses first. When none exists, assemble a disposable harness with isolated terminal sessions and per-worker state directories.

## When to Use It

- Reproducing interactive CLI or TUI bugs with deterministic keystrokes, signals, and terminal dimensions.
- Verifying prompts, arrow-key navigation, Ctrl-C handling, resize redraws, and exit codes in `/pstack` or `/interrogate`.
- Capturing before-and-after terminal transcripts for `ro-verify` proof on the swarm board.
- Profiling CLI startup latency, CPU hot paths, hangs, or memory growth.
- Powering the terminal driver inside project-local skills created by [`/verify-gen`](../verify-gen/SKILL.md).

## Swarm Worker Isolation

Concurrent swarm workers (`impl-*`, `cand-*`, `adv-*`, and `ro-verify`) share the host OS and default `tmux` server unless each worker isolates its PTY, environment, and state paths.

1. **Unique PTY and `tmux` sockets.** Give every `tmux` run a worker-scoped socket and session name (`tmux -L "pstack-${WORKER_NAME:-w}-$$" new-session -d -s "run-$$"`) so parallel workers never collide on session names or kill another worker's server.
2. **Per-worker filesystem and config directories.** Create `RUN_DIR="/tmp/cli-${WORKER_NAME:-w}-$$-$(date +%s)"` and export isolated `HOME`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` subdirectories inside `$RUN_DIR` unless the test specifically targets a different fixture path. Concurrent CLI processes never fight over SQLite locks, sockets, auth files, or history logs.
3. **Deterministic terminal environment.** Pin `TERM=xterm-256color`, explicit columns and rows (`-x 120 -y 36`), `NO_COLOR` or color flags as needed, and `TZ=UTC` when testing formatted timestamps.
4. **Ephemeral inspector ports.** Bind runtime debuggers to `127.0.0.1:0` so parallel profiling sessions never clash on port `9229`.
5. **Read-only compliance.** Keep temporary PTY scripts, transcripts, and profiles inside `/tmp` so `ro-*` workers satisfy `hooks/guard.mjs` repository write restrictions.

## Harness Loop

1. Identify the exact binary or script under test and prepare an isolated `$RUN_DIR` workspace.
2. Check for existing repository harnesses first (e2e runners, Expect scripts, PTY test helpers, or demo scripts).
3. Launch the CLI inside an isolated `tmux` socket or Python/Node PTY with explicit dimensions and isolated env vars.
4. Capture the initial screen and wait for a concrete readiness prompt before sending input.
5. Send one action at a time (text, `Enter`, arrow keys, `Escape`, `C-c`, or terminal resize).
6. Poll until the expected screen text or exit status appears rather than sleeping blindly.
7. Save the transcript, exit code, and any CPU or heap profiles under `$RUN_DIR/artifacts/`.
8. Kill the isolated session or child PID cleanly while keeping proof artifacts intact.

## Minimal Isolated `tmux` Harness

```bash
RUN_DIR="/tmp/cli-${WORKER_NAME:-local}-$$-$(date +%s)"
mkdir -p "$RUN_DIR/home" "$RUN_DIR/tmp" "$RUN_DIR/artifacts"
SOCK="pstack-$$"
SESSION="cli-$$"

tmux -L "$SOCK" new-session -d -s "$SESSION" -x 120 -y 36 \
  "HOME=$RUN_DIR/home TMPDIR=$RUN_DIR/tmp XDG_CONFIG_HOME=$RUN_DIR/home/.config <command-under-test>"

tmux -L "$SOCK" capture-pane -pt "$SESSION"
tmux -L "$SOCK" send-keys -t "$SESSION" "help" Enter
tmux -L "$SOCK" capture-pane -pt "$SESSION" > "$RUN_DIR/artifacts/help.txt"
tmux -L "$SOCK" kill-server
```

For Node or Bun CLIs that need profiling or live inspection, bind an ephemeral loopback inspector port.

```bash
NODE_OPTIONS="--inspect=127.0.0.1:0" tmux -L "$SOCK" new-session -d -s "$SESSION" -x 120 -y 36 -- <node-cli-command>
```

Parse the `ws://127.0.0.1:<port>/...` URL from stderr before attaching a DevTools-compatible profiler.

## Minimal Python PTY Harness

Use a short `/tmp` PTY script when `tmux` is unavailable or when sub-second deterministic pattern waits are cleaner.

```python
import os
import pty
import select
import subprocess
import tempfile
import time

run_dir = tempfile.mkdtemp(prefix="cli-pty-")
env = {
    **os.environ,
    "HOME": run_dir,
    "TMPDIR": run_dir,
    "XDG_CONFIG_HOME": os.path.join(run_dir, ".config"),
    "TERM": "xterm-256color",
}

master_fd, slave_fd = pty.openpty()
proc = subprocess.Popen(
    ["<command>", "<arg>"],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    env=env,
    close_fds=True,
)
os.close(slave_fd)

deadline = time.time() + 30
buffer = b""
while time.time() < deadline:
    ready, _, _ = select.select([master_fd], [], [], 0.1)
    if not ready:
        continue
    chunk = os.read(master_fd, 4096)
    if not chunk:
        break
    buffer += chunk
    if b"<ready-prompt>" in buffer:
        os.write(master_fd, b"help\n")
        break

print(buffer.decode(errors="replace"))
proc.terminate()
proc.wait(timeout=5)
os.close(master_fd)
```

## Profiling Recipes

- **Startup regression.** Run alternating baseline and candidate trials under identical env vars and warm-cache state, recording median and range.
- **Slow command path.** Start a CPU profile over the ephemeral inspector port, trigger the slow action, stop the profile, and attribute self-time to source lines.
- **Memory leak.** Trigger explicit GC when exposed, capture heap snapshot 1, repeat the interactive command N times, force GC again, and diff heap snapshot 2.
- **Interactive hang.** Capture the rendered pane, open file descriptors or active runtime handles, and a CPU or stack sample before sending `SIGINT`.

## Guardrails

- Prefer deterministic output predicates with bounded timeouts over fixed `sleep` calls. State the reason whenever a timing wait is unavoidable.
- Never pass live production credentials or destructive remote commands into a harness session.
- Keep temporary harness scripts in `/tmp` unless asked to check in a reusable test helper.
- Never hard-code paths or binary names from unrelated repositories.
- Tear down isolated `tmux` sockets, child PIDs, and scratch home directories when finished.
