import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setOriginalCwd,
  setProjectRoot,
} from '../bootstrap/state'
import {
  getSystemContext,
  getUserContext,
  setSystemPromptInjection,
} from '../context'
import { clearMemoryFileCaches } from '../utils/memoryFiles'
import { cleanupTempDir, createTempDir, writeTempFile } from '../../tests/mocks/file-system'

let tempDir = ''
let projectMemoryPromptContent = ''

beforeEach(async () => {
  tempDir = await createTempDir('context-baseline-')
  projectMemoryPromptContent = `baseline-${Date.now()}`

  resetStateForTests()
  setOriginalCwd(tempDir)
  setProjectRoot(tempDir)
  await writeTempFile(tempDir, 'ANGSHENG.md', projectMemoryPromptContent)

  clearMemoryFileCaches()
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  setSystemPromptInjection(null)
  delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS
})

afterEach(async () => {
  clearMemoryFileCaches()
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  setSystemPromptInjection(null)
  delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS
  resetStateForTests()
  if (tempDir) {
    await cleanupTempDir(tempDir)
  }
})

describe('context baseline', () => {
  test('getUserContext includes currentDate and project ANGSHENG.md content', async () => {
    const ctx = await getUserContext()

    expect(ctx.currentDate).toContain("Today's date is")
    expect(ctx.memoryPrompt).toContain(projectMemoryPromptContent)
  })

  test('CLAUDE_CODE_DISABLE_CLAUDE_MDS suppresses memoryPrompt loading', async () => {
    process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'

    const ctx = await getUserContext()

    expect(ctx.currentDate).toContain("Today's date is")
    expect(ctx.memoryPrompt).toBeUndefined()
  })

  test('setSystemPromptInjection clears the memoized user-context cache', async () => {
    const first = await getUserContext()
    process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'

    const second = await getUserContext()
    expect(first.memoryPrompt).toContain(projectMemoryPromptContent)
    expect(second.memoryPrompt).toContain(projectMemoryPromptContent)

    setSystemPromptInjection('cache-break')

    const third = await getUserContext()
    expect(third.memoryPrompt).toBeUndefined()
  })

  test('getSystemContext reflects system prompt injection after cache invalidation', async () => {
    const first = await getSystemContext()
    expect(first.gitStatus).toBeUndefined()
    expect(first.cacheBreaker).toBeUndefined()

    setSystemPromptInjection('baseline-cache-break')

    const second = await getSystemContext()
    if ('cacheBreaker' in second) {
      expect(second.cacheBreaker).toContain('baseline-cache-break')
    } else {
      expect(second.gitStatus).toBeUndefined()
    }
  })
})
