import { z } from 'zod/v4'

export type VersionManifestFile = {
  path: string
  sha1: string
  size: number
  mtime: number
}

export type VersionManifestChanges = {
  added: string[]
  modified: string[]
  deleted: string[]
}

export type VersionManifest = {
  version: number
  timestamp: string
  checksum: string
  files: VersionManifestFile[]
  parentVersion: number | null
  changes: VersionManifestChanges
}

export const VersionManifestFileSchema = z.object({
  path: z.string(),
  sha1: z.string(),
  size: z.number(),
  mtime: z.number(),
})

export const VersionManifestChangesSchema = z.object({
  added: z.array(z.string()),
  modified: z.array(z.string()),
  deleted: z.array(z.string()),
})

export const VersionManifestSchema = z.object({
  version: z.number(),
  timestamp: z.string(),
  checksum: z.string(),
  files: z.array(VersionManifestFileSchema),
  parentVersion: z.number().nullable(),
  changes: VersionManifestChangesSchema,
})

export type SyncPullResult = {
  success: boolean
  pulled: number
  skipped: number
  conflicts: Array<{ path: string; localSha1: string; remoteSha1: string }>
  newVersion: number
  error?: string
}

export type SyncPushResult = {
  success: boolean
  pushed: number
  skipped: number
  newVersion: number
  backupCreated: boolean
  error?: string
}

export type BackupResult = {
  success: boolean
  version: number
  filesChanged: number
  sizeDelta: number
  totalVersions: number
  error?: string
}

export type SyncStatus = {
  localVersion: number | null
  remoteVersion: number | null
  localIndexed: boolean
  remoteIndexed: boolean
  localFileCount: number
  remoteFileCount: number
  pendingPush: number
  pendingPull: number
  lastSyncAt: string | null
}

export type RemoteObjectRef = {
  sha1: string
  exists: boolean
}

export type SyncConfig = {
  remoteUrl: string
  token: string
  autoSync: boolean
  syncIntervalMs: number
  remoteMountPath: string | null
  maxVersions: number
}

export const SyncPullResultSchema = z.object({
  success: z.boolean(),
  pulled: z.number(),
  skipped: z.number(),
  conflicts: z.array(z.object({
    path: z.string(),
    localSha1: z.string(),
    remoteSha1: z.string(),
  })),
  newVersion: z.number(),
  error: z.string().optional(),
})

export const SyncPushResultSchema = z.object({
  success: z.boolean(),
  pushed: z.number(),
  skipped: z.number(),
  newVersion: z.number(),
  backupCreated: z.boolean(),
  error: z.string().optional(),
})

export const SyncStatusSchema = z.object({
  localVersion: z.number().nullable(),
  remoteVersion: z.number().nullable(),
  localIndexed: z.boolean(),
  remoteIndexed: z.boolean(),
  localFileCount: z.number(),
  remoteFileCount: z.number(),
  pendingPush: z.number(),
  pendingPull: z.number(),
  lastSyncAt: z.string().nullable(),
})
