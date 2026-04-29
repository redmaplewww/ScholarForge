#!/usr/bin/env bun
// @ts-nocheck
import {
  access,
  appendFile,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { resolve } from 'node:path'

type Args = {
  repair?: string
  loop?: string
  workdir?: string
  rollback?: string
  summaryOnly?: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--summary-only') {
      args.summaryOnly = true
      continue
    }
    if (!arg.startsWith('--')) continue
    const value = argv[i + 1]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${arg}`)
    const key = arg.slice(2)
    if (key === 'repair') args.repair = value
    else if (key === 'loop') args.loop = value
    else if (key === 'workdir') args.workdir = value
    else if (key === 'rollback') args.rollback = value
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

async function latestMatching(dir: string, suffix: string) {
  const entries = await readdir(dir)
  const hits = entries
    .filter(name => name.endsWith(suffix))
    .sort()
    .reverse()
  return hits.length > 0 ? resolve(dir, hits[0]) : null
}

async function resolvePackets(args: Args, workdir: string) {
  const runsDir = resolve(workdir, '.project', 'runs')
  const repairPath = args.repair
    ? resolve(workdir, args.repair)
    : await latestMatching(runsDir, '.repair.json')

  const repair =
    repairPath && (await exists(repairPath))
      ? JSON.parse(await readFile(repairPath, 'utf8'))
      : null

  let loopPath = args.loop ? resolve(workdir, args.loop) : null
  if (!loopPath && repair?.run_id) {
    const candidate = resolve(runsDir, `${repair.run_id}.next-step.json`)
    if (await exists(candidate)) loopPath = candidate
  }
  if (!loopPath && !repair) {
    loopPath = await latestMatching(runsDir, '.next-step.json')
  }

  const loop =
    loopPath && (await exists(loopPath))
      ? JSON.parse(await readFile(loopPath, 'utf8'))
      : null
  return { repairPath, loopPath, repair, loop }
}

function inferRollbackTarget(repair: any, loop: any, explicit?: string) {
  if (explicit) return explicit
  const status = String(repair?.status ?? '')
  // DOMAIN: customize rollback targets for your domain's stage names
  if (status === 'missing_artifact' || status === 'input_syntax_failure')
    return 'Stage-03'
  if (status === 'runtime_instability' || status === 'numerical_failure')
    return 'Stage-04->Stage-03/02 pending analyst judgment'
  if (status === 'dry_run_only') return 'execution-setup'
  if (status === 'completed') return 'Stage-04'
  return loop?.next_mode === 'failure-analysis' ? 'Stage-04' : 'unspecified'
}

export async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workdir = args.workdir
    ? resolve(process.cwd(), args.workdir)
    : process.cwd()
  const { repairPath, loopPath, repair, loop } = await resolvePackets(
    args,
    workdir,
  )
  if (!repair && !loop) {
    throw new Error('No repair or loop packet found to summarize.')
  }

  const rollbackTarget = inferRollbackTarget(repair, loop, args.rollback)
  const issues = Array.isArray(repair?.issues) ? repair.issues : []
  const suggestedFixes = Array.isArray(repair?.suggested_fixes)
    ? repair.suggested_fixes
    : []
  const selectedActor =
    loop?.selected_actor ?? repair?.required_next_actor ?? 'domain-coordinator'
  const status = loop?.status ?? repair?.status ?? 'unknown'
  const confidence = repair?.confidence ?? 'medium'

  const summary = {
    status,
    rollback_target: rollbackTarget,
    selected_actor: selectedActor,
    repair_packet: repairPath,
    loop_packet: loopPath,
    issues,
    suggested_fixes: suggestedFixes,
    confidence,
  }

  const stageSummaryPath = resolve(workdir, '.project', 'stage-summary.md')
  const openIssuesPath = resolve(workdir, '.project', 'open-issues.md')

  const block =
    [
      '',
      `## Error Summary (${new Date().toISOString()})`,
      `- status: ${status}`,
      `- rollback_target: ${rollbackTarget}`,
      `- selected_actor: ${selectedActor}`,
      `- confidence: ${confidence}`,
      `- repair_packet: ${repairPath ?? ''}`,
      `- loop_packet: ${loopPath ?? ''}`,
      ...issues.map((item: string) => `- issue: ${item}`),
      ...suggestedFixes.map((item: string) => `- suggested_fix: ${item}`),
    ].join('\n') + '\n'

  if (await exists(stageSummaryPath)) {
    await appendFile(stageSummaryPath, block, 'utf8')
  }
  if (!args.summaryOnly && (await exists(openIssuesPath))) {
    const issueBlock =
      [
        '',
        `- issue: ${issues[0] ?? status}`,
        `  - severity: ${status === 'dry_run_only' ? 'medium' : 'high'}`,
        `  - owner: ${selectedActor}`,
        `  - next_action: ${suggestedFixes[0] ?? 'review rollback target and revise stage packet'}`,
      ].join('\n') + '\n'
    await appendFile(openIssuesPath, issueBlock, 'utf8')
  }

  const outPath = resolve(workdir, '.project', 'error-summary.json')
  await writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

if (import.meta.main) {
  await main()
}
