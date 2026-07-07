# Workflow Editor Usage

## Daily Debugging

1. Open `http://127.0.0.1:8767/`.
2. Ask a question in the left chat panel.
3. Watch the top status strip for the active agent, current workflow node, evidence mode, RAG count, and external evidence count.
4. Click a node or edge in the workflow graph.
5. Read the `工作过程与结果` card in the workflow tab for the selected node or transition.

## Reading Node Details

- `真实输入`: what the node received from the previous step.
- `真实输出`: what the node produced.
- `思考 / 交付过程`: auditable process artifacts and handoff payloads.
- `启用 Agent / 事件`: which agents were involved and which runtime events were recorded.

## Editing A Workflow

1. Click `工作流`.
2. Click `编辑工作流`.
3. Select a graph node or edge.
4. Edit the node agent, work, input contract, output contract, handler, checkpoint, or gate policy.
5. For edges, edit source, target, condition, handoff contract, gate policy, planner contract, and reviewer requirement.
6. Click `保存草稿`.
7. Click `生成提案`.
8. Review the diff preview.
9. Click `批准应用` only after the proposal is correct.

AI-assisted workflow generation is handled from the left chat panel, not from this editor. Switch the chat mode to `搭建助手`, or type `/配置 ...` / `/搭建 ...` in normal chat. The generated draft appears here for manual review.

## Important Boundaries

- Drafts do not change the running workflow until they are approved and applied.
- Unknown handlers require code changes and are routed through the code modifier.
- Protected base nodes cannot be deleted from the editor.
- The code modifier is restricted to workflow/code/test paths and must not write secrets, logs, evidence, or memory.

## Editing Multi-Agent Roles

1. Open the `多 Agent` panel.
2. Click `编辑 Agent`.
3. Click an Agent card to edit its label, description, model role, responsibilities, tools, memory access, workflow nodes, permissions, and handoff contract.
4. Click `添加 Agent` to add a new custom role.
5. Click `删除所选` only for non-protected roles.
6. Click `保存草稿`, then `生成提案`, then review the diff preview.
7. Click `批准应用` only after the proposal is correct.

## Top-Level Configurator Agent

The `配置助手` lives in the left chat panel as a top-level builder agent.

- Click `搭建助手` to keep the conversation in builder mode.
- In normal chat, start a message with `/配置`, `/搭建`, `#配置`, `#搭建`, or `配置助手：` to trigger it once.
- Describe the desired agents, workflow nodes, handoff contracts, gates, reviewers, tools, and memory boundaries in natural language.
- The builder writes only draft specs. It does not apply code or change the running workflow by itself.

After a draft is generated:

1. Open `多 Agent` or `工作流`.
2. Review and adjust the generated fields manually.
3. Click `保存草稿`.
4. Click `生成提案`.
5. Review the diff preview.
6. Click `批准应用` only after the proposal is correct.

The configurator prefers DeepSeek for draft generation. If DeepSeek is unavailable, it creates a conservative local fallback draft and clearly reports that fallback in the chat panel.

The `多 Agent` and `工作流` modules are intentionally manual-only surfaces. They keep human intervention, review, proposal, and approval controls, while the top-level chat agent owns natural-language construction.
