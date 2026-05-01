#!/usr/bin/env bun
// @ts-nocheck
// dev.ts - 启动 CLI 对话界面
// 复用宿主 CLI 的 cli.tsx 入口，但以 generic-agent 为工作目录
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from './defines.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

const cliPath = join(projectRoot, 'src', 'entrypoints', 'cli.tsx')

if (!existsSync(cliPath)) {
  console.error('')
  console.error('  [X] 运行时未初始化')
  console.error('  请先运行: bun run scripts/init-runtime.ts')
  console.error('')
  process.exit(1)
}

function resolveAgentName(args: string[]): string {
  // 如果手动传了 --agent，优先使用
  const agentIdx = args.indexOf('--agent')
  if (agentIdx !== -1 && args[agentIdx + 1]) {
    return args[agentIdx + 1]
  }
  // 默认始终启动 domain-coordinator
  return 'domain-coordinator'
}

const defines = getMacroDefines()
const defineArgs = Object.entries(defines).flatMap(([k, v]) => [
  '-d',
  `${k}:${v}`,
])

const envFeatures = Object.entries(process.env)
  .filter(([k]) => k.startsWith('FEATURE_'))
  .map(([k]) => k.replace('FEATURE_', ''))

const allFeatures = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]
const featureArgs = allFeatures.flatMap(name => ['--feature', name])

const inspectArgs = process.env.BUN_INSPECT
  ? ['--inspect-wait=' + process.env.BUN_INSPECT]
  : []

const rawArgs = process.argv.slice(2)
const agentName = resolveAgentName(rawArgs)
const cleanArgs = rawArgs.filter((a, i) => {
  if (a === '--agent') return false
  if (i > 0 && rawArgs[i - 1] === '--agent') return false
  return true
})

const bunExecutable = process.execPath || 'bun'

const child = Bun.spawn(
  [
    bunExecutable,
    ...inspectArgs,
    'run',
    ...defineArgs,
    ...featureArgs,
    cliPath,
    '--agent',
    agentName,
    ...cleanArgs,
  ],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: projectRoot,
    env: process.env,
  },
)

const exitCode = await child.exited
process.exit(exitCode ?? 0)
