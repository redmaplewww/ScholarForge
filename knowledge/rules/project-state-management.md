# Project State Management

All multi-stage work must keep durable state under `.project/`. Chat history is
not sufficient for resumable agent workflows.

## State Files

| File | Purpose |
|------|---------|
| `.project/project.json` | Project metadata and selected domain/team. |
| `.project/setup-config.json` | Local setup wizard output; ignored by git; does not control `bun run chat`. |
| `.project/state.json` | Current high-level state machine snapshot. |
| `.project/workflow-state.json` | Active workflow stages, owners, handoffs, revisions. |
| `.project/evidence.json` | Evidence registry for decisions and review gates. |
| `.project/decisions.md` | Locked decisions log. |
| `.project/review-log.md` | Review decision history. |
| `.project/open-issues.md` | Active blocking issues. |
| `.project/runs/` | Execution run metadata and outputs. |

## Generic State Machine

```text
UNCONFIGURED
  -> DISCOVERY
  -> TEAM_SELECTED
  -> WORKFLOW_PLANNED
  -> IN_PROGRESS
  -> REVIEW_PENDING
  -> REVISING
  -> VERIFIED
  -> KB_UPDATE_PENDING
  -> COMPLETE
```

Failure states:

- `BLOCKED`: user decision, missing credential, unsafe action, or unresolved review gate
- `FAILED`: execution or workflow failure after bounded retries

## `.project/state.json` Template

```json
{
  "domain": "unknown",
  "team": null,
  "state": "UNCONFIGURED",
  "active_stage": null,
  "active_agent": "domain-coordinator",
  "handoff_path": null,
  "evidence_ids": [],
  "review_status": null,
  "kb_updates": [],
  "next_action": "discover target work",
  "updated_at": "ISO-8601"
}
```

## Transition Rules

- Every transition must record `from`, `to`, `actor`, `reason`, and timestamp.
- `REVIEW_PENDING -> VERIFIED` requires reviewer `PASS`.
- `REVIEW_PENDING -> REVISING` requires reviewer `REVISE` plus bounded fixes.
- More than 3 revision loops transitions to `BLOCKED`.
- `COMPLETE` should trigger KB update review for reusable lessons.

## Evidence Registry

`.project/evidence.json` should map evidence IDs to source paths or references:

```json
{
  "EV-001": {
    "type": "local_knowledge | artifact | run_log | external_reference",
    "source": "knowledge/rules/mandatory-checks.md",
    "summary": "why this evidence matters",
    "added_by": "domain-coordinator",
    "added_at": "ISO-8601"
  }
}
```

## Conventions

- Prefer append-only markdown logs for decisions and reviews.
- Never delete state entries; mark superseded or closed.
- Store machine-readable current state in JSON and human-readable rationale in markdown.
- Keep local setup state out of git unless the user explicitly wants a reproducible project config.
