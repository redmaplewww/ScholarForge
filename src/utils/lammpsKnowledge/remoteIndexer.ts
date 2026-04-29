import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import {
  getRemoteDbPath,
  getRemoteDir,
  getRemoteKnowledgeRoots,
  getWorkspaceRoot,
  normalizePathForRemote,
} from './remoteCommon.js'
import { type BuildIndexOptions, type BuildIndexResult } from './indexer.js'

const ALLOWED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.in',
  '.data',
  '.log',
  '.yaml',
  '.yml',
  '.json',
  '.py',
  '.cfg',
  '.ini',
  '.rst',
  '.cif',
  '.mol',
  '.eamfs',
  '.comb3',
  '.eam',
  '.meam',
  '.tersoff',
  '.reax',
])

const ALLOWED_BASENAMES = new Set([
  'in',
  'input',
  'log.lammps',
  'readme',
  'notes',
  'potential',
])

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.idea',
  '.vscode',
  '__pycache__',
])

const CHUNK_CHAR_LIMIT = 1800
const CHUNK_OVERLAP = 250
const MAX_FILE_BYTES = 2 * 1024 * 1024
const CASE_METADATA_FILE_NAME = 'case.metadata.json'

export type RemoteBuildIndexResult = BuildIndexResult & {
  source: 'remote'
}

type SourceFile = {
  absolutePath: string
  relativePath: string
  mtime: number
  size: number
  metadataStamp: number
}

type StoredSourceFile = {
  path: string
  mtime: number
  size: number
  sha1: string
  metadata_stamp: number
}

type CaseMetadata = {
  caseName?: string
  family?: string
  materialSystem?: string
  potentialFamily?: string
  stage?: string
  weight?: number
  reliability?: string
  usage?: string
  tags?: string[]
  aliases?: string[]
  summary?: string
}

type CaseMetadataEntry = {
  metadata: CaseMetadata
  mtime: number
}

type IndexedChunk = {
  path: string
  title: string
  content: string
  snippet: string
  sourceType: string
  sourceTier: string
  family: string | null
  materialSystem: string | null
  potentialFamily: string | null
  stage: string | null
  caseWeight: number | null
  caseReliability: string | null
  caseUsage: string | null
  fileType: string
  chunkIndex: number
  mtime: number
  sha1: string
  charCount: number
}

export async function buildRemoteKnowledgeIndex(
  options: BuildIndexOptions = {},
): Promise<RemoteBuildIndexResult> {
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRoot()
  const remoteDir = getRemoteDir(workspaceRoot)
  if (!existsSync(remoteDir)) {
    return {
      workspaceRoot,
      dbPath: getRemoteDbPath(workspaceRoot),
      mode: 'full',
      indexedFiles: 0,
      indexedChunks: 0,
      skippedFiles: 0,
      removedFiles: 0,
      unchangedFiles: 0,
      source: 'remote',
    }
  }

  const dbPath = getRemoteDbPath(workspaceRoot)
  const cacheDir = join(workspaceRoot, '.claude', 'cache')
  const { mkdir } = await import('fs/promises')
  await mkdir(cacheDir, { recursive: true })
  const db = new Database(dbPath)

  try {
    initializeRemoteSchema(db)

    const caseMetadataMap = await collectCaseMetadataMap(remoteDir)
    const files = await collectSourceFiles(
      remoteDir,
      remoteDir,
      caseMetadataMap,
    )
    const insertDoc = createDocumentInsertQuery(db)
    const insertFts = createFtsInsertQuery(db)
    const upsertSourceFile = createSourceFileUpsertQuery(db)
    const upsertMetadata = createMetadataUpsertQuery(db)

    let indexedFiles = 0
    let indexedChunks = 0
    let skippedFiles = 0

    db.exec('BEGIN')
    try {
      for (const file of files) {
        const chunks = await indexFile(file, remoteDir, caseMetadataMap)
        if (chunks.length === 0) {
          skippedFiles += 1
          continue
        }
        indexedFiles += 1
        for (const chunk of chunks) {
          const rowId = insertChunk(insertDoc, insertFts, chunk)
          if (rowId > 0) indexedChunks += 1
        }
        upsertSourceFile.run(
          file.relativePath,
          file.mtime,
          file.size,
          chunks[0]!.sha1,
          file.metadataStamp,
        )
      }
      upsertMetadata.run('last_run_at', String(Math.floor(Date.now() / 1000)))
      upsertMetadata.run('last_mode', 'full')
      upsertMetadata.run('source', 'remote')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    db.exec('ANALYZE;')

    return {
      workspaceRoot,
      dbPath,
      mode: 'full',
      indexedFiles,
      indexedChunks,
      skippedFiles,
      removedFiles: 0,
      unchangedFiles: 0,
      source: 'remote',
    }
  } finally {
    db.close()
  }
}

export async function updateRemoteKnowledgeIndexIncrementally(
  options: BuildIndexOptions = {},
): Promise<RemoteBuildIndexResult> {
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRoot()
  const remoteDir = getRemoteDir(workspaceRoot)
  if (!existsSync(remoteDir)) {
    return {
      workspaceRoot,
      dbPath: getRemoteDbPath(workspaceRoot),
      mode: 'incremental',
      indexedFiles: 0,
      indexedChunks: 0,
      skippedFiles: 0,
      removedFiles: 0,
      unchangedFiles: 0,
      source: 'remote',
    }
  }

  const dbPath = getRemoteDbPath(workspaceRoot)
  if (!existsSync(dbPath)) {
    return buildRemoteKnowledgeIndex(options)
  }

  const cacheDir = join(workspaceRoot, '.claude', 'cache')
  const { mkdir } = await import('fs/promises')
  await mkdir(cacheDir, { recursive: true })
  const db = new Database(dbPath)

  try {
    ensureRemoteSchema(db)

    const caseMetadataMap = await collectCaseMetadataMap(remoteDir)
    const files = await collectSourceFiles(
      remoteDir,
      remoteDir,
      caseMetadataMap,
    )
    const currentByPath = new Map(files.map(f => [f.relativePath, f]))
    const storedFiles = getStoredSourceFiles(db)
    const removedPaths = [...storedFiles.keys()].filter(
      p => !currentByPath.has(p),
    )

    const insertDoc = createDocumentInsertQuery(db)
    const insertFts = createFtsInsertQuery(db)
    const upsertSourceFile = createSourceFileUpsertQuery(db)
    const upsertMetadata = createMetadataUpsertQuery(db)
    const deleteSourceFile = db.query('DELETE FROM source_files WHERE path = ?')

    let indexedFiles = 0
    let indexedChunks = 0
    let skippedFiles = 0
    let unchangedFiles = 0

    db.exec('BEGIN')
    try {
      for (const removedPath of removedPaths) {
        deleteChunksForPath(db, removedPath)
        deleteSourceFile.run(removedPath)
      }

      for (const file of files) {
        const previous = storedFiles.get(file.relativePath)
        if (
          previous &&
          previous.mtime === file.mtime &&
          previous.size === file.size &&
          previous.metadata_stamp === file.metadataStamp
        ) {
          unchangedFiles += 1
          continue
        }

        const chunks = await indexFile(file, remoteDir, caseMetadataMap)
        deleteChunksForPath(db, file.relativePath)

        if (chunks.length === 0) {
          deleteSourceFile.run(file.relativePath)
          skippedFiles += 1
          continue
        }

        indexedFiles += 1
        for (const chunk of chunks) {
          const rowId = insertChunk(insertDoc, insertFts, chunk)
          if (rowId > 0) indexedChunks += 1
        }
        upsertSourceFile.run(
          file.relativePath,
          file.mtime,
          file.size,
          chunks[0]!.sha1,
          file.metadataStamp,
        )
      }

      upsertMetadata.run('last_run_at', String(Math.floor(Date.now() / 1000)))
      upsertMetadata.run('last_mode', 'incremental')
      upsertMetadata.run('source', 'remote')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    db.exec('ANALYZE;')

    return {
      workspaceRoot,
      dbPath,
      mode: 'incremental',
      indexedFiles,
      indexedChunks,
      skippedFiles,
      removedFiles: removedPaths.length,
      unchangedFiles,
      source: 'remote',
    }
  } finally {
    db.close()
  }
}

export function getRemoteIndexStatus(workspaceRoot = getWorkspaceRoot()): {
  workspaceRoot: string
  dbPath: string
  exists: boolean
  documentCount: number
  sourceFileCount: number
  lastIndexedAt: number | null
} {
  const dbPath = getRemoteDbPath(workspaceRoot)
  if (!existsSync(dbPath)) {
    return {
      workspaceRoot,
      dbPath,
      exists: false,
      documentCount: 0,
      sourceFileCount: 0,
      lastIndexedAt: null,
    }
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    ensureRemoteSchema(db)
    const row = db
      .query(
        `SELECT
           (SELECT COUNT(*) FROM documents) AS document_count,
           (SELECT COUNT(*) FROM source_files) AS source_file_count,
           (SELECT MAX(indexed_at) FROM source_files) AS last_indexed_at`,
      )
      .get() as {
      document_count: number
      source_file_count: number
      last_indexed_at: number | null
    }
    const meta = db
      .query("SELECT value FROM index_metadata WHERE key = 'last_run_at'")
      .get() as { value: string } | null

    return {
      workspaceRoot,
      dbPath,
      exists: true,
      documentCount: row.document_count,
      sourceFileCount: row.source_file_count,
      lastIndexedAt: meta ? Number(meta.value) : row.last_indexed_at,
    }
  } finally {
    db.close()
  }
}

function initializeRemoteSchema(db: Database): void {
  db.exec('DROP TABLE IF EXISTS documents_fts;')
  db.exec('DROP TABLE IF EXISTS index_metadata;')
  db.exec('DROP TABLE IF EXISTS source_files;')
  db.exec('DROP TABLE IF EXISTS documents;')
  db.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      snippet TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      family TEXT,
      material_system TEXT,
      potential_family TEXT,
      stage TEXT,
      case_weight REAL,
      case_reliability TEXT,
      case_usage TEXT,
      file_type TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      sha1 TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      source_location TEXT NOT NULL DEFAULT 'remote',
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE source_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      sha1 TEXT NOT NULL,
      metadata_stamp INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db.exec('CREATE INDEX idx_documents_path ON documents(path);')
  db.exec('CREATE INDEX idx_documents_source_type ON documents(source_type);')
  db.exec('CREATE INDEX idx_documents_source_tier ON documents(source_tier);')
  db.exec(
    'CREATE INDEX idx_documents_source_location ON documents(source_location);',
  )
  db.exec(`
    CREATE VIRTUAL TABLE documents_fts USING fts5(
      path, title, content, tokenize = 'unicode61'
    );
  `)
}

function ensureRemoteSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      snippet TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      family TEXT,
      material_system TEXT,
      potential_family TEXT,
      stage TEXT,
      case_weight REAL,
      case_reliability TEXT,
      case_usage TEXT,
      file_type TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      sha1 TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS source_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      sha1 TEXT NOT NULL,
      metadata_stamp INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_documents_source_tier ON documents(source_tier);',
  )
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      path, title, content, tokenize = 'unicode61'
    );
  `)
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration)
    } catch {}
  }
}

const MIGRATIONS = [
  'ALTER TABLE source_files ADD COLUMN metadata_stamp INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE documents ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'other'",
  'ALTER TABLE documents ADD COLUMN case_reliability TEXT',
  'ALTER TABLE documents ADD COLUMN case_usage TEXT',
  "ALTER TABLE documents ADD COLUMN source_location TEXT NOT NULL DEFAULT 'remote'",
  'CREATE INDEX IF NOT EXISTS idx_documents_source_location ON documents(source_location);',
]

function createDocumentInsertQuery(db: Database) {
  return db.query(
    `INSERT INTO documents (
      path, title, content, snippet, source_type, source_tier, family, material_system,
      potential_family, stage, case_weight, case_reliability, case_usage,
      file_type, chunk_index, mtime, sha1, char_count, source_location
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote')`,
  )
}

function createFtsInsertQuery(db: Database) {
  return db.query(
    'INSERT INTO documents_fts(rowid, path, title, content) VALUES (?, ?, ?, ?)',
  )
}

function createSourceFileUpsertQuery(db: Database) {
  return db.query(
    `INSERT INTO source_files (path, mtime, size, sha1, metadata_stamp, indexed_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(path) DO UPDATE SET
       mtime = excluded.mtime,
       size = excluded.size,
       sha1 = excluded.sha1,
       metadata_stamp = excluded.metadata_stamp,
       indexed_at = excluded.indexed_at`,
  )
}

function createMetadataUpsertQuery(db: Database) {
  return db.query(
    `INSERT INTO index_metadata (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
}

function insertChunk(
  insertDoc: ReturnType<typeof createDocumentInsertQuery>,
  insertFts: ReturnType<typeof createFtsInsertQuery>,
  chunk: IndexedChunk,
): number {
  const result = insertDoc.run(
    chunk.path,
    chunk.title,
    chunk.content,
    chunk.snippet,
    chunk.sourceType,
    chunk.sourceTier,
    chunk.family,
    chunk.materialSystem,
    chunk.potentialFamily,
    chunk.stage,
    chunk.caseWeight,
    chunk.caseReliability,
    chunk.caseUsage,
    chunk.fileType,
    chunk.chunkIndex,
    chunk.mtime,
    chunk.sha1,
    chunk.charCount,
  ) as { lastInsertRowid: number | bigint }
  const rowId = Number(result.lastInsertRowid)
  insertFts.run(rowId, chunk.path, chunk.title, chunk.content)
  return rowId
}

function getStoredSourceFiles(db: Database): Map<string, StoredSourceFile> {
  const rows = db
    .query('SELECT path, mtime, size, sha1, metadata_stamp FROM source_files')
    .all() as StoredSourceFile[]
  return new Map(rows.map(row => [row.path, row]))
}

function deleteChunksForPath(db: Database, path: string): void {
  db.query(
    'DELETE FROM documents_fts WHERE rowid IN (SELECT id FROM documents WHERE path = ?)',
  ).run(path)
  db.query('DELETE FROM documents WHERE path = ?').run(path)
}

async function collectSourceFiles(
  rootDir: string,
  remoteDir: string,
  caseMetadataMap: Map<string, CaseMetadataEntry>,
): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  const seen = new Set<string>()
  if (!existsSync(rootDir)) return files
  await walkFiles(rootDir, remoteDir, files, seen, caseMetadataMap)
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return files
}

async function walkFiles(
  absoluteDir: string,
  remoteDir: string,
  files: SourceFile[],
  seen: Set<string>,
  caseMetadataMap: Map<string, CaseMetadataEntry>,
): Promise<void> {
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      await walkFiles(
        join(absoluteDir, entry.name),
        remoteDir,
        files,
        seen,
        caseMetadataMap,
      )
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name === CASE_METADATA_FILE_NAME) continue
    if (!shouldIndexFile(entry.name)) continue

    const absolutePath = join(absoluteDir, entry.name)
    if (seen.has(absolutePath)) continue
    seen.add(absolutePath)
    const fileStat = await stat(absolutePath)
    if (fileStat.size > MAX_FILE_BYTES) continue
    const relativePath = normalizePathForRemote(absolutePath, remoteDir)
    const metadataEntry = resolveCaseMetadataEntry(
      relativePath,
      caseMetadataMap,
    )
    files.push({
      absolutePath,
      relativePath,
      mtime: Math.floor(fileStat.mtimeMs),
      size: fileStat.size,
      metadataStamp: metadataEntry?.mtime ?? 0,
    })
  }
}

function shouldIndexFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  if (ALLOWED_BASENAMES.has(lowerName)) return true
  if (lowerName.startsWith('in.')) return true
  return ALLOWED_EXTENSIONS.has(extname(lowerName))
}

async function indexFile(
  file: SourceFile,
  remoteDir: string,
  caseMetadataMap: Map<string, CaseMetadataEntry>,
): Promise<IndexedChunk[]> {
  const raw = await readFile(file.absolutePath, 'utf8').catch(() => '')
  const normalized = normalizeText(raw)
  if (!normalized) return []

  const sha1 = createHash('sha1').update(normalized).digest('hex')
  const fileType = detectFileType(file.relativePath)
  const sourceType = detectSourceType(file.relativePath)
  const sourceTier = detectSourceTier(file.relativePath)
  const caseMetadata = resolveCaseMetadataEntry(
    file.relativePath,
    caseMetadataMap,
  )?.metadata
  const metadata = extractMetadata(file.relativePath, normalized, caseMetadata)
  const titleBase = basename(file.relativePath)
  const metadataPrelude = buildMetadataPrelude(caseMetadata, metadata)

  const chunks = splitIntoChunks(file.relativePath, normalized, fileType)
  return chunks.map((content, chunkIndex) => ({
    path: normalizePathForRemote(file.absolutePath, remoteDir),
    title: chunkIndex === 0 ? titleBase : `${titleBase} [${chunkIndex + 1}]`,
    content: metadataPrelude ? `${metadataPrelude}\n\n${content}` : content,
    snippet: makeSnippet(
      metadataPrelude ? `${metadataPrelude} ${content}` : content,
    ),
    sourceType,
    sourceTier,
    family: metadata.family,
    materialSystem: metadata.materialSystem,
    potentialFamily: metadata.potentialFamily,
    stage: metadata.stage,
    caseWeight: metadata.caseWeight,
    caseReliability: metadata.caseReliability,
    caseUsage: metadata.caseUsage,
    fileType,
    chunkIndex,
    mtime: file.mtime,
    sha1,
    charCount: content.length,
  }))
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\0/g, '')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitIntoChunks(
  relativePath: string,
  content: string,
  fileType: string,
): string[] {
  if (fileType === 'log') return chunkLongSections(splitPlainText(content))
  if (relativePath.endsWith('.md')) {
    const headingChunks = splitMarkdownByHeading(content)
    if (headingChunks.length > 0) return chunkLongSections(headingChunks)
  }
  return chunkLongSections(splitPlainText(content))
}

function splitMarkdownByHeading(content: string): string[] {
  const lines = content.split('\n')
  const chunks: string[] = []
  let buffer: string[] = []
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line) && buffer.length > 0) {
      chunks.push(buffer.join('\n').trim())
      buffer = [line]
      continue
    }
    buffer.push(line)
  }
  if (buffer.length > 0) chunks.push(buffer.join('\n').trim())
  return chunks.filter(Boolean)
}

function splitPlainText(content: string): string[] {
  const blocks = content
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)
  return blocks.length > 0 ? blocks : [content]
}

function chunkLongSections(sections: string[]): string[] {
  const chunks: string[] = []
  for (const section of sections) {
    if (section.length <= CHUNK_CHAR_LIMIT) {
      chunks.push(section)
      continue
    }
    let start = 0
    while (start < section.length) {
      const end = Math.min(section.length, start + CHUNK_CHAR_LIMIT)
      chunks.push(section.slice(start, end).trim())
      if (end >= section.length) break
      start = Math.max(end - CHUNK_OVERLAP, start + 1)
    }
  }
  return chunks.filter(Boolean)
}

function detectSourceType(relativePath: string): string {
  if (relativePath.startsWith('knowledge/memory/')) return 'experience'
  if (relativePath.startsWith('knowledge/papers/notes/')) return 'paper_note'
  if (relativePath.startsWith('knowledge/papers/topics/')) return 'paper_topic'
  if (relativePath.startsWith('knowledge/papers/summaries/'))
    return 'paper_summary'
  if (relativePath.startsWith('knowledge/manuals/')) return 'manual_reference'
  if (relativePath.startsWith('knowledge/corrections/reference-corpus/'))
    return 'correction'
  if (relativePath.startsWith('knowledge/examples/')) return 'manual_example'
  if (relativePath.startsWith('knowledge/corrections/playbooks/'))
    return 'playbook'
  if (relativePath.startsWith('knowledge/cases/raw/')) return 'raw_case'
  if (relativePath.startsWith('knowledge/')) return 'knowledge_summary'
  if (relativePath.endsWith('.md')) return 'manual'
  return 'case_asset'
}

function detectSourceTier(relativePath: string): string {
  if (relativePath.startsWith('knowledge/rules/')) return 'rule'
  if (relativePath.startsWith('knowledge/memory/')) return 'memory'
  if (relativePath.startsWith('knowledge/papers/')) return 'paper'
  if (relativePath.startsWith('knowledge/templates/')) return 'template'
  if (relativePath.startsWith('knowledge/cases/')) return 'case'
  if (relativePath.startsWith('knowledge/manuals/')) return 'manual'
  if (relativePath.startsWith('knowledge/corrections/')) return 'correction'
  if (relativePath.startsWith('knowledge/examples/')) return 'example'
  if (relativePath.startsWith('knowledge/potentials/')) return 'potential'
  if (relativePath.startsWith('knowledge/reports/')) return 'report'
  return 'other'
}

function detectFileType(relativePath: string): string {
  const lowerPath = relativePath.toLowerCase()
  if (lowerPath.includes('log.lammps') || lowerPath.endsWith('.log'))
    return 'log'
  if (lowerPath.endsWith('.md')) return 'markdown'
  if (
    lowerPath.endsWith('.json') ||
    lowerPath.endsWith('.yaml') ||
    lowerPath.endsWith('.yml')
  )
    return 'metadata'
  if (
    lowerPath.includes('/potential') ||
    /\.(eam|meam|tersoff|reax)$/.test(lowerPath)
  )
    return 'potential'
  if (lowerPath.endsWith('.data')) return 'structure'
  if (
    lowerPath.endsWith('.in') ||
    lowerPath.includes('/in.') ||
    lowerPath.endsWith('.lmp')
  )
    return 'input'
  return 'text'
}

function extractMetadata(
  relativePath: string,
  content: string,
  caseMetadata?: CaseMetadata,
) {
  const lowerPath = relativePath.toLowerCase()
  if (
    lowerPath === 'knowledge/cases/case-family-index.md' ||
    lowerPath === 'knowledge/rules/potential-selection.md' ||
    lowerPath === 'knowledge/rules/workflow-stages.md' ||
    lowerPath === 'knowledge/rules/review-guidelines.md'
  ) {
    return {
      family: null as string | null,
      materialSystem: null as string | null,
      potentialFamily: null as string | null,
      stage: null as string | null,
      caseWeight: null as number | null,
      caseReliability: null as string | null,
      caseUsage: null as string | null,
    }
  }
  const combined = `${relativePath}\n${content}`
  const lower = combined.toLowerCase()
  return {
    family: caseMetadata?.family ?? detectFamily(lower),
    materialSystem:
      caseMetadata?.materialSystem ?? detectMaterialSystem(combined),
    potentialFamily:
      caseMetadata?.potentialFamily ?? detectPotentialFamily(lower),
    stage: caseMetadata?.stage ?? detectStage(combined),
    caseWeight:
      typeof caseMetadata?.weight === 'number'
        ? clampCaseWeight(caseMetadata.weight)
        : null,
    caseReliability: caseMetadata?.reliability ?? null,
    caseUsage: caseMetadata?.usage ?? null,
  }
}

async function collectCaseMetadataMap(
  rootDir: string,
): Promise<Map<string, CaseMetadataEntry>> {
  const map = new Map<string, CaseMetadataEntry>()
  if (!existsSync(rootDir)) return map
  await walkCaseMetadata(rootDir, rootDir, map)
  return map
}

async function walkCaseMetadata(
  absoluteDir: string,
  rootDir: string,
  map: Map<string, CaseMetadataEntry>,
): Promise<void> {
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      await walkCaseMetadata(join(absoluteDir, entry.name), rootDir, map)
      continue
    }
    if (!entry.isFile() || entry.name !== CASE_METADATA_FILE_NAME) continue
    const absolutePath = join(absoluteDir, entry.name)
    const relativeDir = normalizePathForRemote(dirname(absolutePath), rootDir)
    const raw = await readFile(absolutePath, 'utf8').catch(() => '')
    const parsed = parseCaseMetadata(raw)
    if (parsed) {
      const metadataStat = await stat(absolutePath).catch(() => null)
      map.set(relativeDir, {
        metadata: parsed,
        mtime: metadataStat ? Math.floor(metadataStat.mtimeMs) : 0,
      })
    }
  }
}

function parseCaseMetadata(raw: string): CaseMetadata | null {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    return {
      caseName: typeof p.caseName === 'string' ? p.caseName.trim() : undefined,
      family: typeof p.family === 'string' ? p.family.trim() : undefined,
      materialSystem:
        typeof p.materialSystem === 'string'
          ? p.materialSystem.trim()
          : undefined,
      potentialFamily:
        typeof p.potentialFamily === 'string'
          ? p.potentialFamily.trim()
          : undefined,
      stage: typeof p.stage === 'string' ? p.stage.trim() : undefined,
      weight:
        typeof p.weight === 'number' && Number.isFinite(p.weight)
          ? clampCaseWeight(p.weight)
          : undefined,
      reliability:
        typeof p.reliability === 'string' ? p.reliability.trim() : undefined,
      usage: typeof p.usage === 'string' ? p.usage.trim() : undefined,
      tags: Array.isArray(p.tags)
        ? p.tags.filter((i): i is string => typeof i === 'string')
        : undefined,
      aliases: Array.isArray(p.aliases)
        ? p.aliases.filter((i): i is string => typeof i === 'string')
        : undefined,
      summary: typeof p.summary === 'string' ? p.summary.trim() : undefined,
    }
  } catch {
    return null
  }
}

function resolveCaseMetadataEntry(
  relativePath: string,
  metadataMap: Map<string, CaseMetadataEntry>,
): CaseMetadataEntry | undefined {
  let current = dirname(relativePath).replace(/\\/g, '/')
  while (current && current !== '.') {
    const exact = metadataMap.get(current)
    if (exact) return exact
    const parent = dirname(current).replace(/\\/g, '/')
    if (parent === current) break
    current = parent
  }
  return metadataMap.get('.')
}

function buildMetadataPrelude(
  caseMetadata: CaseMetadata | undefined,
  metadata: {
    family: string | null
    materialSystem: string | null
    potentialFamily: string | null
    stage: string | null
    caseWeight: number | null
    caseReliability: string | null
    caseUsage: string | null
  },
): string {
  const lines: string[] = []
  if (caseMetadata?.caseName) lines.push(`case: ${caseMetadata.caseName}`)
  if (metadata.family) lines.push(`family: ${metadata.family}`)
  if (metadata.materialSystem)
    lines.push(`material: ${metadata.materialSystem}`)
  if (metadata.potentialFamily)
    lines.push(`potential: ${metadata.potentialFamily}`)
  if (metadata.stage) lines.push(`stage: ${metadata.stage}`)
  if (typeof metadata.caseWeight === 'number')
    lines.push(`case_weight: ${metadata.caseWeight.toFixed(2)}`)
  if (metadata.caseReliability)
    lines.push(`reliability: ${metadata.caseReliability}`)
  if (metadata.caseUsage) lines.push(`usage: ${metadata.caseUsage}`)
  if (caseMetadata?.aliases?.length)
    lines.push(`aliases: ${caseMetadata.aliases.join(', ')}`)
  if (caseMetadata?.tags?.length)
    lines.push(`tags: ${caseMetadata.tags.join(', ')}`)
  if (caseMetadata?.summary) lines.push(`summary: ${caseMetadata.summary}`)
  return lines.join('\n')
}

function clampCaseWeight(weight: number): number {
  return Math.max(0.1, Math.min(3, weight))
}

function detectFamily(lower: string): string | null {
  const families: Array<[string, string]> = [
    ['deposition', 'reactive-and-deposition'],
    ['oxid', 'oxidation'],
    ['melt', 'melt-solidify'],
    ['solidif', 'melt-solidify'],
    ['tensile', 'mechanical-loading'],
    ['shear', 'mechanical-loading'],
    ['indent', 'mechanical-loading'],
    ['cascade', 'radiation-damage'],
    ['grind', 'machining'],
    ['tribo', 'tribology'],
    ['diffusion', 'diffusion'],
  ]
  for (const [needle, family] of families) {
    if (lower.includes(needle)) return family
  }
  return null
}

function detectPotentialFamily(lower: string): string | null {
  const candidates: Array<[string, string]> = [
    ['reaxff', 'reaxff'],
    ['pair_style reax/c', 'reaxff'],
    ['tersoff', 'tersoff'],
    ['meam', 'meam'],
    ['eam/fs', 'eam'],
    ['eam/alloy', 'eam'],
    ['eam', 'eam'],
    ['airebo', 'airebo'],
    ['lj/cut', 'lj'],
    ['buck/coul', 'buckingham'],
    ['hybrid', 'hybrid'],
  ]
  for (const [needle, value] of candidates) {
    if (lower.includes(needle)) return value
  }
  return null
}

function detectStage(input: string): string | null {
  const match = input.match(/WF-0?([1-9])/i)
  if (!match) return null
  return `WF-0${match[1]}`
}

function detectMaterialSystem(input: string): string | null {
  const normalized = input.replace(/_/g, '-').replace(/\//g, '-')
  const match = normalized.match(
    /\b([A-Z][a-z]?)-(?:([A-Z][a-z]?)-)?([A-Z][a-z]?)\b/,
  )
  if (!match) return null
  const elements = [match[1], match[2], match[3]].filter(Boolean)
  return elements.join('-')
}

function makeSnippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 280)
}
