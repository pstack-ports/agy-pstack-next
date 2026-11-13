# Epistemics

How to reason about confidence when historical evidence is fragmentary or contradictory, and how to report findings without false certainty. Code shows what executes today, not why an author wrote it. Motivation lives in commits, PRs, tickets, docs, chat threads, and telemetry. Every one of those records is partial. Pretending otherwise turns guesses into confident misinformation.

## Confidence tiers

Every provenance claim in `/understand` must sit in one of five tiers. The tier determines both its section and its phrasing.

### 1. Direct

An explicit textual statement from an author or contemporary artifact answers why. Code behavior alone never qualifies. Valid examples include a PR body stating "fixes pagination stall past 1000 rows", a ticket stating "added for customer Acme SOC2 review", an inline comment stating `// clamp to 100 because upstream rejects larger batches`, a design doc recording "chose option A over B for restart durability", or an author chat message explaining the switch.

Phrasing uses confident present or past tense with an immediate citation, such as "This guard exists because upstream rejects batches over 100 (`PR #412`)."

### 2. Supported

Multiple pieces of indirect evidence converge on one conclusion even though no single text states the full sentence. Examples include a PR titled "tighten batch perf", a linked `perf` ticket, and hot-path benchmarks added in the same commit, or an error metric spiking the day before a defensive guard landed and dropping to zero right after deploy.

Phrasing states the conclusion and cites every converging item, such as "Converging evidence points to latency pressure on large payloads (`PR #412`, `ENG-881`, `dd metric checkout.p99`)."

### 3. Inferred

A reasonable interpretation of context that no source states directly. For example, a fix merged within twenty minutes of an incident channel alert with no ticket text, or a retry count of 3 matching adjacent client wrappers.

Phrasing uses explicit hedges and shows the inference chain, such as "Given the same-day merge during `#sev-api` activity, this check was likely added as an urgent mitigation."

### 4. Speculative

A plausible hypothesis resting on thin evidence where rival explanations fit just as well. Worth naming because a human teammate may recognize the right story, provided it is clearly marked as a guess.

Phrasing frames it as one candidate among others inside Competing hypotheses, such as "One possibility is an old Safari layout workaround, though no contemporary ticket or comment mentions Safari."

### 5. Unknown

The `ro-*` mesh searched relevant sources and found no record of why. Documenting the null result saves the reader from repeating dead-end searches and tells them which human or unindexed system to ask.

Phrasing names exact queries, scopes, and sources searched, such as "We searched Linear for `batch_limit` and `clamp`, reviewed all 6 PRs touching `src/sync.ts` since 2024, and checked `#eng-sync`. None recorded why the threshold is 100."

## Phrasing rules

- **Causation words require Direct or Supported citations.** Words like `because`, `the reason is`, `was designed to`, `fixes`, and `the team decided` claim historical fact and require an adjacent citation.
- **Hedges belong on Inferred claims.** Use `appears to`, `likely`, `suggests`, `is consistent with`, or `plausibly`, paired with the evidence chain.
- **Cut false-clarity filler.** Drop `obviously`, `clearly`, `of course`, dismissive `just`, and personal framing like `I think` or `I believe`. Write `the evidence suggests` instead.

## Guardrails against common traps

### Avoid retrospective rationalization

Code that looks sensible today may be an accident, copy-paste from a sibling file, or a workaround for a deleted system. Never work backward from current code structure to invent a tidy engineering reason. Absence of security discussion in a PR does not prove security was irrelevant.

### Resist sycophancy on user guesses

Users frequently embed a theory inside their question ("Why do we buffer here, is it for memory pressure?"). Treat that guess as one hypothesis to test independently against git, tickets, docs, and telemetry. Refute it plainly with citations when the record points elsewhere.

### Surface contradictions instead of picking a winner

When a ticket frames a change as customer compliance and the PR frames it as tech-debt cleanup, cite both. Do not hide the inconvenient source to make the story cleaner.

## Pre-delivery audit

Before presenting Mode B or Mode C provenance findings, check every bullet:

1. Every claim in What we found carries a verifiable citation (`PR #`, commit SHA, ticket ID, doc URL, chat permalink, or telemetry query).
2. No line cites code mechanics alone as proof of author intent.
3. Contradictory sources appear side by side with both citations.
4. What we do not know lists concrete searches that returned nothing and unavailable MCP categories.
