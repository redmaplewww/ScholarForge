#!/usr/bin/env bun
// @ts-nocheck
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Args = {
  run?: string
  workdir?: string
  input?: string
  output?: string
}

type RunMetadata = {
  run_id: string
  launched_at?: string
  completed_at?: string
  workdir: string
  input: string
  mode: string
  command_source?: string
  command?: string[]
  command_args?: string[]
  log_path?: string
  stdout_path?: string
  stderr_path?: string
  dry_run?: boolean
  executable_available?: boolean
  status?: string
  exit_code?: number
  notes?: string
  platform?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`)
    }
    const key = arg.slice(2)
    if (key === 'run') args.run = value
    else if (key === 'workdir') args.workdir = value
    else if (key === 'input') args.input = value
    else if (key === 'output') args.output = value
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

async function resolveRunMetadata(
  args: Args,
  workdir: string,
): Promise<{ path: string; data: RunMetadata }> {
  if (args.run) {
    const path = resolve(workdir, args.run)
    return {
      path,
      data: JSON.parse(await readFile(path, 'utf8')) as RunMetadata,
    }
  }

  const runsDir = resolve(workdir, '.project', 'runs')
  const entries = await readdir(runsDir)
  const jsons = entries
    .filter(
      name =>
        name.endsWith('.json') &&
        !name.endsWith('.repair.json') &&
        !name.endsWith('.next-step.json') &&
        !name.endsWith('analysis-report.json'),
    )
    .sort()
    .reverse()
  if (jsons.length === 0) {
    throw new Error(`No run metadata found in ${runsDir}`)
  }
  const path = resolve(runsDir, jsons[0])
  return { path, data: JSON.parse(await readFile(path, 'utf8')) as RunMetadata }
}

async function readOptional(path?: string) {
  if (!path) return ''
  if (!(await exists(path))) return ''
  return readFile(path, 'utf8')
}

// DOMAIN: customize suggested actor names for your domain's agent roles
type SuggestedActor =
  | 'domain-specialist-a'
  | 'domain-specialist-b'
  | 'domain-reviewer'
  | 'domain-analyst'
  | 'domain-coordinator'

function classify(
  metadata: RunMetadata,
  stdout: string,
  stderr: string,
  log: string,
) {
  const combined = `${stderr}\n${stdout}\n${log}`.toLowerCase()
  const issues: string[] = []
  const suggestedFixes: string[] = []
  let run_status = 'unknown'
  let suggested_actor: SuggestedActor = 'domain-coordinator'
  let autoRepairEligible = false
  let confidence: 'high' | 'medium' | 'low' = 'medium'

  if (metadata.dry_run) {
    run_status = 'dry_run_only'
    issues.push(
      'No runnable executable is available in the current environment.',
    )
    suggestedFixes.push(
      'Configure `.project/execution.json` or `DOMAIN_COMMAND` with a valid executable before rerunning.',
    )
    suggested_actor = 'domain-coordinator'
    confidence = 'high'
  } else if (metadata.exit_code === 0) {
    run_status = 'completed'
    suggested_actor = 'domain-analyst'
    confidence = 'high'
  } else if (!metadata.log_path || !metadata.log_path.trim()) {
    run_status = 'launch_failed'
    issues.push('Run failed before a log path was established.')
    suggestedFixes.push('Check the resolved command and working directory.')
    suggested_actor = 'domain-coordinator'
    confidence = 'high'
  } else if (
    combined.includes('cannot open') ||
    combined.includes('no such file or directory')
  ) {
    run_status = 'missing_artifact'
    issues.push('The run could not open a referenced file.')
    // DOMAIN: customize fix suggestion for your domain's input format
    suggestedFixes.push(
      'Verify input file paths, referenced resources, and included scripts exist relative to the working directory.',
    )
    suggested_actor = 'domain-specialist-a'
    autoRepairEligible = true
    confidence = 'high'
  } else if (
    combined.includes('unknown command') ||
    combined.includes('illegal') ||
    combined.includes('syntax error')
  ) {
    run_status = 'input_syntax_failure'
    // DOMAIN: customize fix suggestion for your domain's syntax errors
    issues.push('The domain tool reported an unknown or illegal command.')
    suggestedFixes.push(
      'Review command spelling, syntax, and ordering against the domain documentation.',
    )
    suggested_actor = 'domain-reviewer'
    autoRepairEligible = true
    confidence = 'high'
  } else {
    // DOMAIN: add domain-specific error patterns here
    // Example patterns:
    // else if (combined.includes('domain-specific-error-keyword')) { ... }
    run_status = metadata.status === 'failed' ? 'runtime_failed' : 'unknown'
    issues.push('Run failed but no high-confidence signature was detected.')
    suggestedFixes.push(
      'Inspect stderr and log output with domain-analyst before editing the input.',
    )
    suggested_actor = 'domain-analyst'
    confidence = 'medium'
  }

  const logSignals = collectSignals(log)
  if (logSignals.length > 0 && run_status === 'completed') {
    suggestedFixes.push(
      'Even though the run completed, review warnings before trusting the result.',
    )
    confidence = 'medium'
  }

  return {
    run_status,
    suggested_actor,
    auto_repair_eligible: autoRepairEligible,
    confidence,
    issues,
    suggested_fixes: [...new Set(suggestedFixes)],
    log_signals: logSignals,
  }
}

function collectSignals(log: string) {
  const signals: string[] = []
  const lower = log.toLowerCase()
  if (lower.includes('warning')) signals.push('warnings-present')
  if (lower.includes('error')) signals.push('errors-present')
  // DOMAIN: add domain-specific log signal patterns here
  return signals
}

export async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workdir = args.workdir
    ? resolve(process.cwd(), args.workdir)
    : process.cwd()
  const { path: metadataPath, data: metadata } = await resolveRunMetadata(
    args,
    workdir,
  )
  const stdout = await readOptional(metadata.stdout_path)
  const stderr = await readOptional(metadata.stderr_path)
  const log = await readOptional(metadata.log_path)

  const outputPath = args.output
    ? resolve(workdir, args.output)
    : resolve(workdir, '.project', 'runs', `${metadata.run_id}.repair.json`)

  const report = {
    run_id: metadata.run_id,
    input: metadata.input,
    mode: metadata.mode,
    metadata_path: metadataPath,
    repair_path: outputPath,
    log_path: metadata.log_path ?? null,
    stdout_path: metadata.stdout_path ?? null,
    stderr_path: metadata.stderr_path ?? null,
    launch_status:
      metadata.status ?? (metadata.dry_run ? 'dry_run' : 'unknown'),
    ...classify(metadata, stdout, stderr, log),
  }
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (import.meta.main) {
  await main()
}
