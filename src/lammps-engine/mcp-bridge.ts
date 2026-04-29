import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MCP_BRIDGE_VERSION = '1.0.0'

interface McpRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: any
}

interface McpResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: any
  error?: { code: number; message: string; data?: any }
}

let engineUrl = 'http://127.0.0.1:3847'
let engineApiKey = ''
let requestId = 1

function send(id: number | string | null, result: any) {
  const response: McpResponse = { jsonrpc: '2.0', id, result }
  process.stdout.write(JSON.stringify(response) + '\n')
}

function sendError(
  id: number | string | null,
  code: number,
  message: string,
  data?: any,
) {
  const response: McpResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  }
  process.stdout.write(JSON.stringify(response) + '\n')
}

async function httpCall(method: string, params?: any): Promise<any> {
  const url = `${engineUrl}${method}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (engineApiKey) {
    headers['X-Engine-Key'] = engineApiKey
  }

  const body = JSON.stringify(params || {})

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    return await res.json()
  } catch (e: any) {
    throw new Error(`Engine call failed: ${e.message}`)
  }
}

const TOOL_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  lammps_knowledge_search: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_knowledge_search',
      args,
    })
    return data.result
  },
  lammps_kb_ingest: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_kb_ingest',
      args,
    })
    return data.result
  },
  lammps_kb_queue: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_kb_queue',
      args,
    })
    return data.result
  },
  lammps_kb_status: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_kb_status',
      args,
    })
    return data.result
  },
  lammps_kb_review: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_kb_review',
      args,
    })
    return data.result
  },
  lammps_workflow_run: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_workflow_run',
      args,
    })
    return data.result
  },
  lammps_paper_notes: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'lammps_paper_notes',
      args,
    })
    return data.result
  },
  gateway_session_create: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'gateway_session_create',
      args,
    })
    return data.result
  },
  gateway_job_submit: async (args: any) => {
    const data = await httpCall('/api/mcp/call', {
      tool: 'gateway_job_submit',
      args,
    })
    return data.result
  },
}

const TOOL_DEFINITIONS = [
  {
    name: 'lammps_knowledge_search',
    description:
      'Search LAMMPS knowledge base with semantic matching. Use for finding relevant LAMMPS documentation, examples, and research notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
        workspace: { type: 'string', description: 'Workspace root override' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lammps_kb_ingest',
    description: 'Ingest files into the knowledge base pipeline for indexing.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file to ingest' },
        workspace: { type: 'string', description: 'Workspace root override' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'lammps_kb_queue',
    description: 'List all files queued for knowledge base processing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lammps_kb_status',
    description: 'Get knowledge base pipeline status and statistics.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lammps_kb_review',
    description: 'Review and approve or reject a queued knowledge base item.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Item ID' },
        action: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'Review action',
        },
        workspace: { type: 'string', description: 'Workspace root override' },
      },
      required: ['id', 'action'],
    },
  },
  {
    name: 'lammps_workflow_run',
    description: 'Execute a LAMMPS simulation workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow name or path' },
        config: { type: 'object', description: 'Workflow configuration' },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'lammps_paper_notes',
    description: 'Query paper research notes and citations.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for paper notes' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gateway_session_create',
    description: 'Create a gateway session for distributed computation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gateway_job_submit',
    description: 'Submit a job to the gateway for execution.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'object', description: 'Job specification' },
      },
      required: ['job'],
    },
  },
]

process.stdin.setEncoding('utf-8')

let buffer = ''

function parseMessages(raw: string) {
  const messages: string[] = []
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\n') {
      const line = raw.slice(start, i).trim()
      if (line) messages.push(line)
      start = i + 1
    }
  }
  const tail = raw.slice(start).trim()
  if (tail) messages.push(tail)
  return messages
}

async function handleMessage(line: string) {
  let req: McpRequest
  try {
    req = JSON.parse(line)
  } catch {
    sendError(null, -32700, 'Parse error')
    return
  }

  if (req.method === 'initialize') {
    engineUrl = req.params?.engineUrl || engineUrl
    engineApiKey = req.params?.engineApiKey || engineApiKey
    send(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lammps-ai-engine-mcp', version: MCP_BRIDGE_VERSION },
    })
    return
  }

  if (req.method === 'tools/list') {
    send(req.id, { tools: TOOL_DEFINITIONS })
    return
  }

  if (req.method === 'tools/call') {
    const toolName = req.params?.name
    const args = req.params?.arguments || {}

    if (!toolName) {
      sendError(req.id, -32602, 'Missing tool name')
      return
    }

    const handler = TOOL_HANDLERS[toolName]
    if (!handler) {
      sendError(req.id, -32602, `Unknown tool: ${toolName}`)
      return
    }

    try {
      const result = await handler(args)
      send(req.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      })
    } catch (e: any) {
      send(req.id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      })
    }
    return
  }

  if (req.method === 'ping') {
    send(req.id, {})
    return
  }

  send(req.id, null)
}

async function checkEngine() {
  try {
    const res = await fetch(`${engineUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) return true
  } catch {
    return false
  }
  return false
}

async function bootstrap() {
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk
    const messages = parseMessages(buffer)
    buffer = ''

    for (const msg of messages) {
      await handleMessage(msg)
    }
  })

  process.stdin.on('end', () => {
    process.exit(0)
  })

  process.stderr.write(
    `[lammps-engine-mcp] Bridge v${MCP_BRIDGE_VERSION} started\n`,
  )
  process.stderr.write(`[lammps-engine-mcp] Engine URL: ${engineUrl}\n`)
  process.stderr.write(
    `[lammps-engine-mcp] Waiting for MCP protocol messages...\n`,
  )
}

bootstrap()
