// Host auth provider adapter — bridges OAuth token management to mcp-client's AuthProvider interface

import type { AuthProvider } from '@agent-aura/mcp-client'
import {
  getWebAppOAuthTokens,
  checkAndRefreshOAuthTokenIfNeeded,
  handleOAuth401Error,
} from '../../../utils/auth.js'

/**
 * Creates an AuthProvider implementation using the host's OAuth token management.
 */
export function createMcpAuth(): AuthProvider {
  return {
    async getTokens() {
      const tokens = getWebAppOAuthTokens()
      if (!tokens) return null
      return { accessToken: tokens.accessToken }
    },
    async refreshTokens() {
      await checkAndRefreshOAuthTokenIfNeeded()
    },
    async handleOAuthError(error: unknown) {
      const currentToken = getWebAppOAuthTokens()?.accessToken ?? ''
      await handleOAuth401Error(currentToken)
    },
  }
}
