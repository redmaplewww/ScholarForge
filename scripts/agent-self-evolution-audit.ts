#!/usr/bin/env bun
// @ts-nocheck
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

type RiskLevel = 'low' | 'medium' | 'high'

type Proposal = {
  id: string
  target_agent: string | null
  target_area: 'agent' | 'workflow' | 'evidence' | 'knowledge' | 'state'
  proposal_type:
    | 'context-optimization'
    | 'evidence-routing'
    | 'handoff-schema'
    | 'kb-bootstrap'
    | 'sandbox-test'
    | 'review-check'
  risk_level: RiskLevel
  observed_problem: string
  evidence_paths: string[]
  failure_cases: string[]
  proposed_change: string
  predicted_impact: string
  validation_plan: string[]
  metrics: string[]
  human_review_required: true
  auto_apply_allowed: false
  sandbox_status: 'not_requested' | 'approved' | 'complete' | 'failed'
  apply_allowed: false
  candidate_copy_path?: string
}

type Signal = {
  kind: string
  target: string | null
  count: number
  evidence: string[]
  excerpts: string[]
}

const ROOT = process.cwd()
const args = new Set(process.argv.slice(2))
const materializeCopies = args.has('--materialize-copies')
const approveSandbox = args.has('--approve-sandbox')

function runId() {
  return new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z')
}

function rel(path: string) {
  return relative(ROOT, path).replaceAll('\\', '/')
}

async function readIfExists(path: string): Promise<string> {
  if (!existsSync(path)) return ''
  return await readFile(path, 'utf8')
}

async function listFiles(
  dir: string,
  predicate = (_: string) => true,
): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) out.push(...(await listFiles(p, predicate)))
    else if (predicate(p)) out.push(p)
  }
  return out
}

function countMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length || 0
}

function extractExcerpts(
  content: string,
  pattern: RegExp,
  limit = 5,
): string[] {
  const lines = content.split(/\r?\n/)
  const excerpts: string[] = []
  for (let i = 0; i < lines.length && excerpts.length < limit; i++) {
    if (pattern.test(lines[i]))
      excerpts.push(`${i + 1}: ${lines[i].slice(0, 220)}`)
    pattern.lastIndex = 0
  }
  return excerpts
}

function inferTargetAgent(text: string): string | null {
  const match = text.match(
    /([a-z0-9][a-z0-9-]+(?:coordinator|reviewer|specialist|agent|writer|analyst|researcher|librarian))/i,
  )
  return match ? match[1].toLowerCase() : null
}

async function collectSignals(): Promise<Signal[]> {
  const sources = [
    '.project/review-log.md',
    '.project/open-issues.md',
    '.project/state.json',
    '.project/workflow-state.json',
    '.project/evidence.json',
    'knowledge/memory/confirmed-lessons.md',
    'knowledge/memory/pending-lessons.md',
    'knowledge/memory/session-lessons.md',
  ]
    .map(p => resolve(ROOT, p))
    .filter(existsSync)

  const runFiles = await listFiles(resolve(ROOT, '.project', 'runs'), p =>
    /\.(json|md|log|txt)$/i.test(p),
  )
  const reportFiles = await listFiles(
    resolve(ROOT, 'knowledge', 'reports'),
    p => /\.(md|json|log|txt)$/i.test(p),
  )
  sources.push(...runFiles, ...reportFiles)

  const signals: Signal[] = []

  for (const path of sources) {
    const content = await readIfExists(path)
    if (!content) continue
    const source = rel(path)
    const checks = [
      { kind: 'revise-loop', pattern: /\bREVISE\b|返工|修订|revision/i },
      {
        kind: 'blocked-work',
        pattern: /\bBLOCKED\b|blocked|阻塞|缺少|等待用户/i,
      },
      { kind: 'failed-run', pattern: /\bFAILED\b|error|exception|失败|报错/i },
      {
        kind: 'missing-evidence',
        pattern: /missing evidence|no evidence|缺少证据|未引用|uncited/i,
      },
      {
        kind: 'handoff-gap',
        pattern: /handoff|交接|next_actor|next action|rollback/i,
      },
    ]

    for (const check of checks) {
      const count = countMatches(content, check.pattern)
      if (count === 0) continue
      signals.push({
        kind: check.kind,
        target: inferTargetAgent(content),
        count,
        evidence: [source],
        excerpts: extractExcerpts(content, check.pattern),
      })
    }
  }

  return mergeSignals(signals)
}

function mergeSignals(signals: Signal[]): Signal[] {
  const byKey = new Map<string, Signal>()
  for (const s of signals) {
    const key = `${s.kind}:${s.target || 'unknown'}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...s })
      continue
    }
    existing.count += s.count
    existing.evidence = [...new Set([...existing.evidence, ...s.evidence])]
    existing.excerpts = [...existing.excerpts, ...s.excerpts].slice(0, 8)
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count)
}

function proposalFromSignal(signal: Signal, index: number): Proposal {
  const id = `SE-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(index + 1).padStart(3, '0')}`
  const targetArea =
    signal.kind === 'missing-evidence'
      ? 'evidence'
      : signal.kind === 'handoff-gap'
        ? 'workflow'
        : 'agent'
  const proposalType =
    signal.kind === 'missing-evidence'
      ? 'evidence-routing'
      : signal.kind === 'handoff-gap'
        ? 'handoff-schema'
        : signal.kind === 'failed-run'
          ? 'sandbox-test'
          : 'context-optimization'
  return {
    id,
    target_agent: signal.target,
    target_area: targetArea,
    proposal_type: proposalType,
    risk_level:
      signal.count >= 5 ? 'high' : signal.count >= 2 ? 'medium' : 'low',
    observed_problem: `${signal.kind} observed ${signal.count} time(s)${signal.target ? ` around ${signal.target}` : ''}.`,
    evidence_paths: signal.evidence,
    failure_cases: signal.evidence.filter(
      p => p.includes('.project/runs') || /review|issue|lesson|report/i.test(p),
    ),
    proposed_change:
      proposalType === 'evidence-routing'
        ? 'Add a narrow evidence lookup/context-pack requirement before the affected review or production stage.'
        : proposalType === 'handoff-schema'
          ? 'Tighten the handoff packet for the affected stage with required next actor, rollback target, evidence IDs, and artifact paths.'
          : proposalType === 'sandbox-test'
            ? 'Create sandbox replay cases from the failure evidence and compare current vs candidate behavior before any production change.'
            : 'Reduce broad prompt/context loading and replace it with task-scoped evidence cards or context packs.',
    predicted_impact:
      'Lower revise/failure rate, shorter review loops, and more complete evidence without weakening gates.',
    validation_plan: [
      'Ask user approval before sandbox testing.',
      'Create candidate copies under this proposal directory only.',
      'Replay the failure cases listed in this proposal.',
      'Compare before/after metrics: review rounds, failure count, blocked count, evidence completeness.',
      'Recommend apply only if candidate clearly improves at least one metric with no regression.',
    ],
    metrics: [
      'review_rounds',
      'failure_count',
      'blocked_count',
      'evidence_completeness',
    ],
    human_review_required: true,
    auto_apply_allowed: false,
    sandbox_status: approveSandbox ? 'approved' : 'not_requested',
    apply_allowed: false,
  }
}

async function materializeCandidateCopies(
  runDir: string,
  proposals: Proposal[],
) {
  if (!materializeCopies) return
  const agentDir = resolve(ROOT, 'agents')
  for (const p of proposals) {
    if (!p.target_agent) continue
    const source = resolve(agentDir, `${p.target_agent}.md`)
    if (!existsSync(source)) continue
    const dst = resolve(runDir, 'candidate-agents', `${p.target_agent}.md`)
    await mkdir(dirname(dst), { recursive: true })
    await copyFile(source, dst)
    const content = await readFile(dst, 'utf8')
    await writeFile(
      dst,
      `${content}\n\n<!-- SELF-EVOLUTION CANDIDATE ${p.id}\n${p.proposed_change}\nDo not copy to production without sandbox report and explicit user approval.\n-->\n`,
      'utf8',
    )
    p.candidate_copy_path = rel(dst)
  }
}

async function writeSandboxManifest(runDir: string, proposals: Proposal[]) {
  if (!approveSandbox) return
  const manifest = {
    approved_by_user: true,
    created_at: new Date().toISOString(),
    proposals: proposals.map(p => ({
      id: p.id,
      target_agent: p.target_agent,
      failure_cases: p.failure_cases,
      metrics: p.metrics,
      candidate_copy_path: p.candidate_copy_path || null,
    })),
    acceptance_gate:
      'Apply is allowed only after sandbox-report.md shows clear metric improvement and no mandatory-check regression.',
  }
  await writeFile(
    resolve(runDir, 'sandbox-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )
  await writeFile(
    resolve(runDir, 'sandbox-report.md'),
    '# Sandbox Report\n\nStatus: pending\n\nFill this after replaying failure cases. Do not apply proposals until this report shows clear improvement.\n',
    'utf8',
  )
}

function renderReport(runId: string, signals: Signal[], proposals: Proposal[]) {
  return `# Agent Self-Evolution Audit\n\nRun: ${runId}\nMode: advisory; no production files modified.\n\n## Signals\n\n${signals.map(s => `- ${s.kind}: count=${s.count}, target=${s.target || 'unknown'}, evidence=${s.evidence.join(', ')}`).join('\n') || '- No strong signals found.'}\n\n## Proposals\n\n${proposals.map(p => `### ${p.id}\n\n- target: ${p.target_agent || p.target_area}\n- type: ${p.proposal_type}\n- risk: ${p.risk_level}\n- auto_apply_allowed: ${p.auto_apply_allowed}\n- apply_allowed: ${p.apply_allowed}\n- problem: ${p.observed_problem}\n- evidence: ${p.evidence_paths.join(', ')}\n- proposed change: ${p.proposed_change}\n- validation: ${p.validation_plan.join(' ')}\n`).join('\n') || 'No proposals generated.'}\n\n## Safety Gate\n\nSandbox testing requires explicit user approval. Applying a proposal requires a second explicit user approval that references the proposal ID.\n`
}

async function main() {
  const id = runId()
  const runDir = resolve(ROOT, 'agent-improvement-proposals', id)
  await mkdir(runDir, { recursive: true })
  await mkdir(resolve(ROOT, 'project-memory'), { recursive: true })

  const signals = await collectSignals()
  const proposals = signals.slice(0, 8).map(proposalFromSignal)

  await materializeCandidateCopies(runDir, proposals)
  await writeSandboxManifest(runDir, proposals)

  await writeFile(
    resolve(runDir, 'signals.json'),
    JSON.stringify(signals, null, 2),
    'utf8',
  )
  await writeFile(
    resolve(runDir, 'proposals.json'),
    JSON.stringify(proposals, null, 2),
    'utf8',
  )
  await writeFile(
    resolve(runDir, 'proposals.md'),
    renderReport(id, signals, proposals),
    'utf8',
  )
  await writeFile(
    resolve(ROOT, 'project-memory', 'agent-evolution-report.md'),
    renderReport(id, signals, proposals),
    'utf8',
  )

  console.log(`Agent self-evolution audit complete: ${rel(runDir)}`)
  console.log('Production files were not modified.')
  if (!approveSandbox) {
    console.log(
      'To prepare sandbox files after user approval: bun run self-evolve:audit -- --approve-sandbox --materialize-copies',
    )
  }
}

await main()
