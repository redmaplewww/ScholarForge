// @ts-nocheck
export interface AgentDef {
  name: string
  role: string
  model?: string
  effort?: 'low' | 'medium' | 'high'
  maxTurns?: number
  color?: string
  mcpServers?: string[]
  description?: string
}

export interface WorkflowStage {
  name: string
  description: string
  agent: string
  reviewGate: boolean
  producesArtifacts: string[]
}

export interface ErrorPattern {
  pattern: string
  category: string
  autoRepair: boolean
  repairStrategy?: string
  escalationAgent?: string
}

export interface FileTypeConfig {
  extension: string
  template: string
  description: string
}

export interface SubcommandConfig {
  name: string
  description: string
  script: string
  args?: string
}

export interface SetupConfig {
  domain: {
    name: string
    description: string
    terminology: Record<string, string>
  }
  agents: AgentDef[]
  workflow: {
    stages: WorkflowStage[]
    defaultStage: string
  }
  knowledge: {
    categories: string[]
    requiredMetadata: string[]
    tagVocabulary: string[]
  }
  errors: {
    patterns: ErrorPattern[]
    maxRetries: number
    escalationTimeout: number
  }
  execution: {
    defaultModel: string
    defaultEffort: 'low' | 'medium' | 'high'
    maxTurnsPerAgent: number
    timeoutSeconds: number
  }
  cli: {
    subcommands: SubcommandConfig[]
    defaultAgent: string
  }
}
