import { Database } from 'bun:sqlite'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import {
  ensureKnowledgeCacheDir,
  getKnowledgeDbPath,
  getKnowledgeRoots,
  getWorkspaceRoot,
  normalizePathForDb,
} from './common.js'

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

export type BuildIndexOptions = {
  workspaceRoot?: string
}

export type BuildIndexResult = {
  workspaceRoot: string
  dbPath: string
  mode: 'full' | 'incremental'
  indexedFiles: number
  indexedChunks: number
  skippedFiles: number
  removedFiles: number
  unchangedFiles: number
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

type IndexMetadataRow = {
  key: string
  value: string
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

export async function buildKnowledgeIndex(
  options: BuildIndexOptions = {},
): Promise<BuildIndexResult> {
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRoot()
  await ensureKnowledgeCacheDir(workspaceRoot)
  const dbPath = getKnowledgeDbPath(workspaceRoot)
  const db = new Database(dbPath)

  try {
    initializeSchema(db)

    const caseMetadataMap = await collectCaseMetadataMap(workspaceRoot)
    const files = await collectSourceFiles(workspaceRoot, caseMetadataMap)
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
        const chunks = await indexFile(file, workspaceRoot, caseMetadataMap)
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
    }
  } finally {
    db.close()
  }
}

export async function updateKnowledgeIndexIncrementally(
  options: BuildIndexOptions = {},
): Promise<BuildIndexResult> {
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRoot()
  await ensureKnowledgeCacheDir(workspaceRoot)
  const dbPath = getKnowledgeDbPath(workspaceRoot)
  const db = new Database(dbPath)

  try {
    ensureSchema(db)

    const caseMetadataMap = await collectCaseMetadataMap(workspaceRoot)
    const files = await collectSourceFiles(workspaceRoot, caseMetadataMap)
    const currentByPath = new Map(files.map(file => [file.relativePath, file]))
    const storedFiles = getStoredSourceFiles(db)
    const removedPaths = [...storedFiles.keys()].filter(
      path => !currentByPath.has(path),
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

        const chunks = await indexFile(file, workspaceRoot, caseMetadataMap)
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
    }
  } finally {
    db.close()
  }
}

export function getKnowledgeIndexStatus(workspaceRoot = getWorkspaceRoot()): {
  workspaceRoot: string
  dbPath: string
  exists: boolean
  documentCount: number
  sourceFileCount: number
  lastIndexedAt: number | null
} {
  const dbPath = getKnowledgeDbPath(workspaceRoot)
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

  const db = new Database(dbPath)
  try {
    ensureSchema(db)
    const metadata = getIndexMetadata(db)
    const lastRunRaw = metadata.get('last_run_at')
    const lastRunAt = lastRunRaw
      ? Number(lastRunRaw)
      : rowLastIndexedAtFallback(db)
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

    return {
      workspaceRoot,
      dbPath,
      exists: true,
      documentCount: row.document_count,
      sourceFileCount: row.source_file_count,
      lastIndexedAt: lastRunAt,
    }
  } finally {
    db.close()
  }
}

function rowLastIndexedAtFallback(db: Database): number | null {
  const row = db
    .query('SELECT MAX(indexed_at) AS last_indexed_at FROM source_files')
    .get() as { last_indexed_at: number | null }
  return row.last_indexed_at
}

function initializeSchema(db: Database): void {
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
  db.exec('CREATE INDEX idx_documents_family ON documents(family);')
  db.exec(
    'CREATE INDEX idx_documents_potential_family ON documents(potential_family);',
  )
  db.exec('CREATE INDEX idx_documents_stage ON documents(stage);')
  db.exec(`
    CREATE VIRTUAL TABLE documents_fts USING fts5(
      path,
      title,
      content,
      tokenize = 'unicode61'
    );
  `)
}

function ensureSchema(db: Database): void {
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
    CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
    CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
    CREATE INDEX IF NOT EXISTS idx_documents_family ON documents(family);
    CREATE INDEX IF NOT EXISTS idx_documents_potential_family ON documents(potential_family);
    CREATE INDEX IF NOT EXISTS idx_documents_stage ON documents(stage);
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      path,
      title,
      content,
      tokenize = 'unicode61'
    );
  `)
  try {
    db.exec(
      'ALTER TABLE source_files ADD COLUMN metadata_stamp INTEGER NOT NULL DEFAULT 0',
    )
  } catch {
    // Column already exists.
  }
  try {
    db.exec(
      "ALTER TABLE documents ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'other'",
    )
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE documents ADD COLUMN case_reliability TEXT')
  } catch {
    // Column already exists.
  }
  try {
    db.exec('ALTER TABLE documents ADD COLUMN case_usage TEXT')
  } catch {
    // Column already exists.
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_documents_source_tier ON documents(source_tier);',
  )
}

function createDocumentInsertQuery(db: Database) {
  return db.query(
    `INSERT INTO documents (
      path, title, content, snippet, source_type, source_tier, family, material_system,
      potential_family, stage, case_weight, case_reliability, case_usage, file_type, chunk_index, mtime, sha1, char_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

function getIndexMetadata(db: Database): Map<string, string> {
  const rows = db
    .query('SELECT key, value FROM index_metadata')
    .all() as IndexMetadataRow[]
  return new Map(rows.map(row => [row.key, row.value]))
}

function deleteChunksForPath(db: Database, path: string): void {
  db.query(
    'DELETE FROM documents_fts WHERE rowid IN (SELECT id FROM documents WHERE path = ?)',
  ).run(path)
  db.query('DELETE FROM documents WHERE path = ?').run(path)
}

async function collectSourceFiles(
  workspaceRoot: string,
  caseMetadataMap: Map<string, CaseMetadataEntry>,
): Promise<SourceFile[]> {
  const roots = getKnowledgeRoots(workspaceRoot)
  const files: SourceFile[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (/\.[A-Za-z0-9]+$/.test(root)) {
      await addFileIfEligible(root, workspaceRoot, files, seen, caseMetadataMap)
      continue
    }
    const rootStat = await stat(root).catch(() => null)
    if (rootStat?.isFile()) {
      await addFileIfEligible(root, workspaceRoot, files, seen, caseMetadataMap)
      continue
    }
    await walkFiles(root, workspaceRoot, files, seen, caseMetadataMap)
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return files
}

async function walkFiles(
  absoluteDir: string,
  workspaceRoot: string,
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
        workspaceRoot,
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
    await addFileIfEligible(
      absolutePath,
      workspaceRoot,
      files,
      seen,
      caseMetadataMap,
    )
  }
}

async function addFileIfEligible(
  absolutePath: string,
  workspaceRoot: string,
  files: SourceFile[],
  seen: Set<string>,
  caseMetadataMap: Map<string, CaseMetadataEntry>,
): Promise<void> {
  if (seen.has(absolutePath)) return
  seen.add(absolutePath)
  const fileStat = await stat(absolutePath)
  if (fileStat.size > MAX_FILE_BYTES) return
  const relativePath = normalizePathForDb(absolutePath, workspaceRoot)
  const metadataEntry = resolveCaseMetadataEntry(relativePath, caseMetadataMap)
  files.push({
    absolutePath,
    relativePath,
    mtime: Math.floor(fileStat.mtimeMs),
    size: fileStat.size,
    metadataStamp: metadataEntry?.mtime ?? 0,
  })
}

function shouldIndexFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase()
  if (ALLOWED_BASENAMES.has(lowerName)) return true
  if (lowerName.startsWith('in.')) return true
  return ALLOWED_EXTENSIONS.has(extname(lowerName))
}

async function indexFile(
  file: SourceFile,
  workspaceRoot: string,
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
    path: normalizePathForDb(file.absolutePath, workspaceRoot),
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
    .replace(/\u0000/g, '')
    .replace(/\t/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitIntoChunks(
  relativePath: string,
  content: string,
  fileType: string,
): string[] {
  if (fileType === 'log') {
    return splitLogSections(content)
  }
  if (relativePath.endsWith('.md')) {
    const headingChunks = splitMarkdownByHeading(content)
    if (headingChunks.length > 0) return chunkLongSections(headingChunks)
  }
  return chunkLongSections(splitPlainText(content))
}

function splitLogSections(content: string): string[] {
  const lines = content.split('\n')
  if (lines.length <= 240) {
    return chunkLongSections(splitPlainText(content))
  }

  const sections: string[] = []
  const addSection = (label: string, start: number, end: number) => {
    const slice = lines.slice(Math.max(0, start), Math.min(lines.length, end))
    const text = slice.join('\n').trim()
    if (text) sections.push(`## ${label}\n${text}`)
  }

  addSection('Log Start', 0, 120)

  const hitPatterns = [
    /ERROR/i,
    /WARNING/i,
    /Lost atoms/i,
    /Bond atoms missing/i,
    /Non-numeric/i,
    /qeq/i,
  ]
  const seenWindows = new Set<string>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!hitPatterns.some(pattern => pattern.test(line))) continue
    const start = Math.max(0, index - 8)
    const end = Math.min(lines.length, index + 9)
    const key = `${start}:${end}`
    if (seenWindows.has(key)) continue
    seenWindows.add(key)
    addSection(`Error Window ${index + 1}`, start, end)
  }

  const thermoHeaders: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^(step|loop time)/i.test(line.trim())) {
      thermoHeaders.push(index)
    }
  }
  for (const headerIndex of thermoHeaders.slice(0, 4)) {
    addSection(
      `Thermo Sample ${headerIndex + 1}`,
      headerIndex,
      headerIndex + 24,
    )
  }

  addSection('Log End', Math.max(0, lines.length - 180), lines.length)
  return chunkLongSections(sections)
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
    .map(block => block.trim())
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
  if (relativePath.startsWith('knowledge/manuals/')) {
    return 'manual_reference'
  }
  if (relativePath.startsWith('knowledge/corrections/reference-corpus/'))
    return 'correction'
  if (relativePath.startsWith('knowledge/examples/')) return 'manual_example'
  if (relativePath.startsWith('knowledge/corrections/playbooks/'))
    return 'playbook'
  if (relativePath.startsWith('knowledge/cases/raw/')) return 'raw_case'
  if (relativePath.startsWith('knowledge/source/')) return 'migration'
  if (relativePath.startsWith('knowledge/archive/')) return 'migration'
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
  if (relativePath.startsWith('knowledge/source/')) return 'source'
  if (relativePath.startsWith('knowledge/archive/')) return 'archive'
  return 'other'
}

function detectFileType(relativePath: string): string {
  const lowerPath = relativePath.toLowerCase()
  if (lowerPath.includes('log.lammps') || lowerPath.endsWith('.log')) {
    return 'log'
  }
  if (lowerPath.endsWith('.md')) return 'markdown'
  if (
    lowerPath.endsWith('.json') ||
    lowerPath.endsWith('.yaml') ||
    lowerPath.endsWith('.yml')
  ) {
    return 'metadata'
  }
  if (
    lowerPath.includes('/potential') ||
    /\.(eam|meam|tersoff|reax)$/.test(lowerPath)
  ) {
    return 'potential'
  }
  if (lowerPath.endsWith('.data')) return 'structure'
  if (
    lowerPath.endsWith('.in') ||
    lowerPath.includes('/in.') ||
    lowerPath.endsWith('.lmp')
  ) {
    return 'input'
  }
  return 'text'
}

function extractMetadata(
  relativePath: string,
  content: string,
  caseMetadata?: CaseMetadata,
): {
  family: string | null
  materialSystem: string | null
  potentialFamily: string | null
  stage: string | null
  caseWeight: number | null
  caseReliability: string | null
  caseUsage: string | null
} {
  const lowerPath = relativePath.toLowerCase()
  if (
    lowerPath === 'knowledge/cases/case-family-index.md' ||
    lowerPath === 'knowledge/rules/potential-selection.md' ||
    lowerPath === 'knowledge/rules/workflow-stages.md' ||
    lowerPath === 'knowledge/rules/review-guidelines.md'
  ) {
    return {
      family: null,
      materialSystem: null,
      potentialFamily: null,
      stage: null,
      caseWeight: null,
      caseReliability: null,
      caseUsage: null,
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
  workspaceRoot: string,
): Promise<Map<string, CaseMetadataEntry>> {
  const roots = getKnowledgeRoots(workspaceRoot)
  const map = new Map<string, CaseMetadataEntry>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (/\.[A-Za-z0-9]+$/.test(root)) continue
    await walkCaseMetadata(root, workspaceRoot, map)
  }
  return map
}

async function walkCaseMetadata(
  absoluteDir: string,
  workspaceRoot: string,
  map: Map<string, CaseMetadataEntry>,
): Promise<void> {
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      await walkCaseMetadata(join(absoluteDir, entry.name), workspaceRoot, map)
      continue
    }
    if (!entry.isFile() || entry.name !== CASE_METADATA_FILE_NAME) continue

    const absolutePath = join(absoluteDir, entry.name)
    const relativeDir = normalizePathForDb(dirname(absolutePath), workspaceRoot)
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
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      caseName:
        typeof parsed.caseName === 'string'
          ? parsed.caseName.trim()
          : undefined,
      family:
        typeof parsed.family === 'string' ? parsed.family.trim() : undefined,
      materialSystem:
        typeof parsed.materialSystem === 'string'
          ? parsed.materialSystem.trim()
          : undefined,
      potentialFamily:
        typeof parsed.potentialFamily === 'string'
          ? parsed.potentialFamily.trim()
          : undefined,
      stage: typeof parsed.stage === 'string' ? parsed.stage.trim() : undefined,
      weight:
        typeof parsed.weight === 'number' && Number.isFinite(parsed.weight)
          ? clampCaseWeight(parsed.weight)
          : undefined,
      reliability:
        typeof parsed.reliability === 'string'
          ? parsed.reliability.trim()
          : undefined,
      usage: typeof parsed.usage === 'string' ? parsed.usage.trim() : undefined,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((item): item is string => typeof item === 'string')
        : undefined,
      aliases: Array.isArray(parsed.aliases)
        ? parsed.aliases.filter(
            (item): item is string => typeof item === 'string',
          )
        : undefined,
      summary:
        typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined,
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
  if (metadata.potentialFamily) {
    lines.push(`potential: ${metadata.potentialFamily}`)
  }
  if (metadata.stage) lines.push(`stage: ${metadata.stage}`)
  if (typeof metadata.caseWeight === 'number') {
    lines.push(`case_weight: ${metadata.caseWeight.toFixed(2)}`)
  }
  if (metadata.caseReliability) {
    lines.push(`reliability: ${metadata.caseReliability}`)
  }
  if (metadata.caseUsage) {
    lines.push(`usage: ${metadata.caseUsage}`)
  }
  if (caseMetadata?.aliases?.length) {
    lines.push(`aliases: ${caseMetadata.aliases.join(', ')}`)
  }
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
