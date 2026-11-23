---
name: typescript-best-practices
description: >-
  TypeScript best practices grounding type-system and boundary discipline in
  concrete syntax and patterns. Use when reading, writing, or reviewing any .ts
  or .tsx file, or for /agy-pstack-next:typescript-best-practices and
  /typescript-best-practices.
---

# TypeScript best practices

Apply **Model the domain & type discipline** and **Boundary discipline** in [`../../rules/AGENTS.md`](../../rules/AGENTS.md) first.

For multi-file edits or repo-wide audits invoked directly in App/CLI, route execution through built-in `swarm` per [`../pstack/references/swarm-contract.md`](../pstack/references/swarm-contract.md), passing `<plugin-dir>/skills/typescript-best-practices/SKILL.md` (and `references/patterns.md` when needed) in each worker's brief. When running inside `/boost`, `/teamwork`, an IDE extension, an active worker, or a single-file task, apply these rules and run typechecks/tests inline per the Embedded Context rule in [`swarm-contract.md`](../pstack/references/swarm-contract.md).

| Rule | Summary |
|------|---------|
| Discriminated unions | Model variants with a `kind` literal discriminant so impossible states can't be represented. No optional-field bags. |
| Branded types | Brand primitives with `& { readonly __brand: "X" }` so they can't be mixed up. Validate once at the boundary. A brand comes from a verifying type guard (`input is AgentId`), never from `as`. |
| Constructive modeling | Build the shape so the illegal value can't be constructed. `[T, ...T[]]` for non-empty, `[T, T][]` for even length, `start` plus `duration` for a range. Not a runtime guard, not a wish for refinement types. |
| Simplest total type | Keep `T[]` while every operation on it stays total. Strengthen to `NonEmpty<T>` only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`. |
| Schemas before guards | Before hand-writing a property-by-property type guard, use the repository's runtime schema library and infer the type from the schema, such as `z.infer`. |
| No `as` casts | Every `as` is a runtime crash waiting. Cast only after validation. |
| Narrowing hierarchy | Discriminant switch > `in` operator > `typeof`/`instanceof` > user-defined type guard > `as`. |
| Type guards | Must verify the claim. A lying guard is worse than `as` because the bug hides behind a name that says it's safe. Name them `isX` or `hasX`. |
| Exhaustiveness | Inline `const _exhaustive: never = x;` in default arms so the compiler errors when a new variant is added. |
| `satisfies` over `as` | Validates the value without widening literal types. |
| Boundary validation | Parse where data crosses in, into a named domain type. `Record<string, unknown>` (however spelled) stops at that parse. Trust types inside. See **Boundary discipline** in [`../../rules/AGENTS.md`](../../rules/AGENTS.md). |
| Schema-derived types | Reach for `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited`/`typeof` before declaring a new interface. |
| Object args | Pass objects, not positional, so argument order is self-documenting. Skip on hot paths (per-frame render, tokenizers, parsers). |
| Real tests | Don't mock what you can run. Prefer the framework's real test primitives with leak/disposable checks, and verify UI in a running build. Mock only what you can't run locally. |
| Structured telemetry | Prefer structured logger diagnostics with enough context to debug from an id. No `console.log` in shipped code. |

Examples: [`references/patterns.md`](references/patterns.md).
