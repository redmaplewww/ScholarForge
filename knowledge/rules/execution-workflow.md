# Execution Workflow

## Execution Configuration

Configuration is resolved in this priority order:

1. CLI `--command` argument
2. `DOMAIN_COMMAND` environment variable
3. `.project/execution.json` platform-specific config
4. PATH fallback (searches for configured binary names)

## Execution Modes

- **local**: Run directly on the current machine


## Dry-Run Mode

When no executable is found or `--dry-run` is passed:
- Validates inputs and configuration
- Records metadata without executing
- Sets `dry_run: true` in run metadata

## Run Metadata

Each run produces a JSON file in `.project/runs/`:

```json
{
  "run_id": "<timestamp-based-id>",
  "launched_at": "<ISO timestamp>",
  "workdir": "<working directory>",
  "input": "<input file>",
  "mode": "local|hpc",
  "command": ["<resolved command>"],
  "log_path": "<log file path>",
  "dry_run": false,
  "exit_code": 0,
  "status": "completed|failed"
}
```
