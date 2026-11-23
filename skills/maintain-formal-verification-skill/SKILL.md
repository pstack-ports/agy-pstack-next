---
name: maintain-formal-verification-skill
description: >-
  Bring a project's formal verification back in line with the code after the
  code changes: find the commits that touched verified code, update the model,
  harness, or properties to describe the code as it is now, rerun, and say
  whether each failure is drift in the verification or a bug in the code. Use
  for /agy-pstack-next:maintain-formal-verification-skill,
  /maintain-formal-verification-skill, "is the model still true to the code",
  or after merges and refactors that touched verified code without rechecking it.
---

# Maintain a formal verification skill

A formal check proves a property of what it describes. When the code changes and the verification does not, the check can keep passing while it describes code that no longer exists. That pass is the dangerous case, because it looks like a proof. This skill is the upkeep loop for a verify skill that [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) generated, or for any project-local skill that runs a model checker, prover, or code-level verifier against named code. The project-local skill handles a change that an agent makes while it uses that skill. This skill handles the changes that skipped it: merges, edits made without the skill across `/swarm`, `/boost`, `/teamwork`, or direct sessions, and drift that builds up across many commits.

Follow built-in `swarm` and [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md) on `TARGET_CWD`, directing solver/TLC scratch outputs into per-worker `mktemp -d` directories outside the repo and passing `<plugin-dir>/skills/statechart/SKILL.md` in briefs whenever a check uses [`/statechart`](../statechart/SKILL.md).

## Outcomes

Give each check one outcome, and say which:

- **in sync**: no change since the last sync alters what the check describes, and the check passes.
- **updated**: the code changed, the verification now describes the new code, and the check passes.
- **bug**: the verification describes the current code, and the code breaks the property. This is a finding about the code. It is not drift.
- **blocked**: the check could not be brought back in line or could not run. Say exactly why.

A check can be both **updated** and **bug**: the update makes the verification describe the code again, and then the property fails on it.

## Edit scope

Edit only the verification: models, harnesses, property files, and the verify skill itself. Never edit product code during a run, unless the user asks you to. When a property fails on the current code, do not weaken the property or the model to make it pass. Report the failure.

## Pass

1. **Locate & baseline (`swarm` scouts, `workspace: "inherit"`).** Check `.agents/skills/` (or `.cursor/skills/` in cross-tool repos) in `TARGET_CWD` for formal verify skills; if none exist, stop and point at [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md). Otherwise fan out `inherit` scouts to collect each check's property, covered code, bounds, command, and `sync_commit` (falling back to the last commit touching the verification files, noted explicitly), and run each check as-is in an isolated `mktemp -d` directory. A pass here only means the old description holds; defer drift-vs-bug judgment to step 4.

2. **Read every change to covered code (`workspace: "inherit"`).** Diff the covered files in `TARGET_CWD` from the sync commit to `HEAD`, and read each commit message. Also look for code that moved: a covered function that is renamed, split, or moved to another file is still covered code. Also look for new code that touches the state that a check guards, such as a new function that writes the same fields. For each change, decide which of these it is:
   - **No effect.** The change does not alter anything the verification describes, such as formatting, comments, or code paths that the verification does not cover. Check this against the model or harness, not against the commit message.
   - **The verification no longer describes the code.** A step that was one indivisible action is now two, a branch was added or removed, a check moved, a new path reaches the guarded state, or a value now has a different range. The model or harness must change.
   - **The promise changed on purpose.** The change alters what the code promises, and evidence in the change says that this is intended: the doc comment, the tests, the changelog, or the commit message. The property must change, and you must cite that evidence.
   - **The promise may be broken.** The code changed, and no evidence says that the promise changed. Treat a failure that follows as a bug candidate.

3. **Update from the code, not from the result (`formal-author`, `workspace: "share"`).** Inside an isolated `share` worktree, change the model or harness so that each changed part again points to code that a reviewer can open, and keep one indivisible step in the code as one step in the verification. Write the update from the code before you rerun, and do not shape it by what makes the check pass. Change a property only for a promise that changed on purpose. Write down the old wording, the new wording, and the evidence. Keep the bounds unless the change makes them wrong. If you must reduce a bound, say so in the report.

4. **Rerun and judge each result (`formal-author` + independent `verifier` in `workspace: "share"`).**
   - **Pass:** the check can now pass on a description that has lost the ability to fail. Inside the disposable `share` worktree, break the new code the way the property guards against, such as removing a new check or reordering a new step, and confirm that the check catches it. Then drop the break.
   - **Fail:** replay the counterexample against the real code, step by step. If a step cannot happen in the code, the verification is wrong. Fix the verification, and say what was wrong. If every step can happen, it is a bug. Name the commit that introduced it, tell the counterexample as a sequence of steps in the code's own words, and state the harm in one sentence. If a cheap test or reproduction against the real code shows the bug, add it to the report as evidence. Do not commit it to the product code.

5. **Update the verify skill & land cleanly.** Update covered code, commands, bounds, assumptions, and `sync_commit` (`git -C <TARGET_CWD> rev-parse HEAD`; never advance `sync_commit` for a `blocked` check). Gate `<author_cwd> <sha>` with a cold `verifier` (`workspace: "share"`, detached `HEAD`) confirming steps run and edits touch only verification files, then audit, land into `TARGET_CWD` when changed, and retire task workers per [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md).

## Report

Tell the user, for each check:

- the outcome, and the commits that you read;
- what changed in the verification and why, with a short reason for each change: the code changed shape, or the promise changed on purpose (with the evidence);
- the rerun result, and the break that you used to show the updated check can still fail;
- each bug, in plain words: the counterexample as steps in the code's words, the harm, and the commit that introduced it;
- what the verification still does not cover, including new code that it should cover and does not.

Say outright which failures were drift in the verification and which were bugs in the code. For a check that passed before you updated it and fails after, say that the old pass was on a stale description.

Put the verification updates in a change of their own, separate from any product fix.
