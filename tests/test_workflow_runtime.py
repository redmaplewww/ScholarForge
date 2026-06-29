import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from reasoning_agent_template.config import AgentConfig
from reasoning_agent_template.models import KnowledgeChunk, stable_hash
from reasoning_agent_template.runtime import create_deep_agent_runtime
from reasoning_agent_template.workflow import TemplateCoordinator


class WorkflowRuntimeTests(unittest.TestCase):
    def test_state_machine_runs_routine_path_without_required_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            knowledge = root / "knowledge"
            knowledge.mkdir()
            (knowledge / "template.md").write_text(
                "The template enforces evidence-first reasoning, gated actions, and minimal changes.",
                encoding="utf-8",
            )
            config = AgentConfig.default(workspace_root=root)
            config.knowledge["directory"] = str(knowledge)

            coordinator = TemplateCoordinator(config=config, workspace_root=root)
            result = coordinator.run("What constraints does the template enforce?")

            self.assertEqual(
                result.stage_trace,
                [
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
            )
            self.assertEqual(result.state.evidence_mode, "optional")
            self.assertEqual(len(result.evidence), 0)
            self.assertEqual(result.gate_decisions[-1].status, "allow")
            self.assertEqual(result.gate_decisions[-1].risk_level, "none")
            self.assertEqual(result.state.current_stage, "respond")

    def test_high_risk_reasoning_path_requires_citations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            knowledge = root / "knowledge"
            knowledge.mkdir()
            (knowledge / "risk.md").write_text(
                "High-risk production changes require rollback plans, backups, approvals, and evidence.",
                encoding="utf-8",
            )
            config = AgentConfig.default(workspace_root=root)
            config.knowledge["directory"] = str(knowledge)
            config.gates["min_evidence_by_risk"]["high"] = 1

            coordinator = TemplateCoordinator(config=config, workspace_root=root)
            result = coordinator.run("High-risk architecture decision: audit production change safety.")

            self.assertEqual(result.state.evidence_mode, "required")
            self.assertGreaterEqual(len(result.evidence), 1)
            self.assertIn(result.evidence[0].id, result.answer)
            self.assertEqual(result.gate_decisions[-1].status, "allow")
            self.assertEqual(result.gate_decisions[-1].risk_level, "high")

    def test_academic_research_question_requires_external_paper_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "knowledge").mkdir()
            config = AgentConfig.default(workspace_root=root)
            config.knowledge["directory"] = str(root / "knowledge")

            def fake_external_retrieve(searcher, query, *, top_k, sources):
                evidence = searcher.ledger.record(
                    source_type="paper",
                    uri="https://www.semanticscholar.org/paper/test-paper",
                    locator="Semantic Scholar paperId=test-paper",
                    content="Large language models are being evaluated for clinical diagnosis support.",
                    summary="Test paper about LLMs for clinical diagnosis.",
                    confidence=0.82,
                    used_for=["external:semantic_scholar"],
                )
                return [
                    KnowledgeChunk(
                        source=evidence.uri,
                        span=evidence.locator,
                        text="Large language models are being evaluated for clinical diagnosis support.",
                        content_hash=stable_hash("test-paper"),
                        score=0.82,
                        evidence_id=evidence.id,
                    )
                ]

            with patch(
                "reasoning_agent_template.workflow.ExternalEvidenceSearch.retrieve",
                autospec=True,
                side_effect=fake_external_retrieve,
            ) as retrieve:
                coordinator = TemplateCoordinator(config=config, workspace_root=root)
                result = coordinator.run("请综述大语言模型在医学诊断中的最新研究进展，并给出关键论文依据。")

            self.assertEqual(result.state.evidence_mode, "required")
            self.assertEqual(result.state.risk_level, "medium")
            self.assertEqual(result.state.evidence_category, "academic")
            self.assertIn("papers", result.state.evidence_sources)
            self.assertGreaterEqual(len(result.state.external_results), 1)
            self.assertTrue(any(item.source_type == "paper" for item in result.evidence))
            self.assertEqual(result.gate_decisions[-1].status, "allow")
            retrieve.assert_called_once()

    def test_academic_research_question_interrupts_when_only_local_rag_is_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            knowledge = root / "knowledge"
            knowledge.mkdir()
            (knowledge / "local.md").write_text(
                "大语言模型 医学诊断 研究 综述 需要论文证据，但这只是本地项目备注。",
                encoding="utf-8",
            )
            config = AgentConfig.default(workspace_root=root)
            config.knowledge["directory"] = str(knowledge)

            with patch(
                "reasoning_agent_template.workflow.ExternalEvidenceSearch.retrieve",
                autospec=True,
                return_value=[],
            ):
                coordinator = TemplateCoordinator(config=config, workspace_root=root)
                result = coordinator.run("请综述大语言模型在医学诊断中的最新研究进展，并给出关键论文依据。")

            self.assertEqual(result.state.evidence_mode, "required")
            self.assertEqual(result.state.evidence_category, "academic")
            self.assertGreaterEqual(len(result.evidence), 1)
            self.assertFalse(any(item.source_type == "paper" for item in result.evidence))
            self.assertEqual(result.gate_decisions[-1].status, "interrupt")

    def test_runtime_uses_fallback_when_deepagents_is_not_installed(self):
        config = AgentConfig.default(workspace_root=Path("."))

        runtime = create_deep_agent_runtime(config=config, tools=[], skills_dir=Path("skills"))

        self.assertEqual(runtime.backend, "fallback")
        self.assertTrue(callable(runtime.invoke))


if __name__ == "__main__":
    unittest.main()
