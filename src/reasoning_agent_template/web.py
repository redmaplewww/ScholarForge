from __future__ import annotations

import json
import mimetypes
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from reasoning_agent_template.code_modifier import CodeModifierAdapter, LocalWorkflowSpecCodeModifier
from reasoning_agent_template.config import load_agent_config
from reasoning_agent_template.llm import LLMRequestError, MissingApiKeyError
from reasoning_agent_template.multiagent import ChatClient, MultiAgentOrchestrator
from reasoning_agent_template.skills import SkillRegistry
from reasoning_agent_template.workflow_spec import WorkflowSpec, WorkflowSpecStore


STATIC_ROOT = Path(__file__).parent / "web_static"


def create_server(
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    config_path: str | Path = "agent.yaml",
    workspace_root: str | Path = ".",
    llm_client_factory: Callable[[Any], ChatClient] | None = None,
    code_modifier_adapter: CodeModifierAdapter | None = None,
) -> ThreadingHTTPServer:
    workspace = Path(workspace_root)
    config = load_agent_config(Path(config_path))
    orchestrator = MultiAgentOrchestrator(
        config=config,
        workspace_root=workspace,
        llm_client_factory=llm_client_factory,
    )
    handler = _make_handler(
        orchestrator=orchestrator,
        workspace=workspace,
        config_path=Path(config_path),
        code_modifier_adapter=code_modifier_adapter,
    )
    return ThreadingHTTPServer((host, port), handler)


def _make_handler(
    *,
    orchestrator: MultiAgentOrchestrator,
    workspace: Path,
    config_path: Path,
    code_modifier_adapter: CodeModifierAdapter | None = None,
) -> type[BaseHTTPRequestHandler]:
    workflow_store = WorkflowSpecStore(workspace, orchestrator.config.runtime)
    code_modifier = code_modifier_adapter or LocalWorkflowSpecCodeModifier(workspace)

    class DebugHandler(BaseHTTPRequestHandler):
        server_version = "ReasoningAgentDebug/0.1"

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/":
                self._send_static("index.html")
                return
            if path == "/api/status":
                self._send_json(orchestrator.status())
                return
            if path == "/api/workflow":
                self._send_json(orchestrator.workflow_status())
                return
            if path == "/api/workflow/spec":
                self._send_json(_workflow_spec_payload(workflow_store))
                return
            if path == "/api/skills":
                skills = SkillRegistry(workspace / "skills").load()
                self._send_json(
                    {
                        "skills": [
                            {"name": skill.name, "description": skill.description, "path": str(skill.path)}
                            for skill in skills.values()
                        ]
                    }
                )
                return
            if path.startswith("/assets/"):
                self._send_static(path.removeprefix("/assets/"))
                return
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/workflow/draft":
                try:
                    body = self._read_json()
                    spec = WorkflowSpec.from_dict(dict(body.get("spec") or body))
                    self._send_json(workflow_store.save_draft(spec))
                except Exception as exc:
                    self._send_json({"error": str(exc), "type": type(exc).__name__}, status=400)
                return
            if path == "/api/workflow/proposal":
                try:
                    body = self._read_json()
                    spec = WorkflowSpec.from_dict(dict(body["spec"])) if body.get("spec") else None
                    if spec is not None:
                        workflow_store.save_draft(spec)
                    self._send_json(workflow_store.create_proposal(spec))
                except Exception as exc:
                    self._send_json({"error": str(exc), "type": type(exc).__name__}, status=400)
                return
            if path == "/api/workflow/apply":
                try:
                    body = self._read_json()
                    proposal_id = str(body.get("proposal_id", "")).strip()
                    if not proposal_id:
                        self._send_json({"error": "proposal_id is required"}, status=400)
                        return
                    if not bool(body.get("approved")):
                        self._send_json({"error": "approved=true is required"}, status=403)
                        return
                    proposal = workflow_store.load_proposal(proposal_id)
                    result = code_modifier.apply_workflow_proposal(
                        proposal,
                        approved_by=str(body.get("approved_by") or "local-user"),
                    )
                    payload = result.to_dict()
                    payload["workflow"] = _workflow_spec_payload(workflow_store)
                    self._send_json(payload, status=200 if result.status == "applied" else 409)
                except Exception as exc:
                    self._send_json({"error": str(exc), "type": type(exc).__name__}, status=500)
                return
            if path != "/api/chat":
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return
            try:
                body = self._read_json()
                message = str(body.get("message", "")).strip()
                thread_id = str(body.get("thread_id", "default")).strip() or "default"
                if not message:
                    self._send_json({"error": "message is required"}, status=400)
                    return
                if bool(body.get("async")):
                    worker = threading.Thread(
                        target=self._run_chat_background,
                        args=(message, thread_id),
                        daemon=True,
                    )
                    worker.start()
                    self._send_json({"status": "accepted", "thread_id": thread_id})
                    return
                self._send_json(orchestrator.run(message, thread_id=thread_id))
            except (LLMRequestError, MissingApiKeyError) as exc:
                self._send_json(
                    {
                        "error": str(exc),
                        "type": type(exc).__name__,
                        "phase": "llm",
                        "status": "failed",
                    },
                    status=502,
                )
            except Exception as exc:
                self._send_json(
                    {"error": str(exc), "type": type(exc).__name__, "phase": "server", "status": "failed"},
                    status=500,
                )

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _run_chat_background(self, message: str, thread_id: str) -> None:
            try:
                orchestrator.run(message, thread_id=thread_id)
            except (LLMRequestError, MissingApiKeyError) as exc:
                orchestrator.record_failure(message=message, thread_id=thread_id, error=exc, phase="llm")
            except Exception as exc:
                orchestrator.record_failure(message=message, thread_id=thread_id, error=exc, phase="server")

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            data = self.rfile.read(length).decode("utf-8")
            return json.loads(data) if data else {}

        def _send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
            data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _send_static(self, relative: str) -> None:
            target = (STATIC_ROOT / relative).resolve()
            try:
                target.relative_to(STATIC_ROOT.resolve())
            except ValueError:
                self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
                return
            if not target.exists() or not target.is_file():
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return
            data = target.read_bytes()
            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type in {
                "application/javascript",
                "application/json",
            }:
                content_type = f"{content_type}; charset=utf-8"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return DebugHandler


def _workflow_spec_payload(store: WorkflowSpecStore) -> dict[str, Any]:
    spec = store.load()
    draft = store.load_draft()
    validation_target = draft or spec
    validation = validation_target.validate(base=spec if draft else None)
    return {
        "spec": spec.to_dict(),
        "draft": draft.to_dict() if draft else None,
        "validation": validation.to_dict(),
        "paths": {
            "spec": str(store.spec_path),
            "draft": str(store.draft_path),
            "proposal_dir": str(store.proposal_dir),
        },
    }


def serve(
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    config_path: str | Path = "agent.yaml",
    workspace_root: str | Path = ".",
) -> None:
    server = create_server(host=host, port=port, config_path=config_path, workspace_root=workspace_root)
    print(f"Reasoning Agent Debug Console: http://{host}:{server.server_address[1]}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping debug console.")
    finally:
        server.server_close()
