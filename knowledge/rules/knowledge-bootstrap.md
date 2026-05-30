# Knowledge Bootstrap

Every concrete team should define a starter knowledge base before doing serious
work. The goal is not to fill the KB upfront; it is to make reusable knowledge
capture predictable from the first task.

## Required Structure

| Directory | Purpose |
|-----------|---------|
| `knowledge/rules/` | Workflow, handoff, review, evidence, and state rules. |
| `knowledge/memory/` | Confirmed lessons, pending lessons, session lessons, historical lessons. |
| `knowledge/cases/` | Successful or representative examples. |
| `knowledge/reports/` | Generated reports and summaries. |
| `knowledge/templates/` | Reusable output, prompt, and artifact templates. |
| `knowledge/papers/` | External references or literature notes when relevant. |

## Bootstrap Questions

The coordinator or setup-coordinator should answer these when creating a team:

1. What evidence is mandatory before each review gate?
2. What counts as a reusable case?
3. What failures should become troubleshooting knowledge?
4. What metadata is required for each knowledge item?
5. Which tags should be standardized?
6. Which outputs deserve templates?

## KB Update Triggers

- `COMPLETE`: capture successful patterns and reusable artifacts.
- `FAILED`: capture failure mode, logs, suspected cause, and repair attempt.
- `BLOCKED`: capture missing dependency, credential, approval, or unclear requirement.
- `REVISE`: capture reviewer feedback when it reveals a reusable rule.

## Knowledge Item Template

```markdown
---
id: KB-<category>-<timestamp>
type: rule | lesson | case | report | template | troubleshooting | reference
tags: []
source: <path-or-event>
status: candidate | confirmed | deprecated
created_at: <ISO-8601>
---

# Title

## Context

## Evidence

## Reusable Guidance

## Applicability

## Related Items
```

All confirmed KB entries should be routed through `domain-kb-coordinator` when
that agent is available.
