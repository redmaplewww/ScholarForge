// @ts-nocheck
/**
 * indexer.ts - 知识库索引器
 * 为 knowledge/ 目录内容建立简单索引，支持快速检索。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getKnowledgeRoot } from './common'

export interface IndexEntry {
  path: string
  title: string
  tags: string[]
  lastModified: number
}

const INDEX_FILE = '.knowledge-index.json'

export function buildIndex(cwd?: string): IndexEntry[] {
  const root = getKnowledgeRoot(cwd)
  const entries: IndexEntry[] = []

  for (const file of walkMarkdown(root)) {
    const content = readFileSync(file, 'utf8')
    const title = extractTitle(content)
    const tags = extractTags(content)
    const stat = statSync(file)
    entries.push({
      path: file,
      title,
      tags,
      lastModified: stat.mtimeMs,
    })
  }

  writeFileSync(join(root, INDEX_FILE), JSON.stringify(entries, null, 2))
  return entries
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : ''
}

function extractTags(content: string): string[] {
  const match = content.match(/tags:\s*\[(.+)\]/)
  if (!match) return []
  return match[1].split(',').map(t => t.trim().replace(/['"]/g, ''))
}

function walkMarkdown(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        files.push(...walkMarkdown(full))
      } else if (entry.name.endsWith('.md')) {
        files.push(full)
      }
    }
  } catch {}
  return files
}
