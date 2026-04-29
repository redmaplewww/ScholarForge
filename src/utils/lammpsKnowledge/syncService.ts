import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import type {
  SyncPullResult,
  SyncPushResult,
  SyncStatus,
  VersionManifestFile,
  VersionManifest,
} from './syncTypes.js'
import {
  getRemoteDir,
  getRemoteDbPath,
  getSyncConfig,
  getSyncStateDir,
  getWorkspaceRoot,
  isRemoteConfigured,
} from './remoteCommon.js'
import {
  buildRemoteKnowledgeIndex,
  updateRemoteKnowledgeIndexIncrementally,
  getRemoteIndexStatus,
} from './remoteIndexer.js'
import {
  buildLocalManifest,
  createBackup,
  getLatestVersion,
  loadVersionManifest,
  writeObject,
  readObject,
} from './backupManager.js'
import { getKnowledgeIndexStatus } from './indexer.js'
import { getKnowledgeRoots } from './common.js'

export async function pullFromRemote(
  workspaceRoot = getWorkspaceRoot(),
): Promise<SyncPullResult> {
  const config = getSyncConfig()
  if (!isRemoteConfigured()) {
    return {
      success: false,
      pulled: 0,
      skipped: 0,
      conflicts: [],
      newVersion: 0,
      error: 'Remote not configured. Set LAMMPS_KNOWLEDGE_REMOTE_URL.',
    }
  }

  try {
    const remoteDir = getRemoteDir(workspaceRoot)
    await mkdir(remoteDir, { recursive: true })

    const localVersion = await getLatestVersion(workspaceRoot)
    const statusResponse = await apiGet(config, '/knowledge/status')
    if (!statusResponse.ok) {
      return {
        success: false,
        pulled: 0,
        skipped: 0,
        conflicts: [],
        newVersion: localVersion,
        error: `Server returned ${statusResponse.status}`,
      }
    }

    const serverStatus = (await statusResponse.json()) as {
      version: number
      fileCount: number
    }
    const remoteVersion = serverStatus.version

    if (remoteVersion <= localVersion) {
      return {
        success: true,
        pulled: 0,
        skipped: 0,
        conflicts: [],
        newVersion: localVersion,
      }
    }

    const pullUrl = `/knowledge/pull?since_version=${localVersion}`
    const pullResponse = await apiGet(config, pullUrl)
    if (!pullResponse.ok) {
      return {
        success: false,
        pulled: 0,
        skipped: 0,
        conflicts: [],
        newVersion: localVersion,
        error: `Pull failed: ${pullResponse.status}`,
      }
    }

    const pullData = (await pullResponse.json()) as {
      version: number
      manifest: VersionManifest
      objects: Record<string, string>
    }

    let pulled = 0
    let skipped = 0
    const conflicts: SyncPullResult['conflicts'] = []

    const localFiles = await buildLocalManifest(remoteDir, workspaceRoot)
    const localMap = new Map(localFiles.map(f => [f.path, f]))

    for (const file of pullData.manifest.files) {
      const objectContent = pullData.objects[file.sha1]
      if (!objectContent) {
        skipped += 1
        continue
      }

      const localFile = localMap.get(file.path)
      if (localFile && localFile.sha1 !== file.sha1) {
        const existingContent = await readFile(join(remoteDir, file.path), 'utf8').catch(() => '')
        const existingSha1 = createHash('sha1').update(existingContent).digest('hex')
        if (existingSha1 !== file.sha1 && existingContent.length > 0) {
          conflicts.push({
            path: file.path,
            localSha1: existingSha1,
            remoteSha1: file.sha1,
          })
          skipped += 1
          continue
        }
      }

      const filePath = join(remoteDir, file.path)
      const fileDir = join(filePath, '..')
      await mkdir(fileDir, { recursive: true })
      await writeFile(filePath, Buffer.from(objectContent, 'base64'))
      await writeObject(file.sha1, objectContent, workspaceRoot)
      pulled += 1
    }

    for (const deletedPath of pullData.manifest.changes.deleted) {
      const filePath = join(remoteDir, deletedPath)
      if (existsSync(filePath)) {
        await unlink(filePath).catch(() => {})
      }
    }

    await updateRemoteKnowledgeIndexIncrementally({ workspaceRoot })

    return {
      success: true,
      pulled,
      skipped,
      conflicts,
      newVersion: pullData.version,
    }
  } catch (error) {
    return {
      success: false,
      pulled: 0,
      skipped: 0,
      conflicts: [],
      newVersion: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function pushToRemote(
  workspaceRoot = getWorkspaceRoot(),
): Promise<SyncPushResult> {
  const config = getSyncConfig()
  if (!isRemoteConfigured()) {
    return {
      success: false,
      pushed: 0,
      skipped: 0,
      newVersion: 0,
      backupCreated: false,
      error: 'Remote not configured. Set LAMMPS_KNOWLEDGE_REMOTE_URL.',
    }
  }

  try {
    const knowledgeRoots = getKnowledgeRoots(workspaceRoot)
    const allFiles: VersionManifestFile[] = []
    for (const root of knowledgeRoots) {
      const files = await buildLocalManifest(root, workspaceRoot)
      allFiles.push(...files)
    }

    const localVersion = await getLatestVersion(workspaceRoot)
    const previousManifest = localVersion > 0
      ? await loadVersionManifest(localVersion, workspaceRoot)
      : null

    const previousMap = new Map(
      (previousManifest?.files ?? []).map(f => [f.path, f]),
    )

    const changedFiles = allFiles.filter(f => {
      const prev = previousMap.get(f.path)
      return !prev || prev.sha1 !== f.sha1
    })

    if (changedFiles.length === 0) {
      return {
        success: true,
        pushed: 0,
        skipped: allFiles.length,
        newVersion: localVersion,
        backupCreated: false,
      }
    }

    const objects: Record<string, string> = {}
    for (const file of changedFiles) {
      const knowledgeRoot = knowledgeRoots.find(r => {
        const absPath = join(r, file.path)
        return existsSync(absPath)
      })
      if (!knowledgeRoot) continue

      const content = await readFile(join(knowledgeRoot, file.path))
      objects[file.sha1] = content.toString('base64')
      await writeObject(file.sha1, content, workspaceRoot)
    }

    const pushResponse = await apiPost(config, '/knowledge/push', {
      version: localVersion,
      files: allFiles,
      objects,
    })

    if (!pushResponse.ok) {
      return {
        success: false,
        pushed: 0,
        skipped: 0,
        newVersion: localVersion,
        backupCreated: false,
        error: `Push failed: ${pushResponse.status}`,
      }
    }

    const pushData = (await pushResponse.json()) as { version: number }
    const newVersion = pushData.version

    const backup = await createBackup(allFiles, localVersion, workspaceRoot)

    return {
      success: true,
      pushed: changedFiles.length,
      skipped: allFiles.length - changedFiles.length,
      newVersion,
      backupCreated: backup.success,
    }
  } catch (error) {
    return {
      success: false,
      pushed: 0,
      skipped: 0,
      newVersion: 0,
      backupCreated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getSyncStatus(
  workspaceRoot = getWorkspaceRoot(),
): Promise<SyncStatus> {
  const localStatus = getKnowledgeIndexStatus(workspaceRoot)
  const remoteStatus = getRemoteIndexStatus(workspaceRoot)
  const localVersion = await getLatestVersion(workspaceRoot)

  let remoteVersion: number | null = null
  let lastSyncAt: string | null = null

  if (isRemoteConfigured()) {
    try {
      const config = getSyncConfig()
      const response = await apiGet(config, '/knowledge/status')
      if (response.ok) {
        const data = (await response.json()) as {
          version: number
          lastModified: string
        }
        remoteVersion = data.version
        lastSyncAt = data.lastModified
      }
    } catch {}
  }

  const stateDir = getSyncStateDir(workspaceRoot)
  const lastSyncFile = join(stateDir, 'last-sync.json')
  if (existsSync(lastSyncFile)) {
    try {
      const raw = await readFile(lastSyncFile, 'utf8')
      const parsed = JSON.parse(raw) as { lastSyncAt: string }
      lastSyncAt = parsed.lastSyncAt
    } catch {}
  }

  return {
    localVersion,
    remoteVersion,
    localIndexed: localStatus.exists,
    remoteIndexed: remoteStatus.exists,
    localFileCount: localStatus.sourceFileCount,
    remoteFileCount: remoteStatus.sourceFileCount,
    pendingPush: 0,
    pendingPull:
      remoteVersion !== null && localVersion !== null
        ? Math.max(0, remoteVersion - localVersion)
        : 0,
    lastSyncAt,
  }
}

export async function recordSyncTimestamp(
  workspaceRoot = getWorkspaceRoot(),
): Promise<void> {
  const stateDir = getSyncStateDir(workspaceRoot)
  const lastSyncFile = join(stateDir, 'last-sync.json')
  await writeFile(
    lastSyncFile,
    JSON.stringify({ lastSyncAt: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

async function apiGet(config: { remoteUrl: string; token: string }, path: string): Promise<Response> {
  return fetch(`${config.remoteUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/json',
    },
  })
}

async function apiPost(
  config: { remoteUrl: string; token: string },
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${config.remoteUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
