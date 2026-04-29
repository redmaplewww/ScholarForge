import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  VersionManifest,
  VersionManifestFile,
  BackupResult,
} from './syncTypes.js'
import { getSyncStateDir, getWorkspaceRoot } from './remoteCommon.js'

const VERSIONS_DIR = 'versions'
const OBJECTS_DIR = 'objects'
const LATEST_FILE = 'latest-version.json'
const MAX_FULL_VERSIONS = 50
const DAILY_KEEP_AFTER_FULL = 30 * 24 * 60 * 60 * 1000

export async function createBackup(
  files: VersionManifestFile[],
  parentVersion: number | null,
  workspaceRoot = getWorkspaceRoot(),
): Promise<BackupResult> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const versionsDir = join(stateDir, VERSIONS_DIR)
  const objectsDir = join(stateDir, OBJECTS_DIR)

  await mkdir(versionsDir, { recursive: true })
  await mkdir(objectsDir, { recursive: true })

  const previousManifest = parentVersion !== null
    ? await loadVersionManifest(parentVersion, workspaceRoot)
    : null

  const changes = computeChanges(
    files,
    previousManifest?.files ?? [],
  )

  let sizeDelta = 0
  for (const file of files) {
    const existingObjPath = join(objectsDir, file.sha1.slice(0, 2), file.sha1)
    if (!existsSync(existingObjPath)) {
      sizeDelta += file.size
    }
  }

  const latestVersion = previousManifest?.version ?? 0
  const newVersion = latestVersion + 1

  const manifest: VersionManifest = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    checksum: '',
    files,
    parentVersion,
    changes,
  }
  manifest.checksum = computeManifestChecksum(manifest)

  const manifestPath = join(versionsDir, `v${newVersion}.json`)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  const latestPath = join(stateDir, LATEST_FILE)
  await writeFile(latestPath, JSON.stringify({ version: newVersion }, null, 2), 'utf8')

  await cleanupOldVersions(workspaceRoot)

  const allVersions = await listVersions(workspaceRoot)

  return {
    success: true,
    version: newVersion,
    filesChanged: changes.added.length + changes.modified.length + changes.deleted.length,
    sizeDelta,
    totalVersions: allVersions.length,
  }
}

export async function writeObject(
  sha1: string,
  content: Buffer | string,
  workspaceRoot = getWorkspaceRoot(),
): Promise<void> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const prefix = sha1.slice(0, 2)
  const dir = join(stateDir, OBJECTS_DIR, prefix)
  await mkdir(dir, { recursive: true })
  const objPath = join(dir, sha1)
  if (existsSync(objPath)) return
  await writeFile(objPath, content)
}

export async function readObject(
  sha1: string,
  workspaceRoot = getWorkspaceRoot(),
): Promise<Buffer | null> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const prefix = sha1.slice(0, 2)
  const objPath = join(stateDir, OBJECTS_DIR, prefix, sha1)
  if (!existsSync(objPath)) return null
  return readFile(objPath)
}

export async function loadVersionManifest(
  version: number,
  workspaceRoot = getWorkspaceRoot(),
): Promise<VersionManifest | null> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const manifestPath = join(stateDir, VERSIONS_DIR, `v${version}.json`)
  if (!existsSync(manifestPath)) return null
  const raw = await readFile(manifestPath, 'utf8')
  try {
    return JSON.parse(raw) as VersionManifest
  } catch {
    return null
  }
}

export async function getLatestVersion(
  workspaceRoot = getWorkspaceRoot(),
): Promise<number> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const latestPath = join(stateDir, LATEST_FILE)
  if (!existsSync(latestPath)) return 0
  try {
    const raw = await readFile(latestPath, 'utf8')
    const parsed = JSON.parse(raw) as { version: number }
    return parsed.version
  } catch {
    return 0
  }
}

export async function listVersions(
  workspaceRoot = getWorkspaceRoot(),
): Promise<Array<{ version: number; timestamp: string; filesChanged: number }>> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const versionsDir = join(stateDir, VERSIONS_DIR)
  if (!existsSync(versionsDir)) return []

  const entries = await readdir(versionsDir)
  const results: Array<{ version: number; timestamp: string; filesChanged: number }> = []

  for (const entry of entries) {
    if (!entry.startsWith('v') || !entry.endsWith('.json')) continue
    const raw = await readFile(join(versionsDir, entry), 'utf8').catch(() => '')
    if (!raw) continue
    try {
      const manifest = JSON.parse(raw) as VersionManifest
      results.push({
        version: manifest.version,
        timestamp: manifest.timestamp,
        filesChanged:
          manifest.changes.added.length +
          manifest.changes.modified.length +
          manifest.changes.deleted.length,
      })
    } catch {}
  }

  results.sort((a, b) => a.version - b.version)
  return results
}

export async function restoreVersion(
  version: number,
  targetDir: string,
  workspaceRoot = getWorkspaceRoot(),
): Promise<{ restored: number; errors: string[] }> {
  const manifest = await loadVersionManifest(version, workspaceRoot)
  if (!manifest) {
    return { restored: 0, errors: [`Version ${version} not found`] }
  }

  await mkdir(targetDir, { recursive: true })
  let restored = 0
  const errors: string[] = []

  for (const file of manifest.files) {
    const content = await readObject(file.sha1, workspaceRoot)
    if (!content) {
      errors.push(`Object ${file.sha1} for ${file.path} not found`)
      continue
    }
    const filePath = join(targetDir, file.path)
    const fileDir = join(filePath, '..')
    await mkdir(fileDir, { recursive: true })
    await writeFile(filePath, content)
    restored += 1
  }

  return { restored, errors }
}

function computeChanges(
  currentFiles: VersionManifestFile[],
  previousFiles: VersionManifestFile[],
): VersionManifest['changes'] {
  const currentMap = new Map(currentFiles.map(f => [f.path, f]))
  const previousMap = new Map(previousFiles.map(f => [f.path, f]))

  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []

  for (const [path, file] of currentMap) {
    const prev = previousMap.get(path)
    if (!prev) {
      added.push(path)
    } else if (prev.sha1 !== file.sha1) {
      modified.push(path)
    }
  }

  for (const path of previousMap.keys()) {
    if (!currentMap.has(path)) {
      deleted.push(path)
    }
  }

  return { added, modified, deleted }
}

function computeManifestChecksum(manifest: Omit<VersionManifest, 'checksum'>): string {
  const data = `${manifest.version}:${manifest.timestamp}:${manifest.files.map(f => `${f.path}:${f.sha1}`).join(',')}`
  return createHash('sha256').update(data).digest('hex')
}

async function cleanupOldVersions(
  workspaceRoot = getWorkspaceRoot(),
): Promise<void> {
  const versions = await listVersions(workspaceRoot)
  if (versions.length <= MAX_FULL_VERSIONS) return

  const now = Date.now()
  const toDelete: number[] = []

  for (let i = 0; i < versions.length - MAX_FULL_VERSIONS; i++) {
    const v = versions[i]!
    const vTime = new Date(v.timestamp).getTime()
    const age = now - vTime
    if (age > DAILY_KEEP_AFTER_FULL) {
      const dayKey = new Date(vTime).toISOString().slice(0, 10)
      const sameDay = versions
        .slice(0, versions.length - MAX_FULL_VERSIONS)
        .filter(
          other =>
            new Date(other.timestamp).toISOString().slice(0, 10) === dayKey,
        )
      if (sameDay.indexOf(v) < sameDay.length - 1) {
        toDelete.push(v.version)
      }
    }
  }

  const stateDir = getSyncStateDir(workspaceRoot)
  for (const version of toDelete) {
    const manifestPath = join(stateDir, VERSIONS_DIR, `v${version}.json`)
    const { unlink } = await import('fs/promises')
    await unlink(manifestPath).catch(() => {})
  }
}

export async function buildLocalManifest(
  knowledgeRoot: string,
  workspaceRoot = getWorkspaceRoot(),
): Promise<VersionManifestFile[]> {
  const files: VersionManifestFile[] = []
  if (!existsSync(knowledgeRoot)) return files

  await walkForManifest(knowledgeRoot, knowledgeRoot, files)
  return files
}

async function walkForManifest(
  dir: string,
  root: string,
  files: VersionManifestFile[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      await walkForManifest(fullPath, root, files)
      continue
    }
    if (!entry.isFile()) continue
    const fileStat = await stat(fullPath)
    const content = await readFile(fullPath)
    const sha1 = createHash('sha1').update(content).digest('hex')
    const relativePath = fullPath.slice(root.length + 1).replace(/\\/g, '/')
    files.push({
      path: relativePath,
      sha1,
      size: fileStat.size,
      mtime: Math.floor(fileStat.mtimeMs),
    })
  }
}
