// @ts-nocheck
/**
 * mcp-bridge.ts - MCP 桥接器（模板）
 */
export function createMCPBridge() {
  return {
    name: 'mcp-bridge',
    version: '1.0.0',
  }
}

if (import.meta.main) {
  console.log('[mcp-bridge] MCP 桥接器模板')
}
