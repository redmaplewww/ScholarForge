# Evidence System

The evidence system turns citations into a machine-readable registry so review
gates can verify that important decisions are backed by concrete sources.

## Registry

Evidence is stored in `.project/evidence.json` as a map of `EV-XXX` IDs.

```json
{
  "EV-001": {
    "id": "EV-001",
    "type": "local_knowledge | artifact | run_log | external_reference | review | decision | user_input",
    "source": "knowledge/rules/mandatory-checks.md",
    "summary": "why this evidence matters",
    "tags": ["review-gate"],
    "added_by": "domain-coordinator",
    "added_at": "ISO-8601",
    "exists": true,
    "sha_hint": "size:mtime"
  }
}
```

## Commands

Register evidence:

```bash
bun run evidence:add -- --source knowledge/rules/mandatory-checks.md --summary "Mandatory review rules" --type local_knowledge --tag review
```

List evidence:

```bash
bun run evidence:list
```

Check evidence IDs or minimum count:

```bash
bun run evidence:check -- --ids EV-001,EV-002
bun run evidence:check -- --require 2 --stage DESIGN
```

## Review Gate Rule

For non-trivial or high-risk decisions, handoff packets should cite evidence IDs
or source paths. Reviewers should reject handoffs when evidence is missing,
nonexistent, or too weak for the risk level.

## Evidence Quality Tiers

| Tier | Source | Typical use |
|------|--------|-------------|
| Strong | local rule, confirmed lesson, run log, reviewed artifact | review gates and production decisions |
| Medium | prior case, report, external reference | planning and design justification |
| Weak | unreviewed note, user memory, pending lesson | advisory only |

## Safety

Do not register secrets, credentials, private keys, `.env` values, tokens, or
private personal data as evidence.
