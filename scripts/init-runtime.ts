#!/usr/bin/env bun
// @ts-nocheck
/**
 * init-runtime.ts - 一次性从 CLI-self 复制运行时，之后完全独立
 *
 * 步骤:
 * 1. 定位 CLI-self
 * 2. 复制 src/ -> 本地 src/（如本地 src/ 已存在则跳过）
 * 3. 复制 packages/ -> 本地 packages/
 * 4. 复制 tsconfig.json, tsconfig.base.json 等构建配置
 * 5. 合并依赖到 package.json（不覆盖脚本）
 * 6. 安装依赖
 * 7. 同步 agents/ -> .angsheng/agents/
 * 8. 扫描具体团队 coordinator 并生成 `bun run <team>` 入口
 * 9. 完成，可删除 CLI-self 后仍能运行
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { resolve, join, relative } from 'node:path'

const HOST_CLI_CANDIDATES = [
  process.env.OPENCODE_CLI_PATH,
  resolve(import.meta.dir, '..', '..', 'CLI-self'),
]

function findHostCli(): string | null {
  for (const c of HOST_CLI_CANDIDATES) {
    if (!c) continue
    if (existsSync(resolve(c, 'src', 'entrypoints', 'cli.tsx'))) return c
  }
  return null
}

function getProjectRoot(): string {
  return resolve(import.meta.dir, '..')
}

function copyDir(
  src: string,
  dst: string,
  label: string,
  filter?: (path: string) => boolean,
) {
  if (existsSync(dst)) {
    console.log(`  [skip] ${label} 已存在，跳过复制`)
    return
  }
  console.log(`  [复制] ${label} ...`)
  cpSync(src, dst, { recursive: true, filter })
  console.log(`  [OK]   ${label} 复制完成`)
}

function mergeDeps(projectRoot: string, hostRoot: string) {
  const ourPkgPath = resolve(projectRoot, 'package.json')
  const hostPkgPath = resolve(hostRoot, 'package.json')

  const ourPkg = JSON.parse(readFileSync(ourPkgPath, 'utf8'))
  const hostPkg = JSON.parse(readFileSync(hostPkgPath, 'utf8'))

  let changed = false

  if (
    (!ourPkg.workspaces || ourPkg.workspaces.length === 0) &&
    hostPkg.workspaces
  ) {
    ourPkg.workspaces = hostPkg.workspaces
    changed = true
  }

  if (hostPkg.dependencies) {
    ourPkg.dependencies = {
      ...hostPkg.dependencies,
      ...(ourPkg.dependencies || {}),
    }
    changed = true
  }

  if (hostPkg.devDependencies) {
    ourPkg.devDependencies = {
      ...hostPkg.devDependencies,
      ...(ourPkg.devDependencies || {}),
    }
    changed = true
  }

  for (const depName of Object.keys(ourPkg.dependencies || {})) {
    if (ourPkg.devDependencies?.[depName] !== undefined) {
      delete ourPkg.devDependencies[depName]
      changed = true
    }
  }

  if (changed) {
    writeFileSync(ourPkgPath, JSON.stringify(ourPkg, null, 2))
    console.log('  [OK]   package.json 依赖已合并（脚本保留不变）')
  } else {
    console.log('  [skip] package.json 无需更新')
  }
}

function ensureBaseScripts(projectRoot: string) {
  const pkgPath = resolve(projectRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.scripts ||= {}

  const requiredScripts = baseScriptMap()

  let changed = false
  for (const [key, value] of Object.entries(requiredScripts)) {
    if (pkg.scripts[key] === value) continue
    pkg.scripts[key] = value
    changed = true
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    console.log('  [OK]   package.json 基础脚本已同步')
  }
}

function syncAgents(projectRoot: string) {
  const src = resolve(projectRoot, 'agents')
  const dst = resolve(projectRoot, '.angsheng', 'agents')
  mkdirSync(dst, { recursive: true })
  let n = 0
  for (const f of readdirSync(src).filter(f => f.endsWith('.md'))) {
    const dstFile = join(dst, f)
    const srcFile = join(src, f)
    if (!existsSync(dstFile)) {
      copyFileSync(srcFile, dstFile)
      n++
    } else {
      const srcContent = readFileSync(srcFile, 'utf8')
      const dstContent = readFileSync(dstFile, 'utf8')
      if (srcContent !== dstContent) {
        copyFileSync(srcFile, dstFile)
        n++
      }
    }
  }
  console.log(`  [OK]   .angsheng/agents/ (${n} 个已更新)`)
}

function syncGenericDocs(projectRoot: string, hostRoot: string) {
  if (process.env.GENERIC_AGENT_SYNC_UPSTREAM_DOCS !== '1') {
    console.log('  [skip] docs/ 保持发布版精简文档')
    return
  }

  const docsDir = resolve(projectRoot, 'docs')
  mkdirSync(docsDir, { recursive: true })
  const files = [
    'agent-workflow-overview.md',
    'features/all-features-guide.md',
    'features/coordinator-mode.md',
    'features/fork-subagent.md',
    'features/proactive.md',
    'features/token-budget.md',
    'features/workflow-scripts.md',
    'features/daemon.md',
    'features/channels.md',
    'features/web-search-tool.md',
    'features/web-browser-tool.md',
    'features/mcp-skills.md',
    'features/acp-link.md',
    'features/context-collapse.md',
    'features/computer-use-tools-reference.md',
    'features/teammem.md',
  ]

  let n = 0
  for (const rel of files) {
    const src = resolve(hostRoot, 'docs', rel)
    if (!existsSync(src)) continue
    const dst = resolve(docsDir, rel)
    mkdirSync(resolve(dst, '..'), { recursive: true })
    copyFileSync(src, dst)
    n++
  }
  console.log(`  [OK]   docs/ 已同步 ${n} 个 CLI 功能文档`)
}

function detectTeamCoordinators(projectRoot: string): string[] {
  const agentsDir = resolve(projectRoot, 'agents')
  if (!existsSync(agentsDir)) return []

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'))
  const teams: string[] = []

  for (const f of files) {
    try {
      const content = readFileSync(join(agentsDir, f), 'utf8')
      const match = content.match(/^name:\s*(.+?)$/m)
      if (match) {
        const name = match[1].trim()
        const isSkip =
          name === 'domain-coordinator' ||
          name === 'setup-coordinator' ||
          name.endsWith('-setup-coordinator') ||
          name.startsWith('domain-') ||
          name.includes('-kb-') ||
          name.includes('-reviewer')
        if (name.endsWith('-coordinator') && !isSkip) {
          teams.push(name)
        }
      }
    } catch {}
  }
  return teams
}

function generateTeamScripts(projectRoot: string, teams: string[]) {
  const pkgPath = resolve(projectRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let changed = false

  // 移除旧的无效团队脚本（含带 team: 前缀的旧格式）
  const oldTeamPrefix = 'team:'
  const reserved = new Set(Object.keys(baseScriptMap()))
  const teamKeys = new Set(teams.map(t => t.replace('-coordinator', '')))
  const teamCommands = new Set(
    teams.map(team => `bun run scripts/dev.ts --agent ${team}`),
  )
  for (const key of Object.keys(pkg.scripts)) {
    const isOldFormat = key.startsWith(oldTeamPrefix)
    const isTeamKey = teamKeys.has(key)
    const looksGeneratedTeamCommand =
      typeof pkg.scripts[key] === 'string' &&
      /^bun run scripts\/dev\.ts --agent .+-coordinator$/.test(
        pkg.scripts[key],
      ) &&
      key !== 'chat' &&
      key !== 'chat:setup'
    if (!isOldFormat && !isTeamKey && !looksGeneratedTeamCommand) continue
    const agentName = pkg.scripts[key]
    const isValid = teamCommands.has(agentName)
    if (!isValid) {
      delete pkg.scripts[key]
      changed = true
    }
  }

  // 添加新的团队脚本
  for (const team of teams) {
    const scriptName = team.replace('-coordinator', '')
    if (reserved.has(scriptName)) {
      console.warn(
        `  [!]   跳过团队入口 ${scriptName}: 与内置脚本重名，请重命名 ${team}`,
      )
      continue
    }
    if (pkg.scripts[scriptName] !== undefined) continue
    pkg.scripts[scriptName] = `bun run scripts/dev.ts --agent ${team}`
    changed = true
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
    console.log(`  [OK]   package.json 团队脚本已更新`)
  } else {
    console.log('  [skip] package.json 团队脚本无需更新')
  }
}

function baseScriptMap(): Record<string, string> {
  return {
    'init-runtime': 'bun run scripts/init-runtime.ts',
    chat: 'bun run scripts/dev.ts',
    'chat:setup': 'bun run scripts/dev.ts --agent setup-coordinator',
    setup: 'bun run scripts/setup-wizard.ts',
    'setup:ai': 'bun run scripts/setup-wizard.ts --ai',
    'init-state': 'bun run scripts/project-state-init.ts',
    lookup: 'bun run scripts/lookup.ts',
    execute: 'bun run scripts/execute.ts',
    repair: 'bun run scripts/auto-repair.ts',
    loop: 'bun run scripts/repair-loop.ts',
    'summarize-error': 'bun run scripts/error-summary.ts',
    'maintain-knowledge': 'bun run scripts/knowledge-maintenance.ts',
    rcs: 'bun run scripts/rcs.ts',
    'engine:run': 'bun run src-generic/engine/entrypoint.ts',
    'engine:mcp': 'bun run src-generic/engine/mcp-bridge.ts',
  }
}

function createAngshengMd(projectRoot: string) {
  const angPath = resolve(projectRoot, 'ANGSHENG.md')
  if (existsSync(angPath)) return
  writeFileSync(
    angPath,
    `# Generic Agent Project

## Getting Started
1. Run \`bun run chat\` to start interactive mode
2. Run \`bun run setup\` to configure your domain
`,
  )
  console.log('  [OK]   ANGSHENG.md')
}

async function main() {
  const projectRoot = getProjectRoot()
  const hostRoot = findHostCli()

  console.log('')
  console.log('  ============================================================')
  console.log('  |  Generic Agent - 一次性运行时复制                         |')
  console.log(
    '  |  复制完成后可独立运行，不再需要 CLI-self                   |',
  )
  console.log('  ============================================================')
  console.log('')

  if (!hostRoot) {
    console.error('  [X] 找不到 CLI-self，请:')
    console.error('      1. 设置 set OPENCODE_CLI_PATH=F:\\opencode\\CLI-self')
    console.error('      2. 或确保 generic-agent 与 CLI-self 在同一父目录')
    console.error('')
    process.exit(1)
  }

  console.log(`  源目录 (CLI-self):  ${hostRoot}`)
  console.log(`  目标目录:           ${projectRoot}`)
  console.log('')

  // 检查是否已有 src/entrypoints/cli.tsx（已复制过）
  const alreadyInitialized = existsSync(
    resolve(projectRoot, 'src', 'entrypoints', 'cli.tsx'),
  )

  if (alreadyInitialized) {
    console.log('  [!] 运行时已存在。如需重新复制，请先删除 src/ 目录。')
    console.log('')
  }

  console.log('  [1/6] 复制 src/ (CLI 运行时)...')
  copyDir(resolve(hostRoot, 'src'), resolve(projectRoot, 'src'), 'src/')
  console.log('')

  console.log('  [2/6] 复制 packages/ (工作区包，跳过嵌套 node_modules)...')
  copyDir(
    resolve(hostRoot, 'packages'),
    resolve(projectRoot, 'packages'),
    'packages/',
    (path: string) => !path.includes('node_modules'),
  )
  console.log('')

  console.log('  [3/6] 复制构建配置...')
  const configs = ['tsconfig.json', 'tsconfig.base.json']
  for (const f of configs) {
    const src = resolve(hostRoot, f)
    if (existsSync(src)) {
      copyFileSync(src, resolve(projectRoot, f))
    }
  }
  const optionalConfigs = ['vite.config.ts', 'build.ts']
  for (const f of optionalConfigs) {
    const src = resolve(hostRoot, f)
    if (existsSync(src)) {
      copyFileSync(src, resolve(projectRoot, f))
    }
  }
  const runtimeScripts = ['rcs.ts']
  for (const f of runtimeScripts) {
    const src = resolve(hostRoot, 'scripts', f)
    if (existsSync(src)) {
      mkdirSync(resolve(projectRoot, 'scripts'), { recursive: true })
      copyFileSync(src, resolve(projectRoot, 'scripts', f))
    }
  }
  console.log('  [OK]   构建配置已复制')
  console.log('')

  console.log('  [4/6] 合并依赖到 package.json...')
  mergeDeps(projectRoot, hostRoot)
  ensureBaseScripts(projectRoot)
  console.log('')

  console.log('  [5/6] 安装依赖 (bun install)...')
  if (process.env.GENERIC_AGENT_SKIP_INSTALL === '1') {
    console.log('  [skip] GENERIC_AGENT_SKIP_INSTALL=1，跳过依赖安装')
  } else {
    console.log('  注意: 这一步需要几分钟，会从网络下载依赖')
    console.log('')
    const installProc = Bun.spawn(['bun', 'install'], {
      cwd: projectRoot,
      stdio: ['inherit', 'inherit', 'inherit'],
      env: process.env,
    })
    const installCode = await installProc.exited
    if (installCode !== 0) {
      console.error('  [X] bun install 失败')
      console.error('  请检查网络连接，然后手动运行: bun install')
      console.error('  若只需刷新团队入口，可运行:')
      console.error(
        '      GENERIC_AGENT_SKIP_INSTALL=1 bun run scripts/init-runtime.ts',
      )
      process.exit(1)
    }
  }
  console.log('')

  console.log('  [6/6] 同步 Agent 定义 & 项目文件...')
  syncAgents(projectRoot)
  syncGenericDocs(projectRoot, hostRoot)
  mkdirSync(resolve(projectRoot, '.project', 'runs'), { recursive: true })
  createAngshengMd(projectRoot)

  const teams = detectTeamCoordinators(projectRoot)
  generateTeamScripts(projectRoot, teams)
  console.log('')

  console.log('  ============================================================')
  console.log('  |  初始化完成!                                              |')
  console.log(
    '  |  所有文件已复制到本地，不再依赖 CLI-self                   |',
  )
  console.log('  ============================================================')
  console.log('')
  console.log('  使用方法:')
  console.log('')
  console.log('    bun run chat           启动通用对话 (domain-coordinator)')
  console.log('    bun run setup          配置领域')
  console.log('    bun run chat:setup     AI 辅助配置')
  if (teams.length > 0) {
    console.log('')
    console.log('  团队快捷入口:')
    for (const team of teams) {
      const key = team.replace('-coordinator', '')
      console.log(`    bun run ${key.padEnd(16)}启动 ${team} 团队`)
    }
  }
  console.log('')
}

main()
