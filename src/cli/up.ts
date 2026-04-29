import { readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { findGitRoot } from '../utils/git.js'

/**
 * `aura up` — run the "# aura up" section from the nearest ANGSHENG.md.
 *
 * Walks up from CWD looking for ANGSHENG.md files, extracts the section
 * under the `# aura up` heading, and executes it as a shell script.
 *
 * ANT-only command (USER_TYPE === "ant").
 */
export async function up(): Promise<void> {
  const cwd = process.cwd()
  const gitRoot = findGitRoot(cwd)
  const searchDirs = gitRoot ? [gitRoot, cwd] : [cwd]

  let upSection: string | null = null

  for (const dir of searchDirs) {
    const memoryPromptPath = join(dir, 'ANGSHENG.md')
    try {
      const content = readFileSync(memoryPromptPath, 'utf-8')
      upSection = extractUpSection(content)
      if (upSection) {
        console.log(`Found "# aura up" in ${memoryPromptPath}`)
        break
      }
    } catch {
      // File not found — continue searching
    }
  }

  if (!upSection) {
    console.log(
      'No "# aura up" section found in ANGSHENG.md.\n' +
        'Add a section like:\n\n' +
        '  # aura up\n' +
        '  ```bash\n' +
        '  npm install\n' +
        '  npm run build\n' +
        '  ```',
    )
    return
  }

  console.log('Running:\n')
  console.log(upSection)
  console.log()

  const result = spawnSync('bash', ['-c', upSection], {
    cwd,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`\naura up failed with exit code ${result.status}`)
    process.exitCode = result.status ?? 1
  } else {
    console.log('\naura up completed successfully.')
  }
}

/**
 * Extract the content under "# aura up" heading from markdown.
 * Returns the text between `# aura up` and the next `#` heading (or EOF).
 * Strips fenced code block markers if present.
 */
function extractUpSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  let inSection = false
  const sectionLines: string[] = []

  for (const line of lines) {
    if (/^#\s+claude\s+up\b/i.test(line)) {
      inSection = true
      continue
    }
    if (inSection && /^#\s/.test(line)) {
      break
    }
    if (inSection) {
      sectionLines.push(line)
    }
  }

  if (sectionLines.length === 0) return null

  // Strip fenced code block markers
  let text = sectionLines.join('\n').trim()
  text = text.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '')

  return text.trim() || null
}
