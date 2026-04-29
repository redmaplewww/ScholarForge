// @ts-nocheck
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SetupConfig, AgentDef, WorkflowStage } from './types'

export async function generateAll(
  config: SetupConfig,
  root: string,
): Promise<string[]> {
  const files: string[] = []

  const agentFiles = await generateAgents(config.agents, root)
  files.push(...agentFiles)

  const workflowFile = await generateWorkflowRules(config.workflow.stages, root)
  files.push(workflowFile)

  const configFile = await generateConfig(config, root)
  files.push(configFile)

  const projectFile = await generateProjectJson(config, root)
  files.push(projectFile)

  return files
}

async function generateAgents(
  agents: AgentDef[],
  root: string,
): Promise<string[]> {
  const files: string[] = []
  const agentsDir = resolve(root, 'agents')

  await mkdir(agentsDir, { recursive: true })

  for (const agent of agents) {
    const content = generateAgentMarkdown(agent)
    const filePath = resolve(agentsDir, `${agent.name}.md`)
    await writeFile(filePath, content, 'utf8')
    files.push(filePath)
  }

  return files
}

function generateAgentMarkdown(agent: AgentDef): string {
  const lines: string[] = [
    '---',
    `name: ${agent.name}`,
    `description: ${agent.description || agent.role}`,
    `model: ${agent.model || 'sonnet'}`,
    `effort: ${agent.effort || 'medium'}`,
    `color: ${agent.color || 'green'}`,
    `permissionMode: acceptEdits`,
    `maxTurns: ${agent.maxTurns || 60}`,
  ]

  if (agent.mcpServers?.length) {
    lines.push('mcpServers:')
    for (const s of agent.mcpServers) {
      lines.push(`  - ${s}`)
    }
  }

  lines.push('---', '')
  lines.push(`You are the ${agent.name}.`)
  lines.push('')
  lines.push(`Role: ${agent.role}`)
  lines.push('')

  return lines.join('\n')
}

async function generateWorkflowRules(
  stages: WorkflowStage[],
  root: string,
): Promise<string> {
  const rulesDir = resolve(root, 'knowledge', 'rules')
  await mkdir(rulesDir, { recursive: true })

  const content = [
    '# Workflow Stages',
    '',
    ...stages.map(
      (s, i) =>
        `${i + 1}. **${s.name}** — ${s.description} (Agent: ${s.agent}${s.reviewGate ? ', Review Gate: YES' : ''})`,
    ),
  ].join('\n')

  const filePath = resolve(rulesDir, 'workflow-stages.md')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

async function generateConfig(
  config: SetupConfig,
  root: string,
): Promise<string> {
  const filePath = resolve(root, 'setup-config.json')
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
  return filePath
}

async function generateProjectJson(
  config: SetupConfig,
  root: string,
): Promise<string> {
  const projectDir = resolve(root, '.project')
  await mkdir(projectDir, { recursive: true })

  const content = {
    name: config.domain.name,
    description: config.domain.description,
    defaultAgent: config.cli.defaultAgent,
    workflow: {
      stages: config.workflow.stages.map(s => s.name),
      defaultStage: config.workflow.defaultStage,
    },
  }

  const filePath = resolve(projectDir, 'project.json')
  await writeFile(filePath, JSON.stringify(content, null, 2), 'utf8')
  return filePath
}

export function generateSetupCoordinatorPrompt(config: SetupConfig): string {
  return [
    '请审核以下领域配置并帮助完善:',
    '',
    `领域: ${config.domain.name}`,
    `描述: ${config.domain.description}`,
    `Agent 数量: ${config.agents.length}`,
    `工作流阶段: ${config.workflow.stages.length}`,
    '',
    '请检查配置的完整性和一致性，并提出改进建议。',
  ].join('\n')
}
