const state = {
  payload: null,
  activeTab: "evidence",
};

const $ = (id) => document.getElementById(id);

function labelStatus(value) {
  const labels = {
    ready: "就绪",
    completed: "已完成",
    running: "运行中",
    idle: "空闲",
    pending: "待执行",
    configured: "已配置",
    allow: "允许",
    interrupt: "中断",
    deny: "拒绝",
    none: "无事实结论",
    skipped: "已跳过",
    called: "已调用",
    missing_api_key: "缺少 Key",
    error: "错误",
    respond: "响应完成",
    optional: "可选",
    required: "必需",
    stage_started: "阶段开始",
    stage_completed: "阶段完成",
    llm_completed: "LLM 完成",
    external_evidence: "外部证据",
  };
  return labels[value] || value || "未知";
}

function labelRisk(value) {
  const labels = {
    none: "无事实结论",
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
  return String(value)
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

function renderStatus(payload) {
  state.payload = payload;
  $("runtimeLine").textContent = `${payload.runtime?.agent || "agent"} | ${payload.runtime?.workspace || "workspace"}`;
  $("agentStatus").textContent = labelStatus(payload.status || "ready");
  $("stateStatus").textContent = labelStatus(payload.state_machine?.current || "idle");
  $("evidenceCount").textContent = `${labelStatus(payload.evidence?.mode || "idle")} / ${labelRisk(payload.evidence?.risk_level || "none")} / ${payload.evidence?.category || "idle"} / ${payload.evidence?.count ?? 0}`;
  $("ragCount").textContent = `${payload.rag?.count ?? 0} / ${payload.external_evidence?.count ?? 0}`;
  $("agentCount").textContent = `${payload.agents?.length || 0} 个已加载`;
  $("currentStage").textContent = labelStatus(payload.state_machine?.current || "idle");
  $("runId").textContent = payload.run_id || "暂无运行";

  renderAgents(payload.agents || []);
  renderTimeline(payload.state_machine?.stages || payload.state_machine?.configured || []);
  renderTab();
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

function renderTimeline(stages) {
  const normalized = stages.map((stage, index) => {
    if (typeof stage === "string") {
      return { name: stage, status: "configured", index };
    }
    return stage;
  });
  $("stateTimeline").innerHTML = normalized
    .map((stage) => `
      <li>
        <strong>${escapeHtml(stage.name)}</strong>
        <span class="badge ${escapeHtml(stage.status)}">${escapeHtml(labelStatus(stage.status))}</span>
        <small>${escapeHtml(formatDuration(stage.duration_ms))}</small>
      </li>
    `)
    .join("");
}

function renderTab() {
  const payload = state.payload || {};
  const target = $("tabContent");
  if (state.activeTab === "evidence") {
    const items = payload.evidence?.items || [];
    const header = `
      <article class="detail-item">
        <p><strong>证据策略</strong> <span class="badge ${escapeHtml(payload.evidence?.mode || "idle")}">${escapeHtml(labelStatus(payload.evidence?.mode || "idle"))}</span></p>
        <p>风险: ${escapeHtml(labelRisk(payload.evidence?.risk_level || "none"))} | 类别: ${escapeHtml(payload.evidence?.category || "routine")}</p>
        <p class="mono">来源策略: ${escapeHtml((payload.evidence?.sources || []).join(", ") || "无")}</p>
        <p class="mono">触发原因: ${escapeHtml((payload.evidence?.reasons || []).join("; ") || "普通对话或低风险说明")}</p>
      </article>
    `;
    target.innerHTML = header + (items.length
      ? items.map((item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(item.id)}</strong> <span class="hash">${escapeHtml(item.content_hash || "")}</span></p>
            <p>${escapeHtml(item.summary || "")}</p>
            <p class="mono">${escapeHtml(item.source_type)} | ${escapeHtml(item.uri)} | ${escapeHtml(item.locator)}</p>
          </article>
        `).join("")
      : `<p class="empty">当前运行还没有记录证据。</p>`);
    return;
  }
  if (state.activeTab === "rag") {
    const items = payload.rag?.results || [];
    target.innerHTML = items.length
      ? items.map((item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(item.source)}</strong> <span class="badge completed">${Number(item.score || 0).toFixed(2)}</span></p>
            <p class="mono">${escapeHtml(item.span)} | ${escapeHtml(item.evidence_id)}</p>
            <p>${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")
      : `<p class="empty">暂无 RAG 搜索结果。</p>`;
    return;
  }
  if (state.activeTab === "external") {
    const items = payload.external_evidence?.results || [];
    target.innerHTML = items.length
      ? items.map((item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(item.source)}</strong> <span class="badge completed">${Number(item.score || 0).toFixed(2)}</span></p>
            <p class="mono">${escapeHtml(item.span)} | ${escapeHtml(item.evidence_id)}</p>
            <p>${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")
      : `<p class="empty">暂无外部论文、网络或用户经验证据。</p>`;
    return;
  }
  if (state.activeTab === "workflow") {
    const workflow = payload.workflow || {};
    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];
    target.innerHTML = `
      <article class="detail-item">
        <p><strong>工作流状态</strong> <span class="badge ${escapeHtml(workflow.status)}">${escapeHtml(labelStatus(workflow.status))}</span></p>
        <p>当前节点：${escapeHtml(workflow.current || "idle")} | 检查点：${escapeHtml((workflow.checkpoints || []).join(", "))}</p>
      </article>
      ${nodes.map((node) => `
        <article class="detail-item">
          <p><strong>${escapeHtml(node.id)}</strong> <span class="badge ${escapeHtml(node.status)}">${escapeHtml(labelStatus(node.status))}</span></p>
          <p>${escapeHtml(node.description || "")}</p>
          <p class="mono">负责 Agent: ${escapeHtml(node.agent)} | 输入: ${escapeHtml(node.input)} | 输出: ${escapeHtml(node.output)}</p>
          <p class="mono">${escapeHtml(node.observed || (node.checkpoint ? "检查点" : ""))}${node.duration_ms !== undefined ? ` | ${escapeHtml(formatDuration(node.duration_ms))}` : ""}</p>
        </article>
      `).join("")}
      <article class="detail-item">
        <p><strong>边</strong></p>
        <p class="mono">${escapeHtml(edges.map((edge) => `${edge.from} -> ${edge.to}`).join("\n"))}</p>
      </article>
    `;
    return;
  }
  if (state.activeTab === "gates") {
    const items = payload.gates?.decisions || [];
    target.innerHTML = items.length
      ? items.map((item) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(item.gate_id)}</strong> <span class="badge ${escapeHtml(item.status)}">${escapeHtml(labelStatus(item.status))}</span></p>
            <p>风险: ${escapeHtml(labelRisk(item.risk_level))} | 证据: ${escapeHtml((item.required_evidence || []).join(", "))}</p>
            <p class="mono">${escapeHtml((item.reasons || []).join("; ") || "门禁无异常。")}</p>
          </article>
        `).join("")
      : `<p class="empty">暂无门禁决策。</p>`;
    return;
  }
  if (state.activeTab === "memory") {
    const memory = payload.memory || {};
    target.innerHTML = `
      <article class="detail-item">
        <p><strong>策略</strong> ${escapeHtml(memory.policy || "configured")}</p>
        <p>分区: ${escapeHtml((memory.partitions || []).join(", "))}</p>
        <p>只读: ${escapeHtml((memory.read_only || []).join(", "))}</p>
        <p class="mono">${escapeHtml((memory.pending_consolidation || []).join("\n") || "暂无待沉淀内容。")}</p>
      </article>
    `;
    return;
  }
  if (state.activeTab === "skills") {
    const skills = payload.skills || {};
    target.innerHTML = `
      <article class="detail-item">
        <p><strong>${skills.count || 0} 个技能包已加载</strong></p>
        <p class="mono">${escapeHtml((skills.enabled || skills.loaded || []).join("\n"))}</p>
      </article>
    `;
    return;
  }
  if (state.activeTab === "events") {
    const events = payload.events || [];
    target.innerHTML = events.length
      ? events.map((event) => `
          <article class="detail-item">
            <p><strong>${escapeHtml(event.agent)}</strong> <span class="badge">${escapeHtml(labelStatus(event.kind))}</span></p>
            <p>${escapeHtml(event.message)}</p>
            <p class="mono">${escapeHtml(event.time)}${event.duration_ms !== undefined ? ` | ${escapeHtml(formatDuration(event.duration_ms))}` : ""}${event.evidence_id ? ` | ${escapeHtml(event.evidence_id)}` : ""}</p>
          </article>
        `).join("")
      : `<p class="empty">暂无事件。</p>`;
    return;
  }
  target.innerHTML = `<pre class="mono">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
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

async function sendMessage(event) {
  event.preventDefault();
  const input = $("messageInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendMessage("user", message);
  $("sendButton").disabled = true;
  $("agentStatus").textContent = "运行中";
  $("runId").textContent = "后台运行中...";
  try {
    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    renderStatus(payload);
    appendMessage("agent", payload.answer);
  } catch (error) {
    $("agentStatus").textContent = "错误";
    appendMessage("agent", `错误：${error.message}`);
  } finally {
    $("sendButton").disabled = false;
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    state.activeTab = button.dataset.tab;
    renderTab();
  });
});

$("chatForm").addEventListener("submit", sendMessage);
$("refreshButton").addEventListener("click", refreshStatus);

refreshStatus().catch((error) => appendMessage("agent", `状态加载失败：${error.message}`));
