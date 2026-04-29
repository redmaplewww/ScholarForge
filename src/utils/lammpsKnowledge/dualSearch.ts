import { Database } from 'bun:sqlite'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getKnowledgeDbPath, getWorkspaceRoot } from './common.js'
import { getRemoteDbPath } from './remoteCommon.js'
import type { SearchKnowledgeInput, SearchKnowledgeResult } from './search.js'

type DualResultItem = SearchKnowledgeResult['results'][number] & {
  source: 'local' | 'remote'
}

export type DualSearchResult = {
  query: string
  localCount: number
  remoteCount: number
  duplicates: number
  results: DualResultItem[]
}

export function dualSearch(
  input: SearchKnowledgeInput,
  localResults: SearchKnowledgeResult,
): DualSearchResult {
  const workspaceRoot = getWorkspaceRoot()
  const remoteDbPath = getRemoteDbPath(workspaceRoot)

  const remoteRows = searchRemoteDb(remoteDbPath, input)
  const remoteResults = remoteRows.map(row => ({
    ...row,
    source: 'remote' as const,
    evidenceLines: [] as string[],
    whyRanked: [`source:remote`, `tier:${row.sourceTier}`],
  }))

  const localResultsMapped = localResults.results.map(r => ({
    ...r,
    source: 'local' as const,
  }))

  const seen = new Map<string, DualResultItem>()
  const merged: DualResultItem[] = []
  let duplicates = 0

  const allItems = [...localResultsMapped, ...remoteResults]
  allItems.sort((a, b) => b.score - a.score)

  for (const item of allItems) {
    const dedupeKey = `${item.path}::${item.snippet.slice(0, 60)}`
    if (seen.has(dedupeKey)) {
      duplicates += 1
      continue
    }
    seen.set(dedupeKey, item)
    merged.push(item)
  }

  const topK = input.topK ?? 8
  const finalResults = merged.slice(0, Math.min(topK * 2, 40))

  return {
    query: input.query,
    localCount: localResultsMapped.length,
    remoteCount: remoteResults.length,
    duplicates,
    results: finalResults,
  }
}

type RemoteSearchRow = {
  path: string
  title: string
  snippet: string
  source_type: string
  source_tier: string
  family: string | null
  material_system: string | null
  potential_family: string | null
  stage: string | null
  case_weight: number | null
  case_reliability: string | null
  case_usage: string | null
  file_type: string
  sha1: string
}

function searchRemoteDb(
  dbPath: string,
  input: SearchKnowledgeInput,
): Array<SearchKnowledgeResult['results'][number]> {
  if (!existsSync(dbPath)) return []

  const db = new Database(dbPath, { readonly: true })
  try {
    const query = input.query.trim()
    if (!query) return []

    const topK = Math.min(20, Math.max(1, input.topK ?? 8))
    const fetchLimit = topK * 3

    const tokens = query
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0)
      .map(t => `"${t}"`)
    if (tokens.length === 0) return []

    const ftsQuery = tokens.join(' OR ')

    const params: Array<string | number> = [ftsQuery, fetchLimit]

    const rows = db
      .query(
        `SELECT d.path, d.title, d.snippet, d.source_type, d.source_tier,
                d.family, d.material_system, d.potential_family, d.stage,
                d.case_weight, d.case_reliability, d.case_usage, d.file_type, d.sha1,
                (-bm25(documents_fts, 6.0, 4.0, 1.0)
                  + CASE WHEN d.path LIKE 'knowledge/%' THEN 3.0 ELSE 0.0 END
                  + CASE WHEN d.source_type = 'experience' THEN 2.0 ELSE 0.0 END
                  + CASE WHEN d.source_type = 'manual_reference' THEN 2.5 ELSE 0.0 END
                  + COALESCE(d.case_weight, 1.0)
                ) AS score
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
         WHERE documents_fts MATCH ?
         ORDER BY score DESC
         LIMIT ?`,
      )
      .all(...params) as (RemoteSearchRow & { score: number })[]

    return rows.map(row => ({
      path: `[remote] ${row.path}`,
      title: row.title,
      snippet: row.snippet,
      sourceType: row.source_type,
      sourceTier: row.source_tier,
      family: row.family,
      materialSystem: row.material_system,
      potentialFamily: row.potential_family,
      stage: row.stage,
      caseWeight: row.case_weight,
      caseReliability: row.case_reliability,
      caseUsage: row.case_usage,
      fileType: row.file_type,
      score: row.score * 0.9,
      whyRanked: [`source:remote`, `tier:${row.source_tier}`],
      evidenceLines: [],
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}
