import json
import tempfile
import unittest
from pathlib import Path

from reasoning_agent_template.evidence import EvidenceLedger
from reasoning_agent_template.evolution import SelfEvolutionEngine
from reasoning_agent_template.gates import GatePolicy
from reasoning_agent_template.knowledge import LocalKnowledgeBase
from reasoning_agent_template.memory import LongTermMemoryStore


class KnowledgeMemoryEvolutionTests(unittest.TestCase):
    def test_local_knowledge_retrieval_returns_citable_chunks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            knowledge_dir = root / "knowledge"
            knowledge_dir.mkdir()
            (knowledge_dir / "policy.md").write_text(
                "# Policy\nEvidence-first answers must cite source spans.",
                encoding="utf-8",
            )
            (knowledge_dir / "memory.txt").write_text(
                "Long-term memory writes require a gate decision.",
                encoding="utf-8",
            )
            ledger = EvidenceLedger(root / "evidence" / "ledger.jsonl")
            kb = LocalKnowledgeBase(knowledge_dir, ledger=ledger)

            kb.ingest()
            results = kb.retrieve("Which policy requires evidence citations?", top_k=2)

            self.assertGreaterEqual(len(results), 1)
            self.assertEqual(results[0].source, str(knowledge_dir / "policy.md"))
            self.assertIn("lines", results[0].span)
            self.assertEqual(len(results[0].content_hash), 64)
            self.assertGreater(results[0].score, 0)
            self.assertTrue(results[0].evidence_id.startswith("ev_"))

    def test_long_term_memory_requires_evidence_and_never_writes_shared_partition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = EvidenceLedger(root / "evidence.jsonl")
            policy = GatePolicy(
                workspace_root=root,
                min_evidence_by_risk={"medium": 1},
                approval_required_actions={"write_memory"},
            )
            store = LongTermMemoryStore(root / "memory", gate_policy=policy)

            missing = store.write(
                partition="project",
                key="principle",
                value="Use evidence-first reasoning.",
                evidence=[],
            )
            self.assertEqual(missing.decision.status, "interrupt")
            self.assertEqual(store.read("project", "principle"), None)

            evidence = ledger.record(
                source_type="user",
                uri="conversation",
                locator="turn:1",
                content="User approved project memory.",
                summary="User approved project memory.",
                confidence=1.0,
                used_for=["memory:project"],
            )
            written = store.write(
                partition="project",
                key="principle",
                value="Use evidence-first reasoning.",
                evidence=[evidence],
                approved_by="human",
            )
            self.assertEqual(written.decision.status, "allow")
            self.assertEqual(store.read("project", "principle"), "Use evidence-first reasoning.")

            shared = store.write(
                partition="shared",
                key="global_rule",
                value="Do not mutate shared memory.",
                evidence=[evidence],
                approved_by="human",
            )
            self.assertEqual(shared.decision.status, "deny")
            self.assertEqual(store.read("shared", "global_rule"), None)

    def test_self_evolution_generates_proposals_without_mutating_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skills_dir = root / "skills"
            proposals_dir = root / "evolution" / "proposals"
            skills_dir.mkdir()
            (skills_dir / "minimal-change").mkdir()
            skill_file = skills_dir / "minimal-change" / "SKILL.md"
            skill_file.write_text("---\nname: minimal-change\ndescription: keep changes small\n---\n", encoding="utf-8")
            ledger = EvidenceLedger(root / "evidence.jsonl")
            evidence = ledger.record(
                source_type="test",
                uri="golden",
                locator="case:minimal-change",
                content="The agent over-edited unrelated files.",
                summary="Over-edit failure.",
                confidence=0.87,
                used_for=["evolution:minimal-change"],
            )

            engine = SelfEvolutionEngine(proposals_dir=proposals_dir, skills_dir=skills_dir)
            proposal = engine.propose_skill_update(
                skill_name="minimal-change",
                rationale="Tighten scope checks after an over-edit failure.",
                evidence=[evidence],
                suggested_change="Require an explicit unrelated-file scan before editing.",
            )

            self.assertTrue(proposal.path.exists())
            self.assertEqual(skill_file.read_text(encoding="utf-8"), "---\nname: minimal-change\ndescription: keep changes small\n---\n")
            data = json.loads(proposal.path.read_text(encoding="utf-8"))
            self.assertEqual(data["target"], "skills/minimal-change/SKILL.md")
            self.assertEqual(data["status"], "proposed")
            self.assertEqual(data["evidence_ids"], [evidence.id])


if __name__ == "__main__":
    unittest.main()
