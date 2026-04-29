// @ts-nocheck
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Lesson = {
  id: string
  status: string
  category: string
  lesson: string
  evidence: string
  note: string
  source: string
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[`*_:#.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLessons(content: string, source: string): Lesson[] {
  const lines = content.split(/\r?\n/)
  const lessons: Lesson[] = []
  let current: Lesson | null = null
  for (const line of lines) {
    if (line.startsWith('## [')) {
      if (current) lessons.push(current)
      current = {
        id: line.replace(/^##\s*/, '').trim(),
        status: '',
        category: '',
        lesson: '',
        evidence: '',
        note: '',
        source,
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('- status:'))
      current.status = line.replace('- status:', '').trim()
    else if (line.startsWith('- category:'))
      current.category = line.replace('- category:', '').trim()
    else if (line.startsWith('- lesson:'))
      current.lesson = line.replace('- lesson:', '').trim()
    else if (line.startsWith('- evidence:'))
      current.evidence = line.replace('- evidence:', '').trim()
    else if (line.startsWith('- note:'))
      current.note = line.replace('- note:', '').trim()
  }
  if (current) lessons.push(current)
  return lessons.filter(item => item.lesson)
}

async function main() {
  const root = process.cwd()
  const maintenanceDir = resolve(root, 'knowledge/maintenance')
  await mkdir(maintenanceDir, { recursive: true })

  const confirmedPath = resolve(root, 'knowledge/memory/confirmed-lessons.md')
  const pendingPath = resolve(root, 'knowledge/memory/pending-lessons.md')
  const historicalPath = resolve(root, 'knowledge/memory/historical-lessons.md')
  const sessionPath = resolve(root, 'knowledge/memory/session-lessons.md')

  const confirmed = parseLessons(
    await readFile(confirmedPath, 'utf8'),
    'confirmed-lessons.md',
  )
  const pending = parseLessons(
    await readFile(pendingPath, 'utf8'),
    'pending-lessons.md',
  )

  const historical = await readFile(historicalPath, 'utf8')
  const session = await readFile(sessionPath, 'utf8')

  const normalizedSeen = new Map<string, Lesson[]>()
  for (const item of [...confirmed, ...pending]) {
    const key = normalize(item.lesson)
    const arr = normalizedSeen.get(key) || []
    arr.push(item)
    normalizedSeen.set(key, arr)
  }

  const duplicates = [...normalizedSeen.values()].filter(
    items => items.length > 1,
  )

  // DOMAIN: customize the promotion eligibility criteria and risky keyword patterns
  const promotionCandidates = pending.filter(item => {
    const evidenceCount = item.evidence
      ? item.evidence.split(';').filter(Boolean).length
      : 0
    // DOMAIN: define risky patterns that require manual review
    const risky = false
    return evidenceCount >= 2 && !risky
  })

  // DOMAIN: customize the manual review filter criteria
  const manualQueue: Lesson[] = []

  const report = `# Latest Knowledge Maintenance Report

- confirmed_count: ${confirmed.length}
- pending_count: ${pending.length}
- duplicate_candidate_groups: ${duplicates.length}
- promotion_candidates: ${promotionCandidates.length}
- manual_review_candidates: ${manualQueue.length}

## Source coverage

- historical_lessons_loaded: ${historical.length > 0 ? 'yes' : 'no'}
- session_lessons_loaded: ${session.length > 0 ? 'yes' : 'no'}

## Notes

- This report does not modify the active knowledge base.
- Use it as a pre-merge maintenance summary.
`

  const duplicateText = ['# Duplicate Candidates', '']
  if (duplicates.length === 0) {
    duplicateText.push('No duplicate candidates found.')
  } else {
    for (const group of duplicates) {
      duplicateText.push(`## ${group[0].lesson}`)
      for (const item of group) {
        duplicateText.push(`- ${item.id} | ${item.status} | ${item.source}`)
      }
      duplicateText.push('')
    }
  }

  const promotionText = ['# Candidate Promotions', '']
  if (promotionCandidates.length === 0) {
    promotionText.push('No auto-promotion candidates found.')
  } else {
    for (const item of promotionCandidates) {
      promotionText.push(`## ${item.id}`)
      promotionText.push(`- lesson: ${item.lesson}`)
      promotionText.push(`- evidence: ${item.evidence}`)
      promotionText.push(`- note: ${item.note}`)
      promotionText.push('')
    }
  }

  const manualText = ['# Manual Review Queue', '']
  if (manualQueue.length === 0) {
    manualText.push('No manual review candidates found.')
  } else {
    for (const item of manualQueue) {
      manualText.push(`## ${item.id}`)
      manualText.push(`- category: ${item.category}`)
      manualText.push(`- lesson: ${item.lesson}`)
      manualText.push(`- evidence: ${item.evidence}`)
      manualText.push(`- note: ${item.note}`)
      manualText.push('')
    }
  }

  await writeFile(resolve(maintenanceDir, 'latest-report.md'), report, 'utf8')
  await writeFile(
    resolve(maintenanceDir, 'duplicate-candidates.md'),
    duplicateText.join('\n'),
    'utf8',
  )
  await writeFile(
    resolve(maintenanceDir, 'candidate-promotions.md'),
    promotionText.join('\n'),
    'utf8',
  )
  await writeFile(
    resolve(maintenanceDir, 'manual-review-queue.md'),
    manualText.join('\n'),
    'utf8',
  )

  console.log('Knowledge maintenance reports updated in knowledge/maintenance/')
}

await main()

export {}
