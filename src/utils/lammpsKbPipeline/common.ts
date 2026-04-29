import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'

export const LAMMPS_KB_PIPELINE_PLUGIN_NAME = 'lammps-kb-pipeline'
export const LAMMPS_KB_PIPELINE_MCP_SERVER_NAME = 'lammps-kb-pipeline'
export const LAMMPS_KB_PIPELINE_DB_BASENAME = 'lammps-kb-pipeline.sqlite'

export type PipelineStatus =
  | 'candidate'
  | 'confirmed'
  | 'pending_review'
  | 'quarantined'

export type PipelineContentType =
  | 'case'
  | 'case_note'
  | 'correction'
  | 'dialogue'
  | 'error'
  | 'experience'
  | 'input_script'
  | 'output_log'
  | 'potential_note'
  | 'qa'
  | 'rule'
  | 'template_snippet'
  | 'unknown'

export type PipelineQuality =
  | 'gold_candidate'
  | 'noise'
  | 'uncertain'
  | 'useful'

export function getWorkspaceRoot(): string {
  return resolve(process.env.LAMMPS_KB_PIPELINE_WORKSPACE_ROOT ?? process.cwd())
}

export function getProjectCacheDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(workspaceRoot, '.claude', 'cache')
}

export function getPipelineStateDir(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(workspaceRoot, '.claude', 'lammps-kb-pipeline')
}

export function getPipelineDbPath(workspaceRoot = getWorkspaceRoot()): string {
  return join(getProjectCacheDir(workspaceRoot), LAMMPS_KB_PIPELINE_DB_BASENAME)
}

export function getKnowledgeRoot(workspaceRoot = getWorkspaceRoot()): string {
  return join(workspaceRoot, 'knowledge')
}

export function getRulesDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'rules')
}

export function getMemoryDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'memory')
}

export function getCasesDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'cases')
}

export function getTemplatesDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'templates')
}

export function getTemplateAnswersDir(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(getTemplatesDir(workspaceRoot), 'answers')
}

export function getCorrectionsDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'corrections')
}

export function getPotentialsDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'potentials')
}

export function getReportsDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'reports')
}

export function getMaintenanceDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getKnowledgeRoot(workspaceRoot), 'maintenance')
}

export function getConfirmedLessonsPath(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(getMemoryDir(workspaceRoot), 'confirmed-lessons.md')
}

export function getPendingLessonsPath(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(getMemoryDir(workspaceRoot), 'pending-lessons.md')
}

export function getLearnedRulesPath(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(getRulesDir(workspaceRoot), 'learned-rules.md')
}

export function getIngestedKnowledgeIndexPath(
  workspaceRoot = getWorkspaceRoot(),
): string {
  return join(getMaintenanceDir(workspaceRoot), 'ingested-knowledge-index.md')
}

export function getCaseNotesDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getCasesDir(workspaceRoot), 'notes')
}

export function getCandidateDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getPipelineStateDir(workspaceRoot), 'candidate')
}

export function getQuarantineDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getPipelineStateDir(workspaceRoot), 'quarantine')
}

export function getReviewLogDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getPipelineStateDir(workspaceRoot), 'reviews')
}

export function getRawDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(getPipelineStateDir(workspaceRoot), 'raw')
}

export async function ensurePipelineDirs(
  workspaceRoot = getWorkspaceRoot(),
): Promise<void> {
  await Promise.all([
    mkdir(getProjectCacheDir(workspaceRoot), { recursive: true }),
    mkdir(getPipelineStateDir(workspaceRoot), { recursive: true }),
    mkdir(getRawDir(workspaceRoot), { recursive: true }),
    mkdir(getCandidateDir(workspaceRoot), { recursive: true }),
    mkdir(getQuarantineDir(workspaceRoot), { recursive: true }),
    mkdir(getReviewLogDir(workspaceRoot), { recursive: true }),
    mkdir(getKnowledgeRoot(workspaceRoot), { recursive: true }),
    mkdir(getRulesDir(workspaceRoot), { recursive: true }),
    mkdir(getMemoryDir(workspaceRoot), { recursive: true }),
    mkdir(getCasesDir(workspaceRoot), { recursive: true }),
    mkdir(getCaseNotesDir(workspaceRoot), { recursive: true }),
    mkdir(getTemplatesDir(workspaceRoot), { recursive: true }),
    mkdir(getTemplateAnswersDir(workspaceRoot), { recursive: true }),
    mkdir(getCorrectionsDir(workspaceRoot), { recursive: true }),
    mkdir(getPotentialsDir(workspaceRoot), { recursive: true }),
    mkdir(getReportsDir(workspaceRoot), { recursive: true }),
    mkdir(getMaintenanceDir(workspaceRoot), { recursive: true }),
  ])
}

export function normalizePathForDb(
  absolutePath: string,
  workspaceRoot = getWorkspaceRoot(),
): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/')
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  if (normalizedPath.startsWith(normalizedRoot + '/')) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function escapeYamlScalar(value: string): string {
  return JSON.stringify(value)
}
