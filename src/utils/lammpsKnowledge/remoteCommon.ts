import { existsSync } from 'fs'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getWorkspaceRoot, getRemoteDir } from './common.js'
import type { SyncConfig } from './syncTypes.js'

export { getWorkspaceRoot, getRemoteDir } from './common.js'

export const REMOTE_DB_BASENAME = 'lammps-knowledge-remote.sqlite'
export const REMOTE_STATE_DIR_NAME = '.knowledge-sync-state'
export const LOCAL_MANIFEST_FILE = 'local-manifest.json'

const DEFAULT_MAX_VERSIONS = 50
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000

export function getRemoteKnowledgeRoots(
  workspaceRoot: string = getWorkspaceRoot(),
): string[] {
  const remoteDir = getRemoteDir(workspaceRoot)
  if (!existsSync(remoteDir)) return []
  return [remoteDir]
}

export function getRemoteDbPath(
  workspaceRoot: string = getWorkspaceRoot(),
): string {
  return join(workspaceRoot, '.claude', 'cache', REMOTE_DB_BASENAME)
}

export function getSyncStateDir(
  workspaceRoot: string = getWorkspaceRoot(),
): string {
  const dir = join(workspaceRoot, REMOTE_STATE_DIR_NAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getLocalManifestPath(
  workspaceRoot: string = getWorkspaceRoot(),
): string {
  return join(getSyncStateDir(workspaceRoot), LOCAL_MANIFEST_FILE)
}

export function getSyncConfig(): SyncConfig {
  return {
    remoteUrl: process.env.LAMMPS_KNOWLEDGE_REMOTE_URL ?? '',
    token: process.env.LAMMPS_KNOWLEDGE_REMOTE_TOKEN ?? '',
    autoSync: process.env.LAMMPS_KNOWLEDGE_AUTO_SYNC !== 'false',
    syncIntervalMs: Number(
      process.env.LAMMPS_KNOWLEDGE_SYNC_INTERVAL_MS ?? DEFAULT_SYNC_INTERVAL_MS,
    ),
    remoteMountPath: process.env.LAMMPS_KNOWLEDGE_REMOTE_PATH ?? null,
    maxVersions: Number(
      process.env.LAMMPS_KNOWLEDGE_MAX_VERSIONS ?? DEFAULT_MAX_VERSIONS,
    ),
  }
}

export function isRemoteConfigured(): boolean {
  return (process.env.LAMMPS_KNOWLEDGE_REMOTE_URL ?? '').length > 0
}

export function normalizePathForRemote(
  absolutePath: string,
  remoteDir: string,
): string {
  const normalizedRoot = remoteDir.replace(/\\/g, '/')
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  if (normalizedPath.startsWith(normalizedRoot + '/')) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}
