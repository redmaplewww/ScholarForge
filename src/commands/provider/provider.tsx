import React, { useEffect, useState } from 'react'
import { Box, Text } from '@anthropic/ink'
import type { CommandResultDisplay } from '../../commands.js'
import { Select } from '../../components/CustomSelect/select.js'
import type { OptionWithDescription } from '../../components/CustomSelect/select.js'
import { useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import {
  updateSettingsForSource,
  getSettings_DEPRECATED,
} from '../../utils/settings/settings.js'
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js'
import { setInitialMainLoopModel } from '../../bootstrap/state.js'

// --- Provider env var mapping ---

type ProviderConfig = {
  keyVar: string
  urlVar: string
  urlRequired: boolean
}

const PROVIDER_ENV_MAP: Record<string, ProviderConfig> = {
  anthropic: {
    keyVar: 'ANTHROPIC_API_KEY',
    urlVar: 'ANTHROPIC_BASE_URL',
    urlRequired: false,
  },
  openai: {
    keyVar: 'OPENAI_API_KEY',
    urlVar: 'OPENAI_BASE_URL',
    urlRequired: true,
  },
  gemini: {
    keyVar: 'GEMINI_API_KEY',
    urlVar: 'GEMINI_BASE_URL',
    urlRequired: false,
  },
  grok: {
    keyVar: 'GROK_API_KEY',
    urlVar: 'GROK_BASE_URL',
    urlRequired: false,
  },
}

const VALID_PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'grok',
  'bedrock',
  'vertex',
  'foundry',
] as const

const CLOUD_PROVIDERS = ['bedrock', 'vertex', 'foundry'] as const
const INTERACTIVE_PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok'] as const

type ProviderName = (typeof VALID_PROVIDERS)[number]
type InteractiveProviderName = (typeof INTERACTIVE_PROVIDERS)[number]
type CloudProviderName = (typeof CLOUD_PROVIDERS)[number]

const OPENAI_FALLBACK_MODEL = 'gpt-5.4'

function getEnvVarForProvider(provider: CloudProviderName): string {
  switch (provider) {
    case 'bedrock':
      return 'CLAUDE_CODE_USE_BEDROCK'
    case 'vertex':
      return 'CLAUDE_CODE_USE_VERTEX'
    case 'foundry':
      return 'CLAUDE_CODE_USE_FOUNDRY'
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

function getMergedEnv(): Record<string, string> {
  const settings = getSettings_DEPRECATED()
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  )
  if (settings?.env) {
    Object.assign(merged, settings.env)
  }
  return merged
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 3) + '...' + key.slice(-4)
}

function normalizeProviderBaseUrl(
  provider: InteractiveProviderName,
  baseUrl: string,
): string {
  if (provider !== 'openai') return baseUrl
  try {
    const parsed = new URL(baseUrl)
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/v1'
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

function clearCloudProviderEnvVars(): void {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GROK
}

function getPreferredModelForProvider(
  provider: InteractiveProviderName,
  mergedEnv = getMergedEnv(),
): string | null {
  if (provider === 'openai') {
    return (
      mergedEnv.OPENAI_MODEL ||
      mergedEnv.OPENAI_DEFAULT_SONNET_MODEL ||
      OPENAI_FALLBACK_MODEL
    )
  }
  return null
}

function syncSessionModelForProvider(
  setAppState: ReturnType<typeof useSetAppState>,
  provider: InteractiveProviderName | null,
  mergedEnv = getMergedEnv(),
): void {
  const nextModel =
    provider === null ? null : getPreferredModelForProvider(provider, mergedEnv)

  setInitialMainLoopModel(nextModel)
  setAppState(prev => ({
    ...prev,
    mainLoopModel: nextModel,
    mainLoopModelForSession: null,
  }))
}

function buildProviderEnvUpdate(
  provider: InteractiveProviderName,
  config: ProviderConfig,
  apiKey: string,
  baseUrl: string,
  mergedEnv = getMergedEnv(),
): Record<string, string> {
  const envUpdate: Record<string, string> = {}

  if (apiKey) envUpdate[config.keyVar] = apiKey
  if (baseUrl) {
    envUpdate[config.urlVar] = normalizeProviderBaseUrl(provider, baseUrl)
  }

  const preferredModel = getPreferredModelForProvider(provider, mergedEnv)
  if (provider === 'openai' && preferredModel) {
    envUpdate.OPENAI_MODEL = preferredModel
  }

  return envUpdate
}

// --- Backward-compat text-based logic (when args are provided) ---

function handleTextCommand(
  arg: string,
  setAppState: ReturnType<typeof useSetAppState>,
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void,
): void {
  if (arg === 'unset') {
    updateSettingsForSource('userSettings', { modelType: undefined })
    clearCloudProviderEnvVars()
    syncSessionModelForProvider(setAppState, null)
    onDone('API provider cleared (will use environment variables).')
    return
  }

  if (!(VALID_PROVIDERS as readonly string[]).includes(arg)) {
    onDone(`Invalid provider: ${arg}\nValid: ${VALID_PROVIDERS.join(', ')}`)
    return
  }

  const mergedEnv = getMergedEnv()

  // Warn about missing env vars for key-based providers
  if (arg === 'openai') {
    const hasKey = !!mergedEnv.OPENAI_API_KEY
    const hasUrl = !!mergedEnv.OPENAI_BASE_URL
    const preferredModel = getPreferredModelForProvider('openai', mergedEnv)
    if (!hasKey || !hasUrl) {
      updateSettingsForSource('userSettings', {
        modelType: 'openai',
        env: preferredModel ? { OPENAI_MODEL: preferredModel } : {},
      })
      applyConfigEnvironmentVariables()
      syncSessionModelForProvider(setAppState, 'openai', {
        ...mergedEnv,
        ...(preferredModel ? { OPENAI_MODEL: preferredModel } : {}),
      })
      const missing = []
      if (!hasKey) missing.push('OPENAI_API_KEY')
      if (!hasUrl) missing.push('OPENAI_BASE_URL')
      onDone(
        `Switched to OpenAI provider.\nOPENAI_MODEL: ${preferredModel}\nWarning: Missing env vars: ${missing.join(', ')}\nConfigure them via /login or set manually.`,
      )
      return
    }
  }
  if (arg === 'grok') {
    const hasKey = !!(mergedEnv.GROK_API_KEY || mergedEnv.XAI_API_KEY)
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'grok' })
      applyConfigEnvironmentVariables()
      syncSessionModelForProvider(setAppState, 'grok', mergedEnv)
      onDone(
        `Switched to Grok provider.\nWarning: Missing env var: GROK_API_KEY (or XAI_API_KEY)\nConfigure it via settings.json env or set manually.`,
      )
      return
    }
  }
  if (arg === 'gemini') {
    const hasKey = !!mergedEnv.GEMINI_API_KEY
    if (!hasKey) {
      updateSettingsForSource('userSettings', { modelType: 'gemini' })
      applyConfigEnvironmentVariables()
      syncSessionModelForProvider(setAppState, 'gemini', mergedEnv)
      onDone(
        `Switched to Gemini provider.\nWarning: Missing env var: GEMINI_API_KEY\nConfigure it via /login or set manually.`,
      )
      return
    }
  }

  if ((INTERACTIVE_PROVIDERS as readonly string[]).includes(arg)) {
    clearCloudProviderEnvVars()
    const interactiveProvider = arg as InteractiveProviderName
    const envUpdate =
      interactiveProvider === 'openai'
        ? buildProviderEnvUpdate(
            interactiveProvider,
            PROVIDER_ENV_MAP.openai,
            '',
            '',
            mergedEnv,
          )
        : {}
    updateSettingsForSource('userSettings', {
      modelType: interactiveProvider,
      ...(Object.keys(envUpdate).length > 0 ? { env: envUpdate } : {}),
    })
    applyConfigEnvironmentVariables()
    syncSessionModelForProvider(
      setAppState,
      interactiveProvider,
      Object.keys(envUpdate).length > 0 ? { ...mergedEnv, ...envUpdate } : mergedEnv,
    )
    const modelSummary =
      interactiveProvider === 'openai' && envUpdate.OPENAI_MODEL
        ? `\nOPENAI_MODEL: ${envUpdate.OPENAI_MODEL}`
        : ''
    onDone(`API provider set to ${arg}.${modelSummary}`)
  } else {
    // Cloud providers: env vars only
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    process.env[getEnvVarForProvider(arg as CloudProviderName)] = '1'
    applyConfigEnvironmentVariables()
    syncSessionModelForProvider(setAppState, null)
    onDone(`API provider set to ${arg} (via environment variable).`)
  }
}

function ProviderTextCommandRunner({
  arg,
  onDone,
}: {
  arg: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const setAppState = useSetAppState()

  useEffect(() => {
    handleTextCommand(arg, setAppState, onDone)
  }, [arg, onDone, setAppState])

  return null
}

// --- Interactive Wizard ---

type WizardStep = 'provider' | 'apiKey' | 'baseUrl' | 'confirm'

function ProviderWizard({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  }): React.ReactNode {
  const current = getAPIProvider()
  const setAppState = useSetAppState()
  const [step, setStep] = useState<WizardStep>('provider')
  const [selectedProvider, setSelectedProvider] =
    useState<InteractiveProviderName>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  if (step === 'provider') {
    const providerOptions: OptionWithDescription<string>[] =
      VALID_PROVIDERS.map(p => ({
        label: p === current ? `${p} (current)` : p,
        value: p,
        description:
          (CLOUD_PROVIDERS as readonly string[]).includes(p)
            ? 'env-only, configure via environment variables'
            : undefined,
      }))

    return (
      <Box flexDirection="column">
        <Text bold>Select API provider:</Text>
        <Select
          options={providerOptions}
          defaultFocusValue={current}
          onChange={value => {
            if ((CLOUD_PROVIDERS as readonly string[]).includes(value)) {
              onDone(
                `${value} requires environment variable configuration.\nSet the appropriate AWS/GCP/Azure credentials, then run /provider ${value}`,
              )
              return
            }
            setSelectedProvider(value as InteractiveProviderName)
            const mergedEnv = getMergedEnv()
            const config = PROVIDER_ENV_MAP[value]
            if (config) {
              const currentKey = mergedEnv[config.keyVar] || ''
              const currentUrl = mergedEnv[config.urlVar] || ''
              setApiKey(currentKey)
              setBaseUrl(currentUrl)
            }
            setStep('apiKey')
          }}
          onCancel={() => {
            onDone(`Kept provider as ${current}`, { display: 'system' })
          }}
        />
      </Box>
    )
  }

  const config = PROVIDER_ENV_MAP[selectedProvider]!

  if (step === 'apiKey') {
    const maskedCurrent = apiKey ? maskKey(apiKey) : ''
    const keyOptions: OptionWithDescription<string>[] = [
      {
        type: 'input',
        label: `${config.keyVar}`,
        value: 'apiKey',
        onChange: val => setApiKey(val),
        initialValue: apiKey,
        placeholder: maskedCurrent || `Enter ${config.keyVar}...`,
        labelValueSeparator: ': ',
        showLabelWithValue: true,
      },
    ]

    return (
      <Box flexDirection="column">
        <Text bold>
          Configure {selectedProvider} — API Key:
        </Text>
        <Text dimColor>Enter to confirm, Esc to go back</Text>
        <Select
          options={keyOptions}
          onChange={() => setStep('baseUrl')}
          onCancel={() => setStep('provider')}
          hideIndexes
        />
      </Box>
    )
  }

  if (step === 'baseUrl') {
    const urlOptions: OptionWithDescription<string>[] = [
      {
        type: 'input',
        label: `${config.urlVar}`,
        value: 'baseUrl',
        onChange: val => setBaseUrl(val),
        initialValue: baseUrl,
        placeholder: config.urlRequired
          ? `Enter ${config.urlVar} (required)...`
          : `Enter ${config.urlVar} (optional, Enter to skip)...`,
        allowEmptySubmitToCancel: !config.urlRequired,
        labelValueSeparator: ': ',
        showLabelWithValue: true,
      },
    ]

    return (
      <Box flexDirection="column">
        <Text bold>
          Configure {selectedProvider} — Base URL:
        </Text>
        <Text dimColor>
          {config.urlRequired
            ? 'Required. Enter to confirm, Esc to go back'
            : 'Optional. Enter to skip, Esc to go back'}
        </Text>
        <Select
          options={urlOptions}
          onChange={() => {
            if (config.urlRequired && !baseUrl.trim()) {
              // Don't advance if URL is required but empty
              return
            }
            setStep('confirm')
          }}
          onCancel={() => {
            if (!config.urlRequired) {
              setBaseUrl('')
              setStep('confirm')
            } else {
              setStep('apiKey')
            }
          }}
          hideIndexes
        />
      </Box>
    )
  }

  // step === 'confirm'
  return (
    <ConfirmStep
      provider={selectedProvider}
      config={config}
      apiKey={apiKey}
      baseUrl={baseUrl}
      setAppState={setAppState}
      onDone={onDone}
      onBack={() => setStep('baseUrl')}
    />
  )
}

function ConfirmStep({
  provider,
  config,
  apiKey,
  baseUrl,
  setAppState,
  onDone,
  onBack,
}: {
  provider: InteractiveProviderName
  config: ProviderConfig
  apiKey: string
  baseUrl: string
  setAppState: ReturnType<typeof useSetAppState>
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  onBack: () => void
}): React.ReactNode {
  const confirmOptions: OptionWithDescription<string>[] = [
    {
      label: 'Confirm',
      value: 'confirm',
      description: 'Apply configuration',
    },
    { label: 'Back', value: 'back', description: 'Go back to edit' },
    { label: 'Cancel', value: 'cancel', description: 'Discard changes' },
  ]

  return (
    <Box flexDirection="column">
      <Text bold>Review configuration:</Text>
      <Text>
        Provider: <Text color="suggestion">{provider}</Text>
      </Text>
      <Text>
        {config.keyVar}:{' '}
        <Text color="suggestion">{apiKey ? maskKey(apiKey) : '(not set)'}</Text>
      </Text>
      <Text>
        {config.urlVar}:{' '}
        <Text color="suggestion">{baseUrl || '(not set)'}</Text>
      </Text>
      <Text> </Text>
      <Select
        options={confirmOptions}
        onChange={value => {
          if (value === 'confirm') {
            const envUpdate = applyProviderConfig(
              provider,
              config,
              apiKey,
              baseUrl,
              setAppState,
            )
            const parts = [`Provider configured: ${provider}`]
            if (apiKey) parts.push(`${config.keyVar}: ${maskKey(apiKey)}`)
            if (baseUrl) parts.push(`${config.urlVar}: ${baseUrl}`)
            if (envUpdate.OPENAI_MODEL) {
              parts.push(`OPENAI_MODEL: ${envUpdate.OPENAI_MODEL}`)
            }
            onDone(parts.join('\n'))
          } else if (value === 'back') {
            onBack()
          } else {
            onDone(`Cancelled provider configuration.`, {
              display: 'system',
            })
          }
        }}
        onCancel={() =>
          onDone(`Cancelled provider configuration.`, { display: 'system' })
        }
        hideIndexes
      />
    </Box>
  )
}

function applyProviderConfig(
  provider: InteractiveProviderName,
  config: ProviderConfig,
  apiKey: string,
  baseUrl: string,
  setAppState: ReturnType<typeof useSetAppState>,
): Record<string, string> {
  const mergedEnv = getMergedEnv()
  const envUpdate = buildProviderEnvUpdate(
    provider,
    config,
    apiKey,
    baseUrl,
    mergedEnv,
  )

  clearCloudProviderEnvVars()
  updateSettingsForSource('userSettings', {
    modelType: provider,
    env: envUpdate,
  })
  applyConfigEnvironmentVariables()
  syncSessionModelForProvider(setAppState, provider, {
    ...mergedEnv,
    ...envUpdate,
  })
  return envUpdate
}

// --- Exported call ---

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const arg = (args || '').trim().toLowerCase()

  if (arg) {
    return <ProviderTextCommandRunner arg={arg} onDone={onDone} />
  }

  return <ProviderWizard onDone={onDone} />
}
