#!/usr/bin/env bun
// @ts-nocheck
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path'

type Args = {
  input?: string
  workdir?: string
  mode?: 'local' | 'hpc'
  log?: string
  command?: string
  dryRun?: boolean
}

type ExecutionConfig = {
  default_mode?: 'local' | 'hpc'
  local?: { command?: string[]; log_flag?: string }
  linux?: { command?: string[]; log_flag?: string }
  windows?: { command?: string[]; log_flag?: string }
  hpc?: { launcher?: string[]; domain_command?: string[]; log_flag?: string }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (!arg.startsWith('--')) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`)
    }
    const key = arg.slice(2)
    if (key === 'input') args.input = value
    else if (key === 'workdir') args.workdir = value
    else if (key === 'mode') args.mode = value as 'local' | 'hpc'
    else if (key === 'log') args.log = value
    else if (key === 'command') args.command = value
    i += 1
  }
  return args
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readExecutionConfig(workdir: string): Promise<ExecutionConfig> {
  const projectConfig = resolve(workdir, '.project', 'execution.json')
  if (await exists(projectConfig)) {
    return JSON.parse(await readFile(projectConfig, 'utf8'))
  }
  return {}
}

function platformKey() {
  return process.platform === 'win32' ? 'windows' : 'linux'
}

async function resolveCommand(
  args: Args,
  workdir: string,
  config: ExecutionConfig,
) {
  const mode = args.mode ?? config.default_mode ?? 'local'
  const envCommand = process.env.DOMAIN_COMMAND?.trim()
  const direct = args.command?.trim() || envCommand
  const platform = platformKey()

  if (direct) {
    return {
      mode,
      argv: splitCommand(direct),
      logFlag: config[platform]?.log_flag ?? config.local?.log_flag ?? '--log',
      source: args.command ? 'cli' : 'env',
    }
  }

  if (mode === 'hpc') {
    const launcher = config.hpc?.launcher ?? ['mpirun', '-np', '4']
    const domainCmd =
      config.hpc?.domain_command ?? config[platform]?.command ?? []
    return {
      mode,
      argv: [...launcher, ...domainCmd],
      logFlag: config.hpc?.log_flag ?? '--log',
      source: '.project/execution.json',
    }
  }

  const configuredLocal =
    config[platform]?.command ?? config.local?.command ?? []
  if (configuredLocal.length > 0) {
    return {
      mode,
      argv: configuredLocal,
      logFlag: config[platform]?.log_flag ?? config.local?.log_flag ?? '--log',
      source: '.project/execution.json',
    }
  }

  const pathFallback = await resolvePathFallbackCommand(workdir)
  if (pathFallback.length > 0) {
    return {
      mode,
      argv: pathFallback,
      logFlag: config[platform]?.log_flag ?? config.local?.log_flag ?? '--log',
      source: 'PATH fallback',
    }
  }

  return {
    mode,
    argv: [],
    logFlag: config[platform]?.log_flag ?? config.local?.log_flag ?? '--log',
    source: '.project/execution.json',
  }
}

async function resolvePathFallbackCommand(cwd: string): Promise<string[]> {
  // DOMAIN: customize candidate binary names for your domain
  const envExecutable = process.env.DOMAIN_EXECUTABLE?.trim()
  const candidates = envExecutable
    ? [envExecutable]
    : process.platform === 'win32'
      ? ['domain-app.exe', 'domain-app']
      : ['domain-app']

  for (const candidate of candidates) {
    if (await canExecute(candidate, cwd)) {
      return [candidate]
    }
  }

  return []
}

function splitCommand(command: string): string[] {
  return (
    command
      .match(/(?:[^"]\S*|".+?")+/g)
      ?.map(token => token.replace(/^"|"$/g, '')) ?? []
  )
}

async function canExecute(command: string, cwd: string) {
  if (!command) return false
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    try {
      await access(resolve(cwd, command), constants.X_OK)
      return true
    } catch {
      try {
        await access(command, constants.X_OK)
        return true
      } catch {
        return false
      }
    }
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidates =
      process.platform === 'win32'
        ? [
            join(dir, `${command}.exe`),
            join(dir, `${command}.bat`),
            join(dir, command),
          ]
        : [join(dir, command)]
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK)
        return true
      } catch {}
    }
  }
  return false
}

function usage() {
  return `Usage: bun run scripts/execute.ts --input <input-file> [--workdir <dir>] [--mode local|hpc] [--log <logfile>] [--command "domain-app"] [--dry-run]`
}

export async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.input) throw new Error(usage())

  const workdir = args.workdir
    ? resolve(process.cwd(), args.workdir)
    : process.cwd()
  const inputPath = resolve(workdir, args.input)
  if (!(await exists(inputPath))) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  const config = await readExecutionConfig(workdir)
  const resolved = await resolveCommand(args, workdir, config)
  const runAt = new Date()
  const runId = runAt
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const runsDir = resolve(workdir, '.project', 'runs')
  await mkdir(runsDir, { recursive: true })

  const logName =
    args.log || `log.${basename(args.input).replace(/\.[^.]+$/, '')}.${runId}`
  const logPath = resolve(workdir, logName)
  const stdoutPath = resolve(runsDir, `${runId}.stdout.txt`)
  const stderrPath = resolve(runsDir, `${runId}.stderr.txt`)
  const metadataPath = resolve(runsDir, `${runId}.json`)

  const executable = resolved.argv[0] ?? ''
  const executableAvailable = await canExecute(executable, workdir)
  const effectiveDryRun =
    args.dryRun === true || !executableAvailable || resolved.argv.length === 0
  // DOMAIN: customize the input flag (e.g. '-in' for LAMMPS, '-i' for other tools)
  const commandArgs = effectiveDryRun
    ? []
    : [...resolved.argv.slice(1), '-in', inputPath, resolved.logFlag, logPath]

  const metadata: Record<string, unknown> = {
    run_id: runId,
    launched_at: runAt.toISOString(),
    workdir,
    input: inputPath,
    mode: resolved.mode,
    command_source: resolved.source,
    command: resolved.argv,
    command_args: commandArgs,
    log_path: logPath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    dry_run: effectiveDryRun,
    executable_available: executableAvailable,
    platform: process.platform,
    notes: effectiveDryRun
      ? 'No runnable executable detected in current environment; interface validated in dry-run mode.'
      : 'Execution launched.',
  }

  if (effectiveDryRun) {
    await writeFile(stdoutPath, '', 'utf8')
    await writeFile(stderrPath, '', 'utf8')
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
    return
  }

  const child = spawn(executable, commandArgs, { cwd: workdir })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    const text = String(chunk)
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.on('data', chunk => {
    const text = String(chunk)
    stderr += text
    process.stderr.write(text)
  })

  const exitCode: number = await new Promise((resolveExit, reject) => {
    child.on('error', reject)
    child.on('close', code => resolveExit(code ?? 1))
  })

  await writeFile(stdoutPath, stdout, 'utf8')
  await writeFile(stderrPath, stderr, 'utf8')
  metadata.exit_code = exitCode
  metadata.completed_at = new Date().toISOString()
  metadata.status = exitCode === 0 ? 'completed' : 'failed'
  if (await exists(logPath)) {
    metadata.log_exists = true
  }
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
  process.exit(exitCode)
}

if (import.meta.main) {
  await main()
}
