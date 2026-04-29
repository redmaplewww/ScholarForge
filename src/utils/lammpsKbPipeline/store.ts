import { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { basename } from 'path'
import { jsonStringify } from '../slowOperations.js'
import { updateKnowledgeIndexIncrementally } from '../lammpsKnowledge/indexer.js'
import { classifyContent, type ClassificationResult } from './classify.js'
import {
  getCaseNotesDir,
  ensurePipelineDirs,
  getCorrectionsDir,
  escapeYamlScalar,
  getCandidateDir,
  getKnowledgeRoot,
  getPipelineDbPath,
  getPotentialsDir,
  getQuarantineDir,
  getRawDir,
  getReportsDir,
  getReviewLogDir,
  getTemplateAnswersDir,
  getTemplatesDir,
  getMemoryDir,
  getConfirmedLessonsPath,
  getIngestedKnowledgeIndexPath,
  getLearnedRulesPath,
  getMaintenanceDir,
  getPendingLessonsPath,
  getWorkspaceRoot,
  normalizePathForDb,
  slugify,
  type PipelineContentType,
  type PipelineQuality,
  type PipelineStatus,
} from './common.js'

export type IngestInput = {
  content?: string
  filePath?: string
  sourceType?: string
  title?: string
  tags?: string[]
  autoClassify?: boolean
}

export type SearchInput = {
  query: string
  topK?: number
  status?: PipelineStatus
  contentType?: PipelineContentType
  stage?: string
  quality?: PipelineQuality
}

export type ReviewDecision = 'candidate' | 'confirmed' | 'quarantined'

export type ApplyReviewInput = {
  entryId: string
  decision: ReviewDecision
  destination?: string
  reviewer?: string
  rationale?: string
  summary?: string
  lesson?: string
  title?: string
  tags?: string[]
  evidencePaths?: string[]
  knowledgeType?: PipelineContentType
  mergeMode?: 'append' | 'replace' | 'new_entry'
  mergeTarget?: string
  applicability?: string
}

type EntryRecord = {
  id: string
  title: string
  source_type: string
  source_path: string | null
  content_type: PipelineContentType
  stage: string | null
  potential_family: string | null
  material_system: string | null
  quality: PipelineQuality
  status: PipelineStatus
  confidence: number
  review_required: number
  summary: string
  tags_json: string
  evidence_paths_json: string
  output_path: string | null
  created_at: number
  updated_at: number
}

type ResolvedKnowledgeTarget = {
  path: string
  mode: 'append' | 'replace'
  mergeTarget?: string
}

export async function ingestContent(
  input: IngestInput,
): Promise<Record<string, unknown>> {
  const workspaceRoot = getWorkspaceRoot()
  await ensurePipelineDirs(workspaceRoot)
  const resolved = await resolveContent(input, workspaceRoot)
  const classification = classifyContent({
    content: resolved.content,
    title: resolved.title,
    sourceType: resolved.sourceType,
    sourcePath: resolved.sourcePath ?? undefined,
  })
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const db = openDb(workspaceRoot)

  try {
    initializeSchema(db)
    const record = {
      id,
      title: resolved.title,
      source_type: resolved.sourceType,
      source_path: resolved.sourcePath,
      content_type: classification.contentType,
      stage: classification.stage,
      potential_family: classification.potentialFamily,
      material_system: classification.materialSystem,
      quality: classification.quality,
      status: classification.status,
      confidence: classification.confidence,
      review_required: classification.reviewRequired ? 1 : 0,
      summary: classification.summary,
      tags_json: jsonStringify(
        uniqueStrings([...(input.tags ?? []), ...classification.tags]),
      ),
      evidence_paths_json: jsonStringify(
        resolved.sourcePath ? [resolved.sourcePath] : [],
      ),
      output_path: null,
      created_at: now,
      updated_at: now,
    }
    const insert = db.query(`
      INSERT INTO entries (
        id, title, source_type, source_path, content_type, stage,
        potential_family, material_system, quality, status, confidence,
        review_required, summary, tags_json, evidence_paths_json, output_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      record.id,
      record.title,
      record.source_type,
      record.source_path,
      record.content_type,
      record.stage,
      record.potential_family,
      record.material_system,
      record.quality,
      record.status,
      record.confidence,
      record.review_required,
      record.summary,
      record.tags_json,
      record.evidence_paths_json,
      record.output_path,
      record.created_at,
      record.updated_at,
    )

    db.query(
      'INSERT INTO entries_fts(rowid, title, summary, content) VALUES (last_insert_rowid(), ?, ?, ?)',
    ).run(record.title, record.summary, resolved.content)

    const rawPath = `${getRawDir(workspaceRoot)}/${id}.json`
    await writeFile(
      rawPath,
      jsonStringify({
        id,
        workspaceRoot,
        raw: resolved,
        classification,
        createdAt: now,
      }),
      'utf8',
    )

    if (classification.status === 'candidate') {
      const candidatePath = `${getCandidateDir(workspaceRoot)}/${buildDatedName(resolved.title, id)}.md`
      await writeFile(
        candidatePath,
        buildStagedMarkdown({
          title: resolved.title,
          entryId: id,
          decision: 'candidate',
          reviewer: 'auto-classifier',
          rationale: classification.reasons.join('; '),
          summary: classification.summary,
          lesson: '',
          classification,
          sourceType: resolved.sourceType,
          sourcePath: resolved.sourcePath,
          evidencePaths: resolved.sourcePath ? [resolved.sourcePath] : [],
          content: resolved.content,
        }),
        'utf8',
      )
      updateOutputPath(
        db,
        id,
        normalizePathForDb(candidatePath, workspaceRoot),
        now,
      )
    }

    if (classification.status === 'quarantined') {
      const quarantinePath = `${getQuarantineDir(workspaceRoot)}/${buildDatedName(resolved.title, id)}.md`
      await writeFile(
        quarantinePath,
        buildStagedMarkdown({
          title: resolved.title,
          entryId: id,
          decision: 'quarantined',
          reviewer: 'auto-classifier',
          rationale: classification.reasons.join('; '),
          summary: classification.summary,
          lesson: '',
          classification,
          sourceType: resolved.sourceType,
          sourcePath: resolved.sourcePath,
          evidencePaths: resolved.sourcePath ? [resolved.sourcePath] : [],
          content: resolved.content,
        }),
        'utf8',
      )
      updateOutputPath(
        db,
        id,
        normalizePathForDb(quarantinePath, workspaceRoot),
        now,
      )
    }

    return {
      id,
      status: classification.status,
      reviewRequired: classification.reviewRequired,
      classification,
      rawPath: normalizePathForDb(rawPath, workspaceRoot),
    }
  } finally {
    db.close()
  }
}

export function getPipelineStatus(): Record<string, unknown> {
  const workspaceRoot = getWorkspaceRoot()
  const db = openDb(workspaceRoot)
  try {
    initializeSchema(db)
    const rows = db
      .query('SELECT status, COUNT(*) AS count FROM entries GROUP BY status')
      .all() as Array<{ status: string; count: number }>
    return {
      workspaceRoot,
      dbPath: getPipelineDbPath(workspaceRoot),
      knowledgeRoot: normalizePathForDb(
        getKnowledgeRoot(workspaceRoot),
        workspaceRoot,
      ),
      counts: Object.fromEntries(rows.map(row => [row.status, row.count])),
    }
  } finally {
    db.close()
  }
}

export function listReviewQueue(limit = 20): Record<string, unknown> {
  const workspaceRoot = getWorkspaceRoot()
  const db = openDb(workspaceRoot)
  try {
    initializeSchema(db)
    const rows = db
      .query(
        `SELECT id, title, source_type, content_type, stage, potential_family,
                material_system, quality, status, confidence, summary,
                review_required, output_path, created_at, updated_at
         FROM entries
         WHERE status IN ('pending_review', 'candidate')
         ORDER BY review_required DESC, confidence DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>
    return { workspaceRoot, items: rows }
  } finally {
    db.close()
  }
}

export function getEntry(entryId: string): Record<string, unknown> {
  const workspaceRoot = getWorkspaceRoot()
  const db = openDb(workspaceRoot)
  try {
    initializeSchema(db)
    const row = db
      .query(
        `SELECT id, title, source_type, source_path, content_type, stage,
                potential_family, material_system, quality, status, confidence,
                review_required, summary, tags_json, evidence_paths_json,
                output_path, created_at, updated_at
         FROM entries
         WHERE id = ?`,
      )
      .get(entryId) as EntryRecord | null
    if (!row) {
      throw new Error(`Entry not found: ${entryId}`)
    }
    return {
      ...row,
      tags: JSON.parse(row.tags_json),
      evidencePaths: JSON.parse(row.evidence_paths_json),
      rawPath: normalizePathForDb(
        `${getRawDir(workspaceRoot)}/${entryId}.json`,
        workspaceRoot,
      ),
    }
  } finally {
    db.close()
  }
}

export function searchEntries(input: SearchInput): Record<string, unknown> {
  const workspaceRoot = getWorkspaceRoot()
  const db = openDb(workspaceRoot)
  try {
    initializeSchema(db)
    const query = input.query.trim()
    if (!query) {
      throw new Error('query must not be empty')
    }
    const topK = Math.max(1, Math.min(input.topK ?? 8, 25))
    const clauses = ['entries_fts MATCH ?']
    const params: Array<string | number> = [toFtsQuery(query)]
    if (input.status) {
      clauses.push('e.status = ?')
      params.push(input.status)
    }
    if (input.contentType) {
      clauses.push('e.content_type = ?')
      params.push(input.contentType)
    }
    if (input.stage) {
      clauses.push('e.stage = ?')
      params.push(input.stage)
    }
    if (input.quality) {
      clauses.push('e.quality = ?')
      params.push(input.quality)
    }
    const rows = db
      .query(
        `SELECT e.id, e.title, e.source_type, e.content_type, e.stage,
                e.potential_family, e.material_system, e.quality, e.status,
                e.confidence, e.summary, e.output_path,
                -bm25(entries_fts, 4.0, 2.0, 1.0) AS score
         FROM entries_fts
         JOIN entries e ON e.rowid = entries_fts.rowid
         WHERE ${clauses.join(' AND ')}
         ORDER BY score DESC, e.updated_at DESC
         LIMIT ?`,
      )
      .all(...params, topK)
    return { query, topK, results: rows }
  } finally {
    db.close()
  }
}

export async function applyReviewDecision(
  input: ApplyReviewInput,
): Promise<Record<string, unknown>> {
  const workspaceRoot = getWorkspaceRoot()
  await ensurePipelineDirs(workspaceRoot)
  const db = openDb(workspaceRoot)
  try {
    initializeSchema(db)
    const entry = db
      .query(
        `SELECT id, title, source_type, source_path, content_type, stage,
                potential_family, material_system, quality, status, confidence,
                summary, tags_json, evidence_paths_json
         FROM entries
         WHERE id = ?`,
      )
      .get(input.entryId) as EntryRecord | null
    if (!entry) {
      throw new Error(`Entry not found: ${input.entryId}`)
    }

    const rawPath = `${getRawDir(workspaceRoot)}/${input.entryId}.json`
    const raw = JSON.parse(await readFile(rawPath, 'utf8')) as {
      raw: { content: string; sourcePath: string | null }
      classification: ClassificationResult
    }
    const now = Math.floor(Date.now() / 1000)
    const title = input.title?.trim() || entry.title
    const tags = uniqueStrings([
      ...JSON.parse(entry.tags_json),
      ...(input.tags ?? []),
    ])
    const evidencePaths = uniqueStrings([
      ...JSON.parse(entry.evidence_paths_json),
      ...(input.evidencePaths ?? []),
    ])
    const reviewer = input.reviewer?.trim() || 'unknown-reviewer'
    const rationale = input.rationale?.trim() || 'No rationale provided.'
    const summary = input.summary?.trim() || entry.summary
    const lesson = input.lesson?.trim() || ''
    const applicability = input.applicability?.trim() || ''
    const knowledgeType = input.knowledgeType ?? entry.content_type

    const target = getDecisionOutputTarget(
      knowledgeType,
      input.decision,
      input.destination,
      title,
      input.entryId,
      workspaceRoot,
      input.mergeMode,
      input.mergeTarget,
    )
    await writeDecisionOutput({
      target,
      mergeMode: input.mergeMode,
      title,
      entryId: input.entryId,
      decision: input.decision,
      reviewer,
      rationale,
      summary,
      lesson,
      applicability,
      classification: raw.classification,
      knowledgeType,
      mergeTarget: input.mergeTarget,
      sourceType: entry.source_type,
      sourcePath: entry.source_path,
      evidencePaths,
      content: raw.raw.content,
    })

    const normalizedTargetPath = normalizePathForDb(target.path, workspaceRoot)
    db.query(
      `UPDATE entries
       SET title = ?, content_type = ?, status = ?, summary = ?, tags_json = ?, evidence_paths_json = ?,
            review_required = ?, output_path = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      title,
      knowledgeType,
      input.decision,
      summary,
      jsonStringify(tags),
      jsonStringify(evidencePaths),
      input.decision === 'candidate' ? 0 : 0,
      normalizedTargetPath,
      now,
      input.entryId,
    )
    await rebuildEntriesFtsIndex(db, workspaceRoot)

    const reviewLogPath = `${getReviewLogDir(workspaceRoot)}/${input.entryId}-${now}.json`
    await writeFile(
      reviewLogPath,
      jsonStringify({
        entryId: input.entryId,
        decision: input.decision,
        reviewer,
        rationale,
        summary,
        lesson,
        applicability,
        knowledgeType,
        mergeTarget: input.mergeTarget,
        evidencePaths,
        targetPath: normalizedTargetPath,
        reviewedAt: now,
      }),
      'utf8',
    )

    if (input.decision === 'confirmed') {
      await updateKnowledgeIndexIncrementally({ workspaceRoot })
      await updateIngestedKnowledgeIndex({
        workspaceRoot,
        title,
        entryId: input.entryId,
        knowledgeType,
        destination: normalizedTargetPath,
        stage: raw.classification.stage,
        potentialFamily: raw.classification.potentialFamily,
        materialSystem: raw.classification.materialSystem,
        tags,
      })
    }

    return {
      entryId: input.entryId,
      decision: input.decision,
      outputPath: normalizedTargetPath,
      reviewLogPath: normalizePathForDb(reviewLogPath, workspaceRoot),
    }
  } finally {
    db.close()
  }
}

function getDecisionOutputTarget(
  contentType: PipelineContentType,
  decision: ReviewDecision,
  destination: string | undefined,
  title: string,
  entryId: string,
  workspaceRoot: string,
  mergeMode?: 'append' | 'replace' | 'new_entry',
  mergeTarget?: string,
): ResolvedKnowledgeTarget {
  const filename = buildDatedName(title, entryId)
  if (decision === 'confirmed') {
    const resolved = getConfirmedDestinationPath(
      contentType,
      destination,
      workspaceRoot,
      filename,
    )
    return {
      path: resolved.path,
      mergeTarget,
      mode:
        mergeMode === 'replace' || resolved.mode === 'replace'
          ? 'replace'
          : 'append',
    }
  }
  if (decision === 'quarantined') {
    return {
      path: `${getQuarantineDir(workspaceRoot)}/${filename}.md`,
      mergeTarget,
      mode: 'replace',
    }
  }
  return {
    path: `${getCandidateDir(workspaceRoot)}/${filename}.md`,
    mergeTarget,
    mode: 'replace',
  }
}

function getConfirmedDestinationPath(
  contentType: PipelineContentType,
  destination: string | undefined,
  workspaceRoot: string,
  filename: string,
): ResolvedKnowledgeTarget {
  const normalizedDestination = destination
    ?.trim()
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
  if (normalizedDestination) {
    if (
      normalizedDestination.startsWith('..') ||
      normalizedDestination.includes('/../')
    ) {
      throw new Error(`Invalid destination: ${destination}`)
    }
    const explicitPath = normalizedDestination.startsWith('knowledge/')
      ? `${workspaceRoot}/${normalizedDestination}`
      : `${getKnowledgeRoot(workspaceRoot)}/${normalizedDestination}`
    return {
      path: explicitPath.endsWith('.md')
        ? explicitPath
        : `${explicitPath}/${filename}.md`,
      mode: explicitPath.endsWith('.md') ? 'append' : 'replace',
    }
  }
  switch (contentType) {
    case 'rule':
      return { path: getLearnedRulesPath(workspaceRoot), mode: 'append' }
    case 'correction':
      return {
        path: `${getCorrectionsDir(workspaceRoot)}/reference-corpus/${filename}.md`,
        mode: 'replace',
      }
    case 'qa':
    case 'input_script':
    case 'template_snippet':
      return {
        path: `${getTemplateAnswersDir(workspaceRoot)}/${filename}.md`,
        mode: 'replace',
      }
    case 'experience':
    case 'dialogue':
      return { path: getConfirmedLessonsPath(workspaceRoot), mode: 'append' }
    case 'case':
    case 'case_note':
      return {
        path: `${getCaseNotesDir(workspaceRoot)}/${filename}.md`,
        mode: 'replace',
      }
    case 'potential_note':
      return {
        path: `${getPotentialsDir(workspaceRoot)}/${filename}.md`,
        mode: 'replace',
      }
    case 'error':
    case 'output_log':
    case 'unknown':
      return {
        path: `${getReportsDir(workspaceRoot)}/${filename}.md`,
        mode: 'replace',
      }
  }
}

async function resolveContent(
  input: IngestInput,
  workspaceRoot: string,
): Promise<{
  content: string
  sourcePath: string | null
  sourceType: string
  title: string
}> {
  if (input.content && input.content.trim()) {
    return {
      content: input.content,
      sourcePath: input.filePath
        ? normalizePathForDb(input.filePath, workspaceRoot)
        : null,
      sourceType: input.sourceType?.trim() || 'text',
      title: input.title?.trim() || inferTitle(input.content, input.filePath),
    }
  }
  if (!input.filePath) {
    throw new Error('Provide either content or filePath')
  }
  const content = await readFile(input.filePath, 'utf8')
  return {
    content,
    sourcePath: normalizePathForDb(input.filePath, workspaceRoot),
    sourceType: input.sourceType?.trim() || 'file',
    title: input.title?.trim() || basename(input.filePath),
  }
}

function openDb(workspaceRoot: string): Database {
  return new Database(getPipelineDbPath(workspaceRoot))
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_path TEXT,
      content_type TEXT NOT NULL,
      stage TEXT,
      potential_family TEXT,
      material_system TEXT,
      quality TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      review_required INTEGER NOT NULL DEFAULT 1,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      evidence_paths_json TEXT NOT NULL,
      output_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      title,
      summary,
      content,
      content=''
    );
    CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
    CREATE INDEX IF NOT EXISTS idx_entries_content_type ON entries(content_type);
    CREATE INDEX IF NOT EXISTS idx_entries_stage ON entries(stage);
    CREATE INDEX IF NOT EXISTS idx_entries_quality ON entries(quality);
  `)
}

function updateOutputPath(
  db: Database,
  entryId: string,
  outputPath: string,
  updatedAt: number,
): void {
  db.query(
    'UPDATE entries SET output_path = ?, updated_at = ? WHERE id = ?',
  ).run(outputPath, updatedAt, entryId)
}

function toFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/[^\p{L}\p{N}_]+/u)
    .map(token => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    throw new Error('query must contain searchable text')
  }

  return tokens.map(token => `${token.replace(/"/g, '')}*`).join(' AND ')
}

function buildDatedName(title: string, entryId: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `${date}-${slugify(title) || 'entry'}-${entryId.slice(0, 8)}`
}

function buildStagedMarkdown(input: {
  title: string
  entryId: string
  decision: ReviewDecision
  reviewer: string
  rationale: string
  summary: string
  lesson: string
  classification: ClassificationResult
  sourceType: string
  sourcePath: string | null
  evidencePaths: string[]
  content: string
}): string {
  const tags = uniqueStrings([
    ...input.classification.tags,
    input.classification.quality,
    input.classification.contentType,
  ])
  return `---
title: ${escapeYamlScalar(input.title)}
entry_id: ${escapeYamlScalar(input.entryId)}
decision: ${escapeYamlScalar(input.decision)}
reviewer: ${escapeYamlScalar(input.reviewer)}
source_type: ${escapeYamlScalar(input.sourceType)}
source_path: ${escapeYamlScalar(input.sourcePath ?? '')}
content_type: ${escapeYamlScalar(input.classification.contentType)}
stage: ${escapeYamlScalar(input.classification.stage ?? '')}
potential_family: ${escapeYamlScalar(input.classification.potentialFamily ?? '')}
material_system: ${escapeYamlScalar(input.classification.materialSystem ?? '')}
quality: ${escapeYamlScalar(input.classification.quality)}
confidence: ${input.classification.confidence.toFixed(2)}
tags:
${tags.map(tag => `  - ${escapeYamlScalar(tag)}`).join('\n')}
evidence_paths:
${input.evidencePaths.length > 0 ? input.evidencePaths.map(path => `  - ${escapeYamlScalar(path)}`).join('\n') : '  - ""'}
---

## Summary

${input.summary}

## Rationale

${input.rationale}

## Reusable Lesson

${input.lesson || 'Pending reviewer synthesis.'}

## Source Extract

\`\`\`text
${input.content.slice(0, 4000)}
\`\`\`
`
}

async function writeDecisionOutput(input: {
  target: ResolvedKnowledgeTarget
  mergeMode?: 'append' | 'replace' | 'new_entry'
  title: string
  entryId: string
  decision: ReviewDecision
  reviewer: string
  rationale: string
  summary: string
  lesson: string
  applicability: string
  classification: ClassificationResult
  knowledgeType: PipelineContentType
  mergeTarget?: string
  sourceType: string
  sourcePath: string | null
  evidencePaths: string[]
  content: string
}): Promise<void> {
  if (input.target.mode === 'replace') {
    await writeFile(
      input.target.path,
      buildKnowledgeArtifactMarkdown(input),
      'utf8',
    )
    return
  }

  const existing = await readFile(input.target.path, 'utf8').catch(() => '')
  const header = buildAppendableHeader(input.target.path)
  const existingBlock = findLedgerBlock(
    existing,
    input.mergeTarget ?? input.target.mergeTarget,
  )
  if (existingBlock && (input.mergeMode ?? 'append') === 'append') {
    const mergedBlock = mergeIntoExistingLedgerBlock(existingBlock, input)
    const nextBody = upsertLedgerBlock(
      existing,
      input.entryId,
      mergedBlock,
      input.mergeTarget ?? input.target.mergeTarget,
      input.title,
    )
    const content = nextBody.trim() ? nextBody : `${header}\n\n${mergedBlock}\n`
    await writeFile(input.target.path, content, 'utf8')
    return
  }
  const block = buildLedgerEntryBlock(
    input,
    input.target.path,
    existingBlock?.headingLine,
  )
  const nextBody = upsertLedgerBlock(
    existing,
    input.entryId,
    block,
    input.mergeTarget ?? input.target.mergeTarget,
    input.title,
  )
  const content = nextBody.trim() ? nextBody : `${header}\n\n${block}\n`
  await writeFile(input.target.path, content, 'utf8')
}

function buildKnowledgeArtifactMarkdown(input: {
  title: string
  entryId: string
  decision: ReviewDecision
  reviewer: string
  rationale: string
  summary: string
  lesson: string
  applicability: string
  classification: ClassificationResult
  knowledgeType: PipelineContentType
  sourceType: string
  sourcePath: string | null
  evidencePaths: string[]
  content: string
}): string {
  const tags = uniqueStrings([
    ...input.classification.tags,
    input.classification.quality,
    input.knowledgeType,
  ])
  return `---
title: ${escapeYamlScalar(input.title)}
entry_id: ${escapeYamlScalar(input.entryId)}
decision: ${escapeYamlScalar(input.decision)}
reviewer: ${escapeYamlScalar(input.reviewer)}
source_type: ${escapeYamlScalar(input.sourceType)}
source_path: ${escapeYamlScalar(input.sourcePath ?? '')}
knowledge_type: ${escapeYamlScalar(input.knowledgeType)}
stage: ${escapeYamlScalar(input.classification.stage ?? '')}
potential_family: ${escapeYamlScalar(input.classification.potentialFamily ?? '')}
material_system: ${escapeYamlScalar(input.classification.materialSystem ?? '')}
tags:
${tags.map(tag => `  - ${escapeYamlScalar(tag)}`).join('\n')}
evidence_paths:
${input.evidencePaths.length > 0 ? input.evidencePaths.map(path => `  - ${escapeYamlScalar(path)}`).join('\n') : '  - ""'}
---

## Summary

${input.summary}

## Reusable Lesson

${input.lesson || input.summary}

${input.applicability ? `## When To Apply\n\n${input.applicability}\n\n` : ''}## Source Reference

- raw entry: ${input.entryId}
- reviewer rationale: ${input.rationale}
`
}

function buildAppendableHeader(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/confirmed-lessons.md')) {
    return '# Confirmed Lessons'
  }
  if (normalized.endsWith('/pending-lessons.md')) {
    return '# Pending Lessons'
  }
  if (normalized.endsWith('/learned-rules.md')) {
    return '# Learned Rules'
  }
  if (normalized.endsWith('/ingested-knowledge-index.md')) {
    return '# Ingested Knowledge Index'
  }
  return '# Knowledge Entries'
}

function buildLedgerEntryBlock(
  input: {
    title: string
    entryId: string
    summary: string
    lesson: string
    applicability: string
    rationale: string
    classification: ClassificationResult
    knowledgeType: PipelineContentType
    evidencePaths: string[]
  },
  targetPath: string,
  preservedHeading?: string,
): string {
  const normalizedTarget = targetPath.replace(/\\/g, '/').toLowerCase()
  if (normalizedTarget.endsWith('/confirmed-lessons.md')) {
    return buildConfirmedLessonBlock(input, preservedHeading)
  }
  const stage = input.classification.stage ?? 'unknown'
  const potential = input.classification.potentialFamily ?? 'unknown'
  const material = input.classification.materialSystem ?? 'unknown'
  const heading =
    preservedHeading ?? `## [${input.entryId.slice(0, 8)}] ${input.title}`
  return `${heading}
- type: ${input.knowledgeType}
- stage: ${stage}
- material: ${material}
- potential: ${potential}
- summary: ${input.summary}
- lesson: ${input.lesson || input.summary}
${input.applicability ? `- apply_when: ${input.applicability}\n` : ''}- evidence: ${input.evidencePaths.length > 0 ? input.evidencePaths.join('; ') : 'raw-only'}
- note: ${input.rationale}`
}

function buildConfirmedLessonBlock(
  input: {
    title: string
    entryId: string
    summary: string
    lesson: string
    applicability: string
    rationale: string
    classification: ClassificationResult
    knowledgeType: PipelineContentType
    evidencePaths: string[]
  },
  preservedHeading?: string,
): string {
  const heading =
    preservedHeading ??
    `## [${extractLessonLabel(input.title, input.entryId)}] ${stripLessonLabel(input.title)}`
  return `${heading}
- status: confirmed
- category: ${mapKnowledgeTypeToCategory(input.knowledgeType)}
- lesson: ${input.lesson || input.summary}
- evidence: ${input.evidencePaths.length > 0 ? uniqueStrings(input.evidencePaths).join('; ') : 'raw-only'}
- note: ${input.rationale}${input.applicability ? ` Apply when: ${input.applicability}` : ''}`
}

function extractLessonLabel(title: string, entryId: string): string {
  const match = title.match(/\b(CL-\d+)\b/i)
  if (match) return match[1].toUpperCase()
  return entryId.slice(0, 8)
}

function stripLessonLabel(title: string): string {
  return title.replace(/^\s*CL-\d+\s*[:：-]?\s*/i, '').trim() || title.trim()
}

function mapKnowledgeTypeToCategory(type: PipelineContentType): string {
  switch (type) {
    case 'rule':
      return 'workflow'
    case 'correction':
      return 'review'
    case 'template_snippet':
      return 'template'
    case 'case_note':
      return 'input'
    case 'potential_note':
      return 'potential'
    case 'experience':
    default:
      return 'workflow'
  }
}

function findLedgerBlock(
  existing: string,
  mergeTarget?: string,
): {
  headingLine: string
  body: string
} | null {
  const anchor = mergeTarget?.trim()
  if (!existing.trim() || !anchor) return null
  const sections = splitLedgerSections(existing)
  const section = sections.find(item => item.heading.includes(anchor))
  if (!section) return null
  const [headingLine, ...rest] = section.block.split('\n')
  return { headingLine, body: rest.join('\n') }
}

function mergeIntoExistingLedgerBlock(
  existingBlock: { headingLine: string; body: string },
  input: {
    entryId: string
    summary: string
    lesson: string
    applicability: string
    rationale: string
    evidencePaths: string[]
  },
): string {
  const lines = existingBlock.body.split('\n')
  const updated = [...lines]
  const evidenceIndex = updated.findIndex(line =>
    line.startsWith('- evidence: '),
  )
  if (evidenceIndex >= 0 && input.evidencePaths.length > 0) {
    const existingEvidence = updated[evidenceIndex].replace('- evidence: ', '')
    const mergedEvidence = uniqueStrings([
      ...existingEvidence.split(';').map(item => item.trim()),
      ...input.evidencePaths,
    ])
    updated[evidenceIndex] = `- evidence: ${mergedEvidence.join('; ')}`
  }
  const noteIndex = updated.findIndex(line => line.startsWith('- note: '))
  const reinforcement = [input.summary, input.lesson, input.applicability]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (reinforcement) {
    const noteAddition = `Reinforcement ${input.entryId.slice(0, 8)}: ${reinforcement}`
    if (noteIndex >= 0) {
      if (!updated[noteIndex].includes(noteAddition)) {
        updated[noteIndex] = `${updated[noteIndex]} ${noteAddition}`.trim()
      }
    } else {
      updated.push(`- note: ${noteAddition}`)
    }
  }
  return `${existingBlock.headingLine}\n${updated.join('\n')}`
}

function splitLedgerSections(
  content: string,
): Array<{ heading: string; block: string }> {
  const lines = content.trim().split('\n')
  const sections: Array<{ heading: string; block: string }> = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      sections.push({ heading: current[0]!, block: current.join('\n') })
      current = [line]
      continue
    }
    if (current.length === 0) {
      if (line.startsWith('## ')) current = [line]
      continue
    }
    current.push(line)
  }
  if (current.length > 0) {
    sections.push({ heading: current[0]!, block: current.join('\n') })
  }
  return sections
}

async function updateIngestedKnowledgeIndex(input: {
  workspaceRoot: string
  title: string
  entryId: string
  knowledgeType: PipelineContentType
  destination: string
  stage: string | null
  potentialFamily: string | null
  materialSystem: string | null
  tags: string[]
}): Promise<void> {
  const indexPath = getIngestedKnowledgeIndexPath(input.workspaceRoot)
  const existing = await readFile(indexPath, 'utf8').catch(() => '')
  const header = '# Ingested Knowledge Index'
  const line = `- [${input.title}](${input.destination}) | type=${input.knowledgeType} | stage=${input.stage ?? 'unknown'} | material=${input.materialSystem ?? 'unknown'} | potential=${input.potentialFamily ?? 'unknown'} | tags=${input.tags.join(', ')} | entry=${input.entryId}`
  const filteredExisting = existing
    .split('\n')
    .filter(entry => !entry.includes(`entry=${input.entryId}`))
    .join('\n')
  const content = filteredExisting.trim()
    ? `${filteredExisting.trim()}\n${line}\n`
    : `${header}\n\n${line}\n`
  await writeFile(indexPath, content, 'utf8')
}

function upsertLedgerBlock(
  existing: string,
  entryId: string,
  block: string,
  mergeTarget?: string,
  title?: string,
): string {
  const normalized = existing.trim()
  if (!normalized) return ''
  const sections = splitLedgerSections(normalized)
  const shortId = entryId.slice(0, 8)
  const targetTitle = title?.trim()
  let replaced = false
  const nextBlocks = sections.map(section => {
    const matchesMergeTarget = mergeTarget?.trim()
      ? section.heading.includes(mergeTarget.trim())
      : false
    const matchesShortId = section.heading.includes(`[${shortId}]`)
    const matchesTitle = targetTitle
      ? section.heading.includes(targetTitle)
      : false
    if (matchesMergeTarget || matchesShortId || matchesTitle) {
      replaced = true
      return block.trim()
    }
    return section.block.trimEnd()
  })
  if (!replaced) {
    nextBlocks.push(block.trim())
  }
  return `${nextBlocks.filter(Boolean).join('\n\n')}\n`
}

async function rebuildEntriesFtsIndex(
  db: Database,
  workspaceRoot: string,
): Promise<void> {
  db.exec('DROP TABLE IF EXISTS entries_fts;')
  db.exec(`
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      title,
      summary,
      content,
      content=''
    );
  `)
  const rows = db
    .query('SELECT rowid, id, title, summary FROM entries')
    .all() as Array<{
    rowid: number
    id: string
    title: string
    summary: string
  }>
  const insert = db.query(
    'INSERT INTO entries_fts(rowid, title, summary, content) VALUES (?, ?, ?, ?)',
  )
  for (const row of rows) {
    const rawPath = `${getRawDir(workspaceRoot)}/${row.id}.json`
    const raw = await readFile(rawPath, 'utf8').catch(() => '')
    insert.run(row.rowid, row.title, row.summary, `${row.summary} ${raw}`)
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function inferTitle(content: string, filePath?: string): string {
  if (filePath) return basename(filePath)
  const firstLine = content
    .split(/\n+/)
    .map(line => line.trim())
    .find(Boolean)
  return firstLine?.slice(0, 80) || 'untitled-lammps-entry'
}
