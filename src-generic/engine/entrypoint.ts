// @ts-nocheck
/**
 * entrypoint.ts - HTTP API 入口（模板）
 */
const PORT = parseInt(process.env.PORT || '3000')

export async function startServer() {
  console.log(`[engine] 服务器启动于端口 ${PORT}`)
  console.log('[engine] 这是模板入口，请根据领域需求自定义')
}

if (import.meta.main) {
  startServer()
}
