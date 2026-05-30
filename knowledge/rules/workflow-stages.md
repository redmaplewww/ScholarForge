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

## Recommended Generic Pipeline

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
   - Output: pass/fail assessment, metrics, issues
   - Review gate: optional

5. **DOMAIN_STAGE_05: Reporting / handoff**
   - Input: verified result
   - Output: final report, reusable lessons, next-step recommendation
   - Review gate: no by default

## Mode Notes

- In normal `bun run chat`, the generic `domain-coordinator` remains the main entry.
- Concrete teams should provide `<team>-coordinator.md` in `agents/`.
- `bun run init-runtime` scans concrete coordinators and creates direct `bun run <team>` entries.
- Team entries do not depend on `.project/setup-config.json`.

<!-- DOMAIN: replace this section with concrete stage definitions. -->
