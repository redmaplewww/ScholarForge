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
import {
  LAMMPS_KB_PIPELINE_MCP_SERVER_NAME,
  type PipelineContentType,
  type PipelineQuality,
  type PipelineStatus,
} from './common.js'
import {
  applyReviewDecision,
  getEntry,
  getPipelineStatus,
  ingestContent,
  listReviewQueue,
  searchEntries,
} from './store.js'

const PIPELINE_STATUSES: PipelineStatus[] = [
  'candidate',
  'confirmed',
  'pending_review',
  'quarantined',
]

const PIPELINE_CONTENT_TYPES: PipelineContentType[] = [
  'case',
  'case_note',
  'correction',
  'dialogue',
  'error',
  'experience',
  'input_script',
  'output_log',
  'potential_note',
  'qa',
  'rule',
  'template_snippet',
  'unknown',
]

const PIPELINE_QUALITIES: PipelineQuality[] = [
  'gold_candidate',
  'noise',
  'uncertain',
  'useful',
]

const TOOLS: Tool[] = [
  {
    name: 'ingest_lammps_kb_content',
    description:
      'Ingest LAMMPS-related content into the isolated KB pipeline, classify it, and stage it for review or quarantine.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string' },
        filePath: { type: 'string' },
        sourceType: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'review_lammps_kb_queue',
    description:
      'List candidate and pending-review items waiting for curator or reviewer handling.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_lammps_kb_entry',
    description: 'Inspect one KB pipeline entry in detail.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entryId: { type: 'string' },
      },
      required: ['entryId'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_lammps_kb_review_decision',
    description:
      'Promote, keep as candidate, or quarantine a KB pipeline entry and write the result to the correct folder.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entryId: { type: 'string' },
        decision: {
          type: 'string',
          enum: ['candidate', 'confirmed', 'quarantined'],
        },
        destination: { type: 'string' },
        reviewer: { type: 'string' },
        rationale: { type: 'string' },
        summary: { type: 'string' },
        lesson: { type: 'string' },
        knowledgeType: { type: 'string' },
        mergeMode: { type: 'string', enum: ['append', 'replace', 'new_entry'] },
        mergeTarget: { type: 'string' },
        applicability: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        evidencePaths: { type: 'array', items: { type: 'string' } },
      },
      required: ['entryId', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_lammps_kb_pipeline',
    description:
      'Search the isolated LAMMPS KB pipeline store by text and optional filters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        topK: { type: 'integer', minimum: 1, maximum: 25 },
        status: { type: 'string' },
        contentType: { type: 'string' },
        stage: { type: 'string' },
        quality: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_lammps_kb_pipeline_status',
    description:
      'Inspect counts and storage paths for the isolated LAMMPS KB pipeline.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
]

export async function runLammpsKbPipelineMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: LAMMPS_KB_PIPELINE_MCP_SERVER_NAME,
      version: MACRO.VERSION,
    },
    {
      capabilities: { tools: {} },
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
        const payload = (args ?? {}) as Record<string, unknown>
        if (name === 'ingest_lammps_kb_content') {
          return asText(
            await ingestContent({
              content:
                typeof payload.content === 'string'
                  ? payload.content
                  : undefined,
              filePath:
                typeof payload.filePath === 'string'
                  ? payload.filePath
                  : undefined,
              sourceType:
                typeof payload.sourceType === 'string'
                  ? payload.sourceType
                  : undefined,
              title:
                typeof payload.title === 'string' ? payload.title : undefined,
              tags: Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (item): item is string => typeof item === 'string',
                  )
                : undefined,
            }),
          )
        }
        if (name === 'review_lammps_kb_queue') {
          return asText(
            listReviewQueue(
              typeof payload.limit === 'number' ? payload.limit : undefined,
            ),
          )
        }
        if (name === 'get_lammps_kb_entry') {
          return asText(getEntry(String(payload.entryId ?? '')))
        }
        if (name === 'apply_lammps_kb_review_decision') {
          return asText(
            await applyReviewDecision({
              entryId: String(payload.entryId ?? ''),
              decision: String(payload.decision ?? '') as
                | 'candidate'
                | 'confirmed'
                | 'quarantined',
              destination:
                typeof payload.destination === 'string'
                  ? payload.destination
                  : undefined,
              reviewer:
                typeof payload.reviewer === 'string'
                  ? payload.reviewer
                  : undefined,
              rationale:
                typeof payload.rationale === 'string'
                  ? payload.rationale
                  : undefined,
              summary:
                typeof payload.summary === 'string'
                  ? payload.summary
                  : undefined,
              lesson:
                typeof payload.lesson === 'string' ? payload.lesson : undefined,
              knowledgeType: asEnum(
                payload.knowledgeType,
                PIPELINE_CONTENT_TYPES,
              ),
              mergeMode:
                payload.mergeMode === 'append' ||
                payload.mergeMode === 'replace' ||
                payload.mergeMode === 'new_entry'
                  ? payload.mergeMode
                  : undefined,
              mergeTarget:
                typeof payload.mergeTarget === 'string'
                  ? payload.mergeTarget
                  : undefined,
              applicability:
                typeof payload.applicability === 'string'
                  ? payload.applicability
                  : undefined,
              title:
                typeof payload.title === 'string' ? payload.title : undefined,
              tags: Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (item): item is string => typeof item === 'string',
                  )
                : undefined,
              evidencePaths: Array.isArray(payload.evidencePaths)
                ? payload.evidencePaths.filter(
                    (item): item is string => typeof item === 'string',
                  )
                : undefined,
            }),
          )
        }
        if (name === 'search_lammps_kb_pipeline') {
          return asText(
            searchEntries({
              query: String(payload.query ?? ''),
              topK: typeof payload.topK === 'number' ? payload.topK : undefined,
              status: asEnum(payload.status, PIPELINE_STATUSES),
              contentType: asEnum(payload.contentType, PIPELINE_CONTENT_TYPES),
              stage:
                typeof payload.stage === 'string' ? payload.stage : undefined,
              quality: asEnum(payload.quality, PIPELINE_QUALITIES),
            }),
          )
        }
        if (name === 'get_lammps_kb_pipeline_status') {
          return asText(getPipelineStatus())
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

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string') return undefined
  return allowed.includes(value as T) ? (value as T) : undefined
}
