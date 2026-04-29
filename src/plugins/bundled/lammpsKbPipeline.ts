import { fileURLToPath } from 'url'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { isInBundledMode } from '../../utils/bundledMode.js'
import {
  LAMMPS_KB_PIPELINE_MCP_SERVER_NAME,
  LAMMPS_KB_PIPELINE_PLUGIN_NAME,
} from '../../utils/lammpsKbPipeline/common.js'

export function registerLammpsKbPipelinePlugin(): void {
  const fallbackCliPath = fileURLToPath(
    new URL('../../entrypoints/cli.tsx', import.meta.url),
  )
  const cliPath =
    process.argv[1] && process.argv[1] !== process.execPath
      ? process.argv[1]
      : fallbackCliPath
  const cliArgs = isInBundledMode()
    ? ['--lammps-kb-pipeline-mcp']
    : [cliPath, '--lammps-kb-pipeline-mcp']

  registerBuiltinPlugin({
    name: LAMMPS_KB_PIPELINE_PLUGIN_NAME,
    description:
      'Isolated LAMMPS knowledge-base processing pipeline for ingesting, reviewing, quarantining, and promoting content into knowledge/.',
    version: '0.1.0',
    defaultEnabled: true,
    mcpServers: {
      [LAMMPS_KB_PIPELINE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: cliArgs,
        env: {
          LAMMPS_KB_PIPELINE_WORKSPACE_ROOT: process.cwd(),
        },
      },
    },
  })
}
