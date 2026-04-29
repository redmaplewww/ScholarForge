import { join } from 'path'

export const PRIMARY_CONFIG_DIRNAME = '.angsheng'
export const LEGACY_CONFIG_DIRNAME = '.angsheng'

export const PRIMARY_MEMORY_FILENAME = 'ANGSHENG.md'
export const LEGACY_MEMORY_FILENAME = 'ANGSHENG.md'

export const PRIMARY_LOCAL_MEMORY_FILENAME = 'ANGSHENG.local.md'
export const LEGACY_LOCAL_MEMORY_FILENAME = 'ANGSHENG.local.md'

export function getPrimaryProjectConfigDir(root: string): string {
  return join(root, PRIMARY_CONFIG_DIRNAME)
}

export function getLegacyProjectConfigDir(root: string): string {
  return join(root, LEGACY_CONFIG_DIRNAME)
}

export function getProjectConfigDirCandidates(root: string): string[] {
  return [getPrimaryProjectConfigDir(root), getLegacyProjectConfigDir(root)]
}

export function getProjectMemoryPathCandidates(root: string): string[] {
  return [join(root, PRIMARY_MEMORY_FILENAME), join(root, LEGACY_MEMORY_FILENAME)]
}

export function getProjectLocalMemoryPathCandidates(root: string): string[] {
  return [
    join(root, PRIMARY_LOCAL_MEMORY_FILENAME),
    join(root, LEGACY_LOCAL_MEMORY_FILENAME),
  ]
}

export function getProjectScopedMemoryPathCandidates(root: string): string[] {
  return [
    join(getPrimaryProjectConfigDir(root), PRIMARY_MEMORY_FILENAME),
    join(getLegacyProjectConfigDir(root), LEGACY_MEMORY_FILENAME),
  ]
}

export function getProjectRulesDirCandidates(root: string): string[] {
  return [
    join(getPrimaryProjectConfigDir(root), 'rules'),
    join(getLegacyProjectConfigDir(root), 'rules'),
  ]
}

export function getProjectSettingsPathCandidates(
  root: string,
  filename: 'settings.json' | 'settings.local.json',
): string[] {
  return [
    join(getPrimaryProjectConfigDir(root), filename),
    join(getLegacyProjectConfigDir(root), filename),
  ]
}

export function isMemoryFilename(name: string): boolean {
  return (
    name === PRIMARY_MEMORY_FILENAME ||
    name === LEGACY_MEMORY_FILENAME ||
    name === PRIMARY_LOCAL_MEMORY_FILENAME ||
    name === LEGACY_LOCAL_MEMORY_FILENAME
  )
}

export function pickPreferredPath(
  candidates: string[],
  existsSync: (path: string) => boolean,
): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return candidates[0] ?? ''
}
