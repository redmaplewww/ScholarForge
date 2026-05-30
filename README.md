# Generic Agent Framework

Generic Agent Framework is a clean, domain-neutral template for building
coordinator-led agent teams on top of the Agent Aura CLI runtime.

The repository is intentionally split into two layers:

- **Template layer**: tracked files in this repo (`agents/`, `knowledge/`,
  `scripts/`, `src-generic/`, docs). This is what you customize and version.
- **Runtime layer**: `src/`, `packages/`, `tsconfig*`, `build.ts`, and
  `node_modules/` created by `bun run init-runtime`. These are local runtime
  copies and are ignored by git.

## Quick Start

```bash
bun install
bun run init-runtime
bun run chat
```

`bun run chat` always starts the generic `domain-coordinator`. It does not read
`.project/setup-config.json`, so stale setup state cannot hijack the default chat
entry.

## Creating A Team

1. Run the setup wizard:

   ```bash
   bun run setup
   ```

2. Review generated files under `agents/`, `knowledge/rules/`, and `.project/`.
3. Ensure the team has a concrete coordinator file:

   ```text
   agents/<team>-coordinator.md
   ```

4. Refresh runtime scripts:

   ```bash
   bun run init-runtime
   ```

5. Start the team directly:

   ```bash
   bun run <team>
   ```

Example: `agents/finance-coordinator.md` creates `bun run finance`.

## Entry Point Contract

| Command | Behavior |
|---------|----------|
| `bun run chat` | Starts `domain-coordinator`, the generic template coordinator. |
| `bun run chat:setup` | Starts `setup-coordinator` for AI-assisted setup refinement. |
| `bun run setup` | Runs the Chinese setup wizard and writes `.project/setup-config.json`. |
| `bun run <team>` | Starts `<team>-coordinator` after `init-runtime` detects it. |
| `bun run init-runtime` | Copies runtime from CLI-self, syncs agents/docs, regenerates scripts. |
| `bun run self-evolve:audit` | Generates advisory self-evolution reports and proposals. |
| `bun run evidence:add` | Registers an evidence source into `.project/evidence.json`. |
| `bun run evidence:list` | Lists registered evidence. |
| `bun run evidence:check` | Validates evidence IDs/source existence before review gates. |

`init-runtime` also removes stale `team:*` scripts and obsolete generated team
scripts whose coordinator files no longer exist.

## Setup Configuration Boundary

`.project/setup-config.json` is per-project setup output. It is ignored by git
and safe to delete when starting over. It records domain decisions only:

- domain name and description
- specialist agents
- workflow stages
- file types
- execution settings
- error patterns
- knowledge sources
- optional CLI routing notes

It does **not** choose the default chat agent. Team launch scripts are generated
only from `agents/<team>-coordinator.md`.

## Directory Layout

```text
generic-agent/
├── agents/                    # Domain-neutral agent templates
├── knowledge/                 # Rules, memory, cases, reports, templates
├── scripts/                   # Init, launch, setup, execution, repair helpers
├── src-generic/               # Reference generic knowledge/engine/setup code
├── docs/                      # Release docs and runtime feature index
├── .project/templates/        # Project state templates
├── package.json               # Template scripts; runtime deps merged on init
└── README.md
```

Ignored local runtime/output directories:

- `src/`
- `packages/`
- `node_modules/`
- `.angsheng/`
- `.project/setup-config.json`
- `.project/runs/`
- `bun.lock`

## Built-In Agent Templates

| File | Purpose |
|------|---------|
| `agents/coordinator.md` | Generic workflow coordinator (`domain-coordinator`). |
| `agents/reviewer.md` | Review gate with `PASS`, `REVISE`, `BLOCKED`. |
| `agents/librarian.md` | Local knowledge retrieval specialist. |
| `agents/researcher.md` | External research specialist. |
| `agents/kb-coordinator.md` | Knowledge ingestion pipeline coordinator. |
| `agents/kb-curator.md` | Knowledge extraction and classification. |
| `agents/kb-reviewer.md` | Knowledge quality reviewer. |
| `agents/setup-coordinator.md` | AI-assisted setup refinement. |
| `agents/specialist-template.md` | Copy this for new domain specialists. |

All template files use `<!-- DOMAIN: -->` comments or `DOMAIN_` markers for
customization points.

## Runtime Feature Alignment

The template launcher mirrors the current CLI-self feature defaults in
`scripts/defines.ts`. The default feature set includes:

- `BUDDY`, `BRIDGE_MODE`, `VOICE_MODE`
- `CHICAGO_MCP`, `AGENT_TRIGGERS`, `AGENT_TRIGGERS_REMOTE`
- `TOKEN_BUDGET`, `ULTRAPLAN`, `KAIROS`, `KAIROS_BRIEF`
- `COORDINATOR_MODE`, `AGENT_TEAMS`, `FORK_SUBAGENT`
- `DAEMON`, `BG_SESSIONS`, `LAN_PIPES`, `ACP`
- `WORKFLOW_SCRIPTS`, `HISTORY_SNIP`, `CONTEXT_COLLAPSE`, `MONITOR_TOOL`
- `TEMPLATES`, `POOR`, and supporting cache/usage flags

Optional runtime features can be enabled per launch with environment variables,
for example:

```bash
FEATURE_MCP_SKILLS=1 bun run chat
FEATURE_TEAMMEM=1 bun run chat
FEATURE_WEB_BROWSER_TOOL=1 bun run chat
```

See `docs/features/README.md` for the feature index.

## Safety-Gated Self-Evolution

The template includes an advisory self-optimization loop. Its purpose is to
identify inefficient stages, repeated error patterns, missing evidence, and
high-revision agents, then propose improvements safely.

Run an audit:

```bash
bun run self-evolve:audit
```

Outputs:

- `project-memory/agent-evolution-report.md`
- `agent-improvement-proposals/<run-id>/signals.json`
- `agent-improvement-proposals/<run-id>/proposals.json`
- `agent-improvement-proposals/<run-id>/proposals.md`

The audit is read-only for production behavior. It never edits active agents,
rules, feature flags, or runtime files.

After the user approves sandbox testing, run:

```bash
bun run self-evolve:audit -- --approve-sandbox --materialize-copies
```

Sandbox mode creates candidate copies and a sandbox manifest under the proposal
directory. Apply is allowed only after the sandbox uses the cases where the
errors were discovered and shows clear metric improvement with no regression.
Applying a proposal requires a second explicit user instruction naming the
proposal ID.

## Release Template Rules

- Do not commit domain-specific teams to the generic template branch.
- Do not commit `.project/setup-config.json`; it is local setup state.
- Do not commit copied runtime files (`src/`, `packages/`, `node_modules/`).
- Keep `bun run chat` fixed to `domain-coordinator`.
- Use concrete coordinator files to create `bun run <team>` entries.
- Run `bun run init-runtime` after changing coordinators.

## Verification Checklist

Before publishing a template build:

```bash
bun install
bun run init-runtime
bun --print "await import('./scripts/defines.ts').then(m => m.DEFAULT_BUILD_FEATURES.includes('COORDINATOR_MODE'))"
echo test | timeout 12 bun run chat
```

The final command may fail with an API quota error after startup; that still
verifies that the launcher reached `domain-coordinator`.
