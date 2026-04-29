// @ts-nocheck
export const KNOWLEDGE_DIR = 'knowledge'
export const RULES_DIR = 'rules'
export const MEMORY_DIR = 'memory'
export const CASES_DIR = 'cases'

export interface KnowledgeItem {
  id: string
  category: string
  title: string
  content: string
  tags: string[]
  source: string
  confidence: 'high' | 'medium' | 'low'
  related?: string[]
}

export function getKnowledgeRoot(cwd?: string): string {
  return join(cwd || process.cwd(), KNOWLEDGE_DIR)
}
