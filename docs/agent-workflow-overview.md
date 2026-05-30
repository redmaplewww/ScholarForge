# CLI Agent Workflow Overview

> External-facing brief. This document intentionally describes only high-level behavior and omits prompts, implementation details, internal rules, and proprietary heuristics.

## Purpose

This CLI project provides an agent-assisted workflow for LAMMPS simulation work. It decomposes a simulation request into staged planning, construction, review, execution, analysis, and visualization steps, while keeping state and decisions traceable across turns.

## Agent Roles

The system uses specialized agents with clear responsibility boundaries:

| Role | Main responsibility | Blocking? |
| --- | --- | --- |
| Coordinator | Routes tasks, tracks stage progress, summarizes next actions | Yes, for routing decisions |
| Simulation Architect | Converts vague requirements into a reviewable simulation scheme | Yes, before implementation |
| Simulation Reasoner | Checks physical reasonableness against available evidence | Advisory only |
| Input Writer | Produces structures, potential configuration, and input scripts | Yes, as producer |
| Reviewer | Performs technical gate checks before key stage transitions | Yes |
| Data Analyst | Parses results, evaluates success criteria, and recommends follow-up | Usually advisory |
| Case Librarian | Retrieves relevant prior cases and reusable knowledge | Advisory |
| Paper Researcher | Retrieves literature benchmarks when needed | Advisory |
| KB Coordinator | Maintains reusable knowledge and lessons learned | Advisory |

## Workflow Stages

The workflow is organized into a compact state machine:

| Stage | Description | Typical output |
| --- | --- | --- |
| WF-00 | Simulation scheme design | Approved simulation plan |
| WF-01 | Model setup | Structure files and handoff packet |
| WF-02 | Potential configuration | Potential selection/configuration packet |
| WF-03A | Input script writing | LAMMPS input script and execution-ready packet |
| WF-04 | Data analysis | Analysis report and pass/fail assessment |
| WF-05 | Visualization/post-processing | Figures and interpreted outputs |

An optional HPC branch can be added after the input script is reviewed. A continuous advisory reasoner may participate after scheme design, after analysis, or during repair loops.

## State Machine

At a high level, each project moves through:

```text
request -> scheme -> model -> potential -> input -> execution -> analysis -> visualization
              |         |          |          |
              +---------+----------+----------+-> reviewer gates
```

State is tracked through lightweight project files rather than hidden conversation memory alone. The core state records:

- current workflow stage
- stage status: in progress, blocked, or completed
- locked technical decisions
- reviewer outcomes
- open issues and next action
- run outputs and analysis reports

This makes the workflow resumable and auditable without exposing internal agent prompts.

## Review And Safety Model

The system uses mandatory review gates for high-risk transitions:

- WF-00: simulation scheme review
- WF-01: model/structure review
- WF-02: potential configuration review
- WF-03A: input script review

Reviewer outcomes are simplified to:

- `PASS`: advance to the next stage
- `REVISE`: return to the producer for bounded correction
- `BLOCKED`: stop advancement and surface the risk to the user

The reviewer focuses on technical correctness and known failure patterns. Physical plausibility checks are handled separately by the reasoner so quality control is split between technical and scientific concerns.

## Handoff Design

Agents exchange concise stage packets instead of relying on free-form context. These packets capture only the information needed for the next stage, such as selected files, assumptions, risks, review status, and next-step recommendations.

This design improves:

- traceability of decisions
- repeatability across sessions
- ability to resume partially completed workflows
- separation between planning, production, review, and analysis

## Execution And Repair Loop

After input review passes, execution can proceed through the CLI's execution layer. Run metadata, logs, repair classifications, and next-step recommendations are written as structured artifacts. The coordinator then decides whether to continue to analysis, route back for correction, or ask for user input when the risk is significant.

The repair loop is intentionally bounded: it recommends a next actor or rollback target, but does not silently rewrite the overall project direction.

## Confidentiality Boundary

This overview excludes:

- internal agent prompts
- exact reviewer rule definitions
- private implementation scripts and routing internals
- detailed knowledge-base structure
- proprietary case examples or hidden heuristics

The intended takeaway is architectural: the CLI uses staged multi-agent collaboration, lightweight state tracking, reviewer gates, advisory reasoning, and resumable handoffs to make simulation workflows more reliable.
