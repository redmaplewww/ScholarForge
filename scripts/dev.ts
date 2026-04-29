#!/usr/bin/env bun
// @ts-nocheck
// dev.ts - 启动 CLI 对话界面
// 复用宿主 CLI 的 cli.tsx 入口，但以 generic-agent 为工作目录
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from './defines.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

// 使用 src/ (符号链接到 CLI-self/src)
const cliPath = join(projectRoot, 'src', 'entrypoints', 'cli.tsx')

if (!existsSync(cliPath)) {
  console.error('')
  console.error('  [X] 运行时未初始化')
  console.error('  请先运行: bun run scripts/init-runtime.ts')
  console.error('')
  process.exit(1)
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

const bunExecutable = process.execPath || 'bun'

const child = Bun.spawn(
  [
    bunExecutable,
    ...inspectArgs,
    'run',
    ...defineArgs,
    ...featureArgs,
    cliPath,
    ...process.argv.slice(2),
  ],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: projectRoot,
    env: process.env,
  },
)

const exitCode = await child.exited
process.exit(exitCode ?? 0)
