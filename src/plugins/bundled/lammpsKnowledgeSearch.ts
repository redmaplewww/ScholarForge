import { fileURLToPath } from 'url'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { isInBundledMode } from '../../utils/bundledMode.js'
import {
  LAMMPS_KNOWLEDGE_MCP_SERVER_NAME,
  LAMMPS_KNOWLEDGE_PLUGIN_NAME,
} from '../../utils/lammpsKnowledge/common.js'

export function registerLammpsKnowledgeSearchPlugin(): void {
  const fallbackCliPath = fileURLToPath(
    new URL('../../entrypoints/cli.tsx', import.meta.url),
  )
  const cliPath =
    process.argv[1] && process.argv[1] !== process.execPath
      ? process.argv[1]
      : fallbackCliPath
  const cliArgs = isInBundledMode()
    ? ['--lammps-knowledge-mcp']
    : [cliPath, '--lammps-knowledge-mcp']

  registerBuiltinPlugin({
    name: LAMMPS_KNOWLEDGE_PLUGIN_NAME,
    description:
      'Optional local SQLite FTS search for the embedded LAMMPS knowledge and case library.',
    version: '0.1.0',
    defaultEnabled: true,
    mcpServers: {
      [LAMMPS_KNOWLEDGE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: cliArgs,
        env: {
          LAMMPS_KNOWLEDGE_WORKSPACE_ROOT: process.cwd(),
        },
      },
    },
  })
}
