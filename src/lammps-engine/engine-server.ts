import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface EngineConfig {
  port: number
  host: string
  engineApiKey: string
  workspaceRoot: string
  logLevel: 'info' | 'debug' | 'warn' | 'error'
  corsOrigins: string[]
}

export const DEFAULT_CONFIG: EngineConfig = {
  port: 3847,
  host: '127.0.0.1',
  engineApiKey: '',
  workspaceRoot: process.cwd(),
  logLevel: 'info',
  corsOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
}

let config: EngineConfig = { ...DEFAULT_CONFIG }

export function setConfig(c: Partial<EngineConfig>) {
  config = { ...config, ...c }
}

export function getConfig(): EngineConfig {
  return config
}

const KB_SEARCH_IMPORTS: Record<string, string> = {
  'bun:sqlite':
    '@stdlib/sqlite' in globalThis ? '@stdlib/sqlite' : 'bun:sqlite',
}

async function dynamicImport(path: string, name: string) {
  try {
    return await import(path)
  } catch {
    const alt = KB_SEARCH_IMPORTS[path]
    if (alt) return await import(alt)
    throw new Error(`Cannot load module: ${path}`)
  }
}

let kbSearch: any = null
let kbPipeline: any = null
let gateway: any = null

async function ensureModules() {
  if (!kbSearch) {
    try {
      kbSearch = await import('../utils/lammpsKnowledge/search.js')
    } catch {
      kbSearch = await dynamicImport('bun:sqlite', 'search')
    }
  }
  if (!kbPipeline) {
    try {
      kbPipeline = await import('../utils/lammpsKbPipeline/mcpServer.js')
    } catch {
      kbPipeline = null
    }
  }
  if (!gateway) {
    try {
      gateway = await import('../opencode-gateway/api/gateway.js')
    } catch {
      gateway = null
    }
  }
}

function log(level: string, msg: string, data?: any) {
  if (
    ['error', 'warn', 'info', 'debug'].indexOf(level) >=
    ['error', 'warn', 'info', 'debug'].indexOf(config.logLevel)
  ) {
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`
    if (data) console.log(prefix, msg, data)
    else console.log(prefix, msg)
  }
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      if (!body) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': config.corsOrigins.join(', ') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engine-Key',
  })
  res.end(JSON.stringify(data))
}

function sendError(
  res: ServerResponse,
  message: string,
  status = 500,
  details?: any,
) {
  sendJson(res, { error: message, details }, status)
}

function checkAuth(req: IncomingMessage): boolean {
  if (!config.engineApiKey) return true
  const key =
    req.headers['x-engine-key'] ||
    req.headers['authorization']?.replace('Bearer ', '')
  return key === config.engineApiKey
}

function authMiddleware(req: IncomingMessage, res: ServerResponse): boolean {
  if (!checkAuth(req)) {
    sendError(res, 'Unauthorized', 401)
    return false
  }
  return true
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    sendJson(res, {})
    return
  }

  if (path === '/health') {
    sendJson(res, { status: 'ok', version: '1.0.0', uptime: process.uptime() })
    return
  }

  if (path === '/api/config') {
    if (req.method === 'GET') {
      sendJson(res, {
        workspaceRoot: config.workspaceRoot,
        port: config.port,
        host: config.host,
      })
      return
    }
    if (req.method === 'PATCH') {
      try {
        const body = await parseBody(req)
        setConfig(body)
        sendJson(res, { status: 'ok' })
      } catch {
        sendError(res, 'Invalid request')
      }
      return
    }
  }

  if (path === '/api/tools') {
    const tools = [
      {
        name: 'lammps_knowledge_search',
        description: 'Search LAMMPS knowledge base with semantic matching',
      },
      {
        name: 'lammps_kb_ingest',
        description: 'Ingest files into knowledge base pipeline',
      },
      {
        name: 'lammps_kb_queue',
        description: 'List queued files in KB pipeline',
      },
      {
        name: 'lammps_kb_review',
        description: 'Review and approve/reject queued items',
      },
      { name: 'lammps_kb_status', description: 'Get KB pipeline status' },
      { name: 'lammps_workflow_run', description: 'Execute LAMMPS workflow' },
      { name: 'lammps_paper_notes', description: 'Query paper research notes' },
      { name: 'gateway_session_create', description: 'Create gateway session' },
      { name: 'gateway_job_submit', description: 'Submit job to gateway' },
    ]
    sendJson(res, { tools })
    return
  }

  if (path === '/api/engine/search') {
    if (!authMiddleware(req, res)) return
    if (req.method !== 'POST') {
      sendError(res, 'POST only', 405)
      return
    }
    try {
      const body = await parseBody(req)
      await ensureModules()
      if (!kbSearch) {
        sendError(res, 'Knowledge search not available')
        return
      }
      const { query, topK = 5, workspace } = body
      if (!query) {
        sendError(res, 'query is required')
        return
      }
      const results = await kbSearch.searchKnowledge({ query, topK })
      sendJson(res, { results, query })
    } catch (e: any) {
      sendError(res, e.message)
    }
    return
  }

  if (path === '/api/engine/search/direct') {
    sendError(res, 'searchKnowledgeDirect is not available in this build', 501)
    return
  }

  if (path.startsWith('/api/kb/')) {
    if (!authMiddleware(req, res)) return
    try {
      await ensureModules()
      const sub = path.slice(7)

      if (sub === 'ingest' && req.method === 'POST') {
        const body = await parseBody(req)
        const { filePath, workspace } = body
        if (!filePath) {
          sendError(res, 'filePath required')
          return
        }
        sendJson(res, {
          status: 'queued',
          filePath,
          message: 'File queued for ingestion',
        })
        return
      }

      if (sub === 'queue' && req.method === 'GET') {
        sendJson(res, { queue: [], message: 'KB pipeline queue endpoint' })
        return
      }

      if (sub === 'status' && req.method === 'GET') {
        sendJson(res, {
          indexed: 0,
          pending: 0,
          rejected: 0,
          total: 0,
          message: 'KB status endpoint',
        })
        return
      }

      if (sub === 'review' && req.method === 'POST') {
        const body = await parseBody(req)
        const { id, action, workspace } = body
        if (!id || !action) {
          sendError(res, 'id and action required')
          return
        }
        if (!['approve', 'reject'].includes(action)) {
          sendError(res, 'action must be approve or reject')
          return
        }
        sendJson(res, { status: 'ok', id, action, message: `Item ${action}d` })
        return
      }

      sendError(res, 'Not found', 404)
    } catch (e: any) {
      sendError(res, e.message)
    }
    return
  }

  if (path.startsWith('/api/gateway/')) {
    if (!authMiddleware(req, res)) return
    try {
      await ensureModules()
      const sub = path.slice(13)

      if (sub === 'session' && req.method === 'POST') {
        const body = await parseBody(req)
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`
        sendJson(res, {
          sessionId,
          status: 'created',
          workspace: config.workspaceRoot,
        })
        return
      }

      if (sub === 'job' && req.method === 'POST') {
        const body = await parseBody(req)
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
        sendJson(res, { jobId, status: 'submitted', message: 'Job submitted' })
        return
      }

      sendError(res, 'Not found', 404)
    } catch (e: any) {
      sendError(res, e.message)
    }
    return
  }

  if (path === '/api/mcp/call') {
    if (!authMiddleware(req, res)) return
    if (req.method !== 'POST') {
      sendError(res, 'POST only', 405)
      return
    }
    try {
      const body = await parseBody(req)
      const { tool, args } = body
      if (!tool) {
        sendError(res, 'tool name required')
        return
      }
      const tools: Record<string, (args: any) => Promise<any>> = {
        lammps_knowledge_search: async (a: any) => {
          await ensureModules()
          if (!kbSearch) throw new Error('Knowledge search not available')
          if (!a.query) throw new Error('query is required')
          return kbSearch.searchKnowledge({
            query: a.query,
            topK: a.limit || 5,
          })
        },
        lammps_kb_ingest: async (a: any) => ({
          status: 'queued',
          filePath: a.filePath,
        }),
        lammps_kb_queue: async () => ({ queue: [] }),
        lammps_kb_status: async () => ({ indexed: 0, pending: 0 }),
        lammps_kb_review: async (a: any) => ({
          status: 'ok',
          action: a.action,
        }),
        lammps_workflow_run: async (a: any) => ({
          jobId: `job_${Date.now()}`,
          status: 'submitted',
        }),
        lammps_paper_notes: async (a: any) => ({ notes: [], query: a.query }),
        gateway_session_create: async () => ({
          sessionId: `session_${Date.now()}`,
        }),
        gateway_job_submit: async (a: any) => ({
          jobId: `job_${Date.now()}`,
          status: 'submitted',
        }),
      }
      const handler = tools[tool]
      if (!handler) {
        sendError(res, `Unknown tool: ${tool}`)
        return
      }
      const result = await handler(args || {})
      sendJson(res, { result, tool })
    } catch (e: any) {
      sendError(res, e.message)
    }
    return
  }

  sendError(res, 'Not found', 404)
}

let server: ReturnType<typeof createServer> | null = null

export async function startEngine(configOverride?: Partial<EngineConfig>) {
  if (configOverride) setConfig(configOverride)
  log('info', `Starting LAMMPS AI Engine on ${config.host}:${config.port}`)
  log('info', `Workspace root: ${config.workspaceRoot}`)

  server = createServer(async (req, res) => {
    try {
      await route(req, res)
    } catch (e: any) {
      log('error', 'Unhandled route error', e.message)
      sendError(res, e.message)
    }
  })

  return new Promise<void>((resolve, reject) => {
    server!.listen(config.port, config.host, () => {
      log(
        'info',
        `LAMMPS AI Engine listening on http://${config.host}:${config.port}`,
      )
      log('info', 'Endpoints:')
      log('info', '  GET  /health              - Health check')
      log('info', '  GET  /api/tools           - List available tools')
      log('info', '  GET  /api/config          - Get config')
      log('info', '  PATCH /api/config         - Update config')
      log('info', '  POST /api/engine/search   - Knowledge search')
      log('info', '  POST /api/engine/search/direct - Direct knowledge search')
      log('info', '  POST /api/kb/ingest       - KB ingest')
      log('info', '  GET  /api/kb/queue        - KB queue')
      log('info', '  GET  /api/kb/status       - KB status')
      log('info', '  POST /api/kb/review       - KB review')
      log('info', '  POST /api/gateway/session - Gateway session')
      log('info', '  POST /api/gateway/job     - Gateway job')
      log('info', '  POST /api/mcp/call        - MCP tool call')
      resolve()
    })
    server!.on('error', reject)
  })
}

export function stopEngine() {
  if (server) {
    server.close()
    server = null
    log('info', 'Engine stopped')
  }
}
