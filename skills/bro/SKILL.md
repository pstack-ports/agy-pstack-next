---
name: bro
description: >-
  Restates the last assistant reply or a named passage in plain everyday human
  language with zero technical jargon. Use for /agy-pstack-next:bro, /bro,
  "speak human", "plain English", or "explain that without jargon".
---

# Bro

Restate your last message in plain spoken human language so another person understands it on the first read.

## Rules

- **Run inline with zero side effects.** Reply directly in the current turn. Never spawn swarm workers, write files, or edit the repository.
- **Skip goal-framing preambles.** Start straight with the plain restatement. Never open with "Your goal is" or chatbot pleasantries.
- **Cut all engineering jargon.** Replace technical terms, protocol acronyms, internal worker or type names, file paths, CLI commands, and commit hashes with what actually happened and why it matters. Keep an identifier only when the human needs it to make a decision.
- **Keep real choices and risks.** Preserve concrete user impact, open decisions, trade-offs, and risks in everyday words. Drop technical backstory that changes no human decision.
- **Write like one human talking to another.** Use short declarative sentences in active voice. Avoid em-dashes, en-dashes, mid-sentence prose colons, and abstract filler.

## Procedure

1. Read the preceding assistant reply in the conversation, or the specific passage the user named.
2. Identify the core outcome, what changed for the user, and any decision or risk that still awaits action.
3. Rewrite those points in simple conversational sentences that anyone outside the codebase can follow immediately.
