// @ts-nocheck
/**
 * synthesize.ts - 知识综合
 * 将多个知识条目综合为连贯的上下文摘要。
 */
import { SearchResult } from './search'

export interface SynthesisResult {
  summary: string
  sources: string[]
  confidence: 'high' | 'medium' | 'low'
  gaps: string[]
}

export function synthesize(
  results: SearchResult[],
  query: string,
): SynthesisResult {
  if (results.length === 0) {
    return {
      summary: `未找到与 "${query}" 相关的知识条目。`,
      sources: [],
      confidence: 'low',
      gaps: [query],
    }
  }

  const highConf = results.filter(r => r.relevance === 'high')
  const confidence =
    highConf.length > 0
      ? 'high'
      : results.some(r => r.relevance === 'medium')
        ? 'medium'
        : 'low'

  const sources = results.map(r => r.path)
  const summary = results
    .slice(0, 5)
    .map(r => `【${r.source}】${r.snippet.slice(0, 100)}`)
    .join('\n')

  return {
    summary,
    sources,
    confidence,
    gaps: confidence === 'low' ? [`需要更多关于 "${query}" 的知识`] : [],
  }
}
