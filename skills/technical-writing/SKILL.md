---
name: technical-writing
description: "Layered technical-writing standard combining Diataxis modes, Google developer style, STE single-thought instruction rules, Global English syntax, zero-slop prose hygiene, and ro-* technical accuracy checks. Use for docs, guides, RFCs, READMEs, PR bodies, and commit messages."
---

# Technical Writing

Write so a tired engineer understands on the first read. Apply all four structural layers plus strict zero-slop prose hygiene, and verify every technical claim against the repository before shipping.

Three rules sit above every layer.

- **Cut every word that does no work.** If a sentence survives without a word, delete the word. Replace `"in order to"` with `"to"`. Delete `"it is important to note that"`.
- **Use the short everyday word.** Write `"use"` instead of `"utilize"`, `"help"` instead of `"facilitate"`, and `"do"` instead of `"perform"`. A longer word must earn its length with precision.
- **Reject robotic prose.** If following rules mechanically makes a sentence sound machine-generated, rewrite the sentence cleanly rather than shipping stiff prose.

The codebase is the word list. Use exact symbol, file, CLI flag, and command names from the repository rather than synonyms or paraphrases. Prefer plain verbs developers say out loud (`move`, `delete`, `tighten`) over abstract metaphor nouns (`substrate`, `vector`, `locus`, `modality`, `paradigm`, `scaffolding`, `north star`, `flywheel`, `evacuate`, `endgame`).

## Vary the Rhythm

Prose can obey every grammar rule and still read synthetic when every sentence has identical cadence and zero specificity.

- Mix sentence lengths deliberately. Short sentences land a point. Slightly longer ones pair a fact with its condition or consequence.
- Keep one thought per sentence. Split sentences that bundle two ideas, and keep sentences whose clauses express one conditional fact.
- State concrete mechanisms and numbers instead of feelings. Replace `"schema changes can cause issues"` with `"renaming a column fails the build"`. If a sentence could appear unchanged in an unrelated project's docs, cut it or ground it in this codebase.

## Pick the Mode First (Diataxis)

Give each document or standalone section one primary mode based on two questions (action vs understanding, learning vs working).

- **Tutorial (action + learning).** Open with what the reader builds, not abstract learning goals. Produce a visible result at every step and name the exact output, prompt, or log line expected. Write as direct steps (`First, run X. Next, inspect Y.`) and link out instead of lecturing.
- **How-to (action + work).** Solve a concrete task for a competent engineer. State actionable steps and conditional branches (`If you need X, pass --flag.`) without background digressions. Title by task (`How to rotate webhook keys`).
- **Reference (understanding + work).** Describe facts, flags, types, limits, and error codes dryly and completely. Mirror the code layout so readers navigate source and reference together. Generate tables or lists from source where possible.
- **Explanation (understanding + learning).** Answer a real `why` question around design trade-offs, constraints, history, and rejected alternatives. Weigh trade-offs directly instead of dumping unweighted bullet lists.

Do not mix modes inside one section. Link across documents instead of embedding reference tables inside tutorials or essays inside how-to steps.

## Write Directly to the Reader (Google Developer Style)

- Address the reader as `"you"` in present tense. Reserve `"will"` for events that genuinely happen later.
- Use active voice (`the hook blocks the call`, not `the call is blocked`). Use passive voice only when the actor is unknown or irrelevant.
- Write instructions as imperatives (`Run agy plugin validate.`). Never write `"should be run"` or `"please"` in procedures, and never call a step `"simple"`, `"easy"`, or `"quick"`.
- Place conditions before actions (`To reset the cache, delete member-map.json.`).
- Put the common case first and exceptions after.
- Link with descriptive anchor text naming the target page or artifact, never `"click here"`.
- Use sentence case for headings and make headings carry the point (`Pick the mode first` rather than `Modes`). Keep one H1 per file with no skipped heading levels.
- Use numbered lists for ordered steps and bullet lists for unordered sets. Introduce every list with a complete sentence and keep list items grammatically parallel.
- Format symbols, paths, commands, and values in backticks and UI labels in bold. Use serial commas and avoid `"etc."`.

## Load One Statement at a Time (STE Rules)

- Put one instruction per procedural sentence and one thought per declarative sentence.
- Keep procedural sentences near 20 words or fewer and explanatory sentences near 25 words or fewer.
- Place warnings and preconditions ahead of the command they guard.
- Retain articles (`the`, `a`) so nouns never read as verbs (`Remove the backup file`, not `Remove backup file`).
- Give each domain term one consistent name everywhere. Calling one mechanism `"the guard"`, `"the gate"`, and `"the filter"` across three paragraphs invents three concepts in the reader's head.

## Leave Zero Two-Way Readings (Global English)

- Place modifiers like `"only"` and `"not"` immediately beside the word they qualify (`fails only on force-push`, not `only fails on force-push`).
- Unpack stacked noun chains (`the script that checks proto import budgets` rather than `the proto import budget check script`).
- Give every pronoun (`it`, `they`, `this`) one unmistakable antecedent, or repeat the noun. Never use bare `"this"` or `"which"` to point at an entire preceding clause.
- Keep explicit verbs in coordinated clauses and structural conjunctions (`that`, `either...or`, `both...and`, `if...then`) where omission invites backtracking.
- Avoid semicolons and em-dashes completely. End the sentence with a period or join tightly related clauses with a comma.
- Avoid mid-sentence connector colons in prose. Reserve colons for introducing a vertical list or code block, and end bold bullet lead-ins with a period (`**Worktree isolation.** Each author edits in its own share worktree.`).
- Write `"a, b, or both"` instead of `"a/b"` or `"and/or"`, and avoid `(s)` plurals, Latin abbreviations, and idioms.

## Zero-Slop Prose Hygiene

Scan every draft and strip AI tells before finishing.

- Remove AI filler vocabulary (`delve`, `crucial`, `pivotal`, `tapestry`, `testament`, `underscore`, `landscape`, `interplay`, `fostering`, `showcase`, `vibrant`, `boasts`, `serves as`). Say `"is"` or `"has"` when you mean `"is"` or `"has"`.
- Cut `"not just X, but Y"` contrasts, forced rule-of-three groupings, vague attributions (`experts note`), chatbot sign-offs, decorative emojis, and sycophantic openers.
- Replace trailing participial filler (`...ensuring safety and highlighting reliability`) with a concrete fact or delete it.
- Keep PR descriptions and commit bodies under a one-minute read. State the problem, root cause or design choice, and verification proof. Link artifacts instead of pasting raw board logs.

## Swarm Accuracy Verification

Good prose on false facts is worse than rough notes. On non-trivial documentation, READMEs, guides, or RFCs inside `/pstack`, pair authoring with an independent read-only fact check.

1. **`impl-docs` (`workspace: "share"`).** Drafts or updates markdown files against real repository paths, commands, and schemas, verifying relative links locally.
2. **`ro-factcheck` (`workspace: "inherit"`).** Independently checks every named file path, relative markdown link, CLI flag, config key, and count against `HEAD` source, posting exact `file:line` mismatches on the swarm board (`#seq`).
3. **Convergence.** `impl-docs` resolves every factual mismatch and prose-hygiene flag before coordinator merges the commit and tears down the worker.

## Worked Example

Before:

> Configuration of the proto import budget check script parameters is performed via budget.json. Note that it is important to remember that running with --write, which updates the committed budget to reflect the current count, should only be done when lowering it. If exceeded, CI fails.

After:

> `budget.mjs` reads the committed limit from `budget.json` and counts files that import protos. If the count exceeds the limit, CI fails. Run `budget.mjs --write` only to lower the limit.
