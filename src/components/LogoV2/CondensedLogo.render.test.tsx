import * as React from 'react'
import { describe, expect, mock, test } from 'bun:test'

mock.module('../../hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 40 }),
}))

mock.module('../../hooks/useMainLoopModel.js', () => ({
  useMainLoopModel: () => 'claude-opus-4-6',
}))

mock.module('../../state/AppState.js', () => ({
  useAppState: (
    selector: (state: {
      agent: string | null
      effortValue: string | null
      toolPermissionContext: { mode: 'bypassPermissions' }
    }) => unknown,
  ) =>
    selector({
      agent: null,
      effortValue: null,
      toolPermissionContext: { mode: 'bypassPermissions' },
    }),
}))

mock.module('../../utils/effort.js', () => ({
  getEffortSuffix: () => '',
}))

mock.module('../../utils/logoV2Utils.js', () => ({
  getLogoDisplayData: () => ({
    version: '2.1.888',
    cwd: 'C:\\wonderland\\Repository\\claude-code-main',
    billingType: 'API Usage Billing',
    agentName: null,
  }),
  truncatePath: (value: string) => value,
}))

mock.module('../../utils/model/model.js', () => ({
  renderModelSetting: () => 'Opus 4.6 (1M context)',
}))

mock.module('../../utils/permissions/PermissionMode.js', () => ({
  permissionModeTitle: () => 'Bypass Permissions',
}))

mock.module('../OffscreenFreeze.js', () => ({
  OffscreenFreeze: ({ children }: { children: React.ReactNode }) => children,
}))

mock.module('./GuestPassesUpsell.js', () => ({
  GuestPassesUpsell: () => null,
  incrementGuestPassesSeenCount: () => {},
  useShowGuestPassesUpsell: () => false,
}))

mock.module('./OverageCreditUpsell.js', () => ({
  OverageCreditUpsell: () => null,
  incrementOverageCreditUpsellSeenCount: () => {},
  useShowOverageCreditUpsell: () => false,
}))

describe('CondensedLogo render', () => {
  test('renders refreshed rounded wordmark with a three-line boxed layout', async () => {
    const { renderToString } = await import('../../utils/staticRender.js')
    const { CondensedLogo } = await import('./CondensedLogo.js')

    const output = await renderToString(React.createElement(CondensedLogo), 100)

    expect(output).toContain('ANGSHENG')
    expect(output).toContain('\u256d')
    expect(output).toContain('\u256f')
    expect(output).toContain('>_ ANGSHENG (v2.1.888)')
    expect(output).toContain('model:')
    expect(output).toContain('directory:')
    expect(output).toContain('permissions:')
    expect(output).not.toContain('billing:')
    expect(output).toContain('Bypass Permissions')
  })
})
