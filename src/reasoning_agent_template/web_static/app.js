const state = {
  payload: null,
  activeTab: "evidence",
  threadId: getOrCreateThreadId(),
  pendingQuestion: null,
  selectedWorkflowElement: null,
};

const $ = (id) => document.getElementById(id);

function getOrCreateThreadId() {
  const key = "reasoning-agent-thread-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, created);
  return created;
}

function labelStatus(value) {
  const labels = {
    ready: "就绪",
    completed: "已完成",
    running: "运行中",
    active: "工作中",
    accepted: "已接收",
    failed: "失败",
    idle: "空闲",
    pending: "待执行",
    configured: "已配置",
    allow: "允许",
    interrupt: "中断",
    deny: "拒绝",
    none: "无",
    skipped: "已跳过",
    noop: "空转",
    called: "已调用",
    missing_api_key: "缺少 Key",
    error: "错误",
    empty: "无结果",
    filtered: "已过滤",
    fallback: "兜底",
    respond: "响应完成",
    optional: "可选",
    required: "必须",
    soft: "软证据",
    strict: "严格证据",
    not_required: "不需要",
    sufficient: "充足",
    partial: "部分不足",
    unqualified: "证据不合格",
    protected_denied: "保护性拒绝",
    exhausted: "已检索但证据不足",
    missing: "未检索",
    simple: "简单",
    medium: "中等",
    hard: "困难",
    routine: "普通对话",
    evidence_soft: "软证据工作流",
    evidence_strict: "严格证据工作流",
    protected_action: "受保护动作",
    approve: "通过",
    escalate: "升级",
    revise: "修正",
    not_available: "不可用",
    llm: "LLM 判断",
    "llm+reviewer": "LLM + Reviewer",
    rules: "规则兜底",
    rules_fallback_after_invalid_llm_json: "规则兜底",
    stage_started: "阶段开始",
    stage_completed: "阶段完成",
    llm_completed: "LLM 完成",
    llm_routing: "LLM 路由",
    route_review: "路由审查",
    review_decision: "审查结论",
    routing_retry: "路由重试",
    reviewer_retry: "审查重试",
    routing_fallback: "路由兜底",
    reviewer_fallback: "审查兜底",
    external_evidence: "外部证据",
    external_search_attempted: "外部搜索",
    short_term_memory: "短期记忆",
    long_term_memory: "长期记忆",
    flow: "主流程",
    branch: "分支",
    retry: "回检",
    loop: "环路",
  };
  return labels[value] || value || "未知";
}

function labelRisk(value) {
  const labels = {
    none: "无",
    low: "低",
    medium: "中",
    high: "高",
    critical: "严重",
  };
  return labels[value] || value || "未知";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDuration(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "";
  return `${Number(value).toFixed(1)} ms`;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function renderStatus(payload) {
  state.payload = payload;
  $("runtimeLine").textContent = `${payload.runtime?.agent || "agent"} | ${payload.runtime?.workspace || "workspace"}`;
  $("agentStatus").textContent = labelStatus(payload.status || "ready");
  $("stateStatus").textContent = labelStatus(payload.workflow?.current || payload.state_machine?.current || "idle");
  $("routingStatus").textContent = `${labelStatus(payload.routing?.difficulty || "idle")} / ${labelStatus(payload.workflow?.variant || payload.routing?.workflow || "idle")}`;
  $("evidenceCount").textContent = `${labelStatus(payload.evidence?.mode || "idle")} / ${labelStatus(payload.evidence?.strictness || "none")} / ${labelStatus(payload.evidence?.status || "idle")} / ${payload.evidence?.count ?? 0}`;
  $("ragCount").textContent = `${payload.rag?.count ?? 0} / ${payload.external_evidence?.count ?? 0}`;
  $("agentCount").textContent = `${payload.agents?.length || 0} 个已加载`;
  $("currentStage").textContent = labelStatus(payload.workflow?.current || payload.state_machine?.current || "idle");
  $("runId").textContent = payload.run_id ? `${payload.run_id} | ${payload.thread_id || state.threadId}` : `暂无运行 | ${state.threadId}`;

  renderWorkingHint(payload);
  renderAgents(payload.agents || []);
  renderWorkflowGraph(payload.workflow || {});
  renderTab();
}

function renderWorkingHint(payload) {
  const hint = payload.working_hint || {};
  const status = payload.status || "ready";
  $("progressBanner").className = `progress-banner ${escapeHtml(status)}`;
  $("workingAgent").textContent = hint.agent ? `Agent: ${hint.agent}` : "等待运行";
  $("workingStage").textContent = hint.stage ? `节点: ${hint.stage}` : labelStatus(payload.workflow?.current || payload.state_machine?.current || "idle");
  $("workingHint").textContent = hint.message || (status === "completed" ? "本轮运行已完成。" : "发送消息后，这里会显示当前 Agent、工作流节点和执行提示。");
}

function renderAgents(agents) {
  $("agentsList").innerHTML = agents
    .map((agent) => {
      const status = agent.status || "idle";
      return `
        <article class="agent-row">
          <header>
            <h3>${escapeHtml(agent.name)}</h3>
            <span class="badge ${escapeHtml(status)}">${escapeHtml(labelStatus(status))}</span>
          </header>
          <p>${escapeHtml(agent.description || "")}</p>
          <p class="mono">${escapeHtml(agent.last_event || agent.current_stage || "")}</p>
        </article>
      `;
    })
    .join("");
}

function renderWorkflowGraph(workflow) {
  renderCytoscapeWorkflowGraph($("workflowGraph"), workflow, { compact: false });
}

function renderCytoscapeWorkflowGraph(container, workflow, options = {}) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  if (container._workflowCy) {
    container._workflowCy.destroy();
    container._workflowCy = null;
  }
  if (!nodes.length) {
    container.innerHTML = `<p class="empty">暂无工作流图。</p>`;
    return;
  }
  if (typeof cytoscape !== "function") {
    container.innerHTML = `<p class="empty">图渲染库未加载，无法绘制工作流。</p>`;
    return;
  }
  container.innerHTML = `
    <div class="workflow-graph-canvas"></div>
    <div class="workflow-graph-legend">
      <span><i class="legend-dot active"></i>工作中</span>
      <span><i class="legend-dot completed"></i>已完成</span>
      <span><i class="legend-dot skipped"></i>跳过/空转</span>
      <span><i class="legend-line retry"></i>回路/重试</span>
    </div>
  `;
  const canvas = container.querySelector(".workflow-graph-canvas");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const elements = [
    ...nodes.map((node, index) => {
      const status = node.status || "pending";
      const effect = node.effective_status || status;
      const duration = formatDuration(node.duration_ms);
      return {
        data: {
          id: node.id,
          label: node.id,
          order: index,
          agent: node.agent || "-",
          effect,
          displayLabel: `${workflowNodeLabel(node.id)}\n${node.agent || "-"}`,
          status,
          description: node.description || "",
          input: node.input || "",
          output: node.output || "",
          observed: node.observed || "",
          duration: duration || (node.work_done ? "有产出" : "无可见产出"),
          skip: node.skip_reason || "",
        },
        classes: [status, effect, node.checkpoint ? "checkpoint" : ""].filter(Boolean).join(" "),
        position: workflowNodePosition(node.id, index, nodes, canvas, options),
      };
    }),
    ...edges
      .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map((edge, index) => ({
        data: {
          id: `edge-${index}-${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
          label: "",
          type: edge.type || "flow",
          description: edge.label || "",
          from: edge.from,
          to: edge.to,
        },
        classes: edge.type || "flow",
      })),
  ];

  const cy = cytoscape({
    container: canvas,
    elements,
    minZoom: 0.35,
    maxZoom: 1.7,
    autoungrabify: false,
    style: cytoscapeWorkflowStyle(),
    layout: workflowHybridLayoutOptions(options),
  });

  cy.one("layoutstop", () => {
    cy.fit(undefined, options.compact ? 20 : 30);
  });
  applyWorkflowSelectionToGraph(cy);
  cy.on("mouseover", "node", (event) => {
    const item = event.target.data();
    canvas.title = `${item.label} | Agent: ${item.agent} | ${labelStatus(item.effect)} | ${item.observed}`;
  });
  cy.on("mouseout", "node", () => {
    canvas.title = "";
  });
  cy.on("tap", "node", (event) => {
    handleWorkflowGraphSelection(workflow, event.target, "node");
  });
  cy.on("tap", "edge", (event) => {
    handleWorkflowGraphSelection(workflow, event.target, "edge");
  });
  container._workflowCy = cy;
}

function handleWorkflowGraphSelection(workflow, element, kind) {
  const data = element.data();
  if (kind === "edge") {
    state.selectedWorkflowElement = {
      kind: "edge",
      id: data.id,
      from: data.from || data.source,
      to: data.to || data.target,
      type: data.type || "flow",
    };
  } else {
    state.selectedWorkflowElement = {
      kind: "node",
      id: data.id,
    };
  }
  setActiveTab("workflow");
  applyWorkflowSelectionToOpenGraphs();
  renderTab();
  applyWorkflowSelectionToOpenGraphs();
}

function applyWorkflowSelectionToOpenGraphs() {
  document.querySelectorAll(".workflow-graph").forEach((container) => {
    if (container._workflowCy) applyWorkflowSelectionToGraph(container._workflowCy);
  });
}

function applyWorkflowSelectionToGraph(cy) {
  const selection = state.selectedWorkflowElement;
  cy.elements().removeClass("selected");
  if (!selection) return;
  const match =
    selection.kind === "edge"
      ? cy
          .edges()
          .filter(
            (edge) =>
              edge.data("id") === selection.id ||
              (edge.data("from") === selection.from &&
                edge.data("to") === selection.to &&
                edge.data("type") === selection.type),
          )
      : cy.nodes().filter((node) => node.id() === selection.id);
  match.addClass("selected");
}

function workflowHybridLayoutOptions(options) {
  return {
    name: "preset",
    fit: true,
    padding: options.compact ? 18 : 26,
    animate: true,
    animationDuration: 320,
  };
}

function workflowLoopNodeOrder() {
  return ["retrieve", "reason", "evidence_audit", "gate", "act_or_answer", "verify", "consolidate"];
}

function workflowEvidenceLoopNodeOrder() {
  return ["retrieve", "reason", "evidence_audit"];
}

function workflowReviewLoopNodeOrder() {
  return ["gate", "act_or_answer", "verify", "consolidate"];
}

function workflowLoopClusterNodes(nodes) {
  const available = new Set(nodes.map((node) => node.id));
  return workflowLoopNodeOrder().filter((id) => available.has(id));
}

function workflowAvailableLoopNodes(nodes, orderedIds) {
  const available = new Set(nodes.map((node) => node.id));
  return orderedIds.filter((nodeId) => available.has(nodeId));
}

function workflowNodePosition(id, index, nodes, canvas, options) {
  const width = Math.max(canvas.clientWidth || 760, options.compact ? 640 : 760);
  const height = Math.max(canvas.clientHeight || 360, options.compact ? 340 : 360);
  const centerY = height * 0.5;
  const evidenceLoopNodes = workflowAvailableLoopNodes(nodes, workflowEvidenceLoopNodeOrder());
  const evidenceLoopIndex = evidenceLoopNodes.indexOf(id);
  if (evidenceLoopIndex >= 0 && evidenceLoopNodes.length >= 3) {
    const angles = {
      retrieve: Math.PI,
      reason: -Math.PI / 2,
      evidence_audit: 0,
    };
    const loopCenterX = width * 0.42;
    const radiusX = Math.min(width * 0.09, options.compact ? 58 : 72);
    const radiusY = Math.min(height * 0.18, options.compact ? 48 : 62);
    const angle = angles[id] ?? (-Math.PI / 2 + (evidenceLoopIndex / evidenceLoopNodes.length) * 2 * Math.PI);
    return {
      x: loopCenterX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  }

  const reviewLoopNodes = workflowAvailableLoopNodes(nodes, workflowReviewLoopNodeOrder());
  const reviewLoopIndex = reviewLoopNodes.indexOf(id);
  if (reviewLoopIndex >= 0 && reviewLoopNodes.length >= 3) {
    const angles = {
      gate: Math.PI,
      act_or_answer: -Math.PI / 2,
      verify: 0,
      consolidate: Math.PI / 2,
    };
    const loopCenterX = width * 0.68;
    const radiusX = Math.min(width * 0.09, options.compact ? 58 : 72);
    const radiusY = Math.min(height * 0.18, options.compact ? 48 : 62);
    const angle = angles[id] ?? (-Math.PI / 2 + (reviewLoopIndex / reviewLoopNodes.length) * 2 * Math.PI);
    return {
      x: loopCenterX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  }

  const anchors = {
    intake: { x: options.compact ? 60 : 68, y: centerY },
    plan: { x: options.compact ? 176 : 198, y: centerY },
    respond: { x: width - (options.compact ? 58 : 68), y: centerY },
  };
  if (anchors[id]) return anchors[id];

  const span = Math.max(width - 160, 1);
  const denom = Math.max(nodes.length - 1, 1);
  return {
    x: 80 + (span * index) / denom,
    y: centerY,
  };
}

function workflowNodeLabel(id) {
  const labels = {
    intake: "接收",
    plan: "计划",
    retrieve: "检索",
    reason: "推理",
    evidence_audit: "证据审计",
    gate: "门禁",
    act_or_answer: "行动/回答",
    verify: "验证",
    consolidate: "沉淀",
    respond: "响应",
  };
  return labels[id] || id;
}

function cytoscapeWorkflowStyle() {
  return [
    {
      selector: "node",
      style: {
        "shape": "round-rectangle",
        "width": 94,
        "height": 44,
        "background-color": "#ffffff",
        "border-width": 1.5,
        "border-color": "#cfd8cf",
        "label": "data(displayLabel)",
        "font-size": 9,
        "font-weight": 700,
        "color": "#20231f",
        "text-valign": "center",
        "text-halign": "center",
        "line-height": 1.14,
        "text-wrap": "wrap",
        "text-max-width": 84,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "node.active",
      style: {
        "background-color": "#edf8f6",
        "border-color": "#0f766e",
        "border-width": 3,
      },
    },
    {
      selector: "node.selected",
      style: {
        "background-color": "#f0fdfa",
        "border-color": "#0f766e",
        "border-width": 4,
      },
    },
    {
      selector: "node.completed",
      style: {
        "background-color": "#f3faf4",
        "border-color": "#2f7d32",
      },
    },
    {
      selector: "node.skipped, node.noop",
      style: {
        "background-color": "#fff9e8",
        "border-color": "#a16207",
        "border-style": "dashed",
      },
    },
    {
      selector: "node.checkpoint",
      style: {
        "border-width": 2.4,
      },
    },
    {
      selector: "edge",
      style: {
        "width": 2.3,
        "line-color": "#c7d0c6",
        "target-arrow-color": "#c7d0c6",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        "control-point-step-size": 34,
        "label": "data(label)",
        "font-size": 8,
        "color": "#687066",
        "text-background-color": "#fbfcfb",
        "text-background-opacity": 0.72,
        "text-background-padding": 2,
        "text-rotation": "none",
        "opacity": 0.86,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "edge.branch",
      style: {
        "line-style": "dashed",
        "line-color": "#8ea39b",
        "target-arrow-color": "#8ea39b",
      },
    },
    {
      selector: "edge.retry, edge.revise, edge.loop",
      style: {
        "curve-style": "bezier",
        "control-point-step-size": 48,
        "line-style": "dashed",
        "line-color": "#a16207",
        "target-arrow-color": "#a16207",
        "color": "#a16207",
      },
    },
    {
      selector: "edge.selected",
      style: {
        "width": 3.8,
        "line-color": "#0f766e",
        "target-arrow-color": "#0f766e",
        "opacity": 1,
      },
    },
  ];
}
function referenceIndexByEvidenceId(payload) {
  const references = payload.evidence?.references || [];
  return new Map(references.map((item) => [item.id, item.index]));
}

function referenceLabel(payload, evidenceId) {
  const index = referenceIndexByEvidenceId(payload).get(evidenceId);
  return index ? `参考文献[${index}]` : evidenceId || "未绑定参考文献";
}

function renderTab() {
  const payload = state.payload || {};
  const target = $("tabContent");
  if (state.activeTab === "evidence") return renderEvidenceTab(target, payload);
  if (state.activeTab === "routing") return renderRoutingTab(target, payload);
  if (state.activeTab === "rag") return renderRagTab(target, payload);
  if (state.activeTab === "external") return renderExternalTab(target, payload);
  if (state.activeTab === "workflow") return renderWorkflowTab(target, payload);
  if (state.activeTab === "gates") return renderGatesTab(target, payload);
  if (state.activeTab === "memory") return renderMemoryTab(target, payload);
  if (state.activeTab === "skills") return renderSkillsTab(target, payload);
  if (state.activeTab === "events") return renderEventsTab(target, payload);
  target.innerHTML = `<pre class="mono">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
}

function renderEvidenceTab(target, payload) {
  const items = payload.evidence?.items || [];
  const references = payload.evidence?.references || [];
  const qualifiedReferences = (payload.evidence?.qualified_evidence_ids || [])
    .map((id) => referenceLabel(payload, id))
    .join(", ");
  const referenceList = references.length
    ? `
      <article class="detail-item reference-list">
        <h3>参考文献索引</h3>
        ${references
          .map(
            (item) => `
          <p class="reference-item">
            <strong>[${escapeHtml(item.index)}]</strong>
            ${escapeHtml(item.source_type)} | ${escapeHtml(item.uri)} | ${escapeHtml(item.locator)}
          </p>
          <p>${escapeHtml(item.summary || "")}</p>
        `,
          )
          .join("")}
      </article>
    `
    : "";
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>模式</strong> ${escapeHtml(labelStatus(payload.evidence?.mode || "idle"))} / ${escapeHtml(labelStatus(payload.evidence?.strictness || "none"))}</p>
      <p>状态: ${escapeHtml(labelStatus(payload.evidence?.status || "idle"))} | 风险: ${escapeHtml(labelRisk(payload.evidence?.risk_level || "none"))}</p>
      <p>合格证据: ${escapeHtml(qualifiedReferences || "暂无")}</p>
      <p class="mono">${escapeHtml((payload.evidence?.reasons || []).join("\n") || "暂无证据策略原因。")}</p>
    </article>
    ${referenceList}
    ${
      items.length
        ? items
            .map(
              (item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(referenceLabel(payload, item.id))}</strong> <span class="badge completed">${escapeHtml(item.source_type)}</span></p>
            <p class="mono">${escapeHtml(item.uri)} | ${escapeHtml(item.locator)} | confidence=${escapeHtml(item.confidence)}</p>
            <p>${escapeHtml(item.summary || "")}</p>
          </article>
        `,
            )
            .join("")
        : `<p class="empty">暂无证据。简单对话不会强制检索；中高难或高风险任务会在这里沉淀证据。</p>`
    }
  `;
}

function renderRoutingTab(target, payload) {
  const routing = payload.routing || {};
  const reviewer = payload.reviewer || {};
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>Coordinator</strong> <span class="badge">${escapeHtml(labelStatus(routing.source || "idle"))}</span></p>
      <p>难度: ${escapeHtml(labelStatus(routing.difficulty || "idle"))} | 工作流: ${escapeHtml(labelStatus(routing.workflow || "idle"))} | confidence=${escapeHtml(routing.confidence ?? 0)}</p>
      <pre class="mono">${escapeHtml(JSON.stringify(routing.decision || {}, null, 2))}</pre>
    </article>
    <article class="detail-item">
      <p><strong>Reviewer</strong> <span class="badge ${escapeHtml(reviewer.status || "idle")}">${escapeHtml(labelStatus(reviewer.status || "idle"))}</span></p>
      <p class="mono">${escapeHtml((reviewer.findings || []).join("\n") || "暂无审查意见。")}</p>
      <pre class="mono">${escapeHtml(JSON.stringify(reviewer.decision || {}, null, 2))}</pre>
    </article>
  `;
}

function renderRagTab(target, payload) {
  const items = payload.rag?.results || [];
  target.innerHTML = items.length
    ? items
        .map(
          (item) => `
        <article class="detail-item">
          <p><strong>${escapeHtml(item.source)}</strong> <span class="badge completed">${Number(item.score || 0).toFixed(2)}</span></p>
          <p class="mono">${escapeHtml(item.span)} | ${escapeHtml(referenceLabel(payload, item.evidence_id))}</p>
          <p>${escapeHtml(item.text || "")}</p>
        </article>
      `,
        )
        .join("")
    : `<p class="empty">暂无本地 RAG 结果。</p>`;
}

function renderExternalTab(target, payload) {
  const external = payload.external_evidence || {};
  const items = external.results || [];
  const diagnostics = external.diagnostics || [];
  const diagnosticsBlock = diagnostics.length
    ? diagnostics
        .map(
          (item) => `
        <article class="detail-item">
          <p><strong>${escapeHtml(item.source || "source")}</strong> <span class="badge ${escapeHtml(item.status || "idle")}">${escapeHtml(labelStatus(item.status || "idle"))}</span></p>
          <p class="mono">${escapeHtml(item.message || "")}</p>
          <p class="mono">${escapeHtml(item.url || "")}</p>
        </article>
      `,
        )
        .join("")
    : "";
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>外部证据检索</strong> ${escapeHtml(items.length)} 条</p>
      <p>尝试来源: ${escapeHtml((external.attempted_sources || []).join(", ") || "暂无")}</p>
      <p class="mono">query=${escapeHtml(external.query || "")}</p>
    </article>
    ${
      items.length
        ? items
            .map(
              (item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(item.source)}</strong> <span class="badge completed">${Number(item.score || 0).toFixed(2)}</span></p>
            <p class="mono">${escapeHtml(item.span)} | ${escapeHtml(referenceLabel(payload, item.evidence_id))}</p>
            <p>${escapeHtml(item.text || "")}</p>
          </article>
        `,
            )
            .join("")
        : `<p class="empty">暂无通过相关性过滤的外部论文、网络或用户经验证据。</p>`
    }
    ${diagnosticsBlock}
  `;
}

function renderWorkflowSelectionPanel(payload) {
  const workflow = payload.workflow || {};
  const selection = state.selectedWorkflowElement;
  if (!selection) {
    return `
      <article class="detail-item workflow-selection">
        <p><strong>工作过程与结果</strong></p>
        <p>未选择工作流对象。选中图上的节点或连线后，这里会显示对应模块的输入、输出、执行摘要、启用 Agent、审查和门禁。</p>
      </article>
    `;
  }
  if (selection.kind === "edge") {
    const edge = workflowSelectedEdge(workflow, selection);
    return edge ? renderWorkflowEdgeSelection(payload, edge) : renderMissingWorkflowSelection(selection);
  }
  const node = workflowSelectedNode(workflow, selection.id);
  return node ? renderWorkflowNodeSelection(payload, node) : renderMissingWorkflowSelection(selection);
}

function renderMissingWorkflowSelection(selection) {
  return `
    <article class="detail-item workflow-selection">
      <p><strong>工作过程与结果</strong></p>
      <p>当前选择 ${escapeHtml(selection.kind || "unknown")}:${escapeHtml(selection.id || selection.from || "")} 已不在最新工作流中。</p>
    </article>
  `;
}

function workflowSelectedNode(workflow, id) {
  return (workflow.nodes || []).find((node) => node.id === id);
}

function workflowSelectedEdge(workflow, selection) {
  return (workflow.edges || []).find(
    (edge, index) =>
      `edge-${index}-${edge.from}-${edge.to}` === selection.id ||
      (edge.from === selection.from && edge.to === selection.to && (edge.type || "flow") === selection.type),
  );
}

function renderWorkflowNodeSelection(payload, node) {
  const agents = workflowAgentsForNode(payload, node);
  const events = workflowEventsForNode(payload, node);
  const artifacts = node.artifacts || {};
  return `
    <article class="detail-item workflow-selection">
      <header class="workflow-selection-head">
        <div>
          <p><strong>工作过程与结果</strong></p>
          <h3>${escapeHtml(workflowNodeLabel(node.id))} <span class="mono">${escapeHtml(node.id)}</span></h3>
        </div>
        <div class="workflow-selection-badges">
          <span class="badge ${escapeHtml(node.status || "pending")}">${escapeHtml(labelStatus(node.status || "pending"))}</span>
          <span class="badge ${escapeHtml(node.effective_status || node.status || "pending")}">${escapeHtml(labelStatus(node.effective_status || node.status || "pending"))}</span>
        </div>
      </header>
      <div class="workflow-selection-grid">
        <section>
          <h4>真实输入</h4>
          ${renderArtifactBlock("input contract", node.input || "未声明")}
          ${renderArtifactBlock("actual_input", artifacts.actual_input || {})}
          <p class="mono">耗时: ${escapeHtml(formatDuration(node.duration_ms) || "未执行")}</p>
        </section>
        <section>
          <h4>真实输出</h4>
          ${renderArtifactBlock("output contract", node.output || "未声明")}
          ${renderArtifactBlock("actual_output", artifacts.actual_output || {})}
        </section>
        <section>
          <h4>思考 / 交付过程</h4>
          ${renderArtifactBlock("process", artifacts.process || node.observed || "暂无执行观察。")}
          ${renderArtifactBlock("handoff", artifacts.handoff || {})}
        </section>
        <section>
          <h4>启用 Agent / 事件</h4>
          ${renderWorkflowAgentList(agents)}
          ${renderWorkflowEventList(events)}
        </section>
      </div>
    </article>
  `;
}

function renderWorkflowEdgeSelection(payload, edge) {
  const workflow = payload.workflow || {};
  const source = workflowSelectedNode(workflow, edge.from) || { id: edge.from };
  const target = workflowSelectedNode(workflow, edge.to) || { id: edge.to };
  const details = workflowEdgeTransitionDetails(payload, edge, source, target);
  const agents = workflowAgentsForEdge(payload, source, target, edge);
  const events = workflowEventsForEdge(payload, edge, source, target);
  const sourceArtifacts = source.artifacts || {};
  const targetArtifacts = target.artifacts || {};
  return `
    <article class="detail-item workflow-selection">
      <header class="workflow-selection-head">
        <div>
          <p><strong>转交流程审查</strong></p>
          <h3>${escapeHtml(workflowNodeLabel(edge.from))} -> ${escapeHtml(workflowNodeLabel(edge.to))}</h3>
        </div>
        <div class="workflow-selection-badges">
          <span class="badge ${escapeHtml(edge.type || "flow")}">${escapeHtml(labelStatus(edge.type || "flow"))}</span>
        </div>
      </header>
      <div class="workflow-selection-grid">
        <section>
          <h4>上游真实输出</h4>
          ${renderArtifactBlock(`${edge.from}.actual_output`, sourceArtifacts.actual_output || source.output || {})}
          <p class="mono">条件: ${escapeHtml(edge.label || "默认主流程")}</p>
        </section>
        <section>
          <h4>下游真实输入</h4>
          ${renderArtifactBlock(`${edge.to}.actual_input`, targetArtifacts.actual_input || target.input || {})}
        </section>
        <section>
          <h4>审查 / 门禁 / 交付</h4>
          ${details.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
          ${renderArtifactBlock("source_handoff", sourceArtifacts.handoff || {})}
          ${renderArtifactBlock("target_handoff", targetArtifacts.handoff || {})}
        </section>
        <section>
          <h4>启用 Agent / 事件</h4>
          ${renderWorkflowAgentList(agents)}
          ${renderWorkflowEventList(events)}
        </section>
      </div>
    </article>
  `;
}

function renderArtifactBlock(title, value) {
  return `
    <div class="artifact-block">
      <h5>${escapeHtml(title)}</h5>
      <pre class="mono artifact-json">${escapeHtml(formatArtifactValue(value))}</pre>
    </div>
  `;
}

function formatArtifactValue(value) {
  if (value === undefined || value === null || value === "") return "暂无";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && !value.length) return "[]";
  if (typeof value === "object" && !Object.keys(value).length) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function workflowNodeReasoningSummary(payload, node) {
  if (node.id === "intake") {
    return `Coordinator 将用户目标归一化，并形成难度 ${labelStatus(payload.routing?.difficulty || "idle")}、工作流 ${labelStatus(payload.workflow?.variant || "idle")} 的初步上下文。`;
  }
  if (node.id === "plan") {
    const reviewer = payload.reviewer || {};
    return `Planner 使用 Coordinator 路由结果生成执行计划；Reviewer 状态为 ${labelStatus(reviewer.status || "idle")}，用于纠正过松的难度、风险或证据判断。`;
  }
  if (node.id === "retrieve") {
    const external = payload.external_evidence || {};
    return `Retriever 按证据策略检索本地 RAG 和外部来源；已尝试 ${escapeHtml((external.attempted_sources || []).join(", ") || "无外部来源")}。`;
  }
  if (node.id === "reason") {
    return `Reasoner 只基于当前路由、记忆和证据上下文生成可发布答案草案；证据不足时会输出受限答案或等待门禁处理。`;
  }
  if (node.id === "evidence_audit") {
    return `Critic 审计关键结论是否有证据支撑；当前证据状态为 ${labelStatus(payload.evidence?.status || "idle")}。`;
  }
  if (node.id === "gate") {
    return `Critic 执行风险、证据和权限门禁；当前已有 ${payload.gates?.count || 0} 条门禁决策。`;
  }
  if (node.id === "act_or_answer") {
    return `Coordinator 根据门禁结果决定发布答案、给出受限答案、拒绝高风险动作，或等待补充证据。`;
  }
  if (node.id === "verify") {
    return `Critic 对输出、证据状态和门禁状态做一致性验证；若失败会回到推理或检索环节。`;
  }
  if (node.id === "consolidate") {
    return `Memory Agent 只生成证据沉淀或记忆候选提案，不直接修改长期记忆、知识库或技能。`;
  }
  if (node.id === "respond") {
    return `Coordinator 汇总最终答案和调试遥测，把参考文献索引留在证据栏中。`;
  }
  return node.observed || "暂无可审计摘要。";
}

function workflowEdgeTransitionDetails(payload, edge, source, target) {
  const details = [];
  details.push(`边类型: ${labelStatus(edge.type || "flow")}；${edge.label || "默认进入下一节点"}`);
  if (edge.from === "intake" || edge.to === "plan" || edge.from === "plan") {
    details.push(
      `路由审查: Coordinator=${labelStatus(payload.routing?.source || "idle")}，Reviewer=${labelStatus(payload.reviewer?.status || "idle")}。`,
    );
  }
  if (edge.from === "plan" && edge.to === "retrieve") {
    details.push(`证据触发: ${labelStatus(payload.evidence?.mode || "idle")} / ${labelStatus(payload.evidence?.strictness || "none")}。`);
  }
  if (edge.from === "plan" && edge.to === "reason") {
    details.push("普通路径: 当证据不强制时可跳过检索，但仍保留 Reviewer 的升级能力。");
  }
  if (edge.from === "evidence_audit" || edge.to === "gate") {
    details.push(`证据审计: ${labelStatus(payload.evidence?.status || "idle")}；合格证据 ${payload.evidence?.qualified_evidence_ids?.length || 0} 条。`);
  }
  if (edge.from === "gate" || edge.to === "gate" || edge.to === "act_or_answer") {
    details.push(workflowGateSummary(payload));
  }
  if (["retry", "revise", "loop"].includes(edge.type || "")) {
    details.push(`回路原因: ${edge.label || "需要补证、复审或修正后再进入主流程"}`);
  }
  details.push(`Agent 转交: ${source.agent || "-"} -> ${target.agent || "-"}`);
  return details;
}

function workflowGateSummary(payload) {
  const decisions = payload.gates?.decisions || [];
  if (!decisions.length) return "门禁: 当前还没有产生门禁决策。";
  return decisions
    .map((decision) => {
      const reasons = (decision.reasons || []).join("; ");
      return `门禁 ${decision.gate_id}: ${labelStatus(decision.status)} / 风险 ${labelRisk(decision.risk_level)}${reasons ? ` / ${reasons}` : ""}`;
    })
    .join("\n");
}

function workflowAgentsForNode(payload, node) {
  const names = new Set([node.agent].filter(Boolean));
  if (node.id === "intake" || node.id === "plan") {
    names.add("coordinator");
    names.add("reviewer");
  }
  if (["evidence_audit", "gate", "verify"].includes(node.id)) names.add("critic");
  if (node.id === "retrieve") names.add("retriever");
  if (node.id === "consolidate") names.add("memory");
  return workflowAgentRecords(payload, names);
}

function workflowAgentsForEdge(payload, source, target, edge) {
  const names = new Set([source.agent, target.agent].filter(Boolean));
  if (edge.from === "intake" || edge.from === "plan" || edge.to === "plan") names.add("reviewer");
  if (edge.from === "evidence_audit" || edge.to === "gate" || edge.from === "gate" || edge.to === "verify") names.add("critic");
  if (["retry", "loop"].includes(edge.type || "")) names.add("retriever");
  return workflowAgentRecords(payload, names);
}

function workflowAgentRecords(payload, names) {
  const byName = new Map((payload.agents || []).map((agent) => [agent.name, agent]));
  return [...names].map((name) => byName.get(name) || { name, status: "not_available", description: "" });
}

function workflowEventsForNode(payload, node) {
  const events = payload.events || [];
  const stageEvents = events.filter((event) => event.stage === node.id);
  const agentEvents = events.filter((event) => !event.stage && event.agent === node.agent);
  return [...stageEvents, ...agentEvents].slice(-8);
}

function workflowEventsForEdge(payload, edge, source, target) {
  const events = payload.events || [];
  const agents = new Set([source.agent, target.agent, "reviewer", "critic"].filter(Boolean));
  return events
    .filter((event) => event.stage === edge.from || event.stage === edge.to || (!event.stage && agents.has(event.agent)))
    .slice(-10);
}

function renderWorkflowAgentList(agents) {
  if (!agents.length) return `<p class="empty">暂无 Agent 记录。</p>`;
  return agents
    .map(
      (agent) => `
        <p>
          <strong>${escapeHtml(agent.name)}</strong>
          <span class="badge ${escapeHtml(agent.status || "idle")}">${escapeHtml(labelStatus(agent.status || "idle"))}</span>
          <span class="mono">${escapeHtml(agent.last_event || agent.current_stage || agent.description || "")}</span>
        </p>
      `,
    )
    .join("");
}

function renderWorkflowEventList(events) {
  if (!events.length) return `<p class="empty">暂无相关事件。</p>`;
  return events
    .map(
      (event) => `
        <p>
          <strong>${escapeHtml(event.agent || "-")}</strong>
          <span class="badge">${escapeHtml(labelStatus(event.kind || "event"))}</span>
          <span class="mono">${escapeHtml(event.stage || "")}${event.duration_ms !== undefined ? ` | ${escapeHtml(formatDuration(event.duration_ms))}` : ""}</span>
          ${escapeHtml(event.message || "")}
        </p>
      `,
    )
    .join("");
}

function renderWorkflowTab(target, payload) {
  const workflow = payload.workflow || {};
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>工作流状态</strong> <span class="badge ${escapeHtml(workflow.status || "idle")}">${escapeHtml(labelStatus(workflow.status || "idle"))}</span></p>
      <p>当前节点: ${escapeHtml(workflow.current || "idle")} | 工作流类型: ${escapeHtml(labelStatus(workflow.variant || "idle"))}</p>
      <p class="mono">检查点: ${escapeHtml((workflow.checkpoints || []).join(", "))}</p>
    </article>
    ${renderWorkflowSelectionPanel(payload)}
    ${nodes
      .map(
        (node) => `
      <article class="detail-item">
        <p>
          <strong>${escapeHtml(node.id)}</strong>
          <span class="badge ${escapeHtml(node.status || "pending")}">${escapeHtml(labelStatus(node.status || "pending"))}</span>
          <span class="badge ${escapeHtml(node.effective_status || node.status || "pending")}">${escapeHtml(labelStatus(node.effective_status || node.status || "pending"))}</span>
        </p>
        <p>${escapeHtml(node.description || "")}</p>
        <p class="mono">负责 Agent: ${escapeHtml(node.agent)} | 输入: ${escapeHtml(node.input)} | 输出: ${escapeHtml(node.output)}</p>
        <p class="mono">实际产出: ${escapeHtml(node.work_done ? "有" : "无")} | ${escapeHtml(node.skip_reason || "无跳过原因")} | ${escapeHtml(node.observed || "")}${node.duration_ms !== undefined ? ` | ${escapeHtml(formatDuration(node.duration_ms))}` : ""}</p>
      </article>
    `,
      )
      .join("")}
    <article class="detail-item">
      <p><strong>控制流边</strong></p>
      <p class="mono">${escapeHtml(edges.map((edge) => `${edge.from} -> ${edge.to} [${edge.type || "flow"}] ${edge.label || ""}`).join("\n"))}</p>
    </article>
  `;
}

function renderGatesTab(target, payload) {
  const items = payload.gates?.decisions || [];
  target.innerHTML = items.length
    ? items
        .map(
          (item) => `
        <article class="detail-item">
          <p><strong>${escapeHtml(item.gate_id)}</strong> <span class="badge ${escapeHtml(item.status)}">${escapeHtml(labelStatus(item.status))}</span></p>
          <p>风险: ${escapeHtml(labelRisk(item.risk_level))} | 证据: ${escapeHtml((item.required_evidence || []).join(", "))}</p>
          <p class="mono">${escapeHtml((item.reasons || []).join("; ") || "门禁无异常。")}</p>
        </article>
      `,
        )
        .join("")
    : `<p class="empty">暂无门禁决策。</p>`;
}

function renderMemoryTab(target, payload) {
  const memory = payload.memory || {};
  const shortTerm = memory.short_term || {};
  const longTerm = memory.long_term || {};
  const boundaries = memory.boundaries || {};
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>策略</strong> ${escapeHtml(memory.policy || "configured")}</p>
      <p>分区: ${escapeHtml((memory.partitions || []).join(", "))}</p>
      <p>只读: ${escapeHtml((memory.read_only || []).join(", "))}</p>
      <p>Thread: ${escapeHtml(shortTerm.thread_id || payload.thread_id || state.threadId)}</p>
      <p>短期记忆: ${escapeHtml(shortTerm.turns || 0)} 轮 | 长期记忆: ${escapeHtml(longTerm.records || 0)} 条 | 本轮写入: ${escapeHtml(longTerm.writes || 0)} 条</p>
      <p class="mono">${escapeHtml((memory.pending_consolidation || []).join("\n") || "暂无待沉淀内容。")}</p>
    </article>
    <article class="detail-item">
      <p><strong>硬边界</strong></p>
      <p class="mono">${escapeHtml(Object.entries(boundaries).map(([key, value]) => `${key}: ${value}`).join("\n") || "暂无边界说明。")}</p>
      <p class="mono">已知 thread: ${escapeHtml((shortTerm.threads || []).join(", ") || shortTerm.thread_id || state.threadId)}</p>
    </article>
    <article class="detail-item">
      <p><strong>短期记忆</strong></p>
      <p class="mono">${escapeHtml((shortTerm.items || []).map((item) => `用户: ${item.user}\nAgent: ${item.assistant}`).join("\n\n") || "暂无短期对话记忆。")}</p>
    </article>
    <article class="detail-item">
      <p><strong>长期记忆</strong></p>
      <p class="mono">${escapeHtml((longTerm.items || []).map((item) => `${item.partition}/${item.key}: ${item.value}`).join("\n") || "暂无长期记忆。")}</p>
    </article>
    <article class="detail-item">
      <p><strong>记忆写入门禁</strong></p>
      <p class="mono">${escapeHtml((longTerm.write_decisions || []).map((item) => `${item.partition}/${item.key}: ${item.status} ${(item.reasons || []).join("; ")}`).join("\n") || "本轮没有长期记忆写入。")}</p>
    </article>
  `;
}

function renderSkillsTab(target, payload) {
  const skills = payload.skills || {};
  target.innerHTML = `
    <article class="detail-item">
      <p><strong>${skills.count || 0} 个技能包已加载</strong></p>
      <p class="mono">${escapeHtml((skills.enabled || skills.loaded || []).join("\n"))}</p>
    </article>
  `;
}

function renderEventsTab(target, payload) {
  const events = payload.events || [];
  target.innerHTML = events.length
    ? events
        .map(
          (event) => `
        <article class="detail-item">
          <p><strong>${escapeHtml(event.agent)}</strong> <span class="badge">${escapeHtml(labelStatus(event.kind))}</span></p>
          <p>${escapeHtml(event.message)}</p>
          <p class="mono">${escapeHtml(event.time)}${event.duration_ms !== undefined ? ` | ${escapeHtml(formatDuration(event.duration_ms))}` : ""}${event.evidence_id ? ` | ${escapeHtml(event.evidence_id)}` : ""}</p>
        </article>
      `,
        )
        .join("")
    : `<p class="empty">暂无事件。</p>`;
}

function appendMessage(role, text) {
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.innerHTML = `<strong>${role === "user" ? "用户" : "Agent"}</strong><p>${escapeHtml(text)}</p>`;
  $("messages").appendChild(node);
  $("messages").scrollTop = $("messages").scrollHeight;
}

async function refreshStatus() {
  renderStatus(await api("/api/status"));
}

async function waitForRunCompletion(question) {
  while (true) {
    await sleep(550);
    const payload = await api("/api/status");
    renderStatus(payload);
    const isSameQuestion = !payload.question || payload.question === question;
    if (isSameQuestion && (payload.status === "completed" || payload.status === "failed")) {
      return payload;
    }
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = $("messageInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  state.pendingQuestion = message;
  appendMessage("user", message);
  $("sendButton").disabled = true;
  $("agentStatus").textContent = "运行中";
  $("runId").textContent = "后台运行中...";
  $("workingAgent").textContent = "Agent: coordinator";
  $("workingStage").textContent = "节点: intake";
  $("workingHint").textContent = "请求已提交，等待 Coordinator 启动。";
  try {
    await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, thread_id: state.threadId, async: true }),
    });
    const payload = await waitForRunCompletion(message);
    renderStatus(payload);
    if (payload.status === "failed") {
      appendMessage("agent", `错误: ${payload.error || "运行失败"}`);
    } else {
      appendMessage("agent", payload.answer || "本轮运行已完成，但没有返回回答。");
    }
  } catch (error) {
    $("agentStatus").textContent = "错误";
    appendMessage("agent", `错误: ${error.message}`);
  } finally {
    state.pendingQuestion = null;
    $("sendButton").disabled = false;
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
    renderTab();
  });
});

$("chatForm").addEventListener("submit", sendMessage);
$("refreshButton").addEventListener("click", refreshStatus);

refreshStatus().catch((error) => appendMessage("agent", `状态加载失败: ${error.message}`));

