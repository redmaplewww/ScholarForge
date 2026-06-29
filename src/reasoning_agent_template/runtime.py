from __future__ import annotations

from pathlib import Path
from typing import Any

from reasoning_agent_template.config import AgentConfig
from reasoning_agent_template.models import RuntimeHandle


def create_deep_agent_runtime(
    *,
    config: AgentConfig,
    tools: list[Any],
    skills_dir: Path,
    prefer_deepagents: bool | None = None,
) -> RuntimeHandle:
    """Create a Deep Agents runtime when requested, otherwise use a local fallback."""

    should_use_deepagents = (
        config.runtime.get("prefer_deepagents", False) if prefer_deepagents is None else prefer_deepagents
    )
    if should_use_deepagents:
        try:
            from deepagents import create_deep_agent  # type: ignore

            interrupt_on = {
                action: True for action in config.gates.get("approval_required_actions", [])
            }
            agent = create_deep_agent(
                tools=tools,
                instructions=_instructions(config),
                skills=str(skills_dir),
                interrupt_on=interrupt_on,
            )
            return RuntimeHandle(backend="deepagents", invoke=agent.invoke)
        except Exception:
            pass

    return RuntimeHandle(backend="fallback", invoke=lambda payload: {"messages": payload.get("messages", [])})


def _instructions(config: AgentConfig) -> str:
    return (
        f"You are {config.identity.get('name', 'a reasoning agent')}. "
        "Follow evidence-first reasoning, gate risky actions, preserve minimal changes, "
        "and generate self-evolution proposals instead of directly mutating core skills."
    )
