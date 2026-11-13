# Understand the code before changing it

Editing unfamiliar code blind is the fastest way to ship subtle regressions. Agents fail the same way humans do when they patch the first plausible line without tracing callers, state invariants, or historical constraints. [`/understand`](../../skills/understand/SKILL.md) builds a verified mental model before any file changes, and [`/ketchup`](../../skills/ketchup/SKILL.md) rebuilds context across long or prior sessions.

![A detective studies a machine blueprint with a magnifying glass while robots gather case files and link clues across an evidence board.](./images/understanding.jpg)

## One parallel `ro-*` mesh, three modes

[`/understand`](../../skills/understand/SKILL.md) spawns a read-only swarm mesh (`ro-code`, `ro-git`, `ro-tracker`, `ro-docs` in `workspace: "inherit"`). Because `hooks/guard.mjs` enforces read-only safety mechanically across files, shell commands, and MCP tools, every `ro-*` worker can cross-query source files, `git log` and `git blame`, GitHub PRs, issue trackers, and design docs simultaneously. Workers post `#seq` clues on the shared board so peers pivot live when `git blame` uncovers a decisive PR or incident ticket.

Pick any of `/understand`'s three modes through natural phrasing.

### 1. Mechanism walkthrough

Ask how a subsystem works right now:

```text
/understand how do we deduplicate outbound webhooks, and can concurrent retries trigger an N+1 query?
```

The mesh traces entry points, data types, state transitions, and subtle invariants, returning a senior-engineer walkthrough backed by exact `file:line` citations.

### 2. Historical provenance and archaeology

Ask why something was built or constrained a specific way:

```text
/understand why was the lease renewal cap fixed at five attempts, and does that constraint still hold?
```

Grounded in [`skills/understand/references/epistemics.md`](../../skills/understand/references/epistemics.md), the report separates direct primary evidence (commits, PR discussions, tickets, post-mortems) from inference, flags thin records explicitly, and reports null findings honestly when nobody wrote down the original reason.

### 3. Interactive Socratic walkthrough

Ask to build real mastery over a complex subsystem or diff rather than skimming a summary:

```text
/understand walk me through how this branch changes transaction retries step by step, with diagrams, and check my understanding as we go.
```

It blends mechanism and history into progressive chunks with Mermaid diagrams and concrete mental-model checks, turning passive reading into active verification. You can also turn it on an agent's own work (`"/understand convince me your fix addresses the root cause rather than the symptom"`).

## Warm fork from investigation straight to code

Once `/understand` (or `/pstack` in `diagnose` topology) pinpoints the exact root cause, you do not throw away the investigator's loaded context. Native swarm supports `fork: "<member>"`, allowing the coordinator to spawn `impl-fix` (`workspace: "share"`, `fork: "ro-code"`) with every file trace and invariant already warm in memory while switching cleanly into an isolated author worktree.

## Catch up and recall context with `/ketchup`

When returning to a long-running swarm or resuming work from earlier in the week, run [`/ketchup`](../../skills/ketchup/SKILL.md):

```text
/ketchup
```

Parallel `ro-*` gatherers inspect active swarm `view.json` state, `board.jsonl` `#seq` deltas, prior `<appDataDir>/brain/*/.system_generated/swarm/` boards, `git log`, and open `gh pr` status without mutating anything. Every item waiting on your decision comes back with options, `#seq` evidence, and risk so you can decide from the briefing alone.

Pass `--plain` when you want a zero-jargon human summary of a dense technical thread, or `--video` when you want a short subtitled slide walkthrough of what changed:

```text
/ketchup --plain
```

```text
/ketchup --video
```

To take over an unfinished branch left by an earlier session and continue execution from its last verified state, hand the branch to `/pstack` (`program` topology):

```text
/pstack pick up the in-flight parser migration branch, verify what already passes, and finish the remaining callers without redoing completed slices.
```

**Pitfall.** Never skip `/understand` on thorny subsystems assuming `"the author worker will read the code anyway"`. An author tasked with shipping a diff optimizes for the shortest edit that compiles. Five minutes of read-only `#seq` clue sharing prevents hours of fixing the wrong layer.

Continue to [Design the change](./04-design.md).
