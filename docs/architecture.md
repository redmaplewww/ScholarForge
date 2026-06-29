# Heavy Reasoning Agent Template Architecture

This template is local-first. The deterministic coordinator lets tests and starter projects run without API keys, while `runtime.create_deep_agent_runtime` can opt into Deep Agents when `runtime.prefer_deepagents` is true and the dependency is installed.

The required path is:

`intake -> plan -> retrieve -> reason -> evidence_audit -> gate -> act_or_answer -> verify -> consolidate -> respond`

Core constraints live in local skills under `skills/`. They are loaded by metadata first and opened only when relevant. Evidence is stored in `evidence/ledger.jsonl`, memory is partitioned under `memory/`, and self-evolution writes proposals under `evolution/proposals/`.

High-risk actions should be mediated through `GatePolicy`. The starter policy checks evidence minimums, human approval requirements, and workspace boundaries.
