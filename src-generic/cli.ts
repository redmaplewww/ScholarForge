#!/usr/bin/env bun
// @ts-nocheck
/**
 * cli.ts - 通用 Agent CLI 入口（非运行时使用）
 *
 * 运行时通过 bun run chat 启动，使用 CLI-self 的 cli.tsx。
 * 此文件仅作为独立模式的参考入口。
 */

const args = process.argv.slice(2)
const command = args[0]

async function main() {
  switch (command) {
    case 'setup':
    case 'init':
      await import('../scripts/setup-wizard.ts')
      break
    case 'execute':
      await import('../scripts/execute.ts')
      break
    case 'repair':
      await import('../scripts/auto-repair.ts')
      break
    case 'lookup':
      await import('../scripts/lookup.ts')
      break
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break
    default:
      console.log('请先运行: bun run init-runtime')
      console.log('初始化后使用: bun run chat')
      printHelp()
  }
}

function printHelp() {
  console.log(`
通用 Agent 框架 CLI

命令:
  setup     配置领域（交互式向导）
  execute   执行工作流
  repair    自动修复
  lookup    知识检索
  help      显示帮助

快速开始:
  1. bun run init-runtime    初始化运行时
  2. bun run setup           配置领域
  3. bun run chat            启动对话
`)
}

main()
