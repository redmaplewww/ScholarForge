---
name: opencode-base
description: Use when designing or extending this project as an OpenCode-based agent framework with minimal custom bottom-layer work.
license: MIT
compatibility: opencode
metadata:
  stack: opencode
  strategy: upstream-first
---

# OpenCode Base Skill

Use this skill when the task is about the agent framework architecture, OpenCode as a base, skill/plugin/tool design, MCP integration, or avoiding custom bottom-layer development.

## Principle

Do not rebuild the agent kernel. Use OpenCode as the owner of:

- model loop
- agents and subagents
- tool invocation
- permissions
- sessions and forks
- snapshots
- command entrypoints
- project rules
- skills
- MCP integration

## Mapping

| Capability | Default owner |
| --- | --- |
| Primary loop | OpenCode runtime |
| Planning/build modes | OpenCode built-in `plan` and `build` agents |
| Specialized roles | `.opencode/agents/*.md` |
| Reusable behavior | `.opencode/skills/*/SKILL.md` |
| Tool extension | MCP server or OpenCode plugin |
| Knowledge/document search | MCP first; LlamaIndex/Haystack only as external service if needed |
| Memory | OpenCode session history first; Mem0/Letta only through MCP or external service |
| Scheduled tasks | external scheduler that calls `opencode run` |
| State machine/workflow | OpenCode commands/agents first; external workflow engine only for production automation |
| Self-evolution | proposal documents and review commands; no automatic core mutation |

## Decision Rule

Before proposing custom code, answer:

1. Can OpenCode config solve this?
2. Can a project agent solve this?
3. Can a project skill solve this?
4. Can an MCP server solve this?
5. Can an upstream tool solve this with a thin command wrapper?

Only if all five answers are no should custom code be proposed.
