# Workflow Stages



## Execute

- **Description**: Execute the produced artifacts.
- **Input**: Final production artifacts
- **Output**: Execution results, metadata
- **Review gate**: No
- **Agent**: (via scripts/execute.ts)

## Analysis

- **Description**: Analyze execution results.
- **Input**: Execution results
- **Output**: Analysis report
- **Review gate**: No
- **Agent**: domain-analyst

## Post-processing

- **Description**: Post-processing, visualization, reporting (on demand).
- **Input**: Analysis report
- **Output**: Final deliverables
- **Review gate**: No
