# Design red flags

Screen every `/crucible` candidate against these eight structural red flags before synthesis. Assume the next contributor is an agent that opens one file, copies the nearest pattern, and takes the shortest path that compiles. Prefer designs where a change that looks right locally is right across the whole repository.

## Shallow module

A shallow module exposes a wide interface while hiding very little policy or complexity. Judge depth by the capability concentrated behind the public boundary relative to the size of that boundary.

Do not confuse a deep module with a deep call chain. Deep call chains scatter logic across tiny layers. Deep modules absorb complexity behind a small, obvious entry point.

Signs of a shallow module:

- Callers must invoke several methods in sequence to complete one logical operation.
- Public options mirror internal implementation stages.
- Reading the signature does not spare the caller from reading the implementation body.

## Information leakage

Information leakage occurs when two or more modules depend on the same internal representation, protocol detail, or policy assumption, forcing lockstep edits whenever that detail changes.

Public re-exports of wire payloads, ORM rows, or third-party framework handles are information leakage. Parse external payloads into clean domain types at the boundary and keep storage or transport schemas private.

## Temporal decomposition

Temporal decomposition splits modules by execution order (separate `load`, `validate`, `transform`, and `save` packages) instead of grouping code by the domain knowledge and invariants it owns. That split duplicates schema assumptions across every stage.

Group operations that protect the same representation inside the single module that owns that representation, even when those operations run at different moments.

## Pass-through method

A pass-through method forwards arguments unchanged to another layer with the same signature. It adds indirection without adding policy, validation, or abstraction.

Delete pass-through wrappers or move the caller directly to the module that owns the behavior.

## Split ownership

More than one module mutates the same state or maintains a parallel copy of it. An agent editing one writer will miss the sibling writer, causing invariants to drift.

Assign every piece of mutable state a single owner. Other modules read derived views or ask the owner to perform transitions.

## Two ways to do one task

Supporting both a legacy path and a new path for the same operation guarantees future agents will copy both.

Keep exactly one supported path. Migrate existing callers and delete the superseded API in the same change.

## Importable internals

When callers can import private helpers or internal subdirectories directly, agents taking the fastest compiling import turn private details into accidental public contracts.

Lock package exports, visibility modifiers, or lint boundaries so importing internals fails the build immediately.

## Hand-synced list

Listing the same enum cases, routes, or role prefixes across multiple files guarantees partial updates when a new entry is added.

Define one canonical source of truth and derive every consumer from it, or enforce build-time exhaustive checks so drift fails compilation.
