# Mandatory Checks

These checks are intentionally domain-neutral. Concrete teams should add
`DOMAIN_MC_...` checks for technical correctness, safety, and acceptance criteria.

## MB-001: Evidence Citation

All non-trivial technical decisions must cite at least one of:

- local knowledge under `knowledge/`
- prior case or report files
- source code or artifact paths
- authoritative external references retrieved by a researcher

Uncited high-impact decisions trigger `REVISE`.

If `.project/evidence.json` exists, high-impact decisions should cite evidence
IDs such as `EV-001`. Use `bun run evidence:check` to validate IDs and source
existence before approving a review gate.

## MB-002: Handoff Completeness

Every stage handoff must include:

- stage id and status
- producer agent
- artifact paths or a reason no artifact exists
- assumptions and known risks
- next recommended actor

Missing required handoff fields trigger `REVISE`.

## MB-003: Review Gate Integrity

If a stage declares a review gate, advancement requires a reviewer decision:

- `PASS`: advance
- `REVISE`: return to producer with bounded fixes
- `BLOCKED`: stop and ask for user or coordinator decision

Skipping a required review gate triggers `BLOCKED`.

## MB-004: Bounded Repair

Repair loops must declare:

- maximum revision count (default: 3)
- rollback target
- responsible actor
- stop condition

Unbounded repair loops trigger `BLOCKED`.

## MB-005: Secret And Safety Hygiene

Do not commit or transmit secrets, credentials, `.env` values, private keys, or
tokens. If a workflow uses team memory, channels, remote control, or MCP tools,
verify that sensitive files are excluded or explicitly approved.

## MB-006: Team Configuration Completeness

Before a new concrete team is considered ready, it must have:

- `agents/<team>-coordinator.md`
- at least one production specialist or a clear reason the coordinator can route to existing generic agents
- workflow stages with owners
- review gate policy
- knowledge taxonomy and starter folders
- evidence requirements
- direct entry instructions: `bun run init-runtime`, then `bun run <team>`

Missing readiness items trigger `REVISE`.

## MB-007: State Machine Traceability

Long or multi-agent work must keep state outside chat. At minimum, track:

- current state and active stage
- active team/agent
- handoff packet path or content
- evidence list
- review decision
- next action

Missing state for multi-stage work triggers `REVISE`.

## MB-008: Knowledge Bootstrap

New domains must define what goes into the knowledge base:

- rules and mandatory checks
- memory/lessons
- cases/examples
- reports/outputs
- templates
- external references, if needed

If no KB plan exists for a reusable workflow, return `REVISE`.

## Domain Check Placeholder

<!-- DOMAIN: add concrete mandatory checks such as DOMAIN_MC_101 here. -->
