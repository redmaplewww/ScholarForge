#!/usr/bin/env bun
// @ts-nocheck
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { main as buildRepairPacket } from './auto-repair.ts'

type Args = {
  repair?: string
  workdir?: string
  output?: string
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
    if (key === 'repair') args.repair = value
    else if (key === 'workdir') args.workdir = value
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

async function resolveRepairPacket(args: Args, workdir: string) {
  if (args.repair) {
    const repairPath = resolve(workdir, args.repair)
    return {
      repairPath,
      packet: JSON.parse(await readFile(repairPath, 'utf8')) as Record<
        string,
        unknown
      >,
    }
  }

  const runsDir = resolve(workdir, '.project', 'runs')
  const entries = await readdir(runsDir)
  const repairs = entries
    .filter(name => name.endsWith('.repair.json'))
    .sort()
    .reverse()
  if (repairs.length > 0) {
    const repairPath = resolve(runsDir, repairs[0])
    return {
      repairPath,
      packet: JSON.parse(await readFile(repairPath, 'utf8')) as Record<
        string,
        unknown
      >,
    }
  }

  const originalArgv = process.argv.slice()
  let output = ''
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.argv = [originalArgv[0], originalArgv[1], '--workdir', workdir]
  process.stdout.write = ((chunk: any) => {
    output += String(chunk)
    return true
  }) as any
  try {
    await buildRepairPacket()
  } finally {
    process.argv = originalArgv
    process.stdout.write = originalWrite as any
  }
  const packet = JSON.parse(output) as Record<string, unknown>
  return {
    repairPath: String(
      packet.repair_path ?? resolve(workdir, '.project', 'runs'),
    ),
    packet,
  }
}

function buildLoopPlan(packet: Record<string, unknown>) {
  const status = String(packet.run_status ?? packet.status ?? 'unknown')
  const actor = String(
    packet.suggested_actor ??
      packet.required_next_actor ??
      'domain-coordinator',
  )
  const input = String(packet.input ?? '')
  const metadataPath = String(packet.metadata_path ?? '')
  const logPath = String(packet.log_path ?? '')
  const issues = Array.isArray(packet.issues) ? packet.issues : []
  const suggestedFixes = Array.isArray(packet.suggested_fixes)
    ? packet.suggested_fixes
    : []

  let nextMode = 'manual-review'
  let taskPrompt = ''
  let autoAdvance = false
  let rollbackTarget: string | null = null

  if (status === 'completed') {
    nextMode = 'post-run-analysis'
    // DOMAIN: customize the post-run analysis prompt for your domain
    taskPrompt = [
      'Analyze the successful run using the latest run packet.',
      `Input: ${input}`,
      `Run metadata: ${metadataPath}`,
      `Log: ${logPath}`,
      'Perform validation against project acceptance criteria.',
      'Compare key metrics against reference values when available.',
      'Summarize key metrics, warnings, and next validation steps.',
    ].join('\n')
  } else if (status === 'dry_run_only') {
    nextMode = 'execution-setup'
    taskPrompt = [
      'The run could not start because no executable is configured.',
      `Input: ${input}`,
      'Prepare the smallest next-step execution setup guidance using `.project/execution.json` or `DOMAIN_COMMAND`.',
      ...suggestedFixes.map(item => `- ${item}`),
    ].join('\n')
  } else if (
    status === 'missing_artifact' ||
    status === 'input_syntax_failure'
  ) {
    nextMode = 'bounded-auto-fix'
    autoAdvance = true
    // DOMAIN: customize the bounded fix prompt for your domain's input format
    taskPrompt = [
      'Revise the input with the smallest bounded fix set.',
      `Input: ${input}`,
      `Run metadata: ${metadataPath}`,
      `Log: ${logPath}`,
      'Issues:',
      ...issues.map(item => `- ${item}`),
      'Required fixes:',
      ...suggestedFixes.map(item => `- ${item}`),
      'Do not redesign the workflow. Apply only the minimum edits needed for the next review/execution attempt.',
    ].join('\n')
    rollbackTarget = 'Stage-03'
  } else {
    nextMode = 'failure-analysis'
    // DOMAIN: customize the failure analysis prompt for your domain
    taskPrompt = [
      'Analyze the failed run before any further edits.',
      `Input: ${input}`,
      `Run metadata: ${metadataPath}`,
      `Log: ${logPath}`,
      'Observed issues:',
      ...issues.map(item => `- ${item}`),
      'Suggested starting points:',
      ...suggestedFixes.map(item => `- ${item}`),
      'Assess whether the failure indicates a potential design-level issue.',
    ].join('\n')

    // DOMAIN: customize rollback targets for your domain's stage names
    rollbackTarget = 'Stage-02'
  }

  return {
    status,
    selected_actor: actor,
    next_mode: nextMode,
    auto_advance: autoAdvance,
    bounded_task_prompt: taskPrompt,
    issues,
    suggested_fixes: suggestedFixes,
    rollback_target: rollbackTarget,
  }
}

export async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workdir = args.workdir
    ? resolve(process.cwd(), args.workdir)
    : process.cwd()
  const { repairPath, packet } = await resolveRepairPacket(args, workdir)
  const plan = buildLoopPlan(packet)

  const outputPath = args.output
    ? resolve(workdir, args.output)
    : resolve(
        workdir,
        '.project',
        'runs',
        `${String(packet.run_id ?? 'latest')}.next-step.json`,
      )

  const result: Record<string, unknown> = {
    run_id: packet.run_id ?? null,
    repair_packet: repairPath,
    run_result_path: packet.metadata_path ?? null,
    generated_at: new Date().toISOString(),
    ...plan,
  }

  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.main) {
  await main()
}
