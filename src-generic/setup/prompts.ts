// @ts-nocheck
import * as readline from 'node:readline'

function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl: any, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim())
    })
  })
}

export function banner(): string {
  return [
    '',
    '  ============================================================',
    '  |  通用 Agent 框架 - 配置向导                              |',
    '  ============================================================',
    '',
  ].join('\n')
}

export function heading(text: string) {
  console.log(``)
  console.log(`  --- ${text} ---`)
  console.log(``)
}

export function subheading(text: string) {
  console.log(`  [${text}]`)
}

export function info(message: string) {
  console.log(`  [信息] ${message}`)
}

export function success(message: string) {
  console.log(`  [完成] ${message}`)
}

export function warn(message: string) {
  console.log(`  [警告] ${message}`)
}

export function error(message: string) {
  console.log(`  [错误] ${message}`)
}

export function bullet(message: string) {
  console.log(`  - ${message}`)
}

export async function text(
  label: string,
  defaultVal: string = '',
): Promise<string> {
  const rl = createRL()
  const prompt = defaultVal ? `  ${label} [${defaultVal}]: ` : `  ${label}: `
  const answer = await ask(rl, prompt)
  rl.close()
  return answer || defaultVal
}

export async function confirm(
  label: string,
  defaultYes: boolean = true,
): Promise<boolean> {
  const rl = createRL()
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(rl, `  ${label} (${hint}): `)
  rl.close()
  if (!answer) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

export async function select(
  label: string,
  options: string[],
): Promise<number> {
  console.log(`  ${label}`)
  options.forEach((opt, i) => {
    console.log(`    ${i + 1}. ${opt}`)
  })
  const rl = createRL()
  const answer = await ask(rl, `  请选择 [1]: `)
  rl.close()
  const idx = parseInt(answer, 10)
  if (isNaN(idx) || idx < 1 || idx > options.length) return 0
  return idx - 1
}

export async function multiline(
  label: string,
  _placeholder: string = '',
): Promise<string> {
  console.log(`  ${label}`)
  console.log(`  (输入多行，空行结束)`)
  const rl = createRL()
  const lines: string[] = []
  while (true) {
    const line = await ask(rl, '  | ')
    if (!line) break
    lines.push(line)
  }
  rl.close()
  return lines.join('\n')
}

export async function pause(label: string = '按回车继续...') {
  const rl = createRL()
  await ask(rl, `  ${label}`)
  rl.close()
}

export function progressBar(current: number, total: number) {
  const pct = Math.round((current / total) * 100)
  const filled = Math.round((current / total) * 30)
  const bar = '#'.repeat(filled) + '-'.repeat(30 - filled)
  console.log(`  [${bar}] ${pct}% (${current}/${total})`)
}
