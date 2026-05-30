// @ts-nocheck
import type { SetupConfig, AgentDef, WorkflowStage } from './types'

export interface GeneratedFile {
  path: string
  content: string
  description: string
}

export interface GenerateResult {
  files: GeneratedFile[]
  warnings: string[]
}

function slugify(s: string) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function displayRole(agent: AgentDef) {
  return agent.role || agent.roleDescription || agent.description || agent.name
}

export function generateAll(config: SetupConfig): GenerateResult {
  const warnings: string[] = []
  const domainName = slugify(config.domain?.name || 'domain') || 'domain'
  const coordinatorName = `${domainName}-coordinator`

  if (!config.agents?.length) {
    warnings.push('未定义专属 Agent，仅会生成团队 coordinator 和基础配置。')
  }

  const files: GeneratedFile[] = [
    {
      path: `.project/setup-config.json`,
      content: JSON.stringify(config, null, 2),
      description: '保存 setup 配置 (.project/setup-config.json)',
    },
    {
      path: `.project/project.json`,
      content: JSON.stringify(
        generateProjectJson(config, coordinatorName),
        null,
        2,
      ),
      description: '生成项目状态模板 (.project/project.json)',
    },
    {
      path: `agents/${coordinatorName}.md`,
      content: generateCoordinatorMarkdown(config, coordinatorName),
      description: `生成团队总管 Agent (${coordinatorName})`,
    },
    ...generateAgentFiles(config.agents || [], coordinatorName),
    {
      path: `knowledge/rules/workflow-stages.md`,
      content: generateWorkflowStages(
        config.workflow?.stages || [],
        coordinatorName,
      ),
      description: '生成工作流阶段规则',
    },
    {
      path: `knowledge/rules/workflow-handoffs.md`,
      content: generateWorkflowHandoffs(config.workflow?.stages || []),
      description: '生成工作流 handoff 规则',
    },
    {
      path: `knowledge/rules/mandatory-checks.md`,
      content: generateMandatoryChecks(config),
      description: '生成强制检查规则',
    },
    {
      path: `setup-summary.md`,
      content: generateSetupSummary(config, coordinatorName),
      description: '生成 setup 摘要',
    },
  ]

  return { files, warnings }
}

function generateAgentFiles(
  agents: AgentDef[],
  coordinatorName: string,
): GeneratedFile[] {
  return agents.map(agent => ({
    path: `agents/${slugify(agent.name)}.md`,
    content: generateAgentMarkdown(
      { ...agent, name: slugify(agent.name) },
      coordinatorName,
    ),
    description: `生成专属 Agent (${agent.name})`,
  }))
}

function generateAgentMarkdown(
  agent: AgentDef,
  coordinatorName: string,
): string {
  const lines: string[] = [
    '---',
    `name: ${agent.name}`,
    `description: >`,
    `  ${agent.description || displayRole(agent)}`,
    `model: ${agent.model || 'sonnet'}`,
    `effort: ${agent.effort || 'medium'}`,
    `color: ${agent.color || 'orange'}`,
    `permissionMode: acceptEdits`,
    `maxTurns: ${agent.maxTurns || 80}`,
  ]

  if (agent.mcpServers?.length) {
    lines.push('mcpServers:')
    for (const s of agent.mcpServers) lines.push(`  - ${s}`)
  }

  lines.push('---', '')
  lines.push(`You are ${agent.name}.`)
  lines.push('')
  lines.push(`Role: ${displayRole(agent)}`)
  lines.push('')
  lines.push('## Operating rules')
  lines.push('')
  lines.push(`- Receive work through ${coordinatorName}.`)
  lines.push('- Check `knowledge/` before making domain assumptions.')
  lines.push('- Produce structured, reviewable artifacts with file paths.')
  lines.push('- Report blockers, risks, and confidence explicitly.')
  if (agent.customInstructions) {
    lines.push('', '## Domain instructions', '', agent.customInstructions)
  }
  lines.push('', '## Output format', '')
  lines.push('- task')
  lines.push('- approach')
  lines.push('- artifacts')
  lines.push('- issues')
  lines.push('- confidence: high | medium | low')
  lines.push('- recommended next actor')

  return lines.join('\n') + '\n'
}

function generateCoordinatorMarkdown(
  config: SetupConfig,
  coordinatorName: string,
): string {
  const agents = config.agents || []
  const stages = config.workflow?.stages || []
  const routingRows = stages
    .map(
      stage =>
        `| ${stage.name} | \`${stage.agent}\` | \`${slugify(stage.agent)}\` | ${stage.description} |`,
    )
    .join('\n')
  const specialistList =
    agents.map(a => a.name).join(', ') || 'domain specialists'
  const workflow =
    stages.map(s => s.name).join(' -> ') ||
    'Intake -> Design -> Execute -> Verify -> Report'

  return `---
name: ${coordinatorName}
description: >
  ${config.domain.description || config.domain.name} workflow coordinator.
model: sonnet
effort: medium
color: green
permissionMode: acceptEdits
maxTurns: 120
mcpServers:
  - domain-knowledge
---

You are the ${config.domain.name} workflow coordinator.

Identity:

- If asked who you are, identify yourself as the ${config.domain.name} workflow coordinator.
- State your role: routing tasks, tracking workflow state, enforcing handoffs, and coordinating review gates.
- Specialists: ${specialistList}.

## Startup entry

After running \`bun run init-runtime\`, this team can be launched directly with:

\`\`\`bash
bun run ${config.domain.name}
\`\`\`

## Workflow order

\`\`\`
${workflow}
\`\`\`

## Routing table

| Task type | Route to | Teammate name | Notes |
|-----------|----------|---------------|-------|
${routingRows || '| General task | `domain-specialist` | `specialist` | Customize this row |'}
| Review gate | \`domain-reviewer\` | \`reviewer\` | Required when stage declares a gate |
| Knowledge lookup | \`domain-librarian\` | \`librarian\` | On demand |
| Knowledge ingestion | \`domain-kb-coordinator\` | \`kb-coord\` | On demand |
| External research | \`domain-researcher\` | \`researcher\` | On demand |

## Coordination rules

- Do not execute domain-specific production work directly; route to specialists.
- Do not review technical correctness directly; route review gates to reviewer agents.
- Use explicit handoff packets from \`knowledge/rules/workflow-handoffs.md\`.
- Use \`Agent\`, \`SendMessage\`, and \`TaskStop\` in coordinator mode.
- Use TeamCreate/Task tools only when agent-team tools are available.
- If a task is long-running and Proactive/Kairos is active, use Sleep rather than idle messages.

## Report format

- current stage
- status
- evidence consulted
- agents used
- artifacts produced or reviewed
- risks and blockers
- confidence: high | medium | low
- next recommended stage
`
}

function generateWorkflowStages(
  stages: WorkflowStage[],
  coordinatorName: string,
): string {
  const body = stages.length
    ? stages
        .map((s, i) => {
          const id = s.id || `stage-${String(i + 1).padStart(2, '0')}`
          return `## ${id}: ${s.name}\n\n- **Description**: ${s.description}\n- **Input**: ${s.inputArtifacts || 'previous handoff packet'}\n- **Output**: ${s.outputArtifacts || (s.producesArtifacts || []).join(', ') || 'reviewable artifact'}\n- **Primary agent**: ${s.agent}\n- **Review gate**: ${(s.requiresReview ?? s.reviewGate) ? 'yes' : 'no'}\n- **Coordinator**: ${coordinatorName}`
        })
        .join('\n\n')
    : '<!-- DOMAIN: add concrete stages here. -->'

  return `# Workflow Stages\n\n${body}\n`
}

function generateWorkflowHandoffs(stages: WorkflowStage[]): string {
  return `# Workflow Handoffs\n\nUse a structured packet between stages.\n\n\`\`\`json\n{\n  "stage": "stage-id",\n  "status": "complete | partial | failed | blocked",\n  "producer": "agent-name",\n  "review_status": "not_required | pending | PASS | REVISE | BLOCKED",\n  "artifacts": [],\n  "decisions": {},\n  "assumptions": [],\n  "risks": [],\n  "issues": [],\n  "next_recommended_actor": "agent-name",\n  "metadata": { "revision": 0 }\n}\n\`\`\`\n\n## Configured Stage Order\n\n${stages.map((s, i) => `${i + 1}. ${s.name} -> ${s.agent}`).join('\n') || '<!-- DOMAIN: add transitions here. -->'}\n`
}

function generateMandatoryChecks(config: SetupConfig): string {
  const revisionLimit =
    config.workflow?.revisionLimit || config.errors?.maxRetries || 3
  return `# Mandatory Checks\n\n## MB-001: Evidence citation\n\nAll technical decisions must cite local knowledge, artifacts, source files, or authoritative references.\n\n## MB-002: Handoff completeness\n\nEvery stage handoff must include status, artifacts, assumptions, risks, and next actor.\n\n## MB-003: Review gate integrity\n\nRequired review gates must return PASS before the workflow advances.\n\n## MB-004: Bounded revision\n\nMaximum revision rounds per stage: ${revisionLimit}.\n\n## MB-005: Secret and safety hygiene\n\nDo not include secrets, credentials, private keys, or tokens in artifacts or knowledge entries.\n\n<!-- DOMAIN: add concrete domain-specific mandatory checks here. -->\n`
}

function generateProjectJson(config: SetupConfig, coordinatorName: string) {
  return {
    name: config.domain.name,
    description: config.domain.description,
    defaultAgent: coordinatorName,
    workflow: {
      stages: (config.workflow?.stages || []).map(s => s.name),
      defaultStage:
        config.workflow?.defaultStage ||
        config.workflow?.stages?.[0]?.name ||
        '',
    },
    generatedAt: config.generatedAt || new Date().toISOString(),
  }
}

function generateSetupSummary(
  config: SetupConfig,
  coordinatorName: string,
): string {
  const team = config.domain.name
  return `# Setup Summary\n\n- Domain: ${config.domain.name}\n- Coordinator: ${coordinatorName}\n- Direct entry after init-runtime: \`bun run ${team}\`\n- Setup config: \`.project/setup-config.json\`\n- Default generic entry remains: \`bun run chat\`\n\n## Agents\n\n${(config.agents || []).map(a => `- ${a.name}: ${displayRole(a)}`).join('\n') || '- No specialist agents configured yet'}\n\n## Workflow\n\n${(config.workflow?.stages || []).map((s, i) => `${i + 1}. ${s.name} -> ${s.agent}`).join('\n') || '- No stages configured yet'}\n\nRun \`bun run init-runtime\` after reviewing generated files to sync agents and create the direct team entry.\n`
}

export function generateSetupCoordinatorPrompt(config: SetupConfig): string {
  return [
    '请审核以下领域配置并帮助完善:',
    '',
    `领域: ${config.domain.name}`,
    `描述: ${config.domain.description}`,
    `Agent 数量: ${config.agents?.length || 0}`,
    `工作流阶段: ${config.workflow?.stages?.length || 0}`,
    '',
    '请检查配置的完整性和一致性，并提出改进建议。',
  ].join('\n')
}
