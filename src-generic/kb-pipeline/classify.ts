// @ts-nocheck
import { KBItem } from './common'

export type Category =
  | 'concept'
  | 'procedure'
  | 'reference'
  | 'case'
  | 'troubleshooting'

export function classifyItem(item: KBItem): Category {
  const title = item.title.toLowerCase()
  const content = item.content.toLowerCase()

  if (title.includes('how to') || content.includes('step')) return 'procedure'
  if (title.includes('error') || content.includes('fix'))
    return 'troubleshooting'
  if (title.includes('case') || content.includes('example')) return 'case'
  if (content.includes('table') || content.includes('parameter'))
    return 'reference'
  return 'concept'
}
