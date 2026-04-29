import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { getAppConfigHomeDir } from '../envUtils.js'

/**
 * Managed settings are isolated into the project config tree in this fork.
 */
export const getManagedFilePath = memoize(function (): string {
  return join(getAppConfigHomeDir(), 'managed')
})

/**
 * Get the path to the managed-settings.d/ drop-in directory.
 * managed-settings.json is merged first (base), then files in this directory
 * are merged alphabetically on top (drop-ins override base, later files win).
 */
export const getManagedSettingsDropInDir = memoize(function (): string {
  return join(getManagedFilePath(), 'managed-settings.d')
})
