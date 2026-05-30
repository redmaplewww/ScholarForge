# ScholarForge

**ScholarForge（学研锻炉）** 是一个面向科研、学术写作、复杂知识工作和可审计自动化流程的通用 Agent 团队框架。它可以从一个普通的 `bun run chat` 入口开始，自动理解目标工作、拆解任务、配置/选择 Agent 团队、建立工作流、维护知识库、记录证据链，并通过安全门控的自优化机制持续改进团队表现。

## 源码来源

本项目源码来源于本地 Agent Aura / CLI-self 工程中的多 Agent 工作流实践，经过去领域化、模板化和发布版整理后形成。原工程中的领域专用内容已被移除，保留的是可迁移到任意研究/知识工作场景的通用能力：Agent 编排、状态机、证据系统、知识库沉淀、自优化审计和运行时初始化机制。

ScholarForge 采用“两层结构”：

- **模板层**：本仓库跟踪的 `agents/`、`knowledge/`、`scripts/`、`src-generic/`、`docs/` 等文件，用来定义你的领域团队和工作流。
- **运行时层**：通过 `bun run init-runtime` 从 CLI-self 一次性复制 `src/`、`packages/`、构建配置和依赖后生成。本地复制完成后，可以独立运行，不再依赖原始 CLI-self 目录。

## 核心能力

### 1. Chat 入口自动编排

`bun run chat` 永远启动通用总管 `domain-coordinator`，不会被 `.project/setup-config.json` 里的旧配置劫持。它负责：

- 识别用户目标工作、交付物、约束、风险和成功标准
- 检查是否已有可用的 `<team>-coordinator`
- 没有合适团队时引导创建新团队
- 将工作分配给 coordinator、specialist、reviewer、librarian、researcher、kb-coordinator 等角色
- 维护 `.project/` 状态文件、证据链和 review gate
- 触发知识库入库和安全自优化审计

### 2. 自动配置 Agent 团队与工作流

运行：

```bash
bun run setup
```

setup 向导会生成或辅助完善：

- `.project/setup-config.json`：领域配置输出，仅用于 setup，不控制默认 chat
- `agents/<team>-coordinator.md`：团队总管 Agent
- specialist agents：领域专家 Agent
- `knowledge/rules/workflow-stages.md`：阶段定义
- `knowledge/rules/workflow-handoffs.md`：handoff packet 结构
- `knowledge/rules/mandatory-checks.md`：强制检查项
- `knowledge/rules/evidence-system.md`：证据系统规则
- `knowledge/rules/project-state-management.md`：状态机规则
- `knowledge/rules/knowledge-bootstrap.md`：知识库初始化规则

当存在 `agents/finance-coordinator.md` 时，执行：

```bash
bun run init-runtime
```

会自动生成：

```bash
bun run finance
```

也就是说，团队创建完成后可以通过 `bun run <team>` 直接进入该团队总管 Agent。

### 3. 状态机与可恢复工作流

ScholarForge 将多阶段任务记录在 `.project/` 中，避免只依赖对话上下文。默认状态机包括：

```text
UNCONFIGURED -> DISCOVERY -> TEAM_SELECTED -> WORKFLOW_PLANNED -> IN_PROGRESS
  -> REVIEW_PENDING -> REVISING -> VERIFIED -> KB_UPDATE_PENDING -> COMPLETE
```

失败状态包括：

- `BLOCKED`：等待用户决策、缺少凭证、权限不足、安全风险或 review gate 无法通过
- `FAILED`：执行失败且超过 bounded repair 限制

核心状态文件模板：

- `.project/templates/state.json`
- `.project/templates/workflow-state.json`
- `.project/templates/evidence.json`
- `.project/templates/self-evolution-state.json`

初始化状态：

```bash
bun run init-state
```

### 4. 证据系统（Evidence System）

证据系统用于保证重要判断、review gate 和高风险决策不是“凭记忆批准”。证据登记在 `.project/evidence.json` 中。

注册证据：

```bash
bun run evidence:add -- --source knowledge/rules/mandatory-checks.md --summary "Mandatory review rules" --type local_knowledge --tag review
```

查看证据：

```bash
bun run evidence:list
```

校验证据：

```bash
bun run evidence:check -- --ids EV-001,EV-002
bun run evidence:check -- --require 2 --stage DESIGN
```

证据记录包括：

- `id`
- `type`
- `source`
- `summary`
- `tags`
- `added_by`
- `added_at`
- `exists`
- `sha_hint`

如果证据 ID 不存在、本地 source 丢失或证据数量不足，`evidence:check` 会以非零退出码失败，方便 reviewer 或 CI 检查使用。

### 5. 知识库搭建与沉淀

默认知识库结构：

```text
knowledge/
├── rules/       # 工作流、handoff、review、证据、状态机、自优化规则
├── memory/      # confirmed/pending/session/historical lessons
├── cases/       # 成功案例和可复用案例
├── reports/     # 分析报告和总结
├── templates/   # 可复用输出模板
└── papers/      # 外部资料、论文和参考文献笔记
```

知识库相关 Agent：

- `domain-librarian`：检索本地知识、案例、报告和历史经验
- `domain-researcher`：当本地证据不足时进行外部研究
- `domain-kb-coordinator`：管理入库流程
- `domain-kb-curator`：提取、分类和整理知识条目
- `domain-kb-reviewer`：审查知识质量

维护知识库：

```bash
bun run maintain-knowledge
```

### 6. Review Gate 与强制检查

`domain-reviewer` 负责阶段性质量门禁，输出：

- `PASS`
- `REVISE`
- `BLOCKED`

默认强制检查包括：

- 证据引用完整性
- handoff packet 完整性
- review gate 不可跳过
- bounded repair 不可无限循环
- secrets / tokens / `.env` 安全检查
- 团队配置完整性
- 状态机可追踪性
- 新领域知识库 bootstrap 完整性

### 7. 安全门控自优化机制

ScholarForge 包含一个自优化 Agent：

- `self-evolution-monitor`

它负责监控：

- 哪个阶段反复返工
- 哪个 Agent 出错率高
- 哪类 review gate 经常失败
- 是否经常缺证据
- 是否存在低效 handoff 或上下文膨胀

运行审计：

```bash
bun run self-evolve:audit
```

输出：

- `project-memory/agent-evolution-report.md`
- `agent-improvement-proposals/<run-id>/signals.json`
- `agent-improvement-proposals/<run-id>/proposals.json`
- `agent-improvement-proposals/<run-id>/proposals.md`

安全原则：

- 默认只生成建议，不修改生产 Agent
- 不自动修改 `agents/*.md`
- 不自动修改 `knowledge/rules/*.md`
- 不自动修改 feature flags、package scripts 或运行时文件
- 用户同意后才允许沙箱测试
- 沙箱测试必须使用发现错误时的案例
- 只有明确指标提升且无回归，才允许建议 apply
- 真正 apply 需要用户第二次明确批准，并指定 proposal ID

用户批准沙箱测试后：

```bash
bun run self-evolve:audit -- --approve-sandbox --materialize-copies
```

### 8. 运行时能力同步

ScholarForge 的启动脚本会同步 CLI-self 当前的默认 feature flags，例如：

- `COORDINATOR_MODE`
- `AGENT_TEAMS`
- `FORK_SUBAGENT`
- `TOKEN_BUDGET`
- `KAIROS`
- `DAEMON`
- `BG_SESSIONS`
- `ACP`
- `LAN_PIPES`
- `WORKFLOW_SCRIPTS`
- `CHICAGO_MCP`

可选能力可以通过环境变量开启：

```bash
FEATURE_MCP_SKILLS=1 bun run chat
FEATURE_TEAMMEM=1 bun run chat
FEATURE_WEB_BROWSER_TOOL=1 bun run chat
```

## 快速开始

```bash
git clone https://github.com/redmaplewww/ScholarForge.git
cd ScholarForge
bun install
bun run init-runtime
bun run chat
```

如果 `CLI-self` 不在同级目录，可以设置：

```powershell
$env:OPENCODE_CLI_PATH="F:\opencode\CLI-self"
bun run init-runtime
```

## 常用命令

| 命令 | 作用 |
|------|------|
| `bun run chat` | 启动通用总管 `domain-coordinator` |
| `bun run setup` | 运行中文配置向导 |
| `bun run chat:setup` | 启动 AI 辅助配置 Agent |
| `bun run init-runtime` | 复制运行时、同步 agents、刷新 `bun run <team>` |
| `bun run <team>` | 直接进入 `<team>-coordinator` |
| `bun run init-state` | 初始化 `.project/` 状态文件 |
| `bun run evidence:add` | 登记证据 |
| `bun run evidence:list` | 查看证据 |
| `bun run evidence:check` | 校验证据 |
| `bun run self-evolve:audit` | 生成自优化审计报告和改进建议 |
| `bun run maintain-knowledge` | 维护知识库 |

## 目录结构

```text
ScholarForge/
├── agents/                    # 通用 Agent 模板
├── knowledge/                 # 规则、知识库、记忆、案例、报告、模板
├── scripts/                   # 初始化、启动、证据、自优化、修复等脚本
├── src-generic/               # 通用知识库/engine/setup 参考实现
├── docs/                      # 发布版文档和运行时功能索引
├── .project/templates/        # 状态文件模板
├── agent-improvement-proposals/ # 自优化建议输出目录（仅保留 .gitkeep）
├── project-memory/            # 自优化报告目录（仅保留 .gitkeep）
├── package.json
└── README.md
```

本地运行时/输出目录默认不入库：

- `src/`
- `packages/`
- `node_modules/`
- `.angsheng/`
- `.project/setup-config.json`
- `.project/runs/`
- `bun.lock`

## 发布版约束

- 不预设任何具体学科或行业团队
- 不提交领域专用 Agent
- 不提交本地 setup 配置
- `bun run chat` 必须固定进入 `domain-coordinator`
- 具体团队必须通过 `agents/<team>-coordinator.md` 生成 `bun run <team>`
- 自优化只能生成 proposal，不能自动改生产行为

## 验证

```bash
bun install
bun --print "await import('./scripts/defines.ts').then(m => m.DEFAULT_BUILD_FEATURES.includes('COORDINATOR_MODE'))"
bun run evidence:list
echo test | timeout 12 bun run chat
```

最后一条命令如果在模型 API 阶段返回额度错误，只要已经显示 `[启动] Agent: domain-coordinator`，就说明启动链路正常。
