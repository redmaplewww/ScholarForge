# Runtime Feature Index

This release template keeps feature documentation domain-neutral. If you need the
full upstream CLI manuals locally, run:

```bash
GENERIC_AGENT_SYNC_UPSTREAM_DOCS=1 bun run init-runtime
```

The generic framework aligns with these runtime feature groups:

| Feature group | Flags / entry points | Template guidance |
|---------------|----------------------|-------------------|
| Generic chat | `bun run chat` | Always starts `domain-coordinator`; does not read `.project/setup-config.json`. |
| Team entry | `bun run <team>` | Generated from `agents/<team>-coordinator.md` by `bun run init-runtime`. |
| Coordinator mode | `COORDINATOR_MODE` | Use self-contained worker prompts; orchestrator should not directly implement. |
| Agent teams | `AGENT_TEAMS` | Use TeamCreate/Task tools only when visible in the current session. |
| Fork subagent | `FORK_SUBAGENT` | Use for inherited-context async work outside coordinator mode. |
| Proactive/Kairos | `KAIROS`, optional `PROACTIVE` | Use Sleep for long waits; avoid idle messages. |
| Token budget | `TOKEN_BUDGET` | Prompts like `+500k` request sustained productive work. |
| Workflow scripts | `WORKFLOW_SCRIPTS` | `.angsheng/workflows/` can expose local workflow commands. |
| Daemon/RCS | `DAEMON`, `BRIDGE_MODE`, `BG_SESSIONS`, `rcs` script | Runtime support is copied from CLI-self; external credentials may be required. |
| Pipes/LAN pipes | `LAN_PIPES` | Multi-instance coordination; LAN use may require firewall setup. |
| ACP/acp-link | `ACP`, `packages/acp-link/` | IDE/WebSocket bridge support when runtime packages are initialized. |
| Channels | `--channels` | External event channels are runtime features, not setup-config settings. |
| Computer use / Chrome | `CHICAGO_MCP` | GUI/browser control packages are copied with runtime. |
| Web search | no primary gate | Adapter backends are selected by runtime configuration. |
| MCP skills | opt-in `FEATURE_MCP_SKILLS=1` | Requires MCP servers exposing `skill://` resources. |
| Team memory | opt-in `FEATURE_TEAMMEM=1` | Requires Anthropic OAuth and GitHub remote. |
