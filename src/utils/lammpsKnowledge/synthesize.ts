import type { SearchKnowledgeResult } from './search.js'

type SynthesisOptions = {
  maxResults?: number
}

export function synthesizeKnowledgeAnswer(
  result: SearchKnowledgeResult,
  options: SynthesisOptions = {},
): string {
  const maxResults = options.maxResults ?? 3
  const isChinese = containsChinese(result.query)
  const topResults = result.results.slice(0, maxResults)
  const sections: string[] = []

  sections.push(buildConclusion(result, isChinese))

  if (result.answerChecklist.length > 0) {
    sections.push(
      [
        isChinese ? '关键点：' : 'Key points:',
        ...result.answerChecklist.map(item => `- ${item}`),
      ].join('\n'),
    )
  }

  const evidenceBlock = buildEvidenceBlock(topResults, isChinese)
  if (evidenceBlock) sections.push(evidenceBlock)

  const pathBlock = buildPathBlock(topResults, isChinese)
  if (pathBlock) sections.push(pathBlock)

  sections.push(
    isChinese
      ? `回答策略：${result.answerStrategy}`
      : `Answer strategy: ${result.answerStrategy}`,
  )

  return sections.filter(Boolean).join('\n\n')
}

function buildConclusion(
  result: SearchKnowledgeResult,
  isChinese: boolean,
): string {
  const lead = result.answerChecklist[0]
  if (lead) {
    return isChinese
      ? `结论：${normalizeSentence(lead)}`
      : `Conclusion: ${normalizeSentence(lead)}`
  }

  switch (result.queryType) {
    case 'syntax_lookup':
      return isChinese
        ? '结论：优先采用本地手册或案例中的精确写法。'
        : 'Conclusion: prefer the exact local manual or case syntax.'
    case 'case_route':
      return isChinese
        ? '结论：先从最接近的 family 或索引路径入手，再下钻到具体 raw case。'
        : 'Conclusion: start from the nearest family or index path, then drill down to raw cases.'
    case 'workflow_summary':
      return isChinese
        ? '结论：先给工作流判断，再补机制和输出 checklist。'
        : 'Conclusion: lead with the workflow judgment, then add mechanism and output checklist.'
    default:
      return isChinese
        ? '结论：先给直接判断，再引用最强本地依据。'
        : 'Conclusion: lead with a direct judgment, then cite the strongest local evidence.'
  }
}

function buildEvidenceBlock(
  rows: SearchKnowledgeResult['results'],
  isChinese: boolean,
): string {
  const evidenceRows = rows.filter(row => row.evidenceLines.length > 0)
  if (evidenceRows.length === 0) return ''
  const lines = [isChinese ? '直接证据：' : 'Direct evidence:']
  for (const row of evidenceRows.slice(0, 2)) {
    lines.push(`- ${row.path}`)
    for (const evidence of row.evidenceLines.slice(0, 4)) {
      lines.push(`  ${evidence}`)
    }
  }
  return lines.join('\n')
}

function buildPathBlock(
  rows: SearchKnowledgeResult['results'],
  isChinese: boolean,
): string {
  if (rows.length === 0) {
    return isChinese
      ? '本地检索结果：当前索引没有返回直接命中，需要补索引或补知识条目。'
      : 'Local retrieval: the current index returned no direct hits; index or knowledge coverage likely needs work.'
  }
  const lines = [isChinese ? '优先参考路径：' : 'Priority reference paths:']
  for (const row of rows.slice(0, 3)) {
    const reason = row.whyRanked.slice(0, 3).join(', ')
    lines.push(`- ${row.path}${reason ? ` - ${reason}` : ''}`)
  }
  return lines.join('\n')
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

function normalizeSentence(text: string): string {
  return text.replace(/[。.]?$/, '') + '。'
}
