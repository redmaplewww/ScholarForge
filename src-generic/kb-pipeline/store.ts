// @ts-nocheck
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { KBItem, getKBRoot } from './common'

const STORE_FILE = '.kb-store.json'

export function loadStore(cwd?: string): KBItem[] {
  const storePath = join(getKBRoot(cwd), STORE_FILE)
  if (!existsSync(storePath)) return []
  return JSON.parse(readFileSync(storePath, 'utf8'))
}

export function saveStore(items: KBItem[], cwd?: string): void {
  const storePath = join(getKBRoot(cwd), STORE_FILE)
  writeFileSync(storePath, JSON.stringify(items, null, 2))
}

export function addItem(item: KBItem, cwd?: string): void {
  const store = loadStore(cwd)
  store.push(item)
  saveStore(store, cwd)
}

export function findById(id: string, cwd?: string): KBItem | undefined {
  return loadStore(cwd).find(i => i.id === id)
}
