import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib import request

from reasoning_agent_template.config import AgentConfig, load_agent_config
from reasoning_agent_template.llm import ChatResult, MissingApiKeyError
from reasoning_agent_template.models import KnowledgeChunk, stable_hash
from reasoning_agent_template.multiagent import MultiAgentOrchestrator
from reasoning_agent_template.web import create_server


class FakeDeepSeekClient:
    model = "deepseek-v4-flash"

    def __init__(self, content="DEEPSEEK_REAL_MARK"):
        self.content = content
        self.calls = []

    def chat(self, messages, temperature, max_tokens):
        self.calls.append(
            {
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        )
        return ChatResult(content=self.content, model=self.model, raw={"id": "fake-deepseek"})


def _fake_orchestrator(config=None, workspace_root=".", content="DEEPSEEK_REAL_MARK"):
    client = FakeDeepSeekClient(content=content)
    orchestrator = MultiAgentOrchestrator(
        config=config or load_agent_config("agent.yaml"),
        workspace_root=workspace_root,
        llm_client_factory=lambda _config: client,
    )
    return orchestrator, client


class MultiAgentWebTests(unittest.TestCase):
    def test_multi_agent_debug_payload_contains_required_monitors(self):
        orchestrator, _client = _fake_orchestrator()

        payload = orchestrator.run("What constraints does this template enforce?")

        self.assertIn("run_id", payload)
        self.assertIn("answer", payload)
        self.assertIn("agents", payload)
        self.assertIn("state_machine", payload)
        self.assertIn("evidence", payload)
        self.assertIn("rag", payload)
        self.assertIn("gates", payload)
        self.assertIn("workflow", payload)
        self.assertIn("memory", payload)
        self.assertIn("events", payload)
        self.assertGreaterEqual(len(payload["agents"]), 6)
        self.assertEqual(payload["agents"][0]["name"], "coordinator")
        self.assertEqual(payload["state_machine"]["current"], "respond")
        self.assertIn("retrieve", payload["state_machine"]["trace"])
        self.assertEqual(payload["workflow"]["status"], "completed")
        self.assertGreaterEqual(len(payload["workflow"]["nodes"]), 10)
        self.assertGreaterEqual(len(payload["workflow"]["edges"]), 9)
        self.assertIn("evidence_audit", payload["workflow"]["checkpoints"])
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "allow")
        self.assertEqual(payload["evidence"]["mode"], "optional")
        self.assertEqual(payload["answer"], "DEEPSEEK_REAL_MARK")
        self.assertEqual(payload["runtime"]["llm"]["status"], "called")
        self.assertTrue(any(event["kind"] == "stage_started" for event in payload["events"]))
        self.assertTrue(
            any(event["kind"] == "stage_completed" and "duration_ms" in event for event in payload["events"])
        )

    def test_deepseek_answer_replaces_local_template_draft(self):
        orchestrator, client = _fake_orchestrator(content="这是 DeepSeek 的真实回答标记。")

        payload = orchestrator.run("这个模板的工作流和证据系统怎么运行？")

        self.assertEqual(payload["answer"], "这是 DeepSeek 的真实回答标记。")
        self.assertEqual(payload["evidence"]["mode"], "optional")
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "allow")
        self.assertEqual(len(client.calls), 1)
        prompt_text = "\n".join(message.content for message in client.calls[0]["messages"])
        self.assertNotIn("Local draft", prompt_text)
        self.assertNotIn("普通对话不会强制走证据系统", payload["answer"])

    def test_chinese_identity_question_does_not_require_evidence_system(self):
        orchestrator, _client = _fake_orchestrator(content="我是 DeepSeek 生成的身份回答。")

        payload = orchestrator.run("你是谁")

        self.assertEqual(payload["evidence"]["count"], 0)
        self.assertEqual(payload["evidence"]["mode"], "optional")
        self.assertEqual(payload["rag"]["count"], 0)
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "allow")
        self.assertEqual(payload["answer"], "我是 DeepSeek 生成的身份回答。")
        self.assertNotIn("ev_", payload["answer"])
        self.assertNotIn("answer gate did not pass", payload["answer"])
        self.assertNotIn("Build evidence-first", payload["answer"])

    def test_chinese_chat_without_evidence_returns_clarification_not_gate_error(self):
        orchestrator, _client = _fake_orchestrator(content="可以聊，这是 DeepSeek 生成的回复。")

        payload = orchestrator.run("我们随便聊聊")

        self.assertEqual(payload["evidence"]["count"], 0)
        self.assertEqual(payload["evidence"]["mode"], "optional")
        self.assertEqual(payload["rag"]["count"], 0)
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "allow")
        self.assertEqual(payload["gates"]["decisions"][-1]["risk_level"], "none")
        self.assertIn("可以聊", payload["answer"])
        self.assertNotIn("answer gate did not pass", payload["answer"])

    def test_high_risk_reasoning_requires_evidence_before_answering(self):
        config = load_agent_config("agent.yaml")
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        orchestrator, _client = _fake_orchestrator(
            config=config,
            workspace_root=workspace.name,
            content="DeepSeek：高风险任务缺少证据，不能执行。",
        )

        payload = orchestrator.run("这是一个高风险强推理任务：请直接给出生产环境删库方案。")

        self.assertEqual(payload["evidence"]["mode"], "required")
        self.assertEqual(payload["evidence"]["count"], 0)
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "interrupt")
        self.assertEqual(payload["gates"]["decisions"][-1]["risk_level"], "high")
        self.assertIn("高风险", payload["answer"])
        self.assertIn("证据", payload["answer"])

    def test_academic_question_payload_exposes_required_evidence_and_external_results(self):
        config = load_agent_config("agent.yaml")
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        orchestrator, client = _fake_orchestrator(
            config=config,
            workspace_root=workspace.name,
            content="DeepSeek: 已基于证据 [ev_testpaper] 回答。",
        )

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
        ):
            payload = orchestrator.run("请综述大语言模型在医学诊断中的最新研究进展，并给出关键论文依据。")

        self.assertEqual(payload["evidence"]["mode"], "required")
        self.assertEqual(payload["evidence"]["category"], "academic")
        self.assertEqual(payload["evidence"]["risk_level"], "medium")
        self.assertTrue(payload["evidence"]["required"])
        self.assertEqual(payload["external_evidence"]["count"], 1)
        self.assertEqual(payload["external_evidence"]["results"][0]["evidence_id"], payload["evidence"]["items"][0]["id"])
        self.assertEqual(payload["gates"]["decisions"][-1]["status"], "allow")
        prompt_text = "\n".join(message.content for message in client.calls[0]["messages"])
        self.assertIn("evidence_mode=required", prompt_text)
        self.assertIn("必须引用 evidence id", prompt_text)
        self.assertIn("external_evidence_results", prompt_text)

    def test_missing_deepseek_key_raises_instead_of_template_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = AgentConfig.default(workspace_root=Path(tmp))
            orchestrator = MultiAgentOrchestrator(config=config, workspace_root=tmp)

            with self.assertRaises(MissingApiKeyError):
                orchestrator.run("你是谁")

    def test_web_status_and_chat_api(self):
        client = FakeDeepSeekClient(content="WEB_DEEPSEEK_MARK")
        server = create_server(
            host="127.0.0.1",
            port=0,
            config_path="agent.yaml",
            workspace_root=".",
            llm_client_factory=lambda _config: client,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{server.server_address[1]}"
            status = _get_json(f"{base_url}/api/status")
            self.assertEqual(status["runtime"]["agent"], "reasoning-agent-template")
            self.assertEqual(status["status"], "ready")
            self.assertIn("agents", status)
            self.assertIn("workflow", status)
            self.assertEqual(status["workflow"]["status"], "idle")

            workflow = _get_json(f"{base_url}/api/workflow")
            self.assertIn("nodes", workflow)
            self.assertIn("edges", workflow)
            self.assertEqual(workflow["status"], "idle")

            chat = _post_json(
                f"{base_url}/api/chat",
                {"message": "What constraints does this template enforce?"},
            )
            self.assertEqual(chat["answer"], "WEB_DEEPSEEK_MARK")
            self.assertEqual(chat["state_machine"]["current"], "respond")
            self.assertEqual(chat["workflow"]["status"], "completed")
            self.assertEqual(chat["evidence"]["mode"], "optional")
            self.assertEqual(chat["runtime"]["llm"]["status"], "called")
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()

    def test_status_marks_llm_configured_from_local_secret_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "configs").mkdir()
            (root / "configs" / "secrets.local.json").write_text(
                json.dumps({"deepseek_api_key": "local-secret-key"}),
                encoding="utf-8",
            )
            config = load_agent_config("agent.yaml")
            config.workspace_root = root
            orchestrator = MultiAgentOrchestrator(config=config, workspace_root=root)

            payload = orchestrator.status()

        self.assertTrue(payload["runtime"]["llm"]["configured"])

    def test_web_ui_contains_debug_surfaces(self):
        server = create_server(host="127.0.0.1", port=0, config_path="agent.yaml", workspace_root=".")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{server.server_address[1]}"
            html = request.urlopen(f"{base_url}/", timeout=10).read().decode("utf-8")
            self.assertIn("Agent 调试控制台", html)
            self.assertIn("状态机", html)
            self.assertIn("证据系统", html)
            self.assertIn("RAG 搜索结果", html)
            self.assertIn("多 Agent 运行时", html)
            self.assertIn("工作流", html)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


def _get_json(url):
    return json.loads(request.urlopen(url, timeout=10).read().decode("utf-8"))


def _post_json(url, payload):
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(request.urlopen(req, timeout=10).read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
