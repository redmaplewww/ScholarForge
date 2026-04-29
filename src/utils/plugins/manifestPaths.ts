import { join } from 'path'
import { getFsImplementation } from '../fsOperations.js'

export const PRIMARY_PLUGIN_MANIFEST_DIR = '.angsheng-plugin'
export const LEGACY_PLUGIN_MANIFEST_DIR = '.claude-plugin'

export const PLUGIN_MANIFEST_DIR_CANDIDATES = [
  PRIMARY_PLUGIN_MANIFEST_DIR,
  LEGACY_PLUGIN_MANIFEST_DIR,
] as const

export function isPluginManifestDirName(name: string): boolean {
  return PLUGIN_MANIFEST_DIR_CANDIDATES.includes(
    name as (typeof PLUGIN_MANIFEST_DIR_CANDIDATES)[number],
  )
}

export function getPrimaryPluginManifestPath(
  rootDir: string,
  filename: string,
): string {
  return join(rootDir, PRIMARY_PLUGIN_MANIFEST_DIR, filename)
}

export function getPluginManifestPathCandidates(
  rootDir: string,
  filename: string,
): string[] {
  return PLUGIN_MANIFEST_DIR_CANDIDATES.map(dir => join(rootDir, dir, filename))
}

export function findExistingPluginManifestPath(
  rootDir: string,
  filename: string,
): string {
  const fs = getFsImplementation()
  return (
    getPluginManifestPathCandidates(rootDir, filename).find(path =>
      fs.existsSync(path),
    ) ?? getPrimaryPluginManifestPath(rootDir, filename)
  )
}

export function getDefaultMarketplaceManifestRelativePath(): string {
  return `${PRIMARY_PLUGIN_MANIFEST_DIR}/marketplace.json`
}

export function getDefaultPluginManifestRelativePath(): string {
  return `${PRIMARY_PLUGIN_MANIFEST_DIR}/plugin.json`
}
