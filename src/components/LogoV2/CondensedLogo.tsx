import * as React from 'react'
import { type ReactNode, useEffect } from 'react'
import { Box, Text, stringWidth } from '@anthropic/ink'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useAppState } from '../../state/AppState.js'
import { getEffortSuffix } from '../../utils/effort.js'
import { truncate } from '../../utils/format.js'
import { getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js'
import { renderModelSetting } from '../../utils/model/model.js'
import { permissionModeTitle } from '../../utils/permissions/PermissionMode.js'
import { OffscreenFreeze } from '../OffscreenFreeze.js'
import {
  AngxinWordmark,
  getAngxinWordmarkWidth,
  type AngxinWordmarkVariant,
} from './AngxinWordmark.js'
import {
  GuestPassesUpsell,
  incrementGuestPassesSeenCount,
  useShowGuestPassesUpsell,
} from './GuestPassesUpsell.js'
import {
  incrementOverageCreditUpsellSeenCount,
  OverageCreditUpsell,
  useShowOverageCreditUpsell,
} from './OverageCreditUpsell.js'

const WHITE = '#ffffff'
const LABEL_WIDTH = 13
const BOX_PADDING_X = 1
const SEPARATOR = ' / '

function formatInfoLine(label: string, value: string, maxWidth: number): string {
  const prefix = `${label}:`.padEnd(LABEL_WIDTH, ' ')
  return `${prefix}${truncate(value, Math.max(maxWidth - stringWidth(prefix), 8))}`
}

export function CondensedLogo(): ReactNode {
  const { columns } = useTerminalSize()
  const agent = useAppState(s => s.agent)
  const effortValue = useAppState(s => s.effortValue)
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)
  const model = useMainLoopModel()
  const modelDisplayName = renderModelSetting(model)
  const { version, cwd, billingType, agentName: agentNameFromSettings } =
    getLogoDisplayData()

  const agentName = agent ?? agentNameFromSettings
  const showGuestPassesUpsell = useShowGuestPassesUpsell()
  const showOverageCreditUpsell = useShowOverageCreditUpsell()

  useEffect(() => {
    if (showGuestPassesUpsell) {
      incrementGuestPassesSeenCount()
    }
  }, [showGuestPassesUpsell])

  useEffect(() => {
    if (showOverageCreditUpsell && !showGuestPassesUpsell) {
      incrementOverageCreditUpsellSeenCount()
    }
  }, [showOverageCreditUpsell, showGuestPassesUpsell])

  const heroWidth = getAngxinWordmarkWidth('hero')
  const compactWidth = getAngxinWordmarkWidth('compact')
  const logoVariant: AngxinWordmarkVariant =
    columns >= heroWidth ? 'hero' : 'compact'
  const wordmarkWidth =
    logoVariant === 'hero' ? heroWidth : compactWidth
  const cardWidth = Math.min(columns, wordmarkWidth)
  const innerWidth = Math.max(cardWidth - 2 - BOX_PADDING_X * 2, 20)

  const effortSuffix = getEffortSuffix(model, effortValue)
  const modelValue = truncate(
    modelDisplayName + effortSuffix,
    innerWidth - LABEL_WIDTH,
  )
  const cwdAvailableWidth = agentName
    ? innerWidth - LABEL_WIDTH - stringWidth(agentName) - SEPARATOR.length - 1
    : innerWidth - LABEL_WIDTH
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 8))
  const directoryValue = agentName
    ? `@${agentName}${SEPARATOR}${truncatedCwd}`
    : truncatedCwd
  const permissionsValue = truncate(
    permissionModeTitle(permissionMode),
    innerWidth - LABEL_WIDTH,
  )
  const billingValue = truncate(billingType, innerWidth - LABEL_WIDTH)
  const titleLine = truncate(`>_ ANGSHENG (v${version})`, innerWidth)

  return (
    <OffscreenFreeze>
      <Box flexDirection="column" alignItems="center">
        <AngxinWordmark variant={logoVariant} />
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={WHITE}
          paddingX={BOX_PADDING_X}
          width={cardWidth}
          flexDirection="column"
          alignItems="flex-start"
        >
          <Text color={WHITE}>{titleLine}</Text>
          <Text color={WHITE}>{' '}</Text>
          <Text color={WHITE}>
            {formatInfoLine('model', modelValue, innerWidth)}
          </Text>
          <Text color={WHITE}>
            {formatInfoLine('directory', directoryValue, innerWidth)}
          </Text>
          <Text color={WHITE}>
            {formatInfoLine('permissions', permissionsValue, innerWidth)}
          </Text>
          <Text color={WHITE}>
            {formatInfoLine('billing', billingValue, innerWidth)}
          </Text>
        </Box>
        {showGuestPassesUpsell && (
          <Box marginTop={1}>
            <GuestPassesUpsell />
          </Box>
        )}
        {!showGuestPassesUpsell && showOverageCreditUpsell && (
          <Box marginTop={1}>
            <OverageCreditUpsell maxWidth={innerWidth} twoLine />
          </Box>
        )}
      </Box>
    </OffscreenFreeze>
  )
}
