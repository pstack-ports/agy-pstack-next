---
name: create-formal-verification-skill
description: >-
  Generate a project-local skill (.agents/skills/verify-<area>-formal/) that
  formally verifies the code where a bug costs the most and tests reach the
  least, in any language, with whichever verification tool fits. Use for
  /agy-pstack-next:create-formal-verification-skill,
  /create-formal-verification-skill, "model-check this race", "prove this
  invariant", or when concurrency, retries, state machines, parsers, or unsafe
  code need more than tests.
---

# Create a formal verification skill

A test checks the cases that someone thought to write. Formal verification checks every case in a stated scope: every order of steps in a model, every input up to a bound, or every input. This skill finds the part of the repo where that matters most, verifies one property of it, and leaves a project-local Antigravity skill (`.agents/skills/verify-<area>-formal/`) that lets the next agent check a change against that property. Write that skill for a `/swarm` `verifier`, a `/boost` challenge worker, a `/teamwork` `Auditor`, or an IDE agent who reads it cold, mid-change, and has never seen your work. The user must be able to trust the result and act on it without learning the verification language.

## Swarm Orchestration

Follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md), delegating the workflow below across three worker roles on `TARGET_CWD`:

1. **Target scout (`workspace: "inherit"`):** Survey concurrency, retries, leases, state machines, parsers, or unsafe code in `TARGET_CWD` to pick the highest-consequence target and lowest-cost tool.
2. **Formal author (`formal-author`, `workspace: "share"`):** Author `.agents/skills/verify-<area>-formal/` in its worktree (writing solver/TLC outputs to `mktemp -d` outside the repo, and passing `<plugin-dir>/skills/statechart/SKILL.md` when TLA+ is chosen), prove failure sensitivity on a temporary scratch break, drop the product break so only `.agents/skills/verify-<area>-formal/` is committed, and ring `@verifier [done] <sha> <cwd>`.
3. **Cold `verifier` (`workspace: "share"`):** Check out `<author_cwd> <sha>` detached, run `.agents/skills/verify-<area>-formal/SKILL.md` cold on its own scratch break, drop the break to confirm baseline, and post `@coordinator [done] PASS` (or `@formal-author` on `ISSUES`). Audit and land `<author_cwd> <sha>` into `TARGET_CWD` per [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md).

## Choose the target from the code

Answer from the codebase, and ask the user only what you cannot observe. If the user named an area or a bug, start there.

A good target is a promise the code makes, where a break harms users and tests rarely reach the case that breaks it. Choose the strongest such target in the repo, not the one that is easiest to verify.

## Let the question choose the tool

Pick the tool that answers the question at the lowest cost: a model checker, a proof assistant, an SMT-backed verifier, or another tool. Whether events can happen in a bad order usually suits a model checker over a small model of the design, and TLA+ is the default for that in any language. Whether the code itself behaves for every input, as with memory safety, overflow, or a data-structure invariant, usually suits a verifier that runs on the code. If no verifier runs on this language, say so, and test the real code with generated inputs, not a hand model of the function. A property that must hold at every size, where a bound is not enough, can need a proof. Prefer a tool that the repo's developers can install and run, and tell the user why you chose it.

## What makes it good

- **True to the code.** Every part of the model or proof points to code that a reviewer can open. What the verification treats as one indivisible step is one indivisible step in the code. Names come from this repo.
- **Able to fail.** A check that you have never seen fail proves nothing. Show each property failing on a broken variant of the code it guards, such as a removed check or a reordered step.
- **Findings stay findings.** When the current code breaks the property, report it with the counterexample in the code's terms. Do not weaken the property or the model until it passes, and do not change product code unless the user asks.
- **Honest about scope.** Say what is verified, under which bounds and assumptions, and what is left out. A pass covers the model or the bound, not the whole system.
- **Readable without the tool.** State the property and the harm in one plain sentence each. Tell a counterexample as a short sequence of steps in the code's words.
- **Cheap to rerun.** One command writing scratch output to `mktemp -d` outside the worktree, a reproducible tool version, and a run short enough that the next agent will use it on every relevant change without colliding across concurrent worktrees.
- **Kept in step with the code.** Record which files and functions each check covers, and the commit at which you last confirmed that the verification describes them. When the covered code changes after that commit, the next agent can see that the verification needs another look.

## Generate the verify skill

Write `.agents/skills/verify-<area>-formal/SKILL.md` with YAML frontmatter (`name` and `description`) that names the area and says when to use it. Without frontmatter, the skill never registers. Keep the generated check self-contained and runtime-agnostic (zero reliance on `swarm` tools) so `/boost` challenge rounds, `/teamwork` `Auditor` gates, `/swarm` `verifier`s, and direct IDE sessions can all execute it identically. From the skill alone, the next agent must be able to tell whether a change touches the verified code, run the check, tell a real bug from a modeling error, and update the verification when a change is intended. Put the coverage record and the sync commit (`git -C <TARGET_CWD> rev-parse HEAD` once confirmed) in the skill, and tell the next agent to move the sync commit forward only after it confirms that the verification describes the code at the new commit. Use this repo's real commands, worktree-relative paths, and nouns, and leave no placeholders.

If the check is a TLA+ model, tell the next agent to read every result with the [`/statechart`](../statechart/SKILL.md) skill (and note that swarm coordinators pass the resolved `<plugin-dir>/skills/statechart/SKILL.md` path in worker briefs). It shows each invariant violation the checker finds as its shortest path in plain words. When the check passes, `/statechart` draws a chart of how the system moves between states. Refer to `/statechart` by name. Its commands, options, and file paths change between releases and machines, so copy none of them into the generated skill or its scripts.

## Prove it before you hand off

Have the independent `verifier` follow the generated skill once, as the next agent would, on a scratch change in its isolated `share` worktree that breaks the property in the real code. It must catch the break. Then drop the scratch change and confirm that the check is back where it started: passing, or failing only on the findings you will report. A verify skill that was never run is a draft. If the skill misses the break or a step does not run, fix the skill or the verification, not the scratch change.

## Hand off

Tell the user what you verified, which tool you used and why, the bounds, what the check found in plain words, how to run it, and what it does not cover. Suggest a second target only if you found a close one. Point the user at [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) for bringing the verification back in line after changes that did not recheck it.
