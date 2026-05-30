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

## Domain Check Placeholder

<!-- DOMAIN: add concrete mandatory checks such as DOMAIN_MC_101 here. -->
