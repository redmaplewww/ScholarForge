import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'

export const LAMMPS_KNOWLEDGE_PLUGIN_NAME = 'lammps-knowledge-search'
export const LAMMPS_KNOWLEDGE_MCP_SERVER_NAME = 'lammps-knowledge'
export const LAMMPS_KNOWLEDGE_DB_BASENAME = 'lammps-knowledge.sqlite'
export const REMOTE_DIR_NAME = '.knowledge-remote'

const PROJECT_ROOT_CANDIDATES = ['knowledge']

export function getWorkspaceRoot(): string {
  return resolve(process.env.LAMMPS_KNOWLEDGE_WORKSPACE_ROOT ?? process.cwd())
}

export function getProjectCacheDir(workspaceRoot = getWorkspaceRoot()): string {
  return join(workspaceRoot, '.claude', 'cache')
}

export function getKnowledgeDbPath(workspaceRoot = getWorkspaceRoot()): string {
  return join(getProjectCacheDir(workspaceRoot), LAMMPS_KNOWLEDGE_DB_BASENAME)
}

export function getKnowledgeRoots(
  workspaceRoot = getWorkspaceRoot(),
): string[] {
  return PROJECT_ROOT_CANDIDATES.map(candidate =>
    join(workspaceRoot, candidate),
  )
}

export function getRemoteDir(workspaceRoot = getWorkspaceRoot()): string {
  const mountPath = process.env.LAMMPS_KNOWLEDGE_REMOTE_PATH
  if (mountPath) return resolve(mountPath)
  return join(workspaceRoot, REMOTE_DIR_NAME)
}

export function getAllKnowledgeRoots(
  workspaceRoot = getWorkspaceRoot(),
): string[] {
  const localRoots = getKnowledgeRoots(workspaceRoot)
  const remoteDir = getRemoteDir(workspaceRoot)
  if (
    remoteDir &&
    existsSync(remoteDir) &&
    !localRoots.includes(remoteDir)
  ) {
    return [...localRoots, remoteDir]
  }
  return localRoots
}

export async function ensureKnowledgeCacheDir(
  workspaceRoot = getWorkspaceRoot(),
): Promise<string> {
  const dir = getProjectCacheDir(workspaceRoot)
  await mkdir(dir, { recursive: true })
  return dir
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
