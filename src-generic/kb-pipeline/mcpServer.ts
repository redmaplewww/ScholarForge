// @ts-nocheck
/**
 * mcpServer.ts - KB Pipeline MCP 服务器（模板）
 */
const SERVER_NAME = 'domain-kb-pipeline'
const SERVER_VERSION = '1.0.0'

export function createKBPipelineServer() {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: [
      {
        name: 'ingest_knowledge',
        description: '将新知识条目导入管道',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '原始内容' },
            source: { type: 'string', description: '来源' },
          },
          required: ['content', 'source'],
        },
        handler: async (args: { content: string; source: string }) => {
          return {
            content: [
              {
                type: 'text',
                text: `知识条目已提交到管道，来源: ${args.source}`,
              },
            ],
          }
        },
      },
    ],
  }
}

if (import.meta.main) {
  console.log(`[${SERVER_NAME}] MCP 服务器模板 v${SERVER_VERSION}`)
}
