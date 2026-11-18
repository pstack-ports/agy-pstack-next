---
name: create-verification-skill
description: >-
  Generate a project-local verification skill (.agents/skills/verify-<app>/)
  that drives your app the way a user does — any language, framework, or
  platform. Use for /agy-pstack-next:create-verification-skill,
  /create-verification-skill, "make a control skill for this repo", or when a
  project has no scripted way to prove UI/CLI/service behavior.
---

# Create a verification skill

Every serious project needs a scripted way to drive the real app and prove behavior: launch it, exercise a feature the way a user would, and capture evidence. This skill generates that as a project-local Antigravity skill (`.agents/skills/verify-<app>/`) tailored to the repo. You write the generator's output for the next agent, not for a human: it will be read cold, mid-task, by an agent or swarm `verifier` that has never seen the app.

## Swarm Orchestration

Follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md), delegating Sections 1–4 below across three worker roles on `TARGET_CWD`:

1. **Interview scouts (`workspace: "inherit"`):** Map `Surface`, `Run`, `Drive`, `Observe`, and `Isolate` in parallel (Section 1).
2. **Skill author (`verify-author`, `workspace: "share"`):** Author `.agents/skills/verify-<app>/` and `features/` (Sections 2–3, passing `<plugin-dir>/skills/create-verification-skill/references/feature-map-example/` in `verify-author`'s brief), commit locally, and ring `@verifier [done] <sha> <cwd>`.
3. **Cold `verifier` (`workspace: "share"`):** Check out `<author_cwd> <sha>` detached, prove `.agents/skills/verify-<app>/SKILL.md` cold end to end (Section 4), and post `@coordinator [done] PASS` (or `@verify-author` on `ISSUES`). Audit and land `<author_cwd> <sha>` into `TARGET_CWD` per [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md).

## 1. Interview the repo, not the user

Answer these from the codebase and only ask the user what you cannot observe:

- **Surface:** what does a user actually touch? A web UI, a CLI/TUI, a desktop app, an API, a mobile app, a library? A repo can have several; pick the primary one and note the rest.
- **Run:** how does the app start locally? Prefer the repo's own documented dev command (package scripts, Makefile, README quickstart). Note ports, env vars, seed data, auth.
- **Drive:** how can an agent interact with it programmatically? Existing harnesses first — Playwright/Cypress specs, expect scripts, PTY helpers, curl-able endpoints, a debug port. Only then pick a generic recipe: browser/CDP for web and Electron, a `tmux`/PTY harness for CLI/TUI, plain HTTP for services.
- **Observe:** what evidence can be captured? Screenshots, ARIA snapshots, terminal transcripts, response bodies, logs, exit codes, DB state.
- **Isolate (concurrent worktrees & projects):** can two instances run side by side across simultaneous `agy` sessions in different projects or different git worktrees of the same repo? Allocate per-run state once via `RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/verify-<app>-XXXXXX")"` (persisting `RUN_DIR` in a variable/file rather than relying on shell `$$`, which changes across `run_command` calls, or static `/tmp/<app>` paths), bind ephemeral ports (`--port 0`, `--remote-debugging-port=0`), isolate data/config dirs (`$RUN_DIR/data`, `HOME`/`XDG_CONFIG_HOME` overrides when CLI/TUI writes dotfiles), isolate browser profiles (`--user-data-dir="$RUN_DIR/profile"`), and use dedicated tmux sockets (`tmux -L "verify-$(basename "$RUN_DIR")" -f /dev/null`). If parallel instances are genuinely impossible (singleton desktop bundle ID, exclusive hardware/simulator lock), say so explicitly in the generated skill: refusing (`blocked`) to double-drive a shared instance beats corrupting another worktree's or the user's session.

If the checkout doesn't build or start as-is, report it precisely (or fix via a `share` worker only when within user scope) before generating; a skill written against a broken base teaches wrong steps. When an irrelevant missing asset blocks startup (a static dir the API never serves, a sample config), the generated skill may create it inside `$RUN_DIR` (or clearly marked as verification scaffolding) and remove it in cleanup.

## 2. Generate the skill

Write `.agents/skills/verify-<app>/SKILL.md` with YAML frontmatter (`name: verify-<app>` and a `description` that names the app, the surface, and when to reach for it — without frontmatter the skill never registers) and these sections, each grounded in what the interview actually found (no placeholders left):

- **Launch:** the exact command that starts the app for verification from `$PWD`, allocating `RUN_DIR` (`mktemp -d`), binding an ephemeral port when supported, and how to tell it's ready (a log line, a prompt, a health response). Launch must reach a usable state from an empty data dir, including any migrations and seed data. Ready means usable, not just that a process answers. A database health check can pass while its init scripts are still running. Include teardown. For a short-lived CLI or TUI there is no server to keep alive: launch means build the binary (or install deps) once in `$PWD`, then start each drive in its own isolated PTY or `tmux -L` session.
- **Doctor:** one read-only check that answers "is this instance worth driving?" — process up (matching `$RUN_DIR/pid`), right worktree/build revision (so Worktree B never drives a server started from Worktree A), port owned by this run, disposable data dir active, auth valid. An agent runs this first whenever anything looks off.
- **Drive:** the harness recipe with real selectors/commands from this repo, not examples. Prefer stable handles (ARIA roles/labels, `data-*` attributes, prompt strings, route paths) over coordinates and tab order.
- **Evidence:** what to capture for a proof and where it goes (e.g. `$RUN_DIR/artifacts/`). State the proof standards: exercise the real user path, not internal setters or test-only endpoints; capture the action and the resulting state, not just the final screen; verify side effects (files written, rows inserted, messages sent) from a read-only second view alongside what's visible; mocks only where a production boundary already isolates the external system. When the safe path is a dry-run or test mode, verify what it actually skips by observing (files, network, git refs) rather than trusting its name: some dry-runs still touch the network or open a browser.
- **Cleanup:** how to tear down instances this run created using exact recorded PIDs (`$RUN_DIR/pid`) or dedicated `tmux -L` sockets. Never kill by process name (`pkill`, `killall`) or blind port scan, which kills sibling worktrees' processes; kill only what you started. Cleanup removes instances and scratch state, never the evidence: proof artifacts survive the teardown, in a location the skill names.
- **Helpers:** any script the skill ships is executable (`chmod +x`) and its invocation is shown in the skill body. A helper the reader has to reverse-engineer is not a helper.

## 3. Seed the feature map

Create `.agents/skills/verify-<app>/features/README.md` plus one file per user-facing feature you can identify (aim for the top 3-5 to start, from routes, commands, menus, or docs). Follow the shape in [`references/feature-map-example/`](references/feature-map-example/README.md), with a `README.md` index and one file per feature. Each file answers, from the user's point of view: what the feature is, how to reach it, how to drive it with the harness, and what observable end state proves it works. The four H2s are `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, and `Gotchas`. If the seed data lacks a precondition that a journey needs, the journey reports a failure and the reason goes in that feature's `Gotchas`. Never weaken the journey to make it pass. The map is the repo's maintained verification source; a proof that drives one convenient entry point is incomplete when the map lists others.

## 4. Prove the generated skill before handing it over

Have the independent `verifier` run the generated instructions cold end to end once: launch, doctor, drive ONE mapped feature (one is enough; the map exists so later runs can cover the rest), capture evidence, clean up. After cleanup, confirm the evidence still exists at the named location — a cleanup that eats the proof fails this step. Fix what fails, and run the generated cleanup after every failed iteration too, so broken attempts don't strand processes and ports. A generated skill that was never executed is a draft, not a deliverable. If you proved it in a stand-in for the real target (a container in place of a fresh VM, a local stack in place of a remote one), list every setup step the stand-in did that the target will not. Those steps stay unverified until a run on the real target covers them.

## 5. Offer the maintenance loop

Point the user at [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) for keeping the map honest as the app changes. Suggest a cadence only if they ask.
