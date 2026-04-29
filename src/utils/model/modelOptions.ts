// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isWebAppSubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import { getAntModels } from './antModels.js'
import {
  COST_TIER_3_15,
  COST_HAIKU_35,
  COST_HAIKU_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getWebAppUserDefaultModelDescription,
  getDefaultSonnetModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getDefaultMainLoopModelSetting,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  getOpus46PricingSuffix,
  renderDefaultModelSetting,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(fastMode = false): ModelOption {
  if (process.env.USER_TYPE === 'ant') {
    const currentModel = renderDefaultModelSetting(
      getDefaultMainLoopModelSetting(),
    )
    return {
      value: null,
      label: 'Default (recommended)',
      description: `Use the default model for Ants (currently ${currentModel})`,
      descriptionForModel: `Default model (currently ${currentModel})`,
    }
  }

  // Subscribers
  if (isWebAppSubscriber()) {
    return {
      value: null,
      label: 'Default (recommended)',
      description: getWebAppUserDefaultModelDescription(fastMode),
    }
  }

  // PAYG
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: null,
    label: 'Default (recommended)',
    description: `Use the default model (currently ${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

function getOpenAIModelOptions(fastMode = false): ModelOption[] {
  const options = [getDefaultOptionForUser(fastMode)]
  const configuredModel =
    process.env.OPENAI_MODEL || process.env.OPENAI_DEFAULT_SONNET_MODEL

  if (
    configuredModel &&
    !['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.1', 'gpt-5'].includes(
      configuredModel,
    )
  ) {
    options.push({
      value: configuredModel,
      label: getMarketingNameForModel(configuredModel) ?? configuredModel,
      description: 'Configured OpenAI model',
      descriptionForModel: `Configured OpenAI model (${configuredModel})`,
    })
  }

  options.push(
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Best for most coding tasks',
      descriptionForModel: 'GPT-5.4 - best for most coding tasks',
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Fastest GPT-5.4 option for lighter tasks',
      descriptionForModel: 'GPT-5.4 Mini - fastest option for lighter tasks',
    },
    {
      value: 'gpt-5.2',
      label: 'GPT-5.2',
      description: 'Strong fallback for coding and reasoning',
      descriptionForModel: 'GPT-5.2 - strong fallback for coding and reasoning',
    },
    {
      value: 'gpt-5.1',
      label: 'GPT-5.1',
      description: 'Balanced GPT-5 generation',
      descriptionForModel: 'GPT-5.1 - balanced GPT-5 generation',
    },
    {
      value: 'gpt-5',
      label: 'GPT-5',
      description: 'Base GPT-5 model',
      descriptionForModel: 'GPT-5 - base GPT-5 model',
    },
  )

  return options
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_SONNET_MODEL
  const customSonnetModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_SONNET_MODEL
      : provider === 'gemini'
      ? process.env.GEMINI_DEFAULT_SONNET_MODEL
      : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
  // When a 3P user has a custom sonnet model string, show it directly
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_SONNET_MODEL_NAME
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_SONNET_MODEL_NAME
        : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_SONNET_MODEL_DESCRIPTION
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_SONNET_MODEL_DESCRIPTION
        : process.env.ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION
    return {
      value: 'sonnet',
      label: nameEnv ?? customSonnetModel,
      description:
        descEnv ?? `Custom Sonnet model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${descEnv ?? `Custom Sonnet model${is1m ? ' with 1M context' : ''}`} (${customSonnetModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getSonnetXXOption, getOpusXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
function getSonnet46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet46 : 'sonnet',
    label: 'Medium Powered',
    description: `Medium Powered · Best for everyday tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Medium Powered - best for everyday tasks. Generally recommended for most coding tasks',
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_OPUS_MODEL
  const customOpusModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_OPUS_MODEL
      : provider === 'gemini'
      ? process.env.GEMINI_DEFAULT_OPUS_MODEL
      : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  // When a 3P user has a custom opus model string, show it directly
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_OPUS_MODEL_NAME
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_OPUS_MODEL_NAME
        : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_OPUS_MODEL_DESCRIPTION
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_OPUS_MODEL_DESCRIPTION
        : process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION
    return {
      value: 'opus',
      label: nameEnv ?? customOpusModel,
      description: descEnv ?? `Custom Opus model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${descEnv ?? `Custom Opus model${is1m ? ' with 1M context' : ''}`} (${customOpusModel})`,
    }
  }
}

function getOpus41Option(): ModelOption {
  return {
    value: 'opus',
    label: 'High',
    description: `High · Legacy`,
    descriptionForModel: 'High - legacy version',
  }
}

function getOpus46Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 : 'opus',
    label: 'High Powered',
    description: `High Powered · Most capable for complex work${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel: 'High Powered - most capable for complex work',
  }
}

export function getSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet46 + '[1m]' : 'sonnet[1m]',
    label: 'Medium Powered Plus',
    description: `Medium Powered for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Medium Powered with 1M context window - for long sessions with large codebases',
  }
}

export function getOpus46_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'opus[1m]',
    label: 'High Powered Plus',
    description: `High Powered for long sessions${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel:
      'High Powered with 1M context window - for long sessions with large codebases',
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const provider = getAPIProvider()
  // Use provider-specific DEFAULT_HAIKU_MODEL
  const customHaikuModel =
    provider === 'openai'
      ? process.env.OPENAI_DEFAULT_HAIKU_MODEL
      : provider === 'gemini'
      ? process.env.GEMINI_DEFAULT_HAIKU_MODEL
      : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  // When a 3P user has a custom haiku model string, show it directly
  if (is3P && customHaikuModel) {
    // Use appropriate NAME/DESCRIPTION env vars based on provider
    const nameEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_HAIKU_MODEL_NAME
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_HAIKU_MODEL_NAME
        : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
    const descEnv =
      provider === 'openai'
        ? process.env.OPENAI_DEFAULT_HAIKU_MODEL_DESCRIPTION
        : provider === 'gemini'
        ? process.env.GEMINI_DEFAULT_HAIKU_MODEL_DESCRIPTION
        : process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION
    return {
      value: 'haiku',
      label: nameEnv ?? customHaikuModel,
      description: descEnv ?? 'Custom Haiku model',
      descriptionForModel: `${descEnv ?? 'Custom Haiku model'} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'haiku',
    label: 'Low',
    description: `Low · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_45)}`}`,
    descriptionForModel:
      'Low - fastest for quick answers. Lower cost but less capable than Medium Powered.',
  }
}

function getHaiku35Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'haiku',
    label: 'Low',
    description: `Low for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_35)}`}`,
    descriptionForModel:
      'Low - faster and lower cost, but less capable than Medium. Use for simple tasks.',
  }
}

function getHaikuOption(): ModelOption {
  // Return correct Haiku option based on provider
  const haikuModel = getDefaultHaikuModel()
  return haikuModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  return {
    value: 'opus',
    label: 'High Powered',
    description: `High Powered · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`,
  }
}

export function getMaxSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const billingInfo = isWebAppSubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'sonnet[1m]',
    label: 'Medium Powered Plus',
    description: `Medium Powered with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

export function getMaxOpus46_1MOption(fastMode = false): ModelOption {
  const billingInfo = isWebAppSubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'opus[1m]',
    label: 'High Powered Plus',
    description: `High Powered with 1M context${billingInfo}${getOpus46PricingSuffix(fastMode)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'opus[1m]',
    label: 'High Powered Plus',
    description: `High Powered with 1M context · Most capable for complex work${!is3P && fastMode ? getOpus46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      'High Powered with 1M context - most capable for complex work',
  }
}

const MaxSonnet46Option: ModelOption = {
  value: 'sonnet',
  label: 'Medium Powered',
  description: 'Medium Powered · Best for everyday tasks',
}

const MaxHaiku45Option: ModelOption = {
  value: 'haiku',
  label: 'Low',
  description: 'Low · Fastest for quick answers',
}

function getOpusPlanOption(): ModelOption {
  return {
    value: 'opusplan',
    label: 'High Plan Mode',
    description: 'Use High Powered in plan mode, Medium Powered otherwise',
  }
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      getDefaultOptionForUser(),
      ...antModelOptions,
      getMergedOpus1MOption(fastMode),
      getSonnet46Option(),
      getSonnet46_1MOption(),
      getHaiku45Option(),
    ]
  }

  if (isWebAppSubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: Opus is default, show Sonnet as alternative
      const premiumOptions = [getDefaultOptionForUser(fastMode)]
      if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
        premiumOptions.push(getMaxOpus46_1MOption(fastMode))
      }

      premiumOptions.push(MaxSonnet46Option)
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet46_1MOption())
      }

      premiumOptions.push(MaxHaiku45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: Sonnet is default, show Opus as alternative
    const standardOptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet46_1MOption())
    }

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption(fastMode))
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus46_1MOption(fastMode))
      }
    }

    standardOptions.push(MaxHaiku45Option)
    return standardOptions
  }

  // PAYG 1P API: Default (Sonnet) + Sonnet 1M + Opus 4.6 + Opus 1M + Haiku
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions = [getDefaultOptionForUser(fastMode)]
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet46_1MOption())
    }
    if (isOpus1mMergeEnabled()) {
      payg1POptions.push(getMergedOpus1MOption(fastMode))
    } else {
      payg1POptions.push(getOpus46Option(fastMode))
      if (checkOpus1mAccess()) {
        payg1POptions.push(getOpus46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getHaiku45Option())
    return payg1POptions
  }

  if (getAPIProvider() === 'openai') {
    return getOpenAIModelOptions(fastMode)
  }

  // PAYG 3P: Default (Sonnet 4.5) + Sonnet (3P custom) or Sonnet 4.6/1M + Opus (3P custom) or Opus 4.1/Opus 4.6/Opus1M + Haiku + Opus 4.1
  const payg3pOptions = [getDefaultOptionForUser(fastMode)]

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    // Add Sonnet 4.6 since Sonnet 4.5 is the default
    payg3pOptions.push(getSonnet46Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet46_1MOption())
    }
  }

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Add Opus 4.1, Opus 4.6 and Opus 4.6 1M
    payg3pOptions.push(getOpus41Option()) // This is the default opus
    payg3pOptions.push(getOpus46Option(fastMode))
    if (checkOpus1mAccess()) {
      payg3pOptions.push(getOpus46_1MOption(fastMode))
    }
  }
  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // Sonnet family
  if (
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-sonnet-4-') ||
    canonical.includes('claude-3-7-sonnet') ||
    canonical.includes('claude-3-5-sonnet')
  ) {
    const currentName = getMarketingNameForModel(getDefaultSonnetModel())
    if (currentName) {
      return { alias: 'Medium', currentVersionName: currentName }
    }
  }

  // Opus family
  if (canonical.includes('claude-opus-4')) {
    const currentName = getMarketingNameForModel(getDefaultOpusModel())
    if (currentName) {
      return { alias: 'High', currentVersionName: currentName }
    }
  }

  // Haiku family
  if (
    canonical.includes('claude-haiku') ||
    canonical.includes('claude-3-5-haiku')
  ) {
    const currentName = getMarketingNameForModel(getDefaultHaikuModel())
    if (currentName) {
      return { alias: 'Low', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known Anthropic model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the ANTHROPIC_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'opusplan') {
    return filterModelOptionsByAllowlist([...options, getOpusPlanOption()])
  } else if (customModel === 'opus' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxOpusOption(fastMode),
    ])
  } else if (customModel === 'opus[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedOpus1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known Anthropic models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
