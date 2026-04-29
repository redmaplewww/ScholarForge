# Project State Management

## State Files

All project state is stored in `.project/` at the workspace root.

### Files

| File | Purpose |
|------|---------|
| `project.json` | Project metadata and configuration |
| `execution.json` | Execution environment configuration |
| `state.md` | Current workflow state (stage, status, history) |
| `decisions.md` | Locked decisions log |
| `review-log.md` | Review decision history |
| `open-issues.md` | Active blocking issues |
| `stage-summary.md` | Stage completion summaries |
| `runs/` | Execution run metadata and outputs |

### State Transitions

1. Each stage writes its output artifacts
2. Reviewer gates write to `review-log.md`
3. Decisions are locked in `decisions.md`
4. Blocking issues tracked in `open-issues.md`
5. Run results stored in `runs/<run-id>.json`

### Conventions

- State files are append-only where possible
- Never delete state entries; mark as superseded
- Each entry includes a timestamp
