// @ts-nocheck
export interface KBItem {
  id: string
  category: string
  title: string
  content: string
  tags: string[]
  source: string
  confidence: 'high' | 'medium' | 'low'
}

export function getKBRoot(cwd?: string): string {
  return join(cwd || process.cwd(), 'knowledge')
}
