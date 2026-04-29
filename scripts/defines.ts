export function getMacroDefines(): Record<string, string> {
  return {
    'MACRO.VERSION': JSON.stringify('1.8.0'),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('agent-aura-cli'),
    'MACRO.PACKAGE_URL': JSON.stringify('agent-aura-cli'),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
  }
}

export const DEFAULT_BUILD_FEATURES = [
  'BUDDY',
  'TRANSCRIPT_CLASSIFIER',
  'BRIDGE_MODE',
  'AGENT_TRIGGERS_REMOTE',
  'VOICE_MODE',
  'PROMPT_CACHE_BREAK_DETECTION',
  'TOKEN_BUDGET',
  'AGENT_TRIGGERS',
  'ULTRATHINK',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'LODESTONE',
  'EXTRACT_MEMORIES',
  'VERIFICATION_AGENT',
  'DAEMON',
]
