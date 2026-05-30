#!/usr/bin/env bun
// @ts-nocheck
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

type EvidenceType =
  | 'local_knowledge'
  | 'artifact'
  | 'run_log'
  | 'external_reference'
  | 'review'
  | 'decision'
  | 'user_input'

type EvidenceRecord = {
  id: string
  type: EvidenceType
  source: string
  summary: string
  tags: string[]
  added_by: string
  added_at: string
  exists: boolean
  sha_hint?: string
}

const root = process.cwd()
const evidencePath = resolve(root, '.project', 'evidence.json')

function usage() {
  console.log(`Usage:
  bun run evidence:add -- --source <path-or-url> --summary <text> [--type artifact] [--tag tag] [--by agent]
  bun run evidence:list
  bun run evidence:check -- --ids EV-001,EV-002
  bun run evidence:check -- --require 2 --stage <stage-name>

Evidence registry: .project/evidence.json`)
}

function arg(name: string, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function args(name: string) {
  const out: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1])
      out.push(process.argv[i + 1])
  }
  return out
}

function isUrl(s: string) {
  return /^https?:\/\//i.test(s)
}

function toProjectPath(pathOrUrl: string) {
  if (isUrl(pathOrUrl)) return pathOrUrl
  const abs = resolve(root, pathOrUrl)
  return relative(root, abs).replaceAll('\\', '/')
}

async function loadRegistry(): Promise<Record<string, EvidenceRecord>> {
  if (!existsSync(evidencePath)) return {}
  try {
    return JSON.parse(await readFile(evidencePath, 'utf8'))
  } catch {
    return {}
  }
}

async function saveRegistry(registry: Record<string, EvidenceRecord>) {
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, JSON.stringify(registry, null, 2), 'utf8')
}

function nextId(registry: Record<string, EvidenceRecord>) {
  const max = Object.keys(registry)
    .map(id => Number(id.replace(/^EV-/, '')))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  return `EV-${String(max + 1).padStart(3, '0')}`
}

function sourceExists(source: string) {
  if (isUrl(source)) return true
  return existsSync(resolve(root, source))
}

function shaHint(source: string) {
  if (isUrl(source)) return undefined
  const abs = resolve(root, source)
  if (!existsSync(abs)) return undefined
  const st = statSync(abs)
  return `${st.size}:${Math.trunc(st.mtimeMs)}`
}

async function addEvidence() {
  const sourceRaw = arg('source')
  const summary = arg('summary')
  if (!sourceRaw || !summary) {
    usage()
    process.exit(1)
  }

  const registry = await loadRegistry()
  const source = toProjectPath(sourceRaw)
  const id = nextId(registry)
  const record: EvidenceRecord = {
    id,
    type: arg('type', 'artifact') as EvidenceType,
    source,
    summary,
    tags: args('tag'),
    added_by: arg('by', 'manual'),
    added_at: new Date().toISOString(),
    exists: sourceExists(source),
    sha_hint: shaHint(source),
  }
  registry[id] = record
  await saveRegistry(registry)
  console.log(JSON.stringify(record, null, 2))
}

async function listEvidence() {
  const registry = await loadRegistry()
  const records = Object.values(registry)
  if (records.length === 0) {
    console.log('No evidence registered.')
    return
  }
  for (const r of records) {
    console.log(`${r.id} [${r.type}] ${r.source} :: ${r.summary}`)
  }
}

async function checkEvidence() {
  const registry = await loadRegistry()
  const idsArg = arg('ids')
  const requireCount = Number(arg('require', '1'))
  const ids = idsArg
    ? idsArg
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : Object.keys(registry)
  const records = ids.map(id => registry[id]).filter(Boolean)
  const missingIds = ids.filter(id => !registry[id])
  const missingSources = records
    .filter(r => !sourceExists(r.source))
    .map(r => r.id)
  const okCount = records.length - missingSources.length
  const ok =
    missingIds.length === 0 &&
    missingSources.length === 0 &&
    okCount >= requireCount
  const result = {
    ok,
    require_count: requireCount,
    valid_count: okCount,
    checked_ids: ids,
    missing_ids: missingIds,
    missing_sources: missingSources,
    stage: arg('stage', ''),
  }
  console.log(JSON.stringify(result, null, 2))
  if (!ok) process.exit(2)
}

const cmd = process.argv[2] || 'help'
if (cmd === 'add') await addEvidence()
else if (cmd === 'list') await listEvidence()
else if (cmd === 'check') await checkEvidence()
else usage()

export {}
