# Code archaeology in git and the repository

## What this source contains

- Commit history including messages, dates, authors, and patches across renames.
- Pull request descriptions, review threads, and review comments via `gh`.
- Inline code comments, `TODO`, `FIXME`, and deprecation notices.
- Architectural decision records (`docs/adr/` or equivalent).
- Test suites whose fixture shapes and names preserve motivating edge cases.
- Co-changed files in the same commit that reveal hidden coupling.
- `CHANGELOG` entries, release notes, and ticket IDs embedded in commit trailers.

Source control is always available and ties directly to the exact lines under study.

## How to search it

Expand from the target file and symbol set:

```bash
# Full history across file renames
git log --follow --oneline -- <file>

# Pickaxe search for commits adding or removing an exact literal
git log -S '<exact_string_from_code>' -- <file>

# Regex diff search across history
git log -G '<regex>' -- <file>

# Exact line authorship and commit timestamps
git blame -L <start>,<end> <file>

# Full commit message and patch
git show <hash>

# Pull request body, linked issues, comments, and reviews
gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews
```

Check in-repo documentation and tests alongside git history:

```bash
# Architectural decision records
rg -l -i 'architecture.decision' --glob '*.md'

# Nearby inline rationale or workarounds
rg -n -C2 '(TODO|FIXME|HACK|XXX|NOTE)' <target_file>

# Behavioral tests referencing the symbol
rg -l '<symbol>' --glob '*test*'
```

## Sharing clues on the swarm board

As soon as `git log` or `gh pr view` surfaces ticket IDs, author handles, merge dates, or incident keywords, post a short clue to the board and tag `@ro-tracker` or `@ro-docs` so peers narrow their time windows and search terms immediately.
