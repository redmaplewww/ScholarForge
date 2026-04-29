import React, { useCallback } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { Box, Dialog, Link, Text } from '@anthropic/ink'
import type { ExternalMemoryPromptInclude } from '../utils/memoryFiles.js'
import { saveCurrentProjectConfig } from '../utils/config.js'
import { Select } from './CustomSelect/index.js'

type Props = {
  onDone(): void
  isStandaloneDialog?: boolean
  externalIncludes?: ExternalMemoryPromptInclude[]
}

export function MemoryPromptExternalIncludesDialog({
  onDone,
  isStandaloneDialog,
  externalIncludes,
}: Props): React.ReactNode {
  React.useEffect(() => {
    // Log when dialog is shown
    logEvent('tengu_claude_md_includes_dialog_shown', {})
  }, [])

  const handleSelection = useCallback(
    (value: 'yes' | 'no') => {
      if (value === 'no') {
        logEvent('tengu_claude_md_external_includes_dialog_declined', {})
        // Mark that we've shown the dialog but it was declined
        saveCurrentProjectConfig(current => ({
          ...current,
          hasMemoryPromptExternalIncludesApproved: false,
          hasMemoryPromptExternalIncludesWarningShown: true,
        }))
      } else {
        logEvent('tengu_claude_md_external_includes_dialog_accepted', {})
        saveCurrentProjectConfig(current => ({
          ...current,
          hasMemoryPromptExternalIncludesApproved: true,
          hasMemoryPromptExternalIncludesWarningShown: true,
        }))
      }

      onDone()
    },
    [onDone],
  )

  const handleEscape = useCallback(() => {
    handleSelection('no')
  }, [handleSelection])

  return (
    <Dialog
      title="Allow external ANGSHENG.md file imports?"
      color="warning"
      onCancel={handleEscape}
      hideBorder={!isStandaloneDialog}
      hideInputGuide={!isStandaloneDialog}
    >
      <Text>
        This project&apos;s ANGSHENG.md imports files outside the current working
        directory. Never allow this for third-party repositories.
      </Text>

      {externalIncludes && externalIncludes.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>External imports:</Text>
          {externalIncludes.map((include, i) => (
            <Text key={i} dimColor>
              {'  '}
              {include.path}
            </Text>
          ))}
        </Box>
      )}

      <Text dimColor>
        Important: Only use Agent Aura with files you trust. Accessing
        untrusted files may pose security risks{' '}
        <Link url="https://code.claude.com/docs/en/security" />{' '}
      </Text>

      <Select
        options={[
          { label: 'Yes, allow external imports', value: 'yes' },
          { label: 'No, disable external imports', value: 'no' },
        ]}
        onChange={value => handleSelection(value as 'yes' | 'no')}
      />
    </Dialog>
  )
}
