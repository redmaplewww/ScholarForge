# Workflow Handoffs

## Handoff Packet Format

```json
{
  "stage": "<stage-id>",
  "status": "complete | partial | failed",
  "artifacts": ["<list of artifact paths>"],
  "decisions": { "<key>": "<value>" },
  "issues": [],
  "metadata": {}
}
```


