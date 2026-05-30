#!/usr/bin/env bun
// @ts-nocheck
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  SetupConfig,
  AgentDef,
  WorkflowStage,
  ErrorPattern,
  FileTypeConfig,
  SubcommandConfig,
} from '../src-generic/setup/types.js'
import {
  generateAll,
  generateSetupCoordinatorPrompt,
} from '../src-generic/setup/generator.js'
import {
  banner,
  heading,
  subheading,
  info,
  success,
  warn,
  error,
  bullet,
  text,
  confirm,
  select,
  multiline,
  pause,
  progressBar,
} from '../src-generic/setup/prompts.js'

async function exists(p: string) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function step01_domain(): Promise<SetupConfig['domain']> {
  heading('第 1 步 / 共 8 步：领域识别')
  info('告诉我们要为哪个领域构建 Agent 系统。\n')

  const name = await text(
    '领域名称（英文短名，如 data-pipeline、financial-analysis）',
  )
  if (!name) {
    error('领域名称不能为空。')
    process.exit(1)
  }

  const description = await text('简要描述这个 Agent 系统要做什么')
  if (!description) {
    error('描述不能为空。')
    process.exit(1)
  }

  const langIdx = await select('主要语言', ['中文', '英文', '中英双语'])
  const languages = ['zh', 'en', 'both'] as const

  return {
    name: slugify(name),
    description,
    primaryLanguage: languages[langIdx],
  }
}

async function step02_agents(
  domain: SetupConfig['domain'],
): Promise<AgentDef[]> {
  heading('第 2 步 / 共 8 步：Agent 团队')
  info('定义你的领域专属 Agent。\n')
  info(
    '内置 Agent（自动包含）：coordinator、reviewer、librarian、kb-coordinator、kb-curator、kb-reviewer、researcher\n',
  )

  const count = parseInt(
    await text('需要几个领域专属 Agent？（1-10）', '2'),
    10,
  )
  const clamped = Math.max(1, Math.min(10, isNaN(count) ? 2 : count))

  const agents: AgentDef[] = []
  for (let i = 0; i < clamped; i++) {
    subheading(`专属 Agent ${i + 1} / ${clamped}`)
    const name = await text(
      'Agent 名称（英文，如 data-analyst、report-generator）',
    )
    if (!name) continue

    const role = await text('角色描述（一句话说明它负责什么）')
    const customInstructions = await multiline(
      '自定义指令（领域规则、约束、输出格式等）',
    )
    const mcpServers = await text('MCP 服务（逗号分隔，不需要则留空）', '')

    agents.push({
      name: slugify(name),
      roleDescription: role || `${name} specialist for ${domain.name}`,
      model: 'sonnet',
      effort: 'medium',
      maxTurns: 80,
      mcpServers: mcpServers
        ? mcpServers
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
      customInstructions,
    })
  }
  return agents
}

async function step03_workflow(
  agents: AgentDef[],
): Promise<SetupConfig['workflow']> {
  heading('第 3 步 / 共 8 步：工作流阶段')
  info('定义生产工作流的各个阶段。\n')

  const agentNames = agents.map(a => a.name)
  const stages: WorkflowStage[] = []

  const count = parseInt(await text('几个生产阶段？（1-8）', '3'), 10)
  const clamped = Math.max(1, Math.min(8, isNaN(count) ? 3 : count))

  for (let i = 0; i < clamped; i++) {
    subheading(`阶段 ${i + 1} / ${clamped}`)
    const name = await text('阶段名称（如 数据采集、模型训练、报告生成）')
    if (!name) continue

    const description = await text('这个阶段具体做什么？')
    const agentIdx = await select('由哪个 Agent 负责？', [
      ...agentNames,
      'domain-coordinator',
    ])
    const requiresReview = await confirm(
      '完成前需要 Reviewer 审查？',
      i < clamped - 1,
    )

    stages.push({
      id: `stage-${String(i + 1).padStart(2, '0')}`,
      name,
      description: description || name,
      agent: agentNames[agentIdx] || 'domain-coordinator',
      requiresReview,
      inputArtifacts:
        i > 0 ? `阶段 ${String(i).padStart(2, '0')} 的输出` : '用户请求',
      outputArtifacts: `${name} 产物`,
    })
  }

  const revisionLimit = parseInt(await text('每个阶段最多返工几轮？', '3'), 10)
  return { stages, revisionLimit: isNaN(revisionLimit) ? 3 : revisionLimit }
}

async function step04_files(): Promise<FileTypeConfig[]> {
  heading('第 4 步 / 共 8 步：文件类型')
  info('配置你的领域需要处理的文件类型。\n')

  const defaults: FileTypeConfig[] = [
    { extension: 'md', label: 'markdown', sourceType: 'documentation' },
    { extension: 'json', label: 'json-data', sourceType: 'data' },
    { extension: 'yaml', label: 'yaml-config', sourceType: 'configuration' },
    { extension: 'txt', label: 'text', sourceType: 'text' },
  ]

  for (const d of defaults) success(`.${d.extension} (${d.label})`)
  info('\n以上为默认包含的类型。下面可以添加自定义类型。')

  const custom: FileTypeConfig[] = []
  while (true) {
    const ext = await text('扩展名（不含点号，留空结束）', '')
    if (!ext) break
    const label = await text('标签', ext)
    const sourceType = await text('来源分类', 'unknown')
    custom.push({ extension: ext, label, sourceType })
    success(`已添加 .${ext}`)
  }

  return [...defaults, ...custom]
}

async function step05_execution(): Promise<SetupConfig['execution']> {
  heading('第 5 步 / 共 8 步：执行配置')
  info('配置如何执行外部命令。\n')

  const enabled = await confirm('你的领域需要执行外部命令吗？', true)
  if (!enabled) {
    return {
      enabled: false,
      binaryName: '',
      defaultArgs: '',
      supportsDryRun: true,
      supportsHpc: false,
      hpcLauncher: '',
    }
  }

  const binaryName = await text(
    '主命令/可执行文件名（如 python、node）',
    'python',
  )
  const defaultArgs = await text('默认参数（如 "-u script.py"）', '')
  const supportsDryRun = await confirm('支持 dry-run 模式？', true)
  const supportsHpc = await confirm('需要 HPC/远程执行？', false)
  const hpcLauncher = supportsHpc
    ? await text('HPC 启动命令（如 "mpirun -np 4"）', 'mpirun -np 4')
    : ''

  return {
    enabled,
    binaryName,
    defaultArgs,
    supportsDryRun,
    supportsHpc,
    hpcLauncher,
  }
}

async function step06_errors(agents: AgentDef[]): Promise<ErrorPattern[]> {
  heading('第 6 步 / 共 8 步：错误模式')
  info('定义常见的错误模式用于自动修复。\n')

  const agentNames = agents.map(a => a.name)
  const patterns: ErrorPattern[] = []

  if (!(await confirm('要添加错误模式吗？', true))) return patterns

  while (true) {
    const name = await text('错误名称（留空结束）', '')
    if (!name) break

    const pattern = await text('检测模式（关键字或正则，| 分隔多种）')
    if (!pattern) continue

    const status = await text(
      '状态标签（如 missing_file、syntax_error）',
      'error',
    )
    const agentIdx = await select('建议由哪个 Agent 修复？', [
      ...agentNames,
      'domain-coordinator',
    ])
    const autoRepairEligible = await confirm('可以自动修复？', true)
    const suggestedFix = await text('修复建议描述', '审查并修复该问题')

    patterns.push({
      name,
      pattern,
      status: slugify(status),
      suggestedActor: agentNames[agentIdx] || 'domain-coordinator',
      autoRepairEligible,
      suggestedFix,
    })
    success(`已添加: ${name}`)
  }
  return patterns
}

async function step07_knowledge(): Promise<SetupConfig['knowledge']> {
  heading('第 7 步 / 共 8 步：知识库')
  info('配置知识来源和外部工具。\n')

  const sourceIdx = await select('主要知识来源', [
    '仅本地文件 (knowledge/)',
    '本地 + 外部 API',
    '本地 + 数据库',
    '以上全部',
  ])
  const sourceMap = [
    ['local'],
    ['local', 'external-api'],
    ['local', 'database'],
    ['local', 'external-api', 'database'],
  ]

  const tools: string[] = []
  if (await confirm('启用外部搜索工具？', false)) {
    const toolIdx = await select('哪些搜索工具？', [
      'Exa (网页搜索)',
      'Semantic Scholar (学术)',
      '两个都要',
    ])
    if (toolIdx === 0 || toolIdx === 2) tools.push('exa')
    if (toolIdx === 1 || toolIdx === 2) tools.push('semanticscholar')
  }

  const initialContent = await multiline('描述需要预置的知识内容（留空跳过）')

  return { sources: sourceMap[sourceIdx], externalTools: tools, initialContent }
}

async function step08_cli(agents: AgentDef[]): Promise<SetupConfig['cli']> {
  heading('第 8 步 / 共 8 步：CLI 配置')
  info('配置 CLI 子命令和关键词路由。\n')

  const agentNames = agents.map(a => a.name)
  const subcommands: SubcommandConfig[] = []

  while (true) {
    const name = await text('子命令名称（英文，留空结束）', '')
    if (!name) break
    const agentIdx = await select('映射到哪个 Agent', [
      ...agentNames,
      'domain-coordinator',
    ])
    const aliases = await text('别名（逗号分隔，留空无别名）', '')
    subcommands.push({
      name: slugify(name),
      agent: agentNames[agentIdx] || 'domain-coordinator',
      aliases: aliases
        ? aliases
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
    })
    success(`已添加: ${name}`)
  }

  const routingKeywords: Record<string, string> = {}
  if (await confirm('添加关键词到 Agent 的路由规则？', true)) {
    while (true) {
      const keywords = await text('关键词（逗号分隔，留空结束）', '')
      if (!keywords) break
      const agentIdx = await select('路由到哪个 Agent', [
        ...agentNames,
        'domain-coordinator',
      ])
      routingKeywords[keywords] = agentNames[agentIdx] || 'domain-coordinator'
    }
  }

  const defaultSubcommand =
    subcommands.length > 0 ? subcommands[0].name : 'plan'

  return { defaultSubcommand, subcommands, routingKeywords }
}

async function reviewAndGenerate(config: SetupConfig): Promise<boolean> {
  heading('确认配置')
  info('生成前请确认你的配置：\n')

  success(`领域: ${config.domain.name}`)
  bullet(`  ${config.domain.description}`)
  bullet(`  语言: ${config.domain.primaryLanguage}`)
  bullet(`  Agent: ${config.agents.length} 个专属 Agent`)
  bullet(
    `  工作流: ${config.workflow.stages.length} 个阶段, ${config.workflow.stages.filter(s => s.requiresReview).length} 个有审查门`,
  )
  bullet(`  文件类型: ${config.files.length} 种`)
  bullet(
    `  执行: ${config.execution.enabled ? config.execution.binaryName : '未启用'}`,
  )
  bullet(`  错误模式: ${config.errors.length} 个`)
  bullet(`  CLI 子命令: ${config.cli.subcommands.length} 个`)
  info('')

  return await confirm('\n确认生成配置文件？', true)
}

async function writeFiles(
  files: { path: string; content: string; description: string }[],
  rootDir: string,
) {
  heading('正在生成文件...')
  info('')

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const fullPath = resolve(rootDir, file.path)
    const dir = resolve(fullPath, '..')

    progressBar(i + 1, files.length, file.description)
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, file.content, 'utf8')
  }

  process.stdout.write('\n')
  success(`已生成 ${files.length} 个文件。\n`)
}

function showNextSteps() {
  heading('后续步骤')
  info('你的 Agent 系统已配置完成！接下来的操作：\n')

  bullet('1. 检查生成的 Agent 定义: agents/ 目录')
  bullet('2. 添加初始知识内容: knowledge/ 目录')
  bullet('3. 运行知识库维护: bun run maintain-knowledge')
  bullet('4. 初始化项目状态: bun run init-state')
  bullet('5. 刷新运行时和团队快捷入口: bun run init-runtime')
  bullet('6. 启动通用入口: bun run chat')
  bullet('7. 如果生成了 <team>-coordinator.md，可直接运行: bun run <team>\n')

  info('或者让 AI 进一步完善配置：')
  bullet('  bun run chat:setup\n')
}

export async function main() {
  banner()

  const mode = await select('请选择配置方式', [
    '交互式引导（逐步回答问题）',
    'AI 辅助（用自然语言描述，AI 自动配置）',
    '加载已有配置文件 (.project/setup-config.json)',
  ])

  if (mode === 1) {
    await runAiMode()
    return
  }

  if (mode === 2) {
    await runLoadMode()
    return
  }

  const domain = await step01_domain()
  const agents = await step02_agents(domain)
  const workflow = await step03_workflow(agents)
  const files = await step04_files()
  const execution = await step05_execution()
  const errors = await step06_errors(agents)
  const knowledge = await step07_knowledge()
  const cli = await step08_cli(agents)

  const config: SetupConfig = {
    domain,
    agents,
    workflow,
    files,
    execution,
    errors,
    knowledge,
    cli,
    generatedAt: new Date().toISOString(),
  }

  const confirmed = await reviewAndGenerate(config)
  if (!confirmed) {
    info('仅保存配置，不生成文件...')
    await mkdir('.project', { recursive: true })
    await writeFile(
      '.project/setup-config.json',
      JSON.stringify(config, null, 2),
      'utf8',
    )
    success('配置已保存到 .project/setup-config.json')
    info('可以重新运行本向导，或使用 --agent setup-coordinator 稍后生成。')
    return
  }

  const result = generateAll(config)
  if (result.warnings.length > 0) {
    for (const w of result.warnings) warn(w)
  }

  await writeFiles(result.files, process.cwd())

  await mkdir('.project', { recursive: true })
  await writeFile(
    '.project/setup-config.json',
    JSON.stringify(config, null, 2),
    'utf8',
  )

  showNextSteps()
  await pause()
}

async function runAiMode() {
  heading('AI 辅助配置')
  info('用自然语言描述你的领域，系统会保存描述并生成初始配置。\n')
  info('之后在宿主 CLI 中使用 setup-coordinator Agent 完成精细配置。\n')

  const description = await multiline('描述你的领域、工作流和需求')
  if (!description) {
    error('描述不能为空。')
    return
  }

  const domainName = await text('给领域起个英文短名', 'my-domain')

  const config: SetupConfig = {
    domain: { name: slugify(domainName), description, primaryLanguage: 'zh' },
    agents: [],
    workflow: { stages: [], revisionLimit: 3 },
    files: [],
    execution: {
      enabled: false,
      binaryName: '',
      defaultArgs: '',
      supportsDryRun: true,
      supportsHpc: false,
      hpcLauncher: '',
    },
    errors: [],
    knowledge: {
      sources: ['local'],
      externalTools: [],
      initialContent: description,
    },
    cli: { defaultSubcommand: 'plan', subcommands: [], routingKeywords: {} },
    generatedAt: new Date().toISOString(),
  }

  const result = generateAll(config)
  await mkdir('.project', { recursive: true })

  for (const file of result.files) {
    const fullPath = resolve(process.cwd(), file.path)
    const dir = resolve(fullPath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, file.content, 'utf8')
  }

  await writeFile(
    '.project/setup-config.json',
    JSON.stringify(config, null, 2),
    'utf8',
  )

  success(`已生成 ${result.files.length} 个文件。`)
  success('配置已保存到 .project/setup-config.json')

  info('\n后续步骤：')
  bullet('1. 运行: bun run chat:setup')
  bullet('2. AI 会读取 .project/setup-config.json 完成精细配置')
  bullet('3. 完成具体 coordinator 后运行: bun run init-runtime')
  bullet('4. 之后可用 bun run <team> 直接进入对应团队\n')

  await pause()
}

async function runLoadMode() {
  heading('加载已有配置')
  const path = await text('配置文件路径', '.project/setup-config.json')

  if (!(await exists(path))) {
    error(`文件不存在: ${path}`)
    return
  }

  const content = await readFile(resolve(process.cwd(), path), 'utf8')
  const config = JSON.parse(content) as SetupConfig

  info(`已加载配置: ${config.domain.name}`)
  const confirmed = await reviewAndGenerate(config)
  if (!confirmed) return

  const result = generateAll(config)
  await writeFiles(result.files, process.cwd())
  showNextSteps()
  await pause()
}

if (import.meta.main) {
  await main()
}
