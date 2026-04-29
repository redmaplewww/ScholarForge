// @ts-nocheck
/**
 * search.ts - 通用知识检索
 * 搜索 knowledge/ 目录下的规则、案例和记忆。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getKnowledgeRoot, RULES_DIR, MEMORY_DIR, CASES_DIR } from './common'

export interface SearchResult {
  path: string
  relevance: 'high' | 'medium' | 'low'
  snippet: string
  source: string
}

export function searchKnowledge(query: string, cwd?: string): SearchResult[] {
  const root = getKnowledgeRoot(cwd)
  const results: SearchResult[] = []
  const terms = query.toLowerCase().split(/\s+/)

  const dirs = [RULES_DIR, MEMORY_DIR, CASES_DIR]
  for (const dir of dirs) {
    const dirPath = join(root, dir)
    if (!statSync(dirPath, { throwIfNoEntry: false })) continue

    for (const file of walkFiles(dirPath)) {
      const content = readFileSync(file, 'utf8').toLowerCase()
      const matchCount = terms.filter(t => content.includes(t)).length
      if (matchCount > 0) {
        const relevance =
          matchCount >= terms.length * 0.7
            ? 'high'
            : matchCount >= terms.length * 0.3
              ? 'medium'
              : 'low'
        results.push({
          path: file,
          relevance,
          snippet: content.slice(0, 200),
          source: dir,
        })
      }
    }
  }

  return results.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.relevance] - order[b.relevance]
  })
}

function walkFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(full))
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files
}
