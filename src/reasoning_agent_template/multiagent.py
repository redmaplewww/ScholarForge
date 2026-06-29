from __future__ import annotations

import os
from pathlib import Path
from time import perf_counter
from typing import Any, Callable, Protocol

from reasoning_agent_template.config import AgentConfig
from reasoning_agent_template.llm import ChatMessage, DeepSeekChatClient
from reasoning_agent_template.models import AgentState, stable_hash, utc_now
from reasoning_agent_template.skills import SkillRegistry
from reasoning_agent_template.workflow import TemplateCoordinator


AGENT_ROLES = [
    ("coordinator", "负责运行调度，并拥有状态机。"),
    ("planner", "生成边界清晰、可审计的推理计划。"),
    ("retriever", "检索本地知识库、论文/外部来源，并记录证据。"),
    ("reasoner", "基于检索证据生成答案草案。"),
    ("critic", "审计证据绑定和门禁结果。"),
    ("memory", "提出长期记忆沉淀候选，不直接写入保护资产。"),
    ("evolver", "生成自进化提案，不直接修改核心技能。"),
]

WORKFLOW_DEFINITIONS = [
    ("intake", "coordinator", "接收目标并建立运行上下文", "用户问题", "规范化目标"),
    ("plan", "planner", "生成可审计的推理计划", "规范化目标", "计划步骤"),
    ("retrieve", "retriever", "检索本地知识库、外部论文和用户经验证据", "计划步骤", "证据候选"),
    ("reason", "reasoner", "基于证据生成草案答案", "证据候选", "答案草案"),
    ("evidence_audit", "critic", "检查关键结论是否绑定证据", "答案草案", "证据审计结果"),
    ("gate", "critic", "执行风险、证据和审批门禁", "证据审计结果", "门禁决策"),
    ("act_or_answer", "coordinator", "根据门禁结果行动或回答", "门禁决策", "可发布结果"),
    ("verify", "critic", "验证状态、证据和输出一致性", "可发布结果", "验证记录"),
    ("consolidate", "memory", "只生成记忆/演进候选，不直接写保护资产", "验证记录", "沉淀候选"),
    ("respond", "coordinator", "输出最终答案和调试遥测", "沉淀候选", "最终响应"),
]

WORKFLOW_CHECKPOINTS = ["retrieve", "evidence_audit", "gate", "verify", "consolidate"]


class ChatClient(Protocol):
    model: str

    def chat(self, messages: list[ChatMessage], *, temperature: float, max_tokens: int) -> Any:
        ...


class MultiAgentOrchestrator:
    """Wrap TemplateCoordinator with explicit multi-agent telemetry."""

    def __init__(
        self,
        *,
        config: AgentConfig,
        workspace_root: str | Path,
        llm_client_factory: Callable[[AgentConfig], ChatClient] | None = None,
    ):
        self.config = config
        self.workspace_root = Path(workspace_root)
        self.llm_client_factory = llm_client_factory

    def run(self, message: str) -> dict[str, Any]:
        started_at = utc_now()
        run_started = perf_counter()
        result = TemplateCoordinator(config=self.config, workspace_root=self.workspace_root).run(message)
        llm_status = {
            "enabled": True,
            "provider": self.config.models.get("worker", {}).get("provider", "deepseek"),
            "model": self.config.models.get("worker", {}).get("model", "deepseek-v4-flash"),
            "status": "not_called",
        }
        events = self._events(result.state)

        answer, llm_status, llm_event = self._call_deepseek(message, result.state)
        events.append(llm_event)

        run_id = f"run_{stable_hash(started_at + message + answer)[:12]}"
        skills = SkillRegistry(Path(self.config.skills.get("directory", "skills"))).load()
        completed_at = utc_now()
        return {
            "run_id": run_id,
            "status": "completed",
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": round((perf_counter() - run_started) * 1000, 2),
            "question": message,
            "answer": answer,
            "runtime": {
                "agent": self.config.identity.get("name", "reasoning-agent-template"),
                "workspace": str(self.workspace_root.resolve()),
                "llm": llm_status,
            },
            "agents": self._agents(result.state),
            "state_machine": self._state_machine(result.state),
            "workflow": self._workflow(result.state),
            "evidence": {
                "count": len(result.evidence),
                "mode": result.state.evidence_mode,
                "required": result.state.evidence_mode == "required",
                "risk_level": result.state.risk_level,
                "category": result.state.evidence_category,
                "reasons": list(result.state.evidence_reasons),
                "sources": list(result.state.evidence_sources),
                "items": [item.to_dict() for item in result.evidence],
            },
            "rag": {
                "query": message,
                "count": len(result.state.retrieval_results),
                "results": [
                    {
                        "source": chunk.source,
                        "span": chunk.span,
                        "score": chunk.score,
                        "content_hash": chunk.content_hash,
                        "evidence_id": chunk.evidence_id,
                        "text": chunk.text,
                    }
                    for chunk in result.state.retrieval_results
                ],
            },
            "external_evidence": {
                "query": message,
                "count": len(result.state.external_results),
                "results": [
                    {
                        "source": chunk.source,
                        "span": chunk.span,
                        "score": chunk.score,
                        "content_hash": chunk.content_hash,
                        "evidence_id": chunk.evidence_id,
                        "text": chunk.text,
                    }
                    for chunk in result.state.external_results
                ],
            },
            "gates": {
                "count": len(result.gate_decisions),
                "decisions": [decision.to_dict() for decision in result.gate_decisions],
            },
            "memory": {
                "policy": "proposal-first",
                "partitions": self.config.memory.get("partitions", []),
                "read_only": self.config.memory.get("read_only_partitions", []),
                "pending_consolidation": list(result.state.pending_consolidation),
            },
            "skills": {
                "enabled": self.config.skills.get("enabled", []),
                "loaded": sorted(skills),
                "count": len(skills),
            },
            "events": events,
        }

    def status(self) -> dict[str, Any]:
        skills = SkillRegistry(Path(self.config.skills.get("directory", "skills"))).load()
        return {
            "status": "ready",
            "runtime": {
                "agent": self.config.identity.get("name", "reasoning-agent-template"),
                "workspace": str(self.workspace_root.resolve()),
                "model": self.config.models.get("worker", {}),
                "llm": {
                    "required": True,
                    "provider": self.config.models.get("worker", {}).get("provider", "deepseek"),
                    "model": self.config.models.get("worker", {}).get("model", "deepseek-v4-flash"),
                    "secret_sources": ["configs/secrets.local.json", "DEEPSEEK_API_KEY"],
                    "configured": DeepSeekChatClient.is_configured(self.config),
                },
            },
            "agents": [
                {"name": name, "status": "idle", "description": description}
                for name, description in AGENT_ROLES
            ],
            "state_machine": {
                "active": False,
                "current": "idle",
                "trace": [],
                "configured": [
                    "intake",
                    "plan",
                    "retrieve",
                    "reason",
                    "evidence_audit",
                    "gate",
                    "act_or_answer",
                    "verify",
                    "consolidate",
                    "respond",
                ],
            },
            "workflow": self.workflow_status(),
            "evidence": {
                "count": 0,
                "mode": "idle",
                "required": False,
                "risk_level": "none",
                "category": "idle",
                "reasons": [],
                "sources": [],
                "items": [],
            },
            "rag": {"count": 0, "results": []},
            "external_evidence": {"count": 0, "results": []},
            "gates": {"count": 0, "decisions": []},
            "memory": {
                "partitions": self.config.memory.get("partitions", []),
                "read_only": self.config.memory.get("read_only_partitions", []),
            },
            "skills": {"loaded": sorted(skills), "count": len(skills)},
        }

    def workflow_status(self) -> dict[str, Any]:
        return {
            "status": "idle",
            "active": False,
            "current": "idle",
            "nodes": [
                {
                    "id": stage,
                    "agent": agent,
                    "description": description,
                    "input": input_name,
                    "output": output_name,
                    "status": "pending",
                    "checkpoint": stage in WORKFLOW_CHECKPOINTS,
                }
                for stage, agent, description, input_name, output_name in WORKFLOW_DEFINITIONS
            ],
            "edges": [
                {"from": WORKFLOW_DEFINITIONS[index][0], "to": WORKFLOW_DEFINITIONS[index + 1][0]}
                for index in range(len(WORKFLOW_DEFINITIONS) - 1)
            ],
            "checkpoints": list(WORKFLOW_CHECKPOINTS),
        }

    def _agents(self, state: AgentState) -> list[dict[str, Any]]:
        metrics = {
            "coordinator": len(state.stage_trace),
            "planner": len(state.plan),
            "retriever": len(state.retrieval_results) + len(state.external_results),
            "reasoner": 1 if state.answer else 0,
            "critic": len(state.verification_notes),
            "memory": len(state.pending_consolidation),
            "evolver": 0,
        }
        return [
            {
                "name": name,
                "description": description,
                "status": "completed" if name != "evolver" else "idle",
                "active": False,
                "current_stage": state.current_stage if name == "coordinator" else name,
                "metric": metrics.get(name, 0),
                "last_event": self._last_event_for(name, state),
            }
            for name, description in AGENT_ROLES
        ]

    def _state_machine(self, state: AgentState) -> dict[str, Any]:
        trace = list(state.stage_trace)
        durations = self._stage_durations(state)
        return {
            "active": False,
            "current": state.current_stage,
            "trace": trace,
            "stages": [
                {
                    "name": stage,
                    "status": "completed" if stage in trace else "pending",
                    "index": index,
                    "duration_ms": durations.get(stage),
                }
                for index, stage in enumerate(trace)
            ],
        }

    def _workflow(self, state: AgentState) -> dict[str, Any]:
        trace = list(state.stage_trace)
        completed = set(trace)
        durations = self._stage_durations(state)
        return {
            "status": "completed" if trace and trace[-1] == "respond" else "running",
            "active": False,
            "current": state.current_stage,
            "nodes": [
                {
                    "id": stage,
                    "agent": agent,
                    "description": description,
                    "input": input_name,
                    "output": output_name,
                    "status": "completed" if stage in completed else "pending",
                    "checkpoint": stage in WORKFLOW_CHECKPOINTS,
                    "observed": self._workflow_observed(stage, state),
                    "duration_ms": durations.get(stage),
                }
                for stage, agent, description, input_name, output_name in WORKFLOW_DEFINITIONS
            ],
            "edges": [
                {"from": WORKFLOW_DEFINITIONS[index][0], "to": WORKFLOW_DEFINITIONS[index + 1][0]}
                for index in range(len(WORKFLOW_DEFINITIONS) - 1)
            ],
            "checkpoints": list(WORKFLOW_CHECKPOINTS),
        }

    def _workflow_observed(self, stage: str, state: AgentState) -> str:
        if stage == "plan":
            return f"{len(state.plan)} 个计划步骤"
        if stage == "retrieve":
            return f"{len(state.retrieval_results)} 条本地 RAG，{len(state.external_results)} 条外部证据"
        if stage == "evidence_audit":
            return f"{len(state.evidence)} 条证据"
        if stage == "gate":
            return f"{len(state.gate_decisions)} 个门禁决策"
        if stage == "verify":
            return "; ".join(state.verification_notes) or "等待验证"
        if stage == "consolidate":
            return "; ".join(state.pending_consolidation) or "无沉淀候选"
        if stage == "respond":
            return "已生成最终响应" if state.answer else "未响应"
        return "已执行" if stage in state.stage_trace else "等待执行"

    def _events(self, state: AgentState) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = list(state.stage_events)
        for chunk in state.retrieval_results:
            events.append(
                {
                    "time": utc_now(),
                    "agent": "retriever",
                    "kind": "rag",
                    "message": f"{Path(chunk.source).name} {chunk.span} score={chunk.score:.2f}",
                }
            )
        for chunk in state.external_results:
            events.append(
                {
                    "time": utc_now(),
                    "agent": "retriever",
                    "kind": "external_evidence",
                    "message": f"{chunk.source} {chunk.span} score={chunk.score:.2f}",
                    "evidence_id": chunk.evidence_id,
                }
            )
        for decision in state.gate_decisions:
            status_label = {"allow": "允许", "interrupt": "中断", "deny": "拒绝"}.get(
                decision.status,
                decision.status,
            )
            risk_label = {
                "none": "无事实结论",
                "low": "低",
                "medium": "中",
                "high": "高",
                "critical": "严重",
            }.get(decision.risk_level, decision.risk_level)
            events.append(
                {
                    "time": utc_now(),
                    "agent": "critic",
                    "kind": "gate",
                    "message": f"{status_label} 风险={risk_label}",
                }
            )
        return events

    def _stage_durations(self, state: AgentState) -> dict[str, float]:
        return {
            str(event["stage"]): float(event["duration_ms"])
            for event in state.stage_events
            if event.get("kind") == "stage_completed" and "duration_ms" in event
        }

    def _last_event_for(self, name: str, state: AgentState) -> str:
        if name == "planner":
            return state.plan[-1] if state.plan else "暂无计划"
        if name == "retriever":
            return f"{len(state.retrieval_results)} 条本地 RAG，{len(state.external_results)} 条外部证据"
        if name == "reasoner":
            return "已生成答案草稿" if state.answer else "暂无答案"
        if name == "critic":
            return state.verification_notes[-1] if state.verification_notes else "门禁已检查"
        if name == "memory":
            return state.pending_consolidation[-1] if state.pending_consolidation else "暂无记忆提案"
        if name == "evolver":
            return "本次运行没有自进化提案"
        return state.current_stage

    def _call_deepseek(
        self,
        message: str,
        state: AgentState,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        llm_status = {
            "enabled": True,
            "provider": self.config.models.get("worker", {}).get("provider", "deepseek"),
            "model": self.config.models.get("worker", {}).get("model", "deepseek-v4-flash"),
            "status": "not_called",
        }
        client = self._deepseek_client()
        messages = self._deepseek_messages(message, state)
        started = perf_counter()
        result = client.chat(messages, temperature=0.2, max_tokens=768)
        duration_ms = round((perf_counter() - started) * 1000, 2)
        llm_status["status"] = "called"
        llm_status["model"] = result.model
        return (
            result.content.strip(),
            llm_status,
            {
                "time": utc_now(),
                "agent": "reasoner",
                "kind": "llm_completed",
                "duration_ms": duration_ms,
                "message": "DeepSeek 已生成回答。",
            },
        )

    def _deepseek_client(self) -> ChatClient:
        if self.llm_client_factory is not None:
            return self.llm_client_factory(self.config)
        return DeepSeekChatClient.from_config(self.config, role="worker")

    def _deepseek_messages(self, message: str, state: AgentState) -> list[ChatMessage]:
        gate = state.gate_decisions[-1] if state.gate_decisions else None
        state_summary = {
            "evidence_mode": state.evidence_mode,
            "risk_level": state.risk_level,
            "evidence_category": state.evidence_category,
            "evidence_reasons": state.evidence_reasons,
            "evidence_sources": state.evidence_sources,
            "gate_status": gate.status if gate else "unknown",
            "gate_reasons": gate.reasons if gate else [],
            "evidence_ids": [item.id for item in state.evidence],
            "stage_trace": state.stage_trace,
        }
        evidence_items = [
            {
                "id": item.id,
                "source_type": item.source_type,
                "uri": item.uri,
                "locator": item.locator,
                "summary": item.summary,
                "confidence": item.confidence,
            }
            for item in state.evidence
        ]
        rag_results = [
            {
                "source": chunk.source,
                "span": chunk.span,
                "score": chunk.score,
                "evidence_id": chunk.evidence_id,
                "text": chunk.text[:1200],
            }
            for chunk in state.retrieval_results
        ]
        external_evidence_results = [
            {
                "source": chunk.source,
                "span": chunk.span,
                "score": chunk.score,
                "evidence_id": chunk.evidence_id,
                "text": chunk.text[:1200],
            }
            for chunk in state.external_results
        ]
        policy_line = (
            f"evidence_mode={state.evidence_mode}; risk_level={state.risk_level}; "
            f"evidence_category={state.evidence_category}; evidence_sources={state.evidence_sources}"
        )
        system = (
            "你是通过 DeepSeek API 调用的多 Agent worker。必须直接回答用户，不要输出预设模板话术。"
            "普通对话可以自然回答，不需要引用证据。"
            "当 evidence_mode=required、risk_level 为 medium/high/critical，或 evidence_category 为 academic/regulated_domain/regulated_advice 时，"
            "只能依据提供的 evidence_items、rag_results 和 external_evidence_results 回答；必须引用 evidence id。"
            "如果证据不足，要明确说明限制并建议继续搜索论文、网络资料、RAG 文档或用户经验证据。"
            "如果 gate_status 不是 allow，不能执行或给出底层高风险方案，只能说明门禁未通过以及需要哪些证据或审批。"
            "不要编造证据 id，不要声称读取了未提供的资料。默认使用中文，除非用户明显使用其他语言。"
        )
        user = (
            "证据策略：\n"
            f"{policy_line}\n\n"
            "用户输入：\n"
            f"{message}\n\n"
            "运行状态 JSON：\n"
            f"{state_summary}\n\n"
            "证据项 JSON：\n"
            f"{evidence_items}\n\n"
            "RAG 结果 JSON：\n"
            f"{rag_results}\n\n"
            "external_evidence_results JSON：\n"
            f"{external_evidence_results}\n\n"
            "请给出 DeepSeek 实时生成的最终回答。"
        )
        return [ChatMessage(role="system", content=system), ChatMessage(role="user", content=user)]
