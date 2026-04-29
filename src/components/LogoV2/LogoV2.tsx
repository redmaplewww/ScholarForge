// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import * as React from 'react'
import { Box, Text, stringWidth } from '@anthropic/ink'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import {
  getLayoutMode,
  truncatePath,
  getLogoDisplayData,
} from '../../utils/logoV2Utils.js'
import { truncate } from '../../utils/format.js'
import { getDisplayPath } from '../../utils/file.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'
import {
  isDebugMode,
  isDebugToStdErr,
  getDebugLogPath,
} from 'src/utils/debug.js'
import { useEffect, useState } from 'react'
import {
  shouldShowProjectOnboarding,
  incrementProjectOnboardingSeenCount,
} from '../../projectOnboardingState.js'
import { CondensedLogo } from './CondensedLogo.js'
import {
  AngxinWordmark,
  getAngxinWordmarkWidth,
  type AngxinWordmarkVariant,
} from './AngxinWordmark.js'
import { permissionModeTitle } from '../../utils/permissions/PermissionMode.js'
import { OffscreenFreeze } from '../OffscreenFreeze.js'
import { checkForReleaseNotesSync } from '../../utils/releaseNotes.js'
import { getDumpPromptsPath } from 'src/services/api/dumpPrompts.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import {
  getStartupPerfLogPath,
  isDetailedProfilingEnabled,
} from 'src/utils/startupProfiler.js'
import { EmergencyTip } from './EmergencyTip.js'
import { VoiceModeNotice } from './VoiceModeNotice.js'
import { Opus1mMergeNotice } from './Opus1mMergeNotice.js'
import { GateOverridesWarning } from './GateOverridesWarning.js'
import { ExperimentEnrollmentNotice } from './ExperimentEnrollmentNotice.js'
import { feature } from 'bun:bundle'

// Conditional require so ChannelsNotice.tsx tree-shakes when both flags are
// false. A module-scope helper component inside a feature() ternary does NOT
// tree-shake (docs/feature-gating.md); the require pattern eliminates the
// whole file. VoiceModeNotice uses the unsafe helper pattern but VOICE_MODE
// is external: true so it's moot there.
/* eslint-disable @typescript-eslint/no-require-imports */
const ChannelsNoticeModule =
  feature('KAIROS') || feature('KAIROS_CHANNELS')
    ? (require('./ChannelsNotice.js') as typeof import('./ChannelsNotice.js'))
    : null
/* eslint-enable @typescript-eslint/no-require-imports */
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  useShowGuestPassesUpsell,
  incrementGuestPassesSeenCount,
} from './GuestPassesUpsell.js'
import {
  useShowOverageCreditUpsell,
  incrementOverageCreditUpsellSeenCount,
} from './OverageCreditUpsell.js'
import { useAppState } from '../../state/AppState.js'
import { getEffortSuffix } from '../../utils/effort.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { renderModelSetting } from '../../utils/model/model.js'

const WHITE = '#ffffff'
const LABEL_WIDTH = 13
const BOX_PADDING_X = 1
const SEPARATOR = ' / '

function formatInfoLine(label: string, value: string, maxWidth: number): string {
  const prefix = `${label}:`.padEnd(LABEL_WIDTH, ' ')
  return `${prefix}${truncate(value, Math.max(maxWidth - stringWidth(prefix), 8))}`
}

export function LogoV2(): React.ReactNode {
  const { columns } = useTerminalSize()
  const showOnboarding = shouldShowProjectOnboarding()
  const showSandboxStatus = SandboxManager.isSandboxingEnabled()
  const showGuestPassesUpsell = useShowGuestPassesUpsell()
  const showOverageCreditUpsell = useShowOverageCreditUpsell()
  const agent = useAppState(s => s.agent)
  const effortValue = useAppState(s => s.effortValue)
  const permissionMode = useAppState(s => s.toolPermissionContext.mode)

  const config = getGlobalConfig()

  // Get company announcements and select one:
  // - First startup (numStartups === 1): show first announcement
  // - All other startups: randomly select from announcements
  const [announcement] = useState(() => {
    const announcements = getInitialSettings().companyAnnouncements
    if (!announcements || announcements.length === 0) return undefined
    return config.numStartups === 1
      ? announcements[0]
      : announcements[Math.floor(Math.random() * announcements.length)]
  })
  const { hasReleaseNotes } = checkForReleaseNotesSync(
    config.lastReleaseNotesSeen,
  )

  useEffect(() => {
    const currentConfig = getGlobalConfig()
    if (currentConfig.lastReleaseNotesSeen === MACRO.VERSION) {
      return
    }
    saveGlobalConfig(current => {
      if (current.lastReleaseNotesSeen === MACRO.VERSION) return current
      return { ...current, lastReleaseNotesSeen: MACRO.VERSION }
    })
    if (showOnboarding) {
      incrementProjectOnboardingSeenCount()
    }
  }, [config, showOnboarding])

  // In condensed mode (early-return below renders <CondensedLogo/>),
  // CondensedLogo's own useEffect handles the impression count. Skipping
  // here avoids double-counting since hooks fire before the early return.
  const isCondensedMode =
    !hasReleaseNotes &&
    !showOnboarding &&
    !isEnvTruthy(process.env.CLAUDE_CODE_FORCE_FULL_LOGO)

  useEffect(() => {
    if (showGuestPassesUpsell && !showOnboarding && !isCondensedMode) {
      incrementGuestPassesSeenCount()
    }
  }, [showGuestPassesUpsell, showOnboarding, isCondensedMode])

  useEffect(() => {
    if (
      showOverageCreditUpsell &&
      !showOnboarding &&
      !showGuestPassesUpsell &&
      !isCondensedMode
    ) {
      incrementOverageCreditUpsellSeenCount()
    }
  }, [
    showOverageCreditUpsell,
    showOnboarding,
    showGuestPassesUpsell,
    isCondensedMode,
  ])

  const model = useMainLoopModel()
  const fullModelDisplayName = renderModelSetting(model)
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings,
  } = getLogoDisplayData()
  // Prefer AppState.agent (set from --agent CLI flag) over settings
  const agentName = agent ?? agentNameFromSettings
  const effortSuffix = getEffortSuffix(model, effortValue)
  const modelDisplayName = fullModelDisplayName + effortSuffix

  // Show condensed logo if no new changelog and not showing onboarding and not forcing full logo
  if (
    !hasReleaseNotes &&
    !showOnboarding &&
    !isEnvTruthy(process.env.CLAUDE_CODE_FORCE_FULL_LOGO)
  ) {
    return (
      <>
        <CondensedLogo />
        <VoiceModeNotice />
        <Opus1mMergeNotice />
        {ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />}
        {isDebugMode() && (
          <Box paddingLeft={2} flexDirection="column">
            <Text color="warning">Debug mode enabled</Text>
            <Text dimColor>
              Logging to: {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}
            </Text>
          </Box>
        )}
        <EmergencyTip />
        {process.env.CLAUDE_CODE_TMUX_SESSION && (
          <Box paddingLeft={2} flexDirection="column">
            <Text dimColor>
              tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION}
            </Text>
            <Text dimColor>
              {process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS
                ? `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Agent Aura uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})`
                : `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}
            </Text>
          </Box>
        )}
        {announcement && (
          <Box paddingLeft={2} flexDirection="column">
            {!process.env.IS_DEMO && config.oauthAccount?.organizationName && (
              <Text dimColor>
                Message from {config.oauthAccount.organizationName}:
              </Text>
            )}
            <Text>{announcement}</Text>
          </Box>
        )}
        {process.env.USER_TYPE === 'ant' && !process.env.DEMO_VERSION && (
          <Box paddingLeft={2} flexDirection="column">
            <Text dimColor>Use /issue to report model behavior issues</Text>
          </Box>
        )}
        {process.env.USER_TYPE === 'ant' && !process.env.DEMO_VERSION && (
          <Box paddingLeft={2} flexDirection="column">
            <Text color="warning">[ANT-ONLY] Logs:</Text>
            <Text dimColor>
              API calls: {getDisplayPath(getDumpPromptsPath())}
            </Text>
            <Text dimColor>
              Debug logs: {getDisplayPath(getDebugLogPath())}
            </Text>
            {isDetailedProfilingEnabled() && (
              <Text dimColor>
                Startup Perf: {getDisplayPath(getStartupPerfLogPath())}
              </Text>
            )}
          </Box>
        )}
        {process.env.USER_TYPE === 'ant' && <GateOverridesWarning />}
        {process.env.USER_TYPE === 'ant' && <ExperimentEnrollmentNotice />}
      </>
    )
  }

  // Calculate layout and display values
  const layoutMode = getLayoutMode(columns)

  // Wordmark + config box layout (Gemini/Codex style)
  const heroWidth = getAngxinWordmarkWidth('hero')
  const compactWidth = getAngxinWordmarkWidth('compact')
  const logoVariant: AngxinWordmarkVariant =
    columns >= heroWidth ? 'hero' : 'compact'
  const wordmarkWidth = logoVariant === 'hero' ? heroWidth : compactWidth
  const cardWidth = Math.min(columns, wordmarkWidth)
  const innerWidth = Math.max(cardWidth - 2 - BOX_PADDING_X * 2, 20)

  const modelValue = truncate(modelDisplayName, innerWidth - LABEL_WIDTH)
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

  // Early return for compact mode — same Codex-style config box, just narrower
  if (layoutMode === 'compact') {
    const compactCardWidth = Math.min(columns, cardWidth)
    const compactInnerWidth = Math.max(compactCardWidth - 2 - BOX_PADDING_X * 2, 20)
    const compactTitleLine = truncate(`>_ ANGSHENG (v${version})`, compactInnerWidth)
    const compactModelValue = truncate(modelDisplayName, compactInnerWidth - LABEL_WIDTH)
    const compactCwdAvail = agentName
      ? compactInnerWidth - LABEL_WIDTH - stringWidth(agentName) - SEPARATOR.length - 1
      : compactInnerWidth - LABEL_WIDTH
    const compactCwd = truncatePath(cwd, Math.max(compactCwdAvail, 8))
    const compactDirValue = agentName
      ? `@${agentName}${SEPARATOR}${compactCwd}`
      : compactCwd
    const compactPermValue = truncate(permissionModeTitle(permissionMode), compactInnerWidth - LABEL_WIDTH)
    const compactBillingValue = truncate(billingType, compactInnerWidth - LABEL_WIDTH)

    return (
      <>
        <OffscreenFreeze>
          <Box flexDirection="column" alignItems="center">
            <AngxinWordmark variant={logoVariant} />
            <Box
              borderStyle="round"
              borderColor={WHITE}
              paddingX={BOX_PADDING_X}
              width={compactCardWidth}
              flexDirection="column"
              alignItems="flex-start"
            >
              <Text color={WHITE}>{compactTitleLine}</Text>
              <Text color={WHITE}>{' '}</Text>
              <Text color={WHITE}>{formatInfoLine('model', compactModelValue, compactInnerWidth)}</Text>
              <Text color={WHITE}>{formatInfoLine('directory', compactDirValue, compactInnerWidth)}</Text>
              <Text color={WHITE}>{formatInfoLine('permissions', compactPermValue, compactInnerWidth)}</Text>
              <Text color={WHITE}>{formatInfoLine('billing', compactBillingValue, compactInnerWidth)}</Text>
            </Box>
          </Box>
        </OffscreenFreeze>
        <VoiceModeNotice />
        <Opus1mMergeNotice />
        {ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />}
        {showSandboxStatus && (
          <Box marginTop={1} flexDirection="column">
            <Text color="warning">
              Your bash commands will be sandboxed. Disable with /sandbox.
            </Text>
          </Box>
        )}
        {process.env.USER_TYPE === 'ant' && <GateOverridesWarning />}
        {process.env.USER_TYPE === 'ant' && <ExperimentEnrollmentNotice />}
      </>
    )
  }

  return (
    <>
      <OffscreenFreeze>
        <Box flexDirection="column" alignItems="center">
          <AngxinWordmark variant={logoVariant} />
          <Box
            borderStyle="round"
            borderColor={WHITE}
            paddingX={BOX_PADDING_X}
            width={cardWidth}
            flexDirection="column"
            alignItems="flex-start"
          >
            <Text color={WHITE}>{titleLine}</Text>
            <Text color={WHITE}>{' '}</Text>
            <Text color={WHITE}>{formatInfoLine('model', modelValue, innerWidth)}</Text>
            <Text color={WHITE}>{formatInfoLine('directory', directoryValue, innerWidth)}</Text>
            <Text color={WHITE}>{formatInfoLine('permissions', permissionsValue, innerWidth)}</Text>
            <Text color={WHITE}>{formatInfoLine('billing', billingValue, innerWidth)}</Text>
          </Box>
        </Box>
      </OffscreenFreeze>
      <VoiceModeNotice />
      <Opus1mMergeNotice />
      {ChannelsNoticeModule && <ChannelsNoticeModule.ChannelsNotice />}
      {isDebugMode() && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">Debug mode enabled</Text>
          <Text dimColor>
            Logging to: {isDebugToStdErr() ? 'stderr' : getDebugLogPath()}
          </Text>
        </Box>
      )}
      <EmergencyTip />
      {process.env.CLAUDE_CODE_TMUX_SESSION && (
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>
            tmux session: {process.env.CLAUDE_CODE_TMUX_SESSION}
          </Text>
          <Text dimColor>
            {process.env.CLAUDE_CODE_TMUX_PREFIX_CONFLICTS
              ? `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} ${process.env.CLAUDE_CODE_TMUX_PREFIX} d (press prefix twice - Claude uses ${process.env.CLAUDE_CODE_TMUX_PREFIX})`
              : `Detach: ${process.env.CLAUDE_CODE_TMUX_PREFIX} d`}
          </Text>
        </Box>
      )}
      {announcement && (
        <Box paddingLeft={2} flexDirection="column">
          {!process.env.IS_DEMO && config.oauthAccount?.organizationName && (
            <Text dimColor>
              Message from {config.oauthAccount.organizationName}:
            </Text>
          )}
          <Text>{announcement}</Text>
        </Box>
      )}
      {showSandboxStatus && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">
            Your bash commands will be sandboxed. Disable with /sandbox.
          </Text>
        </Box>
      )}
      {process.env.USER_TYPE === 'ant' && !process.env.DEMO_VERSION && (
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>Use /issue to report model behavior issues</Text>
        </Box>
      )}
      {process.env.USER_TYPE === 'ant' && !process.env.DEMO_VERSION && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="warning">[ANT-ONLY] Logs:</Text>
          <Text dimColor>
            API calls: {getDisplayPath(getDumpPromptsPath())}
          </Text>
          <Text dimColor>Debug logs: {getDisplayPath(getDebugLogPath())}</Text>
          {isDetailedProfilingEnabled() && (
            <Text dimColor>
              Startup Perf: {getDisplayPath(getStartupPerfLogPath())}
            </Text>
          )}
        </Box>
      )}
      {process.env.USER_TYPE === 'ant' && <GateOverridesWarning />}
      {process.env.USER_TYPE === 'ant' && <ExperimentEnrollmentNotice />}
    </>
  )
}
