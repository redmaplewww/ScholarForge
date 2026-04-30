# Workflow Handoffs — Simulink仿真

## Handoff Packet Format

```json
{
  "stage": "demand-analysis|simulation-design|code-writing|execution|post-processing",
  "status": "complete|partial|failed",
  "artifacts": ["<list of artifact paths>"],
  "decisions": {
    "motor_type": "<PMSM/BLDC/IM>",
    "control_strategy": "<FOC/DTC/MPC>",
    "solver": "<ode15s/ode45/...>",
    "max_step": "<value>"
  },
  "issues": [],
  "metadata": {
    "simulation_time": "<T_sim>",
    "motor_params_source": "<file path>"
  }
}
```

## Stage Transition Rules

### Stage 1 → Stage 2 (SSD → SDD)
- SSD必须通过simulink-reviewer审查(verdict: APPROVED)
- 必须包含: 仿真目标、物理模型、关键参数、控制策略
- Handoff携带: SSD文档路径

### Stage 2 → Stage 3 (SDD → Code)
- SDD必须通过simulink-reviewer审查(verdict: APPROVED)
- 必须包含: 系统架构、模块选型、接口定义、Solver配置
- Handoff携带: SDD文档路径

### Stage 3 → Stage 4 (Code → Execution)
- 代码必须通过simulink-reviewer审查(verdict: APPROVED)
- 必须包含: .slx/.m/.fis完整文件集
- Handoff携带: 代码文件路径列表

### Stage 4 → Stage 5 (Execution → Post-processing)
- 仿真必须成功完成
- Handoff携带: 结果数据路径、仿真日志
- 如果失败: 返回Stage 3修复(最多3次)

### Stage 5 → Complete
- 报告必须通过simulink-reviewer审查(verdict: APPROVED)
- 触发案例入库流程(通知simulink-kb-coordinator)

## Failure Recovery

| 失败阶段 | 处理策略 |
|----------|----------|
| Stage 1 失败 | 退回用户重新澄清需求 |
| Stage 2 失败 | 退回Stage 1重新分析需求 |
| Stage 3 失败 | 退回Stage 2重新设计 |
| Stage 4 失败(修复成功) | 继续Stage 4 |
| Stage 4 失败(3次) | 退回Stage 3修复代码 |
| Stage 5 失败 | 退回Stage 4或Stage 2(根据问题) |

## Parallel Handoffs

知识库操作可以与主工作流并行:
- 任何阶段可同时调用 `simulink-librarian` 检索相关知识
- 任何阶段可同时调用 `simulink-researcher` 搜索外部资源
- 完成后触发 `simulink-kb-coordinator` 入库
