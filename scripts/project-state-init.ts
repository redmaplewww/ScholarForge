// @ts-nocheck
import { mkdir, readFile, access, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  const targetDir = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(process.cwd(), '.project')

  const templates = [
    ['project.json', '.project/templates/project.json'],
    ['execution.json', '.project/templates/execution.json'],
    ['stage-summary.md', '.project/templates/stage-summary.md'],
    ['review-log.md', '.project/templates/review-log.md'],
    ['open-issues.md', '.project/templates/open-issues.md'],
    ['decisions.md', '.project/templates/decisions.md'],
  ] as const

  await mkdir(targetDir, { recursive: true })
  await mkdir(resolve(targetDir, 'runs'), { recursive: true })

  for (const [name, templatePath] of templates) {
    const dest = resolve(targetDir, name)
    if (await exists(dest)) continue
    try {
      const content = await readFile(
        resolve(process.cwd(), templatePath),
        'utf8',
      )
      await writeFile(dest, content, 'utf8')
    } catch {
      await writeFile(dest, '', 'utf8')
    }
  }

  console.log(`Initialized project state in ${targetDir}`)
}

await main()
export {}
