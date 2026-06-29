from __future__ import annotations

from pathlib import Path
import json
from time import perf_counter

from reasoning_agent_template.config import AgentConfig
from reasoning_agent_template.evidence import EvidenceLedger
from reasoning_agent_template.external_evidence import ExternalEvidenceSearch
from reasoning_agent_template.gates import GatePolicy
from reasoning_agent_template.knowledge import LocalKnowledgeBase
from reasoning_agent_template.models import AgentState, KnowledgeChunk, WorkflowResult, stable_hash, utc_now
from reasoning_agent_template.risk import classify_evidence_requirement


STAGES = [
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
]

STAGE_AGENTS = {
    "intake": "coordinator",
    "plan": "planner",
    "retrieve": "retriever",
    "reason": "reasoner",
    "evidence_audit": "critic",
    "gate": "critic",
    "act_or_answer": "coordinator",
    "verify": "critic",
    "consolidate": "memory",
    "respond": "coordinator",
}


class TemplateCoordinator:
    """Deterministic implementation of the template's required state path."""

    def __init__(self, *, config: AgentConfig, workspace_root: Path):
        self.config = config
        self.workspace_root = Path(workspace_root)
        self.ledger = EvidenceLedger(self.workspace_root / "evidence" / "ledger.jsonl")
        self.gate_policy = GatePolicy(
            workspace_root=self.workspace_root,
            min_evidence_by_risk=dict(config.gates.get("min_evidence_by_risk", {})),
            approval_required_actions=set(config.gates.get("approval_required_actions", [])),
        )

    def run(self, user_goal: str) -> WorkflowResult:
        state = AgentState(user_goal=user_goal)
        for stage in STAGES:
            started = perf_counter()
            state.current_stage = stage
            state.stage_trace.append(stage)
            state.stage_events.append(
                {
                    "time": utc_now(),
                    "agent": STAGE_AGENTS.get(stage, "coordinator"),
                    "stage": stage,
                    "kind": "stage_started",
                    "message": f"{stage} started",
                }
            )
            getattr(self, f"_{stage}")(state)
            state.stage_events.append(
                {
                    "time": utc_now(),
                    "agent": STAGE_AGENTS.get(stage, "coordinator"),
                    "stage": stage,
                    "kind": "stage_completed",
                    "duration_ms": round((perf_counter() - started) * 1000, 2),
                    "message": f"{stage} completed",
                }
            )
        return WorkflowResult(
            answer=state.answer,
            state=state,
            stage_trace=list(state.stage_trace),
            evidence=list(state.evidence),
            gate_decisions=list(state.gate_decisions),
        )

    def _intake(self, state: AgentState) -> None:
        requirement = classify_evidence_requirement(state.user_goal)
        state.risk_level = requirement.risk_level
        state.evidence_mode = requirement.mode
        state.evidence_category = requirement.category
        state.evidence_reasons = list(requirement.reasons)
        state.evidence_sources = list(requirement.sources)
        if requirement.mode == "required":
            state.response_kind = "evidence_required_answer"
        else:
            state.response_kind = "routine"
        state.plan = []

    def _plan(self, state: AgentState) -> None:
        if state.evidence_mode == "required":
            state.plan = [
                "识别高风险或高难强推理目标。",
                "检索带可引用位置的本地知识。",
                "把关键结论绑定到证据。",
                "回答前通过高风险证据门禁。",
                "只记录记忆或技能更新提案。",
            ]
            return
        state.plan = [
            "识别为普通对话或低风险说明。",
            "跳过强制证据系统。",
            "直接生成可理解的中文回复。",
            "保留状态机和门禁遥测。",
            "不写入长期记忆或技能。",
        ]

    def _retrieve(self, state: AgentState) -> None:
        if state.evidence_mode != "required":
            state.retrieval_results = []
            state.external_results = []
            state.evidence = []
            return
        knowledge_dir = Path(self.config.knowledge.get("directory", "knowledge"))
        if not knowledge_dir.is_absolute():
            knowledge_dir = self.workspace_root / knowledge_dir
        kb = LocalKnowledgeBase(knowledge_dir, ledger=self.ledger)
        top_k = int(self.config.knowledge.get("top_k", 5))
        state.retrieval_results = kb.retrieve(
            state.user_goal,
            top_k=top_k,
        )
        state.external_results = []
        external_sources = [source for source in state.evidence_sources if source in {"papers", "web", "user_experience"}]
        if external_sources:
            searcher = ExternalEvidenceSearch(
                ledger=self.ledger,
                timeout_seconds=int(self.config.knowledge.get("external_timeout_seconds", 8)),
            )
            state.external_results = searcher.retrieve(
                state.user_goal,
                top_k=int(self.config.knowledge.get("external_top_k", top_k)),
                sources=external_sources,
            )
        by_id = {item.id: item for item in self.ledger.list()}
        ordered_ids = [
            result.evidence_id
            for result in [*state.retrieval_results, *state.external_results]
            if result.evidence_id in by_id
        ]
        state.evidence = [by_id[evidence_id] for evidence_id in dict.fromkeys(ordered_ids)]

    def _config_identity_chunk(self) -> KnowledgeChunk:
        content = json.dumps(
            {
                "identity": self.config.identity,
                "models": self.config.models,
                "skills": self.config.skills,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        evidence = self.ledger.record(
            source_type="config",
            uri="agent.yaml",
            locator="identity, models, skills",
            content=content,
            summary=(
                f"来自 agent.yaml 的 {self.config.identity.get('name', 'reasoning-agent-template')} "
                "身份和已启用能力。"
            ),
            confidence=1.0,
            used_for=["identity:answer"],
        )
        return KnowledgeChunk(
            source="agent.yaml",
            span="identity, models, skills",
            text=content,
            content_hash=stable_hash(content),
            score=1.0,
            evidence_id=evidence.id,
        )

    def _reason(self, state: AgentState) -> None:
        if _is_identity_question(state.user_goal):
            name = self.config.identity.get("name", "reasoning-agent-template")
            purpose = _localized_purpose(
                self.config.identity.get("purpose", "Build evidence-first heavy-reasoning agents."),
                chinese=_has_cjk(state.user_goal),
            )
            if _has_cjk(state.user_goal):
                state.answer = (
                    f"我是 {name}，一个面向{purpose}的多 Agent 调试模板。"
                    "普通对话不会强制走证据系统；高风险或高难强推理任务才会启动证据、RAG 和高风险门禁。"
                )
            else:
                state.answer = (
                    f"I am {name}, a multi-agent debug template for {purpose}. "
                    "Routine chat does not require the evidence system; high-risk or hard reasoning tasks do."
                )
            return
        if _is_template_question(state.user_goal) and state.evidence_mode != "required":
            if _has_cjk(state.user_goal):
                state.answer = (
                    "这个模板通过工作流状态机串联 intake、plan、retrieve、reason、evidence_audit、gate、"
                    "act_or_answer、verify、consolidate 和 respond。证据系统不是每轮对话都强制启用；"
                    "只有高风险、高难强推理、关键修改、长期记忆、自进化、外部执行等任务才进入强制证据门禁。"
                )
            else:
                state.answer = (
                    "The template runs intake, plan, retrieve, reason, evidence_audit, gate, act_or_answer, "
                    "verify, consolidate, and respond. Evidence is mandatory only for high-risk or hard reasoning tasks."
                )
            return
        if not state.retrieval_results and state.evidence_mode != "required":
            state.answer = (
                "可以聊。当前这类普通对话不会强制启动证据系统；如果你提出高风险、高难强推理、"
                "关键修改、长期记忆或自进化任务，我会再切换到证据和门禁模式。"
                if _has_cjk(state.user_goal)
                else "We can chat. Routine conversation does not force evidence mode; high-risk or hard reasoning tasks will."
            )
            return
        evidence_results = [*state.retrieval_results, *state.external_results]
        if not evidence_results:
            state.answer = (
                "这是高风险或高难强推理任务，但当前没有检索到足够证据，所以不能直接给结论。"
                "请补充知识库资料、明确证据来源，或降低任务风险后再继续。"
                if _has_cjk(state.user_goal)
                else "This is a high-risk or hard reasoning task, but I do not have enough evidence to answer it."
            )
            return
        best = evidence_results[0]
        if _has_cjk(state.user_goal):
            state.answer = (
                "这是高风险或高难强推理任务，已启用证据系统。当前回答只基于已检索证据生成；"
                f"证据：[{best.evidence_id}] {best.source} ({best.span})。"
            )
        else:
            state.answer = (
                "Evidence mode is required for this high-risk or hard reasoning task. "
                f"Source: [{best.evidence_id}] {best.source} ({best.span})."
            )

    def _evidence_audit(self, state: AgentState) -> None:
        if state.evidence_mode != "required":
            state.verification_notes.append("普通对话未启用强制证据系统")
            return
        if state.retrieval_results and not state.evidence:
            state.verification_notes.append("检索结果缺少 ledger 证据")
        if "papers" in state.evidence_sources and not any(item.source_type == "paper" for item in state.evidence):
            state.verification_notes.append("学术/研究任务缺少论文或外部学术证据")
        if not state.evidence:
            state.verification_notes.append("必需证据模式缺少支持证据")

    def _gate(self, state: AgentState) -> None:
        gate_evidence = state.evidence
        if state.evidence_category == "academic":
            gate_evidence = [
                item
                for item in state.evidence
                if item.source_type in {"paper", "web", "user_experience"}
            ]
        decision = self.gate_policy.evaluate(
            action=state.response_kind,
            risk_level=state.risk_level,
            evidence=gate_evidence,
            target_path=None,
        )
        state.gate_decisions.append(decision)

    def _act_or_answer(self, state: AgentState) -> None:
        if state.gate_decisions[-1].status != "allow":
            state.answer = (
                "这是高风险或高难强推理任务，证据门禁未通过。请补充可靠证据、降低风险范围，"
                "或把问题拆成可验证的小任务后再继续。"
                if _has_cjk(state.user_goal)
                else "The answer gate did not pass; gather more evidence before responding."
            )

    def _verify(self, state: AgentState) -> None:
        if state.gate_decisions and state.gate_decisions[-1].status == "allow":
            state.verification_notes.append("门禁已通过")

    def _consolidate(self, state: AgentState) -> None:
        state.pending_consolidation.append("不直接写入长期记忆；如重复出现稳定证据，只生成沉淀提案。")

    def _respond(self, state: AgentState) -> None:
        if state.evidence and state.evidence[0].id not in state.answer:
            label = "证据" if _has_cjk(state.user_goal) else "Evidence"
            state.answer = f"{state.answer} {label}: [{state.evidence[0].id}]"


def _has_cjk(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)


def _localized_purpose(value: str, *, chinese: bool) -> str:
    if not chinese:
        return value
    known = "Build evidence-first heavy-reasoning agents with state gates, knowledge, memory, and reviewed self-evolution."
    if value == known:
        return "证据优先、带状态门禁、知识库、记忆和审核式自进化的重推理 Agent 开发"
    return value


def _is_template_question(value: str) -> bool:
    text = value.lower().strip()
    terms = [
        "工作流",
        "状态机",
        "证据系统",
        "rag",
        "门禁",
        "记忆",
        "技能",
        "workflow",
        "state machine",
        "evidence",
        "gates",
        "memory",
        "skills",
        "constraints",
    ]
    return any(term in text for term in terms)


def _requires_evidence_system(value: str) -> bool:
    return classify_evidence_requirement(value).mode == "required"


def _is_identity_question(value: str) -> bool:
    text = value.lower().strip()
    identity_terms = [
        "你是谁",
        "你是啥",
        "你是什么",
        "你能做什么",
        "你可以做什么",
        "介绍一下你",
        "你好",
        "hello",
        "hi",
        "who are you",
        "what are you",
        "what can you do",
    ]
    return any(term in text for term in identity_terms)
