# Safety-Gated Self-Evolution

Self-evolution is the controlled process of using historical work evidence to
improve agents, workflows, evidence routing, and knowledge usage. In this
template, self-evolution is advisory and safety-gated.

## Core Policy

Self-evolution must never directly modify active behavior. It may generate
reports, proposals, candidate copies, and sandbox tests. Production changes
require explicit user approval after measurable sandbox improvement.

Forbidden without explicit user approval:

- editing `agents/*.md`
- editing `knowledge/rules/*.md`
- editing `ANGSHENG.md`
- editing feature flags, package scripts, or runtime files
- promoting proposal behavior into production

Allowed automatically:

- read workflow state, review logs, evidence logs, run metadata, and memory files
- generate diagnostic reports
- generate proposal JSON/Markdown
- identify failure cases for sandbox replay
- create candidate copies only inside `agent-improvement-proposals/<run-id>/`

Allowed only after user approves sandbox testing:

- create sandbox test manifests
- compare current behavior against candidate behavior
- run safe local smoke/replay tests that do not touch production files

Allowed only after a second explicit user approval:

- apply a proposal to active files

## Monitoring Signals

The self-evolution monitor should look for:

- high `REVISE` count for one agent or stage
- repeated `BLOCKED` reasons
- recurring failure signatures in `.project/runs/`
- missing evidence in review packets
- repeated rollback to the same producer
- too many handoff messages for simple stages
- stale or overly broad knowledge loaded for narrow tasks
- repeated user corrections

## Proposal Types

Prefer these proposal types:

- `context-optimization`: reduce prompt/context load while preserving evidence
- `evidence-routing`: require better evidence lookup before a stage
- `handoff-schema`: improve missing or ambiguous handoff fields
- `kb-bootstrap`: add missing templates, tags, or lesson categories
- `sandbox-test`: create replay tests for known failure cases
- `review-check`: add a check only when repeated failure evidence exists

Avoid broad prompt rules such as "be more careful" unless a sandbox test proves
the change improves measurable outcomes.

## Proposal Schema

```json
{
  "id": "SE-YYYYMMDD-HHMMSS-001",
  "target_agent": "agent-name-or-null",
  "target_area": "agent | workflow | evidence | knowledge | state",
  "proposal_type": "context-optimization | evidence-routing | handoff-schema | kb-bootstrap | sandbox-test | review-check",
  "risk_level": "low | medium | high",
  "observed_problem": "specific repeated issue",
  "evidence_paths": [],
  "failure_cases": [],
  "proposed_change": "specific candidate change",
  "predicted_impact": "what should improve",
  "validation_plan": [],
  "metrics": ["review_rounds", "failure_count", "blocked_count", "evidence_completeness"],
  "human_review_required": true,
  "auto_apply_allowed": false,
  "sandbox_status": "not_requested | approved | complete | failed",
  "apply_allowed": false
}
```

## Sandbox Gate

Sandbox testing must use the cases where the original errors were found. A
proposal can be recommended for apply only when the sandbox report shows clear
improvement in at least one target metric and no regression in mandatory checks.

Required sandbox outputs:

- `sandbox-manifest.json`
- candidate copies under `candidate-agents/` or `candidate-rules/`
- `sandbox-report.md`
- before/after metric comparison
- rollback instructions

## Apply Gate

Applying a proposal requires an explicit user instruction that references the
proposal ID. The apply step must show the exact diff first and must preserve
rollback instructions.
