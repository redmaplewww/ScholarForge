# Generic Agent Framework

A domain-agnostic multi-agent architecture extracted from the LAMMPS AI system. Designed for rapid migration to any domain that needs orchestrated agent workflows with knowledge management, self-learning, repair loops, and evidence-based review gates.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Entry (src/cli.ts)                   │
│  Subcommand routing, complexity classification, effort       │
│  selection, agent delegation, team mode support              │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│  Coordinator │ │ Scripts  │ │   Engine     │
│  (agents/)   │ │(scripts/)│ │(src/engine/) │
│              │ │          │ │              │
│ Routes tasks │ │ execute  │ │ HTTP server  │
│ Tracks state │ │ repair   │ │ MCP bridge   │
│ Manages team │ │ loop     │ │ REST API     │
│ Review gates │ │ lookup   │ │              │
└──────┬───────┘ │ maintain │ └──────────────┘
       │         └──────────┘
       │
  ┌────┼────┬────────┬──────────┐
  ▼    ▼    ▼        ▼          ▼
Spec-  Rev- Libr-  Research-  KB-
ialist ewer arian  er        Coord
  │              │                │
  │    ┌─────────┘                │
  ▼    ▼                          ▼
┌──────────────────────────────────────────────┐
│          Knowledge System                     │
│  (src/knowledge/ + src/kb-pipeline/)          │
│                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Search   │  │ Indexer  │  │ Synth    │    │
│  │ (FTS5)   │  │ (SQLite) │  │ (Answer) │    │
│  └──────────┘  └──────────┘  └──────────┘    │
│                                               │
│  ┌──────────────────────────────────────┐     │
│  │ KB Pipeline (ingest→classify→review) │     │
│  │ store → classify → mcpServer        │     │
│  └──────────────────────────────────────┘     │
│                                               │
│  MCP Servers: domain-knowledge                │
│               domain-kb-pipeline              │
└──────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│          Knowledge Base (knowledge/)          │
│                                               │
│  rules/        Stage definitions, handoffs,   │
│                review guidelines, MB checks   │
│  memory/       Confirmed/pending lessons      │
│  cases/        Domain case library            │
│  papers/       Literature notes               │
│  reports/      Analysis reports               │
│  templates/    Reusable templates             │
└──────────────────────────────────────────────┘
```

## Core Systems

### 1. Agent System (`agents/`)
- **domain-coordinator**: Routes tasks, tracks workflow state, manages team/standalone modes
- **domain-reviewer**: Quality gate with PASS/REVISE/BLOCKED decisions
- **domain-kb-coordinator**: Orchestrates knowledge pipeline (curator → reviewer → apply)
- **domain-kb-curator**: Classifies, deduplicates, and proposes knowledge items
- **domain-kb-reviewer**: Final quality call for KB entries
- **domain-librarian**: Retrieval specialist for knowledge base search
- **domain-researcher**: External literature/API search
- **domain-specialist-template**: Template for creating domain-specific agents

### 2. Workflow System (`knowledge/rules/`)
- Multi-stage workflow with review gates at each production stage
- Handoff packets with typed artifacts between stages
- Revision limit (3 rounds max) to prevent infinite loops
- State tracking via `.project/` directory

### 3. Knowledge System (`src/knowledge/`)
- SQLite FTS5 full-text search with BM25 scoring
- Incremental indexing (file mtime-based)
- Answer synthesis with evidence extraction
- MCP server for agent tool access
- Remote sync support

### 4. Self-Learning / KB Pipeline (`src/kb-pipeline/`)
- **Ingest**: Accept content from conversations, files, or API
- **Classify**: Auto-detect content type (experience, rule, case, error, qa)
- **Curate**: Propose knowledge type, destination, merge strategy
- **Review**: Quality gate for confirmed/candidate/quarantine decisions
- **Apply**: Write confirmed knowledge to correct `knowledge/` folder

### 5. Repair System (`scripts/`)
- **auto-repair**: Classify run results by error signature
- **repair-loop**: Build bounded repair task from repair packet
- **error-summary**: Append rollback/error digest to project state
- Automatic actor suggestion and confidence scoring
- Design issue escalation path (analyst → advisory → planner)

### 6. Evidence System
- Every agent must cite local knowledge or case files
- High-risk changes require dual evidence (authoritative + local case)
- Reviewer enforces evidence quality before PASS
- MCP search results include `evidenceLines` and `answerChecklist`

## Directory Structure

```
generic-agent/
├── agents/                          # Agent definitions (Markdown)
│   ├── coordinator.md               # Workflow coordinator
│   ├── reviewer.md                  # Quality gate reviewer
│   ├── kb-coordinator.md            # KB pipeline coordinator
│   ├── kb-curator.md               # KB content curator
│   ├── kb-reviewer.md              # KB quality reviewer
│   ├── librarian.md                # Retrieval specialist
│   ├── researcher.md               # Literature researcher
│   └── specialist-template.md      # Template for new agents
├── src/
│   ├── cli.ts                      # CLI entrypoint
│   ├── knowledge/                  # Knowledge search engine
│   │   ├── common.ts              # Config and paths
│   │   ├── search.ts             # FTS5 search with scoring
│   │   ├── indexer.ts            # Document indexer
│   │   ├── synthesize.ts         # Answer synthesis
│   │   └── mcpServer.ts          # MCP server for knowledge tools
│   ├── kb-pipeline/               # Knowledge pipeline
│   │   ├── common.ts             # Pipeline config and types
│   │   ├── store.ts              # SQLite pipeline storage
│   │   ├── classify.ts           # Content classification
│   │   └── mcpServer.ts          # MCP server for pipeline tools
│   └── engine/                    # HTTP + MCP server
│       ├── entrypoint.ts         # Engine CLI
│       ├── server.ts             # HTTP server scaffold
│       └── mcp-bridge.ts        # MCP bridge scaffold
├── scripts/                       # Executable scripts
│   ├── execute.ts                # Generic execution runner
│   ├── auto-repair.ts           # Error classifier
│   ├── repair-loop.ts           # Repair routing
│   ├── error-summary.ts         # Error digest writer
│   ├── lookup.ts                # Knowledge lookup
│   ├── knowledge-maintenance.ts # KB maintenance
│   └── project-state-init.ts   # Project state initializer
├── knowledge/                     # Knowledge base
│   ├── rules/                    # Workflow rules
│   ├── memory/                   # Lessons (confirmed/pending/historical)
│   ├── cases/                    # Case library
│   ├── papers/                   # Literature notes
│   ├── reports/                  # Analysis reports
│   └── templates/                # Reusable templates
└── .project/                      # Runtime project state
    └── templates/                # State file templates
```

## Migration Guide

### Step 1: Define Your Domain

Search for all `<!-- DOMAIN: -->` comments and `DOMAIN` markers in the codebase. These are the customization points.

### Step 2: Create Domain Specialists

1. Copy `agents/specialist-template.md` for each specialist agent you need
2. Fill in the domain-specific instructions, checklist items, and output format
3. Add the new agents to the coordinator's routing table in `agents/coordinator.md`

### Step 3: Configure Knowledge Structure

1. Edit `knowledge/rules/workflow-stages.md` to define your stages
2. Edit `knowledge/rules/workflow-handoffs.md` for handoff packet formats
3. Edit `knowledge/rules/mandatory-checks.md` for your MB rules
4. Add domain-specific content to `knowledge/` directories

### Step 4: Customize Search and Classification

1. Edit `src/knowledge/search.ts`:
   - `DOMAIN_SYNONYMS`: Your domain's synonym groups
   - `DOMAIN_METADATA_FIELDS`: Your metadata fields
   - `classifyQuery()`: Your query type classification
   - `buildAnswerStrategy()`: Your answer strategies

2. Edit `src/kb-pipeline/classify.ts`:
   - `DOMAIN_KEYWORDS`: Your content classification keywords

3. Edit `src/knowledge/indexer.ts`:
   - `FILE_TYPE_HANDLERS`: Your domain's file types
   - `SOURCE_TYPE_CLASSIFICATION`: Your source type tiers
   - `extractMetadata()`: Your metadata extraction logic

### Step 5: Configure Execution

1. Edit `.project/templates/execution.json` with your domain's executable commands
2. Edit `scripts/execute.ts` if you need custom binary resolution
3. Edit `scripts/auto-repair.ts` to add your domain's error signatures

### Step 6: Wire Up the CLI

1. Edit `src/cli.ts`:
   - Replace agent names in `SUBCOMMAND_AGENT` map
   - Update `routePrompt()` regex patterns for your domain
   - Update `classifyTaskComplexity()` signals
   - Update help text

### Step 7: Integrate with Your CLI Platform

This framework is designed to be integrated into the Agent Aura CLI platform. Copy the relevant files into your CLI project:
- `agents/` → `.angsheng/agents/` (or your agent config directory)
- `src/knowledge/` → `src/utils/domainKnowledge/`
- `src/kb-pipeline/` → `src/utils/domainKbPipeline/`
- `scripts/` → `scripts/`
- `src/cli.ts` → `src/entrypoints/domain-cli.ts`
- `knowledge/` → `knowledge/`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DOMAIN_KNOWLEDGE_WORKSPACE_ROOT` | Workspace root for knowledge search |
| `DOMAIN_KB_PIPELINE_WORKSPACE_ROOT` | Workspace root for KB pipeline |
| `DOMAIN_COMMAND` | Override domain executable command |
| `DOMAIN_EXECUTABLE` | Domain binary name for PATH resolution |
| `ENGINE_PORT` | Engine HTTP server port (default: 3847) |
| `ENGINE_HOST` | Engine HTTP server host (default: 127.0.0.1) |
| `ENGINE_API_KEY` | Engine API key for authentication |
| `ENGINE_WORKSPACE` | Engine workspace root directory |

## Quick Start Checklist

- [ ] Define domain specialists (copy specialist-template.md)
- [ ] Update coordinator routing table
- [ ] Define workflow stages in knowledge/rules/workflow-stages.md
- [ ] Define mandatory checks in knowledge/rules/mandatory-checks.md
- [ ] Add domain synonyms in src/knowledge/search.ts
- [ ] Add domain keywords in src/kb-pipeline/classify.ts
- [ ] Configure execution in .project/templates/execution.json
- [ ] Add domain error patterns in scripts/auto-repair.ts
- [ ] Update CLI subcommands and routing in src/cli.ts
- [ ] Add initial knowledge content to knowledge/
- [ ] Implement TODO items in SQLite database operations
