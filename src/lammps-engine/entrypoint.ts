import { existsSync } from 'fs'
import { startEngine, setConfig, getConfig } from './engine-server.js'

interface CliConfig {
  port?: number
  host?: string
  apiKey?: string
  workspace?: string
  config?: string
}

function parseArgs(): CliConfig {
  const config: CliConfig = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--port' || arg === '-p') {
      config.port = parseInt(argv[++i])
    } else if (arg === '--host') {
      config.host = argv[++i]
    } else if (arg === '--api-key' || arg === '-k') {
      config.apiKey = argv[++i]
    } else if (arg === '--workspace' || arg === '-w') {
      config.workspace = argv[++i]
    } else if (arg === '--config' || arg === '-c') {
      config.config = argv[++i]
    }
  }
  return config
}

function loadConfigFile(filePath: string): Partial<CliConfig> {
  try {
    const content = require('fs').readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  } catch {
    console.error(`Failed to load config from ${filePath}`)
    return {}
  }
}

function printHelp() {
  console.log(`
LAMMPS AI Engine Server
=======================

Usage: lammps-engine [options]

Options:
  --port <n>         Port to listen on (default: 3847)
  --host <addr>      Host to bind to (default: 127.0.0.1)
  --api-key <key>    API key for authentication
  --workspace <dir>  Workspace root directory (default: current directory)
  --config <file>    Load config from JSON file
  --help             Show this help message

Environment variables:
  ENGINE_PORT, ENGINE_HOST, ENGINE_API_KEY, ENGINE_WORKSPACE
`)
}

async function main() {
  const args = parseArgs()

  let fileConfig: Partial<CliConfig> = {}
  if (args.config) {
    fileConfig = loadConfigFile(args.config)
  }

  const config: Partial<CliConfig> = {
    port: parseInt(process.env.ENGINE_PORT || '') || undefined,
    host: process.env.ENGINE_HOST || undefined,
    apiKey: process.env.ENGINE_API_KEY || undefined,
    workspace: process.env.ENGINE_WORKSPACE || undefined,
    ...fileConfig,
    ...(args.port ? { port: args.port } : {}),
    ...(args.host ? { host: args.host } : {}),
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
    ...(args.workspace ? { workspace: args.workspace } : {}),
  }

  if (config.workspace) {
    if (!existsSync(config.workspace)) {
      console.error(`Workspace directory does not exist: ${config.workspace}`)
      process.exit(1)
    }
  }

  setConfig({
    port: config.port || 3847,
    host: config.host || '127.0.0.1',
    engineApiKey: config.apiKey || '',
    workspaceRoot: config.workspace || process.cwd(),
    logLevel: 'info',
    corsOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
  })

  const cfg = getConfig()
  console.log(`LAMMPS AI Engine v1.0.0`)
  console.log(`  Server:  http://${cfg.host}:${cfg.port}`)
  console.log(`  Workspace: ${cfg.workspaceRoot}`)
  console.log(
    `  Auth:    ${cfg.engineApiKey ? 'enabled (API key required)' : 'disabled'}`,
  )
  console.log()

  try {
    await startEngine()
  } catch (e: any) {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `Port ${cfg.port} is already in use. Try --port to use a different port.`,
      )
    } else {
      console.error('Failed to start engine:', e.message)
    }
    process.exit(1)
  }
}

main()
