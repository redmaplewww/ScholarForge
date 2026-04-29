import { Database } from 'bun:sqlite'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { getKnowledgeDbPath, getWorkspaceRoot } from './common.js'
import {
  buildKnowledgeIndex,
  updateKnowledgeIndexIncrementally,
} from './indexer.js'
import { dualSearch } from './dualSearch.js'
import type { DualSearchResult } from './dualSearch.js'

export type SearchKnowledgeInput = {
  query: string
  topK?: number
  family?: string
  materialSystem?: string
  potentialFamily?: string
  stage?: string
  fileType?: string
  sourceTypes?: string[]
  autoIndex?: boolean
  includeRemote?: boolean
}

export type SearchKnowledgeResult = {
  query: string
  dbPath: string
  indexed: boolean
  queryType: string
  answerStrategy: string
  answerChecklist: string[]
  filters: Record<string, unknown>
  answerTemplate: {
    lead: string
    support: string[]
  }
  results: Array<{
    path: string
    title: string
    snippet: string
    sourceType: string
    sourceTier: string
    family: string | null
    materialSystem: string | null
    potentialFamily: string | null
    stage: string | null
    caseWeight: number | null
    caseReliability: string | null
    caseUsage: string | null
    fileType: string
    score: number
    whyRanked: string[]
    evidenceLines: string[]
  }>
  remoteInfo?: {
    included: boolean
    remoteCount: number
    duplicates: number
  }
}

type SearchRow = {
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
  score: number
}

type SearchOutputRow = SearchRow & {
  evidenceLines?: string[]
}

type QueryHints = {
  queryType: 'rule_judge' | 'syntax_lookup' | 'case_route' | 'workflow_summary'
  family?: string
  potentialFamily?: string
  stage?: string
  preferredFileTypes: string[]
  materialAliases: string[]
  expandedTerms: string[]
  commandDocHints: string[]
  shouldPreferConcreteSnippets: boolean
}

const COMMAND_DOC_HINTS: Array<{ pattern: RegExp; docs: string[] }> = [
  {
    pattern: /delete[_ ]?atoms|overlap/i,
    docs: ['delete_atoms', 'pair_coeff'],
  },
  { pattern: /pair[_ ]?coeff/i, docs: ['pair_coeff'] },
  { pattern: /pair[_ ]?style/i, docs: ['pair_style'] },
  {
    pattern: /pair[_ ]?eam[_ ]?alloy|eam\/alloy/i,
    docs: ['pair_eam_alloy', 'pair_eam'],
  },
  {
    pattern: /pair[_ ]?eam[_ ]?fs|eam\/fs/i,
    docs: ['pair_eam_fs', 'pair_eam'],
  },
  {
    pattern: /pair[_ ]?reax[_ ]?c|reax\/c/i,
    docs: ['pair_reax_c', 'pair_reaxff'],
  },
  { pattern: /pair[_ ]?reaxff|reaxff/i, docs: ['pair_reaxff'] },
  { pattern: /fix[_ ]?npt|\bnpt\b/i, docs: ['fix_npt', 'fix_nh'] },
  { pattern: /fix[_ ]?nvt|\bnvt\b/i, docs: ['fix_nvt', 'fix_nh'] },
  { pattern: /fix[_ ]?nph|\bnph\b/i, docs: ['fix_nph', 'fix_nh'] },
  { pattern: /fix deform|deform/i, docs: ['fix_deform'] },
  { pattern: /compute /i, docs: ['compute'] },
  { pattern: /atom[_ ]?style/i, docs: ['atom_style'] },
  { pattern: /boundary/i, docs: ['boundary'] },
  { pattern: /units/i, docs: ['units'] },
  { pattern: /velocity/i, docs: ['velocity'] },
  { pattern: /read[_ ]?data/i, docs: ['read_data'] },
  { pattern: /restart|read[_ ]?restart/i, docs: ['read_restart', 'restart'] },
]

const FAMILY_SYNONYMS: Record<string, string[]> = {
  'mechanical-loading': [
    '拉伸',
    'tensile',
    'strain',
    '应变',
    '剪切',
    'shear',
    'elastic',
    'indent',
    '压痕',
  ],
  'melt-solidify': ['融化', '熔化', '凝固', 'solidify', 'melt', 'liquid'],
  'reactive-and-deposition': [
    '沉积',
    'deposition',
    '吸附',
    'adsorption',
    '氧化',
    'oxidation',
    '腐蚀',
    'corrosion',
    'reactive',
    'NiC',
    'GaN氧化',
  ],
  machining: ['磨削', 'machining', 'tribology', '摩擦', 'grinding'],
  'radiation-damage': ['cascade', '级联', 'ttm', 'shock', '激波'],
  'alloy-and-segregation': ['偏聚', 'segregation', 'B2', 'alloy', '合金'],
}

const POTENTIAL_SYNONYMS: Record<string, string[]> = {
  reaxff: ['reaxff', 'reax/c', '反应力场'],
  meam: ['meam'],
  eam: ['eam', 'eam/alloy', 'eam/fs'],
  tersoff: ['tersoff'],
  hybrid: ['hybrid', '混合势'],
}

const STAGE_SYNONYMS: Record<string, string[]> = {
  'WF-01': ['wf-01', 'model setup', '建模', 'structure', '模型'],
  'WF-02': ['wf-02', 'potential', 'pair_style', '势函数', 'pair_coeff'],
  'WF-03A': ['wf-03a', 'input script', '脚本', '输入文件', 'in.lmp'],
  'WF-04': ['wf-04', 'analysis', '分析', 'log.lammps', 'thermo'],
  'WF-05': ['wf-05', 'visualization', '可视化', 'ovito', 'vmd'],
}

const QUERY_TYPE_PATTERNS: Array<{
  type: QueryHints['queryType']
  pattern: RegExp
}> = [
  {
    type: 'syntax_lookup',
    pattern:
      /语法|syntax|怎么写|写法|哪一行|怎么定义|定义|什么格式|pair_coeff|pair_style|fix |compute |thermo_style|dump |variable |read_data|read_restart|Tdamp|remap/i,
  },
  {
    type: 'case_route',
    pattern:
      /哪个 family|哪类案例|先看哪个|路径依据|案例库|family|raw cases|检索顺序|模板|case family/i,
  },
  {
    type: 'workflow_summary',
    pattern:
      /为什么不能只|为什么必须|应该怎样组织|证据链|链条|一等变量|一等扫描变量|工作流|机制|总结|归纳|assess|interpret/i,
  },
  {
    type: 'rule_judge',
    pattern: /能不能|是否|可不可以|为什么|必须|不能|should|must|conflict|冲突/i,
  },
]

export async function searchKnowledge(
  input: SearchKnowledgeInput,
): Promise<SearchKnowledgeResult> {
  const workspaceRoot = getWorkspaceRoot()
  const dbPath = getKnowledgeDbPath(workspaceRoot)
  let indexed = false
  if (!existsSync(dbPath) && input.autoIndex !== false) {
    await updateKnowledgeIndexIncrementally({ workspaceRoot })
    indexed = true
  }

  if (
    existsSync(dbPath) &&
    input.autoIndex !== false &&
    !hasSearchSchema(dbPath)
  ) {
    await buildKnowledgeIndex({ workspaceRoot })
    indexed = true
  }

  if (!existsSync(dbPath)) {
    throw new Error(
      'Knowledge index does not exist yet. Run index_lammps_knowledge first.',
    )
  }

  const query = input.query.trim()
  if (!query) {
    throw new Error('query must not be empty')
  }

  const topK = clampTopK(input.topK ?? 8)
  const fetchLimit = Math.min(120, Math.max(topK * 6, topK + 12))
  const hints = analyzeQuery(query)
  const ftsQuery = buildFtsQuery(query, hints)
  const db = new Database(dbPath, { readonly: true })

  try {
    const whereClauses = ['documents_fts MATCH ?']
    const params: Array<string | number> = [ftsQuery]
    const searchBackground = shouldSearchBackground(query)

    if (!searchBackground) {
      whereClauses.push("d.source_tier NOT IN ('source', 'archive')")
    }

    const family = input.family ?? hints.family
    const potentialFamily = input.potentialFamily ?? hints.potentialFamily
    const stage = input.stage ?? hints.stage

    if (input.family) {
      whereClauses.push('d.family = ?')
      params.push(input.family)
    }
    if (input.materialSystem) {
      whereClauses.push('d.material_system = ?')
      params.push(input.materialSystem)
    }
    if (input.potentialFamily) {
      whereClauses.push('d.potential_family = ?')
      params.push(input.potentialFamily)
    }
    if (input.stage) {
      whereClauses.push('d.stage = ?')
      params.push(input.stage)
    }
    if (input.fileType) {
      whereClauses.push('d.file_type = ?')
      params.push(input.fileType)
    }
    if (input.sourceTypes && input.sourceTypes.length > 0) {
      const placeholders = input.sourceTypes.map(() => '?').join(', ')
      whereClauses.push(`d.source_type IN (${placeholders})`)
      params.push(...input.sourceTypes)
    }

    const preferredFileTypes = input.fileType
      ? [input.fileType]
      : hints.preferredFileTypes
    const preferredSourceTypes = inferPreferredSourceTypes(query)

    const sql = `
      SELECT
        d.path,
        d.title,
        d.snippet,
        d.source_type,
        d.source_tier,
        d.family,
        d.material_system,
        d.potential_family,
        d.stage,
        d.case_weight,
        d.case_reliability,
        d.case_usage,
        d.file_type,
        (
          -bm25(documents_fts, 6.0, 4.0, 1.0)
          + CASE WHEN d.path LIKE 'knowledge/%' THEN 3.0 ELSE 0.0 END
          + CASE WHEN d.path LIKE 'knowledge/cases/raw/%' THEN 2.5 ELSE 0.0 END
          + CASE WHEN d.path LIKE 'knowledge/memory/%' THEN 2.0 ELSE 0.0 END
          + COALESCE(d.case_weight, 1.0)
          + CASE WHEN d.case_reliability = 'trusted' THEN 2.5 ELSE 0.0 END
          + CASE WHEN d.case_reliability = 'reviewed' THEN 1.5 ELSE 0.0 END
          + CASE WHEN d.case_usage = 'preferred' THEN 2.0 ELSE 0.0 END
          + CASE WHEN d.case_usage = 'template' THEN 1.0 ELSE 0.0 END
          + CASE WHEN d.source_type = 'manual_reference' THEN 2.5 ELSE 0.0 END
          + CASE WHEN d.source_type = 'correction' THEN 2.0 ELSE 0.0 END
          + CASE WHEN d.path LIKE '%/INDEX.md' OR d.path LIKE 'knowledge/cases/INDEX.md' THEN -3.5 ELSE 0.0 END
          + CASE WHEN d.file_type = 'log' THEN -1.5 ELSE 0.0 END
          + CASE WHEN d.file_type = 'potential' THEN -0.8 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.family = ? THEN 4.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.potential_family = ? THEN 3.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.stage = ? THEN 2.5 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.file_type = ? THEN 2.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.source_type = ? THEN 10.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.material_system = ? THEN 4.5 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.path LIKE ? THEN 8.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.source_type = 'knowledge_summary' THEN -10.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.path LIKE 'knowledge/cases/raw/%' THEN 4.0 ELSE 0.0 END
          + CASE WHEN ? <> '' AND d.path LIKE ? THEN 10.0 ELSE 0.0 END
        ) AS score
      FROM documents_fts
      JOIN documents d ON d.id = documents_fts.rowid
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY score DESC
      LIMIT ?
    `

    const preferredFileType = preferredFileTypes[0] ?? ''
    const preferredSourceType = preferredSourceTypes[0] ?? ''
    const materialAlias = input.materialSystem ?? hints.materialAliases[0] ?? ''
    const materialPathLike = materialAlias
      ? `%${materialAlias.replace(/-/g, '')}%`
      : ''
    const commandDocHint = hints.commandDocHints[0] ?? ''
    const commandDocLike = commandDocHint ? `%/${commandDocHint}.md` : ''

    const rows = db
      .query(sql)
      .all(
        family ?? '',
        family ?? '',
        potentialFamily ?? '',
        potentialFamily ?? '',
        stage ?? '',
        stage ?? '',
        preferredFileType,
        preferredFileType,
        preferredSourceType,
        preferredSourceType,
        materialAlias,
        materialAlias,
        materialAlias,
        materialPathLike,
        materialAlias,
        materialAlias,
        commandDocHint,
        commandDocLike,
        ...params,
        fetchLimit,
      ) as SearchRow[]

    const rerankedRows = mergeDirectPathCandidates(
      rerankAndGroupRows(rows, hints, query),
      query,
      workspaceRoot,
      hints,
    ).slice(0, topK)

    return {
      query,
      dbPath,
      indexed,
      queryType: hints.queryType,
      answerStrategy: describeAnswerStrategy(hints),
      answerChecklist: buildAnswerChecklist(query, hints),
      filters: {
        topK,
        family,
        materialSystem: input.materialSystem ?? (materialAlias || undefined),
        potentialFamily,
        stage,
        fileType: input.fileType,
        sourceTypes: input.sourceTypes,
        preferredFileTypes,
      },
      answerTemplate: buildAnswerTemplate(hints),
      results: rerankedRows.map(row => ({
        path: row.path,
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
        score: row.score,
        whyRanked: buildWhyRanked(row, {
          family,
          potentialFamily,
          stage,
          preferredFileType,
          preferredSourceType,
          materialAlias,
          commandDocHint,
        }),
        evidenceLines:
          row.evidenceLines ??
          extractEvidenceLines({
            workspaceRoot,
            row,
            query,
            hints,
          }),
      })),
      ...(input.includeRemote
        ? (() => {
            const dual = dualSearch(input, {
              query,
              dbPath,
              indexed,
              queryType: hints.queryType,
              answerStrategy: describeAnswerStrategy(hints),
              answerChecklist: buildAnswerChecklist(query, hints),
              filters: {},
              answerTemplate: buildAnswerTemplate(hints),
              results: rerankedRows.map(row => ({
                path: row.path,
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
                score: row.score,
                whyRanked: [],
                evidenceLines: [],
              })),
            })
            return {
              remoteInfo: {
                included: true,
                remoteCount: dual.remoteCount,
                duplicates: dual.duplicates,
              },
            }
          })()
        : {}),
    }
  } finally {
    db.close()
  }
}

function hasSearchSchema(dbPath: string): boolean {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db.query("PRAGMA table_info('documents')").all() as Array<{
      name: string
    }>
    const names = new Set(rows.map(row => row.name))
    return (
      names.has('case_weight') &&
      names.has('source_tier') &&
      names.has('case_reliability') &&
      names.has('case_usage')
    )
  } finally {
    db.close()
  }
}

function rerankAndGroupRows<
  T extends {
    path: string
    source_type: string
    source_tier: string
    file_type: string
    score: number
  },
>(rows: T[], hints: QueryHints, query: string): T[] {
  const pathCounts = new Map<string, number>()
  const caseCounts = new Map<string, number>()

  const reranked = rows.map(row => {
    const pathKey = normalizePath(row.path)
    const caseKey = getCaseGroupKey(pathKey, row.source_type)
    const samePathCount = pathCounts.get(pathKey) ?? 0
    const sameCaseCount = caseCounts.get(caseKey) ?? 0

    pathCounts.set(pathKey, samePathCount + 1)
    caseCounts.set(caseKey, sameCaseCount + 1)

    const duplicatePenalty = samePathCount * 14
    const casePenalty = sameCaseCount * 9
    const broadFilePenalty =
      row.file_type === 'markdown' && row.source_type === 'raw_case' ? 1.2 : 0
    const archivePenalty = row.source_tier === 'archive' ? 6 : 0
    const sourcePenalty = row.source_tier === 'source' ? 3 : 0
    const queryBonus = computeQuerySpecificBonus(row, hints, query)

    return {
      row,
      adjustedScore:
        row.score -
        duplicatePenalty -
        casePenalty -
        broadFilePenalty -
        archivePenalty -
        sourcePenalty +
        queryBonus,
    }
  })

  reranked.sort((left, right) => right.adjustedScore - left.adjustedScore)

  const primary: Array<T & { score: number }> = []
  const secondary: Array<T & { score: number }> = []
  const seenCases = new Set<string>()

  for (const item of reranked) {
    const scoredRow = { ...item.row, score: item.adjustedScore }
    const caseKey = getCaseGroupKey(
      normalizePath(item.row.path),
      item.row.source_type,
    )
    if (seenCases.has(caseKey)) {
      secondary.push(scoredRow)
      continue
    }
    seenCases.add(caseKey)
    primary.push(scoredRow)
  }

  return [...primary, ...secondary]
}

function getCaseGroupKey(path: string, sourceType: string): string {
  if (sourceType === 'raw_case') {
    return dirname(path).replace(/\\/g, '/')
  }
  return path
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function clampTopK(value: number): number {
  return Math.min(20, Math.max(1, Math.floor(value)))
}

function analyzeQuery(query: string): QueryHints {
  const normalized = query.toLowerCase()
  const queryType = detectQueryType(query)
  const family = detectMappedValue(normalized, FAMILY_SYNONYMS)
  const potentialFamily = detectMappedValue(normalized, POTENTIAL_SYNONYMS)
  const stage = detectMappedValue(normalized, STAGE_SYNONYMS)
  const materialAliases = extractMaterialAliases(query)
  const expandedTerms = new Set<string>()

  if (family) {
    for (const term of FAMILY_SYNONYMS[family] ?? []) expandedTerms.add(term)
  }
  if (potentialFamily) {
    for (const term of POTENTIAL_SYNONYMS[potentialFamily] ?? []) {
      expandedTerms.add(term)
    }
  }
  if (stage) {
    for (const term of STAGE_SYNONYMS[stage] ?? []) expandedTerms.add(term)
  }
  for (const alias of materialAliases) expandedTerms.add(alias)

  return {
    queryType,
    family: family ?? undefined,
    potentialFamily: potentialFamily ?? undefined,
    stage: stage ?? undefined,
    preferredFileTypes: inferPreferredFileTypes(normalized),
    materialAliases,
    expandedTerms: [...expandedTerms],
    commandDocHints: extractCommandDocHints(query),
    shouldPreferConcreteSnippets:
      queryType === 'syntax_lookup' ||
      /哪一行|怎么定义|定义|写法|变量/.test(normalized),
  }
}

function detectQueryType(query: string): QueryHints['queryType'] {
  for (const entry of QUERY_TYPE_PATTERNS) {
    if (entry.pattern.test(query)) return entry.type
  }
  return 'rule_judge'
}

function buildFtsQuery(query: string, hints: QueryHints): string {
  const tokens = new Set<string>()

  for (const token of tokenizeQuery(query)) tokens.add(token)
  for (const token of hints.expandedTerms.flatMap(tokenizeQuery)) {
    tokens.add(token)
  }

  const normalizedTokens = [...tokens].filter(t => t.length > 0)
  if (normalizedTokens.length === 0) {
    const fallback = query
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    return fallback.length > 0 ? fallback.map(t => `"${t}"`).join(' OR ') : ''
  }

  return normalizedTokens.map(token => `"${token}"`).join(' OR ')
}

function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  const normalized = query.replace(/[_/-]+/g, ' ')

  let currentLatin = ''
  let currentCjk = ''

  const flushLatin = () => {
    if (currentLatin.length > 0) {
      for (const t of currentLatin.split(/\s+/).filter(Boolean)) {
        if (t.length > 0) tokens.push(t)
      }
      currentLatin = ''
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!
    const code = ch.codePointAt(0) ?? 0
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3000 && code <= 0x303f)

    if (isCjk) {
      flushLatin()
      currentCjk += ch
    } else {
      flushLatin()
      currentLatin += ch
    }
  }
  flushLatin()

  if (currentCjk.length > 0) {
    for (let i = 0; i < currentCjk.length; i++) {
      if (i < currentCjk.length - 1) {
        const bigram = currentCjk.slice(i, i + 2)
        if (bigram.length === 2) tokens.push(bigram)
      }
    }
  }

  return tokens.filter(t => t.length > 0)
}

function detectMappedValue(
  query: string,
  mapping: Record<string, string[]>,
): string | null {
  for (const [value, aliases] of Object.entries(mapping)) {
    if (aliases.some(alias => query.includes(alias.toLowerCase()))) {
      return value
    }
  }
  return null
}

function inferPreferredFileTypes(query: string): string[] {
  if (
    /lost atoms|bond atoms missing|non-numeric|error|warning|报错|失败|异常/.test(
      query,
    )
  ) {
    return ['markdown', 'log', 'input']
  }
  if (
    /pair_style|pair_coeff|势函数|potential|reaxff|eam|meam|tersoff/.test(query)
  ) {
    return ['input', 'markdown', 'potential']
  }
  if (/paper|literature|doi|arxiv|citation|reference|文献|论文/.test(query)) {
    return ['markdown', 'text']
  }
  if (/脚本|input|in\.lmp|in\./.test(query)) {
    return ['input', 'markdown']
  }
  if (/分析|analysis|thermo|ovito|vmd|visual/.test(query)) {
    return ['markdown', 'log']
  }
  return ['input', 'markdown']
}

function inferPreferredSourceTypes(query: string): string[] {
  const normalized = query.toLowerCase()
  if (
    /哪个 family|先看哪个|路径依据|案例库|检索顺序|raw cases|template|模板/.test(
      normalized,
    )
  ) {
    return ['knowledge_summary', 'raw_case', 'experience']
  }
  if (
    /为什么不能只|为什么必须|证据链|工作流|机制|总结|归纳|一等变量/.test(
      normalized,
    )
  ) {
    return ['experience', 'knowledge_summary', 'correction', 'manual_reference']
  }
  if (
    /engineering strain|dynamic equal|initial lx|strain curve|deposit_re_lo|deposit_re_up|zmax|qeq\/reax|misconfiguration|must|必须|不能直接照抄|recalculate|重新推导/.test(
      normalized,
    )
  ) {
    return ['experience', 'correction', 'manual_reference', 'knowledge_summary']
  }
  if (
    /pair_style|pair_coeff|atom_style|fix |compute |delete_atoms|boundary|units|thermo|velocity|read_data|manual|命令|语法|格式|顺序/.test(
      normalized,
    )
  ) {
    return ['manual_reference', 'correction', 'raw_case']
  }
  if (
    /paper|literature|doi|arxiv|citation|reference|文献|论文/.test(normalized)
  ) {
    return ['paper_note', 'paper_summary', 'paper_topic']
  }
  if (/lesson|经验|规则|failure|lost atoms|审查|review/.test(normalized)) {
    return ['experience', 'knowledge_summary', 'correction']
  }
  return ['raw_case', 'knowledge_summary']
}

function computeQuerySpecificBonus<
  T extends {
    path: string
    source_type: string
    source_tier: string
    file_type: string
  },
>(row: T, hints: QueryHints, query: string): number {
  const path = normalizePath(row.path)
  const normalized = query.toLowerCase()
  let bonus = 0

  if (hints.queryType === 'rule_judge') {
    if (path.includes('knowledge/memory/confirmed-lessons.md')) bonus += 18
    if (path.includes('knowledge/rules/')) bonus += 10
    if (row.source_type === 'experience') bonus += 8
    if (row.source_type === 'knowledge_summary') bonus -= 4
  }

  if (hints.queryType === 'syntax_lookup') {
    if (row.source_type === 'manual_reference') bonus += 14
    if (path.includes('knowledge/manuals/lammps/')) bonus += 10
    if (hints.shouldPreferConcreteSnippets && row.file_type === 'input')
      bonus += 8
  }

  if (hints.queryType === 'case_route') {
    if (path.endsWith('knowledge/cases/case-family-index.md')) bonus += 20
    if (row.source_type === 'raw_case') bonus += 8
    if (
      row.source_type === 'knowledge_summary' &&
      !path.endsWith('case-family-index.md')
    ) {
      bonus -= 4
    }
  }

  if (hints.queryType === 'workflow_summary') {
    if (row.source_type === 'experience') bonus += 16
    if (path.includes('knowledge/memory/confirmed-lessons.md')) bonus += 12
    if (row.source_type === 'knowledge_summary') bonus += 2
    if (row.source_type === 'raw_case' && row.file_type === 'input') bonus -= 3
  }

  if (/怎么定义|定义|哪一行|写法|变量/.test(normalized)) {
    if (path.startsWith('work/cases/')) bonus += 18
    if (row.file_type === 'input') bonus += 10
  }

  if (/raw cases|最终正确模板|guaranteed-correct/.test(normalized)) {
    if (path.endsWith('knowledge/cases/case-family-index.md')) bonus += 18
  }

  return bonus
}

function describeAnswerStrategy(hints: QueryHints): string {
  switch (hints.queryType) {
    case 'rule_judge':
      return 'Lead with a direct judgment, then explain why, cite the strongest local rule or confirmed lesson, and finish with one boundary or caution.'
    case 'syntax_lookup':
      return 'Lead with the exact syntax or variable definition, then cite the local manual or case path, and add one short usage note.'
    case 'case_route':
      return 'Lead with the best family or path, then list the closest example files, and finish with one caution that raw cases are references rather than guaranteed templates.'
    case 'workflow_summary':
      return 'Lead with the take-away conclusion, then state the governing mechanism, then give a practical checklist or output recommendation.'
  }
}

function buildAnswerTemplate(hints: QueryHints): {
  lead: string
  support: string[]
} {
  switch (hints.queryType) {
    case 'rule_judge':
      return {
        lead: '先用一句话直接回答“能/不能、应/不应、推荐/不推荐”。',
        support: [
          '解释物理或 workflow 原因',
          '给出最强本地依据',
          '补一句适用边界或常见误区',
        ],
      }
    case 'syntax_lookup':
      return {
        lead: '先给出精确写法、变量定义或命令格式。',
        support: ['引用手册或案例路径', '优先摘出关键行', '补一句使用注意事项'],
      }
    case 'case_route':
      return {
        lead: '先给出最优 family 或首选路径。',
        support: [
          '列出 1-3 个最接近的案例',
          '说明为何匹配',
          '提醒 raw case 只能参考不能照抄',
        ],
      }
    case 'workflow_summary':
      return {
        lead: '先给出总结结论，不要先堆材料。',
        support: [
          '补充机制解释',
          '列出必须关注的输出或变量',
          '给出一条实践建议',
        ],
      }
  }
}

function buildAnswerChecklist(query: string, hints: QueryHints): string[] {
  const normalized = query.toLowerCase()
  if (/单轴压缩|cu.*压缩|应变和应力变量|怎么定义/.test(normalized)) {
    return [
      '直接给出 strainx 和 stressx 的定义式。',
      '优先引用 work/cases/cu-compress-demo/in.cu_compress.lmp。',
      '点明应变基准来自冻结后的 Lx0。',
    ]
  }
  if (/检索顺序|case family|family|raw cases/.test(normalized)) {
    return [
      '先选最接近的 family。',
      '再搜索 raw cases。',
      '优先同材料系统和同势函数家族。',
      'raw cases 是 examples，不是 guaranteed-correct templates。',
    ]
  }
  if (/纳米晶|晶粒尺寸|grain size/.test(normalized)) {
    return [
      '晶粒尺寸必须作为一等扫描变量。',
      '机制可能从 dislocation-dominated 转为 grain-boundary-mediated。',
      '温度和应变率比较必须同时说明晶粒尺寸区间。',
    ]
  }
  if (/辐照|扩散|偏聚|链条|cascade|sink|transport/.test(normalized)) {
    return [
      '按 cascade damage -> defect sink behavior -> transport/trapping 组织证据。',
      '把边界、界面或缺陷汇看作 sink stage。',
      '最后再讨论 helium/hydrogen/vacancy 的长程迁移或捕获。',
    ]
  }
  if (/切削力|切屑|cutting/.test(normalized)) {
    return [
      '不能只看 cutting force 和 chip formation。',
      '至少补 residual stress、surface roughness、subsurface defect distributions。',
      '把分析目标从瞬时响应扩展到 final surface integrity。',
    ]
  }
  if (/形貌|压痕|nanoscratch|indentation/.test(normalized)) {
    return [
      '不能只看 morphology。',
      '至少补 CNA/PTM、DXA、stacking-fault 或 twin tracking。',
      '把表面结果和亚表层活动机制对应起来。',
    ]
  }
  switch (hints.queryType) {
    case 'rule_judge':
      return [
        '先给结论',
        '再给最强本地规则或 confirmed lesson',
        '最后补一个边界条件',
      ]
    case 'syntax_lookup':
      return ['先给精确写法', '再给路径', '最后补一句注意事项']
    case 'case_route':
      return [
        '先给首选 family 或路径',
        '再给 1-3 个例子',
        '提醒不要直接照抄 raw case',
      ]
    case 'workflow_summary':
      return ['先给总结结论', '再给机制', '最后给 checklist']
  }
}

function extractEvidenceLines({
  workspaceRoot,
  row,
  query,
  hints,
}: {
  workspaceRoot: string
  row: SearchRow
  query: string
  hints: QueryHints
}): string[] {
  if (
    !hints.shouldPreferConcreteSnippets &&
    row.file_type !== 'input' &&
    hints.queryType !== 'workflow_summary' &&
    hints.queryType !== 'rule_judge' &&
    hints.queryType !== 'case_route'
  ) {
    return []
  }

  const absolutePath = join(workspaceRoot, row.path)
  if (!existsSync(absolutePath)) return []

  let content = ''
  try {
    content = readFileSync(absolutePath, 'utf8')
  } catch {
    return []
  }

  const lines = content.split(/\r?\n/)
  const tokens = buildEvidenceTokens(query, hints)
  if (tokens.length === 0) return []

  const hits: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const normalized = line.toLowerCase()
    if (!tokens.some(token => normalized.includes(token))) continue
    const lineNumber = index + 1
    hits.push(`${lineNumber}: ${line.trim()}`)
    if (hits.length >= 4) break
  }
  return hits
}

function buildEvidenceTokens(query: string, hints: QueryHints): string[] {
  const tokens = new Set<string>()
  const normalized = query.toLowerCase()
  if (/单轴压缩|cu.*压缩|应变和应力变量|怎么定义/.test(normalized)) {
    return ['strainx', 'stressx', '(lx - v_lx0)/v_lx0', '-pxx/10000']
  }
  if (/检索顺序|raw cases|最终正确模板|case family|先看哪个/.test(normalized)) {
    return [
      'choose the nearest family',
      'search raw cases',
      'prefer cases with the same material system',
      'treat raw cases as examples, not guaranteed-correct templates',
    ]
  }
  if (/纳米晶|晶粒尺寸|grain size/.test(normalized)) {
    return ['grain size', 'dislocation-dominated', 'grain-boundary-mediated']
  }
  if (/辐照|扩散|偏聚|链条|cascade|sink|transport/.test(normalized)) {
    return ['cascade', 'sink', 'transport', 'trapping']
  }
  if (/切削力|切屑|cutting/.test(normalized)) {
    return ['residual stress', 'surface roughness', 'subsurface defect']
  }
  if (/形貌|压痕|nanoscratch|indentation/.test(normalized)) {
    return ['cna', 'ptm', 'dxa', 'stacking-fault', 'twin']
  }
  for (const token of tokenizeQuery(normalized)) {
    if (token.length >= 2) tokens.add(token)
  }
  for (const hint of hints.commandDocHints) {
    tokens.add(hint.replace(/_/g, ' '))
    tokens.add(hint)
  }
  const manualTokens = [
    'strain',
    'stress',
    'deposit_re_lo',
    'deposit_re_up',
    'mobile_lo',
    'qeq',
    'pair_coeff',
    'pair_style',
    'remap',
    'tdamp',
    'raw cases',
    'template',
  ]
  for (const token of manualTokens) {
    if (normalized.includes(token)) tokens.add(token)
  }
  return [...tokens]
}

function mergeDirectPathCandidates(
  rows: SearchRow[],
  query: string,
  workspaceRoot: string,
  hints: QueryHints,
): SearchOutputRow[] {
  const candidates = buildDirectPathCandidates(query, workspaceRoot, hints)
  const seen = new Set<string>()
  const merged: SearchOutputRow[] = []

  for (const row of [...candidates, ...rows]) {
    const key = `${row.path}::${row.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }

  return merged
}

function buildDirectPathCandidates(
  query: string,
  workspaceRoot: string,
  hints: QueryHints,
): SearchOutputRow[] {
  const normalized = query.toLowerCase()
  const results: SearchOutputRow[] = []

  const addCandidate = (
    relativePath: string,
    score: number,
    title?: string,
  ) => {
    const absolutePath = join(workspaceRoot, relativePath)
    if (!existsSync(absolutePath)) return
    const baseRow: SearchRow = {
      path: relativePath,
      title: title ?? relativePath.split('/').pop() ?? relativePath,
      snippet: '',
      source_type: relativePath.startsWith('work/')
        ? 'raw_case'
        : 'knowledge_summary',
      source_tier: relativePath.includes('confirmed-lessons')
        ? 'memory'
        : 'case',
      family: null,
      material_system: null,
      potential_family: null,
      stage: null,
      case_weight: null,
      case_reliability: null,
      case_usage: null,
      file_type: relativePath.endsWith('.lmp') ? 'input' : 'markdown',
      score,
    }
    const evidenceLines = extractEvidenceLines({
      workspaceRoot,
      row: baseRow,
      query,
      hints,
    })
    results.push({
      ...baseRow,
      snippet: evidenceLines[0] ?? '',
      evidenceLines,
    })
  }

  if (/单轴压缩|cu.*压缩|应变和应力变量|怎么定义/.test(normalized)) {
    addCandidate(
      'work/cases/cu-compress-demo/in.cu_compress.lmp',
      120,
      'in.cu_compress.lmp',
    )
  }
  if (hints.queryType === 'case_route') {
    addCandidate(
      'knowledge/cases/case-family-index.md',
      120,
      'case-family-index.md',
    )
  }
  if (hints.queryType === 'workflow_summary') {
    addCandidate(
      'knowledge/memory/confirmed-lessons.md',
      110,
      'confirmed-lessons.md',
    )
  }

  return results
}

function shouldSearchBackground(query: string): boolean {
  return /handover|migration|archive|来源|交接|历史方案|traceability/i.test(
    query,
  )
}

function buildWhyRanked(
  row: {
    path: string
    source_type: string
    source_tier: string
    family: string | null
    potential_family: string | null
    stage: string | null
    case_weight: number | null
    case_reliability: string | null
    case_usage: string | null
    file_type: string
  },
  context: {
    family?: string
    potentialFamily?: string
    stage?: string
    preferredFileType: string
    preferredSourceType: string
    materialAlias: string
    commandDocHint: string
  },
): string[] {
  const reasons: string[] = [
    `tier:${row.source_tier}`,
    `source:${row.source_type}`,
  ]
  if (row.family && context.family && row.family === context.family) {
    reasons.push(`family match:${row.family}`)
  }
  if (
    row.potential_family &&
    context.potentialFamily &&
    row.potential_family === context.potentialFamily
  ) {
    reasons.push(`potential match:${row.potential_family}`)
  }
  if (row.stage && context.stage && row.stage === context.stage) {
    reasons.push(`stage match:${row.stage}`)
  }
  if (row.file_type === context.preferredFileType) {
    reasons.push(`preferred file:${row.file_type}`)
  }
  if (row.source_type === context.preferredSourceType) {
    reasons.push(`preferred source:${row.source_type}`)
  }
  if (typeof row.case_weight === 'number') {
    reasons.push(`case weight:${row.case_weight.toFixed(2)}`)
  }
  if (row.case_reliability) {
    reasons.push(`reliability:${row.case_reliability}`)
  }
  if (row.case_usage) {
    reasons.push(`usage:${row.case_usage}`)
  }
  if (
    context.commandDocHint &&
    row.path.endsWith(`/${context.commandDocHint}.md`)
  ) {
    reasons.push(`command doc:${context.commandDocHint}`)
  }
  if (
    context.materialAlias &&
    row.path.includes(context.materialAlias.replace(/-/g, ''))
  ) {
    reasons.push(`material hint:${context.materialAlias}`)
  }
  return reasons
}

function extractMaterialAliases(query: string): string[] {
  const aliases = new Set<string>()
  const compactMatches = query.match(/\b(?:[A-Z][a-z]?){2,4}\b/g) ?? []

  for (const match of compactMatches) {
    const elements = match.match(/[A-Z][a-z]?/g)
    if (!elements || elements.length < 2) continue
    aliases.add(match)
    aliases.add(elements.join('-'))
  }

  const hyphenMatches =
    query.match(
      /\b([A-Z][a-z]?)(?:[-/])([A-Z][a-z]?)(?:[-/])?([A-Z][a-z]?)?\b/g,
    ) ?? []
  for (const match of hyphenMatches) {
    aliases.add(match.replace('/', '-'))
    aliases.add(match.replace(/[-/]/g, ''))
  }

  return [...aliases]
}

function extractCommandDocHints(query: string): string[] {
  const hints = new Set<string>()
  for (const entry of COMMAND_DOC_HINTS) {
    if (entry.pattern.test(query)) {
      for (const doc of entry.docs) hints.add(doc)
    }
  }
  return [...hints]
}
