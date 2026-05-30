# Workflow Handoffs

Agents should exchange concise stage packets instead of relying on conversation
memory alone. Use this template for domain-specific handoffs.

## Handoff Packet Format

```json
{
  "stage": "DOMAIN_STAGE_ID",
  "status": "complete | partial | failed | blocked",
  "producer": "DOMAIN_AGENT_NAME",
  "review_status": "not_required | pending | PASS | REVISE | BLOCKED",
  "artifacts": [
    {
      "path": "relative/or/absolute/path",
      "type": "DOMAIN_ARTIFACT_TYPE",
      "description": "what the next agent needs to know"
    }
  ],
  "decisions": {
    "DOMAIN_DECISION_KEY": "DOMAIN_DECISION_VALUE"
  },
  "assumptions": [],
  "risks": [],
  "issues": [],
  "next_recommended_actor": "DOMAIN_AGENT_OR_COORDINATOR",
  "metadata": {
    "created_at": "ISO-8601 timestamp",
    "revision": 0
  }
}
```

## Auto-Configuration Handoff Packet

When `domain-coordinator` needs to create or select a team, use this setup packet:

```json
{
  "mode": "setup | route-existing-team",
  "target_work": "plain-language user goal",
  "candidate_domain": "short-domain-name",
  "candidate_team": "<team>",
  "deliverables": [],
  "constraints": [],
  "required_capabilities": [],
  "proposed_agents": [
    { "name": "<team>-coordinator", "role": "workflow owner" },
    { "name": "<team>-specialist", "role": "production specialist" }
  ],
  "proposed_stages": [],
  "knowledge_bootstrap": {
    "categories": [],
    "starter_files": [],
    "evidence_sources": []
  },
  "state_machine": {
    "initial_state": "DISCOVERY",
    "terminal_states": ["COMPLETE", "BLOCKED", "FAILED"]
  },
  "next_action": "generate-files | ask-user | run-team"
}
```

## Transition Rules

- Do not advance past a required review gate unless the reviewer returns `PASS`.
- If the reviewer returns `REVISE`, route back to the producer with bounded fixes.
- If the reviewer returns `BLOCKED`, stop and surface the decision to the user.
- Keep rollback targets explicit: previous stage, producer agent, and artifact path.
- Store structured review outputs under `.project/` or `scratchpad/review/` when available.

## Parallel Work

Independent research, knowledge lookup, and KB ingestion may run in parallel with
the main production path when their outputs are not prerequisites for the current
stage. The coordinator is responsible for merging those findings into the next
handoff packet.

<!-- DOMAIN: add concrete transition constraints and artifact schemas here. -->
