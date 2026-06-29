import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import unquote_plus

from reasoning_agent_template.evidence import EvidenceLedger
from reasoning_agent_template.external_evidence import ExternalEvidenceSearch


class _FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None

    def read(self):
        return json.dumps(self.body).encode("utf-8")


class ExternalEvidenceTests(unittest.TestCase):
    def test_semantic_scholar_results_are_normalized_into_citable_evidence(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            return _FakeResponse(
                {
                    "data": [
                        {
                            "paperId": "abc123",
                            "title": "Large Language Models in Clinical Diagnosis",
                            "abstract": "A review of LLMs for diagnostic decision support.",
                            "year": 2025,
                            "url": "https://www.semanticscholar.org/paper/abc123",
                            "authors": [{"name": "Ada Chen"}],
                            "citationCount": 42,
                        }
                    ]
                }
            )

        with tempfile.TemporaryDirectory() as tmp:
            ledger = EvidenceLedger(Path(tmp) / "evidence.jsonl")
            searcher = ExternalEvidenceSearch(ledger=ledger, urlopen=fake_urlopen)

            results = searcher.retrieve(
                "请综述大语言模型在医学诊断中的最新研究进展，并给出关键论文依据。",
                top_k=2,
                sources=["papers"],
            )
            items = ledger.list()

        self.assertEqual(len(results), 1)
        self.assertIn("large language models", unquote_plus(captured["url"]).lower())
        self.assertTrue(results[0].evidence_id.startswith("ev_"))
        self.assertIn("Large Language Models in Clinical Diagnosis", results[0].text)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].source_type, "paper")
        self.assertEqual(items[0].uri, "https://www.semanticscholar.org/paper/abc123")
        self.assertIn("external:semantic_scholar", items[0].used_for)

    def test_user_experience_can_be_recorded_as_evidence_when_prompt_contains_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = EvidenceLedger(Path(tmp) / "evidence.jsonl")
            searcher = ExternalEvidenceSearch(ledger=ledger, urlopen=lambda request, timeout: None)

            results = searcher.retrieve(
                "根据我的经验：上次生产迁移失败是因为索引缺失。请做根因分析。",
                top_k=3,
                sources=["user_experience"],
            )
            items = ledger.list()

        self.assertEqual(len(results), 1)
        self.assertEqual(items[0].source_type, "user_experience")
        self.assertIn("生产迁移失败", items[0].summary)


if __name__ == "__main__":
    unittest.main()
