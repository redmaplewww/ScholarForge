# Simulink仿真Agent框架 — 使用说明

## 框架概述

基于generic-agent框架构建的MATLAB/Simulink仿真Agent团队，覆盖从需求分析到后处理的完整仿真工作流。

## 工作流

```
需求分析(SSD) → 仿真设计(SDD) → 代码编写(.slx/.m/.fis) → 仿真运行 → 后处理分析
```

每阶段结束后由 `simulink-reviewer` 执行强制审查门。

## Agent团队 (13个)

| Agent | 角色 | 阶段 |
|-------|------|------|
| simulink-coordinator | 总协调器 | 全程 |
| simulink-setup-coordinator | 安装向导 | 初始化 |
| requirement-analyst | 需求分析 | Stage 1 |
| simulink-designer | 仿真设计 | Stage 2 |
| code-engineer | 代码编写 | Stage 3 |
| execution-agent | 仿真运行 | Stage 4 |
| postprocessor | 后处理 | Stage 5 |
| simulink-reviewer | 质量审查 | 每阶段 |
| simulink-kb-coordinator | 知识库管理 | 全程 |
| simulink-kb-curator | 知识提取 | 按需 |
| simulink-kb-reviewer | 知识审查 | 按需 |
| simulink-librarian | 知识检索 | 按需 |
| simulink-researcher | 外部研究 | 按需 |

## 知识库结构

```
knowledge/
├── concepts/          理论概念 (PMSM模型, FOC, SVPWM, Fuzzy-PID)
├── procedures/        操作流程 (建模步骤)
├── cases/             完整案例 (PMSM+Fuzzy-PID)
├── reference/         参考资料 (电机参数表)
└── troubleshooting/   故障排查 (Solver收敛, 代数环)
```

## 自学机制

- 仿真成功 → 案例自动入库
- 仿真失败 → 故障排查方案自动入库
- 设计决策 → 经验教训自动入库
- 外部研究 → 资源自动入库

## 快速启动

```bash
bun run chat
```

然后描述你的仿真需求，`simulink-coordinator` 会自动路由到对应Agent。

## 配置文件

- `setup-config.json` — 框架配置(domain: matlab-simulink)
- `knowledge/rules/` — 工作流规则和审查标准

## 关键技术参数 (参考案例)

- PMSM: R_s=2.875Ω, L=0.0085H, ψ_f=0.175Wb, p_n=4, J=0.0008
- 控制: FOC/id=0 + SVPWM + Fuzzy PID速度环
- Fuzzy: 7 MFs (NB→PB), 49 rules/output, Mamdani, centroid defuzzification
- Solver: ode15s (stiff), max step 1e-5s, PWM 10kHz
- 目标: 超调 <5%, 建立 <0.1s, 稳态误差 <1rpm
