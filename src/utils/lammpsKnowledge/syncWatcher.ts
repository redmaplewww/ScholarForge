import { existsSync, watch } from 'fs'
import { getRemoteDir, getSyncConfig } from './remoteCommon.js'
import { getWorkspaceRoot } from './common.js'

type WatcherState = {
  timer: ReturnType<typeof setTimeout> | null
  watcher: ReturnType<typeof watch> | null
  running: boolean
}

let state: WatcherState = {
  timer: null,
  watcher: null,
  running: false,
}

export function startSyncWatcher(
  workspaceRoot = getWorkspaceRoot(),
): void {
  if (state.running) return

  const config = getSyncConfig()
  if (!config.autoSync) return

  const remoteDir = getRemoteDir(workspaceRoot)
  if (!existsSync(remoteDir)) return

  state.running = true

  state.watcher = watch(remoteDir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    if (filename.startsWith('.git') || filename.startsWith('node_modules')) return

    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      triggerSync(workspaceRoot).catch(() => {})
    }, config.syncIntervalMs)
  })

  process.on('SIGINT', () => stopSyncWatcher())
  process.on('SIGTERM', () => stopSyncWatcher())
}

export function stopSyncWatcher(): void {
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (state.watcher) {
    state.watcher.close()
    state.watcher = null
  }
  state.running = false
}

export function isSyncWatcherRunning(): boolean {
  return state.running
}

async function triggerSync(workspaceRoot: string): Promise<void> {
  try {
    const { updateRemoteKnowledgeIndexIncrementally } = await import('./remoteIndexer.js')
    await updateRemoteKnowledgeIndexIncrementally({ workspaceRoot })
  } catch {}
}
