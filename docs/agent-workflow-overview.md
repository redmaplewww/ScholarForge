# Generic Agent Workflow Overview

This template supports staged, reviewable, multi-agent workflows for any domain.
It avoids domain assumptions; concrete teams add their own stages, artifacts,
checks, and specialist agents.

## Core Roles

| Role | Responsibility |
|------|----------------|
| Coordinator | Routes tasks, tracks stage state, creates workers or teammates, summarizes next actions. |
| Specialist | Produces domain-specific artifacts for one or more stages. |
| Reviewer | Enforces mandatory checks before a stage advances. |
| Librarian | Retrieves reusable local knowledge and prior cases. |
| Researcher | Looks up external evidence when local knowledge is insufficient. |
| KB Coordinator | Curates new lessons, cases, and error patterns into `knowledge/`. |

## Workflow Shape

```text
request -> intake -> plan -> produce -> verify -> report
             |        |        |
             +--------+--------+-> reviewer gates when required
```

State should be recorded in explicit files and handoff packets, not hidden in
conversation history only. This makes work resumable, auditable, and portable.

## Review Model

Reviewer decisions use three outcomes:

- `PASS`: advance to the next stage
- `REVISE`: return to the producer with a bounded fix list
- `BLOCKED`: stop advancement and surface the risk to the user or coordinator

## Runtime Modes

- **Normal chat**: `bun run chat` starts `domain-coordinator`.
- **Direct team entry**: `bun run <team>` starts `<team>-coordinator`.
- **Coordinator mode**: coordinator uses worker agents through Agent/SendMessage/TaskStop.
- **Agent teams**: concrete coordinators can use TeamCreate and Task tools when available.
- **Fork subagents**: inherited-context async workers when `FORK_SUBAGENT` is enabled.

## Handoff Design

Each handoff should include stage, status, producer, artifacts, assumptions,
risks, review status, and next recommended actor. See
`knowledge/rules/workflow-handoffs.md` for the template.
