import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib import request

from reasoning_agent_template.code_modifier import LocalWorkflowSpecCodeModifier
from reasoning_agent_template.config import AgentConfig
from reasoning_agent_template.workflow import TemplateCoordinator
from reasoning_agent_template.workflow_spec import WorkflowSpec, WorkflowSpecStore
from reasoning_agent_template.web import create_server


class WorkflowSpecTests(unittest.TestCase):
    def test_default_workflow_spec_validates_and_drives_existing_trace(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "knowledge").mkdir()
            config = AgentConfig.default(workspace_root=root)
            config.knowledge["directory"] = str(root / "knowledge")

            spec = WorkflowSpec.default()
            validation = spec.validate()
            coordinator = TemplateCoordinator(config=config, workspace_root=root)
            result = coordinator.run("hello")

        self.assertTrue(validation.ok, validation.to_dict())
        self.assertEqual(result.stage_trace, spec.node_ids())
        self.assertEqual(result.state.current_stage, "respond")

    def test_workflow_validation_rejects_missing_edges_and_protected_deletion(self):
        base = WorkflowSpec.default()
        data = base.to_dict()
        data["nodes"] = [node for node in data["nodes"] if node["id"] != "gate"]
        candidate = WorkflowSpec.from_dict(data)

        validation = candidate.validate(base=base)

        self.assertFalse(validation.ok)
        self.assertTrue(any("protected node cannot be deleted: gate" in item for item in validation.errors))
        self.assertTrue(any("references missing" in item for item in validation.errors))

    def test_unknown_builtin_handler_requires_code_before_runtime(self):
        data = WorkflowSpec.default().to_dict()
        data["nodes"].insert(
            4,
            {
                "id": "domain_review",
                "label": "领域审查",
                "agent": "critic",
                "description": "领域专家审查",
                "work": "审查领域事实和交付质量。",
                "input_contract": "答案草案",
                "output_contract": "领域审查记录",
                "handler_kind": "builtin",
                "handler": "domain_review",
                "checkpoint": True,
                "gate_policy": {},
                "ui": {},
            },
        )
        data["edges"].append(
            {
                "id": "reason_to_domain_review",
                "from": "reason",
                "to": "domain_review",
                "type": "flow",
                "condition": "draft ready",
                "handoff_contract": {},
                "gate_policy": {},
                "planner_contract": {},
                "reviewer_required": True,
            }
        )
        data["edges"].append(
            {
                "id": "domain_review_to_evidence_audit",
                "from": "domain_review",
                "to": "evidence_audit",
                "type": "flow",
                "condition": "review complete",
                "handoff_contract": {},
                "gate_policy": {},
                "planner_contract": {},
                "reviewer_required": False,
            }
        )
        spec = WorkflowSpec.from_dict(data)

        validation = spec.validate(base=WorkflowSpec.default())

        self.assertFalse(validation.ok)
        self.assertTrue(any("domain_review" in item for item in validation.requires_code))

    def test_local_code_modifier_applies_approved_spec_only_inside_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowSpecStore(root)
            spec = WorkflowSpec.default()
            store.save_draft(spec)
            proposal = store.create_proposal(spec)

            result = LocalWorkflowSpecCodeModifier(root).apply_workflow_proposal(
                proposal,
                approved_by="tester",
            )

        self.assertEqual(result.status, "applied")
        self.assertIn("configs/workflows/default.workflow.json", result.modified_files)

    def test_local_code_modifier_interrupts_unapproved_or_denied_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = WorkflowSpecStore(root)
            proposal = store.create_proposal(WorkflowSpec.default())
            modifier = LocalWorkflowSpecCodeModifier(root)

            unapproved = modifier.apply_workflow_proposal(proposal)
            proposal["target_path"] = "evidence/ledger.jsonl"
            proposal["modified_files"] = ["evidence/ledger.jsonl"]
            denied_path = modifier.apply_workflow_proposal(proposal, approved_by="tester")

        self.assertEqual(unapproved.status, "interrupt")
        self.assertTrue(any("approval is required" in reason for reason in unapproved.gate_decision["reasons"]))
        self.assertEqual(denied_path.status, "interrupt")
        self.assertTrue(any("denied path" in reason for reason in denied_path.gate_decision["reasons"]))

    def test_workflow_api_draft_proposal_and_apply(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "agent.yaml").write_text(
                Path("agent.yaml").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            (root / "knowledge").mkdir()
            server = create_server(host="127.0.0.1", port=0, config_path=root / "agent.yaml", workspace_root=root)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_address[1]}"
            try:
                spec_payload = _get_json(f"{base_url}/api/workflow/spec")
                draft = spec_payload["spec"]
                draft["revision"] = "api-test"

                draft_payload = _post_json(f"{base_url}/api/workflow/draft", {"spec": draft})
                proposal = _post_json(f"{base_url}/api/workflow/proposal", {})
                applied = _post_json(
                    f"{base_url}/api/workflow/apply",
                    {"proposal_id": proposal["proposal_id"], "approved": True, "approved_by": "tester"},
                )
            finally:
                server.shutdown()
                server.server_close()

        self.assertTrue(draft_payload["validation"]["ok"])
        self.assertEqual(applied["status"], "applied")
        self.assertEqual(applied["workflow"]["spec"]["revision"], "api-test")


def _get_json(url: str):
    return json.loads(request.urlopen(url, timeout=10).read().decode("utf-8"))


def _post_json(url: str, body: dict):
    data = json.dumps(body).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(request.urlopen(req, timeout=10).read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
