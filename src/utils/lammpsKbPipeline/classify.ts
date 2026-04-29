import type {
  PipelineContentType,
  PipelineQuality,
  PipelineStatus,
} from './common.js'

export type ClassificationInput = {
  content: string
  title?: string
  sourceType?: string
  sourcePath?: string
}

export type ClassificationResult = {
  contentType: PipelineContentType
  stage: string | null
  potentialFamily: string | null
  materialSystem: string | null
  quality: PipelineQuality
  status: PipelineStatus
  confidence: number
  reviewRequired: boolean
  tags: string[]
  summary: string
  reasons: string[]
}

const STAGE_SYNONYMS: Record<string, string[]> = {
  'WF-01': ['wf-01', 'model setup', '建模', 'structure', 'lattice'],
  'WF-02': ['wf-02', 'potential', 'pair_style', 'pair_coeff', '势函数'],
  'WF-03A': ['wf-03a', 'input', 'in.lmp', 'script', 'fix', 'run  ', 'thermo'],
  'WF-03B': ['wf-03b', 'slurm', 'pbs', 'sbatch', 'mpirun', 'submission'],
  'WF-04': ['wf-04', 'analysis', 'msd', 'rdf', 'stress', '分析', 'thermo'],
  'WF-05': ['wf-05', 'visualization', 'ovito', 'vmd', 'plot', '可视化'],
}

const POTENTIAL_SYNONYMS: Record<string, string[]> = {
  reaxff: ['reaxff', 'reax/c'],
  comb3: ['comb3'],
  meam: ['meam'],
  eam: ['eam', 'eam/alloy', 'eam/fs'],
  tersoff: ['tersoff'],
  airebo: ['airebo'],
  lj: ['lj/cut', 'lennard-jones'],
  hybrid: ['pair_style hybrid', 'pair_style hybrid/overlay', '混合势'],
}

const MATERIAL_ALIASES: Array<[string, string[]]> = [
  ['graphene', ['graphene', '石墨烯']],
  ['copper', ['cu', 'copper', '铜']],
  ['nickel', ['ni', 'nickel', '镍']],
  ['aluminum', ['al', 'aluminum', '铝']],
  ['magnesium', ['mg', 'magnesium', '镁']],
  ['mg-al', ['mg-al', 'mgal', 'magnesium aluminum', '镁铝', '镁铝合金']],
  ['ni-c', ['ni/c', 'ni-c', 'nickel carbon', '镍碳', 'nic']],
  ['tialnb', ['tialnb', 'ti-al-nb']],
  ['gan', ['gan', '氮化镓']],
  ['sic', ['sic', '碳化硅']],
]

const LAMMPS_TERMS = [
  'lammps',
  'pair_style',
  'pair_coeff',
  'fix ',
  'compute ',
  'thermo',
  'dump ',
  'read_data',
  'read_restart',
  'atom_style',
  'neighbor',
  'neigh_modify',
  'run ',
  'minimize',
  'units ',
  'boundary ',
  'region ',
  'group ',
  'velocity ',
  'log.lammps',
]

export function classifyContent(
  input: ClassificationInput,
): ClassificationResult {
  const text = input.content.trim()
  const normalized = `${input.title ?? ''}\n${input.sourcePath ?? ''}\n${text}`
    .toLowerCase()
    .replace(/\r/g, '')
  const reasons: string[] = []
  const lammpTermsHit = countHits(normalized, LAMMPS_TERMS)
  const isLammpsRelated =
    lammpTermsHit > 0 || /\blammps\b/i.test(input.sourceType ?? '')

  const contentType = detectContentType(normalized, input.sourceType)
  const stage = detectMappedValue(normalized, STAGE_SYNONYMS)
  const potentialFamily = detectMappedValue(normalized, POTENTIAL_SYNONYMS)
  const materialSystem = detectMaterialSystem(normalized)
  const summary = buildSummary(text)
  const tags = buildTags({
    contentType,
    stage,
    potentialFamily,
    materialSystem,
  })

  let confidence = 0.3
  if (isLammpsRelated) confidence += 0.25
  if (contentType !== 'unknown') confidence += 0.15
  if (stage) confidence += 0.08
  if (potentialFamily) confidence += 0.08
  if (materialSystem) confidence += 0.06
  if (text.length > 240) confidence += 0.08

  if (isLammpsRelated) {
    reasons.push('matched LAMMPS-specific vocabulary')
  } else {
    reasons.push('weak LAMMPS signal')
  }
  if (contentType !== 'unknown')
    reasons.push(`detected content type ${contentType}`)
  if (stage) reasons.push(`detected workflow stage ${stage}`)
  if (potentialFamily)
    reasons.push(`detected potential family ${potentialFamily}`)
  if (materialSystem) reasons.push(`detected material system ${materialSystem}`)

  let quality: PipelineQuality = 'uncertain'
  let status: PipelineStatus = 'pending_review'
  let reviewRequired = true

  if (!isMeaningful(text, isLammpsRelated)) {
    quality = 'noise'
    status = 'quarantined'
    reviewRequired = false
    confidence = Math.min(confidence, 0.42)
    reasons.push(
      'content is too weak or off-topic for the LAMMPS knowledge base',
    )
  } else if (
    contentType === 'experience' ||
    contentType === 'correction' ||
    contentType === 'qa'
  ) {
    quality = 'gold_candidate'
    status = 'pending_review'
    confidence += 0.12
    reasons.push(
      'high-reuse knowledge candidate requiring reviewer confirmation',
    )
  } else {
    quality = 'useful'
    if (confidence >= 0.8) {
      status = 'candidate'
      reviewRequired = false
      reasons.push(
        'classification confidence is high enough for candidate staging',
      )
    } else {
      status = 'pending_review'
      reasons.push('candidate is plausible but still needs review')
    }
  }

  confidence = clamp(confidence, 0, 0.98)

  return {
    contentType,
    stage,
    potentialFamily,
    materialSystem,
    quality,
    status,
    confidence,
    reviewRequired,
    tags,
    summary,
    reasons,
  }
}

function detectContentType(
  normalized: string,
  sourceType?: string,
): PipelineContentType {
  const source = (sourceType ?? '').toLowerCase()
  if (source.includes('dialog')) return 'dialogue'
  if (source.includes('answer') || source.includes('qa')) return 'qa'
  if (source.includes('case')) return 'case'
  if (source.includes('case-note')) return 'case_note'
  if (source.includes('correction')) return 'correction'
  if (source.includes('experience')) return 'experience'
  if (source.includes('log')) return 'output_log'
  if (source.includes('script')) return 'input_script'
  if (source.includes('potential')) return 'potential_note'
  if (source.includes('rule')) return 'rule'
  if (source.includes('template')) return 'template_snippet'

  if (/^\s*error:/m.test(normalized) || normalized.includes('last command:')) {
    return 'error'
  }
  if (normalized.includes('pair_style') || normalized.includes('read_data')) {
    return 'input_script'
  }
  if (
    normalized.includes('log.lammps') ||
    normalized.includes('thermo_style')
  ) {
    return 'output_log'
  }
  if (
    normalized.includes('经验') ||
    normalized.includes('lesson:') ||
    normalized.includes('best practice')
  ) {
    return 'experience'
  }
  if (
    normalized.includes('must ') ||
    normalized.includes('必须') ||
    normalized.includes('review rule') ||
    normalized.includes('检查要点') ||
    normalized.includes('执行规则')
  ) {
    return 'rule'
  }
  if (
    normalized.includes('纠错') ||
    normalized.includes('correct ') ||
    normalized.includes('should be')
  ) {
    return 'correction'
  }
  if (normalized.includes('case') || normalized.includes('案例')) {
    return 'case'
  }
  if (
    normalized.includes('question') ||
    normalized.includes('answer') ||
    normalized.includes('步骤') ||
    normalized.includes('建议')
  ) {
    return 'qa'
  }
  if (normalized.includes('template') || normalized.includes('模板')) {
    return 'template_snippet'
  }
  if (normalized.includes('user:') || normalized.includes('assistant:')) {
    return 'dialogue'
  }
  return 'unknown'
}

function detectMappedValue(
  normalized: string,
  mapping: Record<string, string[]>,
): string | null {
  for (const [key, aliases] of Object.entries(mapping)) {
    if (aliases.some(alias => normalized.includes(alias))) {
      return key
    }
  }
  return null
}

function detectMaterialSystem(normalized: string): string | null {
  const matches = MATERIAL_ALIASES.filter(([, aliases]) =>
    aliases.some(alias => hasAlias(normalized, alias)),
  ).map(([label]) => label)
  if (matches.length === 0) return null
  return matches.slice(0, 3).join('+')
}

function hasAlias(normalized: string, alias: string): boolean {
  const lowered = alias.toLowerCase()
  if (/^[a-z0-9+-]+$/.test(lowered) && lowered.length <= 4) {
    const escaped = lowered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalized)
  }
  return normalized.includes(lowered)
}

function buildSummary(text: string): string {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  return (lines[0] ?? text.slice(0, 160)).slice(0, 220)
}

function buildTags(values: {
  contentType: PipelineContentType
  stage: string | null
  potentialFamily: string | null
  materialSystem: string | null
}): string[] {
  return [
    values.contentType,
    values.stage,
    values.potentialFamily,
    values.materialSystem,
  ].filter((value): value is string => Boolean(value))
}

function isMeaningful(text: string, isLammpsRelated: boolean): boolean {
  if (text.length < 24) return false
  if (!isLammpsRelated && text.length < 120) return false
  const compact = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (['ok', 'thanks', '收到', '好的', '嗯', 'yes', 'no'].includes(compact)) {
    return false
  }
  return true
}

function countHits(normalized: string, terms: string[]): number {
  return terms.filter(term => normalized.includes(term)).length
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
