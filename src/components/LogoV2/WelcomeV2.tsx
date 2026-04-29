import React from 'react'
import { Box, Text } from '@anthropic/ink'
import {
  AngxinWordmark,
  getAngxinWordmarkWidth,
} from './AngxinWordmark.js'

const WHITE = '#ffffff'
const WELCOME_PANEL_WIDTH = getAngxinWordmarkWidth('hero')
const WELCOME_V2_WIDTH = WELCOME_PANEL_WIDTH + 6
const LABEL_WIDTH = 11

function formatInfoLine(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH, ' ')}${value}`
}

export function WelcomeV2(): React.ReactNode {
  return (
    <Box width={WELCOME_V2_WIDTH} justifyContent="center">
      <Box flexDirection="column" width="100%" alignItems="center">
        <Text dimColor>Welcome to</Text>
        <Box marginTop={1} marginBottom={1}>
          <AngxinWordmark variant="hero" />
        </Box>
        <Box
          borderStyle="round"
          borderColor={WHITE}
          paddingX={1}
          paddingY={0}
          width={WELCOME_PANEL_WIDTH}
          flexDirection="column"
          alignItems="flex-start"
        >
          <Text color={WHITE}>{`>_ ANGSHENG (v${MACRO.VERSION})`}</Text>
          <Text color={WHITE}>{' '}</Text>
          <Text color={WHITE}>
            {formatInfoLine('brand', 'terminal workspace')}
          </Text>
          <Text color={WHITE}>
            {formatInfoLine('style', 'interactive welcome')}
          </Text>
          <Text color={WHITE}>
            {formatInfoLine('version', `v${MACRO.VERSION}`)}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
