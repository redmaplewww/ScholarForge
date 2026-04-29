// @ts-nocheck
/**
 * mcpServer.ts - 领域知识 MCP 服务器（模板）
 * 提供知识检索的 MCP 工具接口。
 * 使用前需安装 @modelcontextprotocol/sdk 并注册到项目 MCP 配置。
 */
import { searchKnowledge } from './search'
import { synthesize } from './synthesize'
import { buildIndex } from './indexer'

const SERVER_NAME = 'domain-knowledge'
const SERVER_VERSION = '1.0.0'

export function createKnowledgeServer() {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: [
      {
        name: 'search_domain_knowledge',
        description: '搜索领域知识库，包括规则、案例和历史经验',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询' },
          },
          required: ['query'],
        },
        handler: async (args: { query: string }) => {
          const results = searchKnowledge(args.query)
          const synth = synthesize(results, args.query)
          return {
            content: [{ type: 'text', text: JSON.stringify(synth, null, 2) }],
          }
        },
      },
      {
        name: 'rebuild_knowledge_index',
        description: '重建知识库索引',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const entries = buildIndex()
          return {
            content: [
              {
                type: 'text',
                text: `索引已重建，共 ${entries.length} 条目`,
              },
            ],
          }
        },
      },
    ],
  }
}

// 如果直接运行此文件，启动 MCP 服务器
if (import.meta.main) {
  console.log(`[${SERVER_NAME}] MCP 服务器模板 v${SERVER_VERSION}`)
  console.log('请将此服务器注册到项目的 MCP 配置中以启用。')
}
