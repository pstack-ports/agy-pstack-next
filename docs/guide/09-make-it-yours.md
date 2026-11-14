# Make it yours

Every repository has its own invariants, failure modes, and team habits. Pstack v2 adapts to how you work through [`/setup-pstack`](../../skills/setup-pstack/SKILL.md) for models and automations, [`/reflect`](../../skills/reflect/SKILL.md) for turning mistakes and slow sessions into structural guardrails, `/pstack` (`evolve` topology) for authoring and blind-testing skills, and [`/make-bot-ui`](../../skills/make-bot-ui/SKILL.md) for custom operator interfaces.

## Tune models, budgets, and standing automations with `/setup-pstack`

Run [`/setup-pstack`](../../skills/setup-pstack/SKILL.md) any time your model catalog, reasoning budget, or daily workflow shifts:

```text
/agy-pstack-next:setup-pstack
```

Beyond updating `~/.gemini/config/rules/pstack-models.md` across `coordinator`, `impl-*`, `ro-*`, `adv-*`, `ro-judge`, and `sicko-*` prefixes and keeping `pstack-swarm-guard` registered in `~/.gemini/config/hooks.json`, `/setup-pstack` helps you draft standing `/schedule` automations tailored to your repositories (for example, morning `/ketchup` summaries or scheduled `/verify-gen --maintain` checks) and recommends prompts from [`prompting.md`](../../skills/setup-pstack/references/prompting.md) and [`recipes.md`](../../skills/setup-pstack/references/recipes.md).

## Turn session friction and repeated corrections into structure with `/reflect`

Whenever a session took twice as long as it should have, or whenever you catch yourself correcting agents for the same repository mistake a second time, run [`/reflect`](../../skills/reflect/SKILL.md):

```text
/agy-pstack-next:reflect agents keep calling the raw SQL client instead of the repository layer, and we wasted three turns debugging port collisions. fix this structurally.
```

`/reflect` unifies session post-mortems, mid-session user correction capture, and structural rule tightening. Parallel read-only reviewers (`ro-divergent`, `ro-judgment`, and `ro-tooling` in `workspace: "inherit"`, guided by [`divergent-reviewer.md`](../../skills/reflect/references/divergent-reviewer.md), [`judgment-reviewer.md`](../../skills/reflect/references/judgment-reviewer.md), and [`tooling-reviewer.md`](../../skills/reflect/references/tooling-reviewer.md)) mine `<appDataDir>/brain/<id>/.system_generated/logs/transcript.jsonl`, swarm `board.jsonl`, and recent git history.

Instead of appending wishful prose reminders that future agents ignore, `/reflect` ranks enforcement from strongest to weakest and routes verified fixes to `impl-sharpen` (`workspace: "share"`).

1. **Architecture or data types.** Make the wrong call fail to compile or cease to exist.
2. **Mechanical hooks, lints, or CI checks.** Block bad tool calls in `hooks/guard.mjs` or fail fast with a lint error that names the exact replacement.
3. **Behavioral tests.** Catch regressions deterministically on run.
4. **Role capsules and skills (`roles/*.md`, `SKILL.md`).** Tighten instructions only for judgment calls that code cannot check directly.

Every structural check gets proven against a real past failure before `impl-sharpen`'s commit lands.

## Author and blind-evaluate skills with `/pstack` (`evolve`)

When your team needs a custom domain skill (for example, database migration safety or release cutoffs), route authoring and evaluation through [`evolve`](../../skills/pstack/topologies/evolve.md):

```text
/agy-pstack-next:pstack author a project skill for zero-downtime Postgres migrations and evaluate it against baseline on three holdout scenarios.
```

`evolve` validates frontmatter and relative links via Antigravity's customization spec (`agy plugin validate --strict --json .`) and prevents prompt overfitting by testing skill or capsule edits blind.

- **Holdout scenarios.** Tasks mirror organic engineering prompts without leaking words like `"eval"` or `"candidate"`.
- **Isolated headless trials.** `impl-eval-*` workers stage candidate `SKILL.md` files directly under `/tmp/<project-slug>-<id>/.agents/skills/<name>/SKILL.md` and run `agy -p --mode auto` inside isolated `/tmp` clones (adding `--sandbox` on read-only trials while omitting `--sandbox` when trials must create git commits) so observer bias cannot skew behavior.
- **Cross-family blind grading.** `ro-judge` scores anonymized outputs and inspects actual tool transcripts to verify instructions were followed in action rather than merely claimed in prose.

For verification-specific skills, reach directly for [`/verify-gen`](../../skills/verify-gen/SKILL.md) (behavioral E2E) or `/verify-gen --formal` (invariants and TLA+ models) instead of writing harnesses from scratch.

## Hold documentation to `/technical-writing` standards

Skills are not the only prose your repo ships. Use [`/technical-writing`](../../skills/technical-writing/SKILL.md) when drafting or reviewing READMEs, guides, RFCs, commit bodies, and PR descriptions:

```text
/agy-pstack-next:technical-writing tighten docs/architecture.md and verify every CLI flag and path against HEAD
```

It enforces Diataxis mode purity (tutorial, how-to, reference, or explanation), active Google developer style, single-thought STE sentences, Global English disambiguation, zero AI vocabulary or em-dashes, and an independent `ro-*` accuracy pass against real source symbols.

## Build custom wake dashboards with `/make-bot-ui`

When you want a one-click browser dashboard on your laptop or phone (over Tailscale) that wakes Antigravity agents to triage queues, approve staging actions, or kick off `/pstack` workflows, run [`/make-bot-ui`](../../skills/make-bot-ui/SKILL.md):

```text
/agy-pstack-next:make-bot-ui build a mobile-friendly triage board on my tailnet where each button wakes an agent to reproduce or close an issue
```

`/make-bot-ui` wires browser buttons to a managed Antigravity sidecar server (`~/.gemini/config/sidecars/<sidecar-id>/sidecar.json` supplying `ANTIGRAVITY_LS_ADDRESS` to `agy agentapi` via safe `execFileSync` argument arrays, enabled through `sidecar://dashboard` rather than editing `~/.gemini/config/config.json`) or to authenticated external webhooks, stores any webhook sender key in a `chmod 600` server-side file outside chat and browser code, verifies the UI with `/control-ui`, and prints both MagicDNS and Tailscale IPv4 URLs.

**Pitfall.** Never mix skill or hook edits into an unrelated product feature branch. Land workflow improvements in their own commit or PR so `evolve` can measure their effect cleanly.

Continue to [Recipes and pitfalls](./10-recipes-and-pitfalls.md).
