from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from reasoning_agent_template.config import load_agent_config
from reasoning_agent_template.multiagent import ChatClient, MultiAgentOrchestrator
from reasoning_agent_template.skills import SkillRegistry


STATIC_ROOT = Path(__file__).parent / "web_static"


def create_server(
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    config_path: str | Path = "agent.yaml",
    workspace_root: str | Path = ".",
    llm_client_factory: Callable[[Any], ChatClient] | None = None,
) -> ThreadingHTTPServer:
    workspace = Path(workspace_root)
    config = load_agent_config(Path(config_path))
    orchestrator = MultiAgentOrchestrator(
        config=config,
        workspace_root=workspace,
        llm_client_factory=llm_client_factory,
    )
    handler = _make_handler(orchestrator=orchestrator, workspace=workspace, config_path=Path(config_path))
    return ThreadingHTTPServer((host, port), handler)


def _make_handler(
    *,
    orchestrator: MultiAgentOrchestrator,
    workspace: Path,
    config_path: Path,
) -> type[BaseHTTPRequestHandler]:
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
            if path != "/api/chat":
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return
            try:
                body = self._read_json()
                message = str(body.get("message", "")).strip()
                if not message:
                    self._send_json({"error": "message is required"}, status=400)
                    return
                self._send_json(orchestrator.run(message))
            except Exception as exc:
                self._send_json({"error": str(exc), "type": type(exc).__name__}, status=500)

        def log_message(self, format: str, *args: Any) -> None:
            return

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
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return DebugHandler


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
