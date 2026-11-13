# Word the prompt

A strong prompt states the outcome and the falsifiable check for done. `/pstack` topologies and mesh skills supply the execution steps, so a few plain sentences beat a hand-written procedure.

## Put in

- **The goal.** State what is broken or what behavior must exist when the run finishes.
- **The done check.** Name an executable test, command, invariant, or visual diff that passes or fails. "Make it cleaner" and "spend two hours" are not checks.
- **The proof to show.** Ask for real command output, a `/control-ui` video or screenshot, a `/control-cli` session capture, or before-and-after benchmark numbers.
- **What you already know.** Include a symptom, repro input, trace ID, PR number, or ticket link so `ro-*` scouts start at the target.
- **Real boundaries.** Constraints such as "repro first, no fix yet", "zero behavior change", "do not push", or "with checkpoint" directly change swarm behavior.

## Leave out

- **Step-by-step choreography.** State what to achieve and let `/pstack` pick the topology and worker roster.
- **Chained skill lists.** Avoid dictating a rigid sequence of five skills unless overriding one specific step.
- **Unverified root-cause guesses.** Share symptoms first. If you have a hypothesis, label it as a guess so `/understand` or `/pstack` `diagnose` tests rival explanations too.

## Load context before changing unfamiliar code

- Ask `/ketchup --recall <topic>` in a fresh session to rebuild recent branch, PR, swarm board, and tracker state before starting.
- Run `/understand` before editing unfamiliar subsystems so a parallel `ro-*` mesh maps both current control flow and historical rationale.
- When an `/understand` run finds the root cause, ask it to warm-fork `ro-code` straight into `impl-fix` so zero context is lost.

## Explore designs before locking in code

- Never accept the first shape on a cross-cutting boundary. Run `/crucible` in `sketch` mode to compare 2 or 3 orthogonal type and state designs, or `full` mode to race working prototypes in isolated `share` worktrees.
- Add `with checkpoint` when you want to inspect the synthesized rationale before implementation starts.
- For stateful protocols or UI lifecycles, ask `/statechart` or `/verify-gen --formal` to prove invariants across interleavings before shipping.

## Before stepping away

- State clearly that you are stepping away so the coordinator resolves routine obstacles autonomously.
- Pair `/goal` or `/schedule` with an objective pass/fail check that runs on every iteration.
- Pre-answer irreversible boundaries explicitly, such as "commit locally, do not push or merge".
- Set a clean exit rule for genuine external blockers, such as "if blocked on missing credentials, stop and summarize in `/ketchup`".

## Steer in one line mid-run

- **Re-pin scope.** "Stop. I asked for a failing repro first, not a fix."
- **Demand real proof.** "Show me the actual command output from `ro-verify`, not a build summary."
- **Switch fidelity.** "Throw those two approaches into `/crucible` full mode and benchmark both."
