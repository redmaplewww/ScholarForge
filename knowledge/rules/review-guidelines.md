# Review Guidelines

## Review Gate Protocol

Every production stage requires a review gate before advancing.

### Review Decision Types

- **PASS**: Artifact meets all requirements. Stage may advance.
- **REVISE**: Artifact has issues that can be fixed. Return to producer with bounded fix list.
- **BLOCKED**: Critical issue that requires user decision or major rework.

### Revision Limit

Maximum 3 REVISE rounds per stage. After 3 rounds: stop and report `blocked-by-review-loop`.

### Review Process

1. Read mandatory checks from `knowledge/rules/mandatory-checks.md`
2. Read confirmed lessons from `knowledge/memory/confirmed-lessons.md`
3. Inspect the target artifact
4. Check against one relevant local example when available
5. Output structured review result

### Review Output Format

```json
{
  "scope": "<what was reviewed>",
  "decision": "PASS | REVISE | BLOCKED",
  "required_next_actor": "<agent name>",
  "issues": [],
  "required_fixes": [],
  "mb_checks": {},
  "confidence": "high | medium | low"
}
```
