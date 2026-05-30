# Workflow Stages

This file is the domain-neutral workflow template. Replace `DOMAIN_...` values and
`<!-- DOMAIN: -->` blocks when creating a concrete team.

## Stage Template

Each stage should define:

- **Stage ID**: `DOMAIN_STAGE_XX`
- **Description**: what this stage produces or validates
- **Input**: required handoff packet and artifacts
- **Output**: reviewable artifacts with paths
- **Primary agent**: `DOMAIN_<role>-agent`
- **Review gate**: `yes | no`
- **Reviewer**: `DOMAIN_reviewer` when a gate is required

## Default Auto-Configuration Pipeline

This is the pipeline that `domain-coordinator` should use when a user starts from
`bun run chat` and describes target work before a concrete team exists.

1. **DISCOVERY: Target work diagnosis**
   - Input: user request, files, constraints, target deliverables
   - Output: domain brief, candidate team name, risk list, success criteria
   - Primary agent: `domain-coordinator`
   - Review gate: no

2. **TEAM_DESIGN: Agent/workflow design**
   - Input: domain brief
   - Output: proposed coordinator, specialists, stages, review gates, KB taxonomy
   - Primary agent: `setup-coordinator`
   - Review gate: yes when the workflow is complex or high risk

3. **TEAM_GENERATION: Template materialization**
   - Input: approved team design
   - Output: `agents/<team>-coordinator.md`, specialists, workflow/evidence/state rules
   - Primary agent: `setup-coordinator`
   - Review gate: optional

4. **RUNTIME_REFRESH: Entry generation**
   - Input: generated concrete coordinator
   - Output: refreshed `.angsheng/agents/` and `bun run <team>` entry
   - Primary command: `bun run init-runtime`
   - Review gate: no

5. **WORKFLOW_EXECUTION: Concrete team work**
   - Input: user task and concrete team entry
   - Output: domain artifacts, review packets, KB update candidates
   - Primary agent: `<team>-coordinator`
   - Review gate: as defined by concrete workflow

## Recommended Concrete Team Pipeline

1. **DOMAIN_STAGE_01: Intake / requirement capture**
   - Input: user request, relevant files, constraints
   - Output: scoped task brief and assumptions
   - Review gate: optional

2. **DOMAIN_STAGE_02: Design / plan**
   - Input: approved task brief
   - Output: implementation or execution plan
   - Review gate: yes for high-risk workflows

3. **DOMAIN_STAGE_03: Production / execution**
   - Input: approved plan
   - Output: domain artifact, code, analysis, or run metadata
   - Review gate: yes for irreversible, expensive, or technical changes

4. **DOMAIN_STAGE_04: Verification / analysis**
   - Input: produced artifacts and run outputs
   - Output: pass/fail assessment, metrics, issues, post-processing outputs, visualizations
   - Review gate: optional

5. **DOMAIN_STAGE_05: Reporting / handoff**
   - Input: verified result
   - Output: final report, result interpretation, reusable lessons, next-step recommendation
   - Review gate: no by default

## Data Post-Processing And Reporting

Concrete teams should include explicit analysis/reporting responsibility when the
workflow produces data, logs, documents, benchmark outputs, experiment results,
or generated artifacts.

Recommended outputs:

- cleaned or normalized result data
- metric definitions and computed values
- plots/tables or other visual summaries
- result interpretation tied back to success criteria
- uncertainty, limitations, and failure notes
- final report under `knowledge/reports/` or a project-specific report path
- reusable lessons routed to the KB pipeline

## Mode Notes

- In normal `bun run chat`, the generic `domain-coordinator` remains the main entry.
- Concrete teams should provide `<team>-coordinator.md` in `agents/`.
- `bun run init-runtime` scans concrete coordinators and creates direct `bun run <team>` entries.
- Team entries do not depend on `.project/setup-config.json`.

<!-- DOMAIN: replace this section with concrete stage definitions. -->
