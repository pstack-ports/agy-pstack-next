# TypeScript patterns

Apply these patterns whenever reading, designing, or editing `.ts` and `.tsx` files. They operationalize Boundary Discipline and Type System Discipline from [principles.md](principles.md).

## Quick reference

| Rule | Standard |
| --- | --- |
| Discriminated unions | Model variants with one shared literal tag (`kind`, `type`, or `tag`) so contradictory optional fields cannot exist. |
| Branded types | Brand distinct primitives (`& { readonly __brand: "X" }`) via a verifying guard at the boundary, never via raw `as`. |
| Constructive modeling | Shape types so invalid values cannot be constructed (`[T, ...T[]]` for non-empty arrays, `start` plus `durationMs` for ranges). |
| Simplest total type | Keep `T[]` while operations stay total. Strengthen to `NonEmpty<T>` or widen return to `T \| undefined` when `!` or impossible throws appear. |
| `unknown` over `any` | Type every external payload (`JSON.parse`, RPC, IPC, CLI, env, DB rows) as `unknown` until parsed. |
| Schemas before guards | Use the repository's existing schema library (such as `z.infer<typeof Schema>`) instead of maintaining duplicate interfaces and hand-rolled guards. |
| No unvalidated `as` | Never silence the compiler with `as`. Narrow or parse first. |
| Narrowing order | Prefer discriminant `switch` or `if`, then `in`, then `typeof` or `instanceof`, then verified type guard `isX`. |
| Honest type guards | Every `x is T` function must check every property required by `T`. |
| Exhaustiveness | Bind the default branch value to `const _exhaustive: never = value` so new union members fail compilation. |
| `satisfies` over `as` | Use `satisfies Config` on object literals to typecheck structure while keeping narrow literal types. |
| Boundary validation | Parse external inputs once at module entrypoints and trust narrowed domain types across internal functions. |
| Schema-derived types | Derive views with `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` instead of redeclaring shapes. |
| Object arguments | Pass named option objects when functions take multiple arguments or same-typed parameters, except inside measured hot loops. |
| Real tests | Exercise real modules, timers, and disposable lifecycles. Mock only external network or hardware boundaries unavailable locally. |
| Structured telemetry | Emit structured logger events carrying correlation IDs instead of shipping `console.log`. |

## Branded types

Brand primitive identifiers once at the boundary so callers cannot transpose same-typed arguments.

```ts
type WorkerId = string & { readonly __brand: "WorkerId" };

function isWorkerId(input: string): input is WorkerId {
	return /^[a-z]+-[a-z0-9-]+$/.test(input);
}

export function parseWorkerId(input: string): WorkerId {
	if (!isWorkerId(input)) {
		throw new Error(`Invalid worker id: ${input}`);
	}
	return input;
}
```

## Discriminated unions

Replace boolean flags and optional property bags with a single literal discriminant.

```ts
// Avoid optional bags that permit contradictory states.
type BadTaskState = { running: boolean; result?: BuildOutput; error?: string };

// Prefer a tagged union where every state carries exact fields.
type TaskState =
	| { readonly kind: "queued" }
	| { readonly kind: "running"; readonly startedAtMs: number }
	| { readonly kind: "succeeded"; readonly output: BuildOutput }
	| { readonly kind: "failed"; readonly error: string };
```

## Constructive modeling and total signatures

Encode invariants directly in the data shape instead of repeating runtime checks across callers.

```ts
export type NonEmpty<T> = readonly [T, ...T[]];

export function asNonEmpty<T>(items: readonly T[]): NonEmpty<T> | null {
	return items.length === 0 ? null : [items[0], ...items.slice(1)];
}

export function pickFirst<T>(items: NonEmpty<T>): T {
	return items[0];
}

// A start timestamp plus duration cannot represent a negative time window.
export interface TimeWindow {
	readonly start: Date;
	readonly durationMs: number;
}
```

Keep plain `readonly T[]` whenever an operation is already total on empty arrays (such as `.map`, `.filter`, or `.reduce` with an initial value). Strengthen the input to `NonEmpty<T>` only where loose types force non-null assertions (`!`) or synthetic throws.

## Schemas and boundary parsing

Let one runtime schema own boundary validation and static type inference when the project already includes a schema library.

```ts
import { z } from "zod";

const SliceReportSchema = z.object({
	worker: z.string().min(1),
	commitSha: z.string().regex(/^[0-9a-f]{7,40}$/),
	verdict: z.enum(["PASS", "ISSUES", "BLOCKED"]),
});

export type SliceReport = z.infer<typeof SliceReportSchema>;

export function parseSliceReport(raw: unknown): SliceReport {
	return SliceReportSchema.parse(raw);
}
```

When an interface already exists first, annotate the schema (`const schema: z.ZodType<Target> = ...`) so missing fields fail compilation immediately. Do not add a new third-party dependency solely for one guard when a small verifying parser suffices.

## Removing `as` casts and checking exhaustiveness

When refactoring an existing `as` cast out of TypeScript code, diagnose why inference stopped:

- Add a literal `kind` tag if variants lacked a shared discriminant.
- Parse at the boundary if `Record<string, unknown>` or `unknown` leaked inward.
- Replace `value as Config` on static literals with `value satisfies Config`.

Close every union `switch` with an explicit `never` check so adding a new variant produces a compile error at every unhandled call site.

```ts
export function describeState(state: TaskState): string {
	switch (state.kind) {
		case "queued":
			return "queued";
		case "running":
			return `running since ${state.startedAtMs}`;
		case "succeeded":
			return `done (${state.output.artifactCount} files)`;
		case "failed":
			return `failed (${state.error})`;
		default: {
			const exhaustive: never = state;
			return exhaustive;
		}
	}
}
```

## Derived types and named arguments

Derive narrow parameter shapes from generated or canonical definitions (`Pick<FullRecord, "id" | "status">`, `ReturnType<typeof createStore>`) so downstream signatures track upstream changes automatically.

```ts
// Prefer named fields when multiple string or numeric arguments can be swapped.
export interface OpenSliceArgs {
	readonly repoPath: string;
	readonly baseRef: string;
	readonly headRef: string;
}

export function diffSlice(args: OpenSliceArgs): Promise<string> {
	return runGitDiff(args.repoPath, args.baseRef, args.headRef);
}
```
