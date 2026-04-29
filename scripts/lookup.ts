// @ts-nocheck
import { searchKnowledge } from '../src/knowledge/search.js'
import { synthesizeKnowledgeAnswer } from '../src/knowledge/synthesize.js'

function parseArgs(argv: string[]) {
  const topKIndex = argv.findIndex(arg => arg === '--topK')
  const topK =
    topKIndex >= 0 && argv[topKIndex + 1]
      ? Number(argv[topKIndex + 1])
      : undefined
  const filtered = argv.filter(
    (arg, index) => index !== topKIndex && index !== topKIndex + 1,
  )
  return { topK, prompt: filtered.join(' ').trim() }
}

export async function main() {
  const { topK, prompt } = parseArgs(Bun.argv.slice(1))
  if (!prompt) {
    process.stderr.write(
      'Usage: bun run scripts/lookup.ts [--topK N] <prompt>\n',
    )
    process.exit(1)
  }
  const result = await searchKnowledge({ query: prompt, topK: topK ?? 6 })
  const answer = synthesizeKnowledgeAnswer(result)
  process.stdout.write(`${answer}\n`)
}

if (import.meta.main) {
  await main()
}
