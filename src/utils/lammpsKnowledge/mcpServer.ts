import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { jsonStringify } from '../slowOperations.js'
import { LAMMPS_KNOWLEDGE_MCP_SERVER_NAME, getWorkspaceRoot } from './common.js'
import {
  buildKnowledgeIndex,
  getKnowledgeIndexStatus,
  updateKnowledgeIndexIncrementally,
} from './indexer.js'
import { searchKnowledge } from './search.js'
import { pullFromRemote, pushToRemote, getSyncStatus } from './syncService.js'
import {
  buildRemoteKnowledgeIndex,
  updateRemoteKnowledgeIndexIncrementally,
  getRemoteIndexStatus,
} from './remoteIndexer.js'
import { listVersions, restoreVersion } from './backupManager.js'
import { isRemoteConfigured, getRemoteDir } from './remoteCommon.js'

const TOOLS: Tool[] = [
  {
    name: 'search_lammps_knowledge',
    description:
      'Search the local LAMMPS SQLite knowledge index for cases, summaries, and experience notes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query.' },
        topK: { type: 'integer', minimum: 1, maximum: 20 },
        family: { type: 'string' },
        materialSystem: { type: 'string' },
        potentialFamily: { type: 'string' },
        stage: { type: 'string' },
        fileType: { type: 'string' },
        sourceTypes: { type: 'array', items: { type: 'string' } },
        autoIndex: { type: 'boolean' },
        includeRemote: { type: 'boolean', description: 'Also search remote knowledge index.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'index_lammps_knowledge',
    description:
      'Apply an incremental update to the local SQLite FTS knowledge database.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['incremental', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'reindex_lammps_knowledge',
    description:
      'Force a full rebuild of the local SQLite FTS knowledge database.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_lammps_knowledge_status',
    description:
      'Inspect whether the local LAMMPS SQLite knowledge index exists and how large it is.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sync_knowledge_pull',
    description:
      'Pull latest knowledge base from remote server to local .knowledge-remote/ directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sync_knowledge_push',
    description:
      'Push local knowledge base changes to remote server, creating an incremental backup.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sync_knowledge_status',
    description:
      'Show sync status: local/remote version, file counts, pending changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'sync_knowledge_backup',
    description:
      'List backup versions or restore to a specific version.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['list', 'restore'], description: 'List versions or restore to a specific version.' },
        version: { type: 'integer', description: 'Version number to restore (only for restore action).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'index_remote_knowledge',
    description:
      'Build or update the remote knowledge index (SQLite FTS for .knowledge-remote/).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['incremental', 'full'] },
      },
      additionalProperties: false,
    },
  },
]

export async function runLammpsKnowledgeMcpServer(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot()
  const server = new Server(
    {
      name: LAMMPS_KNOWLEDGE_MCP_SERVER_NAME,
      version: MACRO.VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({ tools: [...TOOLS] }),
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      try {
        if (name === 'search_lammps_knowledge') {
          const payload = (args ?? {}) as Record<string, unknown>
          return asText(
            await searchKnowledge({
              query: String(payload.query ?? ''),
              topK: typeof payload.topK === 'number' ? payload.topK : undefined,
              family:
                typeof payload.family === 'string' ? payload.family : undefined,
              materialSystem:
                typeof payload.materialSystem === 'string'
                  ? payload.materialSystem
                  : undefined,
              potentialFamily:
                typeof payload.potentialFamily === 'string'
                  ? payload.potentialFamily
                  : undefined,
              stage:
                typeof payload.stage === 'string' ? payload.stage : undefined,
              fileType:
                typeof payload.fileType === 'string'
                  ? payload.fileType
                  : undefined,
              sourceTypes: Array.isArray(payload.sourceTypes)
                ? payload.sourceTypes.filter(
                    (item): item is string => typeof item === 'string',
                  )
                : undefined,
              autoIndex:
                typeof payload.autoIndex === 'boolean'
                  ? payload.autoIndex
                  : undefined,
              includeRemote:
                typeof payload.includeRemote === 'boolean'
                  ? payload.includeRemote
                  : undefined,
            }),
          )
        }

        if (name === 'index_lammps_knowledge') {
          const payload = (args ?? {}) as Record<string, unknown>
          const mode = payload.mode === 'full' ? 'full' : 'incremental'
          return asText(
            mode === 'full'
              ? await buildKnowledgeIndex({ workspaceRoot })
              : await updateKnowledgeIndexIncrementally({ workspaceRoot }),
          )
        }

        if (name === 'reindex_lammps_knowledge') {
          return asText(await buildKnowledgeIndex({ workspaceRoot }))
        }

        if (name === 'get_lammps_knowledge_status') {
          return asText(getKnowledgeIndexStatus(workspaceRoot))
        }

        if (name === 'sync_knowledge_pull') {
          if (!isRemoteConfigured()) {
            return { isError: true, content: [{ type: 'text', text: 'Remote not configured. Set LAMMPS_KNOWLEDGE_REMOTE_URL and LAMMPS_KNOWLEDGE_REMOTE_TOKEN.' }] }
          }
          return asText(await pullFromRemote(workspaceRoot))
        }

        if (name === 'sync_knowledge_push') {
          if (!isRemoteConfigured()) {
            return { isError: true, content: [{ type: 'text', text: 'Remote not configured. Set LAMMPS_KNOWLEDGE_REMOTE_URL and LAMMPS_KNOWLEDGE_REMOTE_TOKEN.' }] }
          }
          return asText(await pushToRemote(workspaceRoot))
        }

        if (name === 'sync_knowledge_status') {
          return asText(await getSyncStatus(workspaceRoot))
        }

        if (name === 'sync_knowledge_backup') {
          const payload = (args ?? {}) as Record<string, unknown>
          const action = payload.action === 'restore' ? 'restore' : 'list'
          if (action === 'restore') {
            const version = typeof payload.version === 'number' ? payload.version : 0
            if (version <= 0) {
              return { isError: true, content: [{ type: 'text', text: 'version is required for restore action.' }] }
            }
            const remoteDir = getRemoteDir(workspaceRoot)
            const result = await restoreVersion(version, remoteDir, workspaceRoot)
            return asText(result)
          }
          return asText(await listVersions(workspaceRoot))
        }

        if (name === 'index_remote_knowledge') {
          const payload = (args ?? {}) as Record<string, unknown>
          const mode = payload.mode === 'full' ? 'full' : 'incremental'
          return asText(
            mode === 'full'
              ? await buildRemoteKnowledgeIndex({ workspaceRoot })
              : await updateRemoteKnowledgeIndexIncrementally({ workspaceRoot }),
          )
        }

        throw new Error(`Unknown tool: ${name}`)
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        }
      }
    },
  )

  const transport = new StdioServerTransport()
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('error', () => process.exit(0))
  await server.connect(transport)
}

function asText(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: jsonStringify(value),
      },
    ],
  }
}
