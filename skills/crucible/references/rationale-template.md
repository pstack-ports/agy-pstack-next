# Rationale template

Ship this one-page decision record alongside the synthesized `/crucible` output. Use sentence-case headings and replace the italic prompts with concrete facts.

## Problem

*One short paragraph stating what behavior or boundary this change establishes and which existing system constraints, callers, or historical invariants from [Phase 1](../SKILL.md) make the design non-trivial.*

## Usage from the caller's view

*Write this before finalizing types. Show 2 or 3 realistic caller snippets importing the module, calling it, and handling its return value or errors. Signatures in Shape must serve this caller experience directly.*

## Shape and invariants

*Describe the core data structures first, then how data moves across signatures, state transitions, and failure cases. State which invariants compile-time types enforce, where boundary validation runs, and what complexity the module hides from callers.*

## Synthesis decision

*Record which `cand-*` axis won as the base in [`/crucible`](../SKILL.md) and why, summarize `ro-judge` (and `ro-steward`) `#seq` findings, list every test or helper cherry-picked from donor `cand-*` branches, and state why losing shapes were rejected.*

## Tradeoffs accepted

*Bullet each deliberate tradeoff in the form "We accept X in exchange for Y" so future maintainers do not mistake intentional constraints for oversights.*

## Alternatives considered

*Name each orthogonal design axis explored during Phase 2 (`cand-a`, `cand-b`, `cand-c`), compare its interface depth and failure surface against the chosen base, and state the exact flaw or cost that ruled it out.*

## Open questions and risks

*List unresolved product or policy questions phrased directly for human decision, plus operational risks to verify during rollout.*

## Next implementation step

*State in one sentence the immediate next verifiable unit to build or ship against this design.*
