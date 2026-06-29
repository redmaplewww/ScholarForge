from __future__ import annotations

from reasoning_agent_template.models import EvidenceRequirement


ACADEMIC_TERMS = [
    "论文",
    "研究",
    "学术",
    "综述",
    "文献",
    "引用",
    "关键论文",
    "最新研究",
    "研究进展",
    "实验",
    "数据集",
    "meta分析",
    "系统综述",
    "citation",
    "citations",
    "paper",
    "papers",
    "literature",
    "review",
    "systematic review",
    "arxiv",
    "doi",
    "dataset",
    "benchmark",
]

REGULATED_TERMS = [
    "医疗",
    "医学",
    "诊断",
    "临床",
    "治疗",
    "用药",
    "法律",
    "合同",
    "诉讼",
    "投资",
    "金融",
    "保险",
    "medical",
    "clinical",
    "diagnosis",
    "treatment",
    "legal",
    "investment",
    "finance",
]

DIRECT_ADVICE_TERMS = [
    "我该",
    "帮我诊断",
    "治疗方案",
    "用什么药",
    "买入",
    "卖出",
    "法律意见",
    "medical advice",
    "diagnose me",
    "treatment plan",
    "legal advice",
    "buy or sell",
]

HIGH_RISK_ACTION_TERMS = [
    "高风险",
    "高危",
    "生产环境",
    "删库",
    "删除数据",
    "执行命令",
    "写文件",
    "修改文件",
    "外部调用",
    "自进化",
    "更新技能",
    "长期记忆",
    "安全漏洞",
    "权限",
    "密钥",
    "high-risk",
    "critical",
    "production",
    "delete",
    "execute command",
    "write file",
    "security vulnerability",
    "credential",
    "api key",
]

HARD_REASONING_TERMS = [
    "强推理",
    "重推理",
    "高难",
    "复杂决策",
    "证明",
    "审计",
    "根因分析",
    "架构决策",
    "迁移方案",
    "hard reasoning",
    "deep reasoning",
    "root cause",
    "architecture decision",
    "audit",
    "migration plan",
]


def classify_evidence_requirement(value: str) -> EvidenceRequirement:
    text = value.lower().strip()
    matched_academic = _matches(text, ACADEMIC_TERMS)
    matched_regulated = _matches(text, REGULATED_TERMS)
    matched_direct_advice = _matches(text, DIRECT_ADVICE_TERMS)
    matched_high_risk = _matches(text, HIGH_RISK_ACTION_TERMS)
    matched_hard_reasoning = _matches(text, HARD_REASONING_TERMS)

    if matched_direct_advice:
        return EvidenceRequirement(
            mode="required",
            risk_level="high",
            category="regulated_advice",
            reasons=_reasons("direct regulated advice", matched_direct_advice + matched_regulated),
            sources=["rag", "papers", "web", "user_experience"],
        )

    if matched_academic:
        return EvidenceRequirement(
            mode="required",
            risk_level="medium",
            category="academic",
            reasons=_reasons("academic/research claim", matched_academic + matched_regulated),
            sources=["rag", "papers", "web", "user_experience"],
        )

    if matched_high_risk:
        return EvidenceRequirement(
            mode="required",
            risk_level="high",
            category="high_risk_action",
            reasons=_reasons("high-risk action or protected asset", matched_high_risk),
            sources=["rag", "user_experience"],
        )

    if matched_regulated:
        return EvidenceRequirement(
            mode="required",
            risk_level="high",
            category="regulated_domain",
            reasons=_reasons("regulated domain", matched_regulated),
            sources=["rag", "papers", "web", "user_experience"],
        )

    if matched_hard_reasoning:
        return EvidenceRequirement(
            mode="required",
            risk_level="medium",
            category="hard_reasoning",
            reasons=_reasons("hard reasoning", matched_hard_reasoning),
            sources=["rag", "user_experience"],
        )

    return EvidenceRequirement(
        mode="optional",
        risk_level="none",
        category="routine",
        reasons=["routine chat or low-risk explanation"],
        sources=[],
    )


def _matches(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term.lower() in text]


def _reasons(label: str, terms: list[str]) -> list[str]:
    unique_terms = list(dict.fromkeys(terms))
    if not unique_terms:
        return [label]
    return [f"{label}: {', '.join(unique_terms[:8])}"]
