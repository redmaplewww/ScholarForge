from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from reasoning_agent_template.gates import GatePolicy
from reasoning_agent_template.models import EvidenceItem, MemoryWriteResult, utc_now


WRITABLE_PARTITIONS = {"semantic", "episodic", "procedural", "project", "user"}


class LongTermMemoryStore:
    """Partitioned JSONL memory store guarded by GatePolicy."""

    def __init__(self, root: Path, *, gate_policy: GatePolicy):
        self.root = Path(root)
        self.gate_policy = gate_policy

    def write(
        self,
        *,
        partition: str,
        key: str,
        value: Any,
        evidence: list[EvidenceItem],
        approved_by: str | None = None,
    ) -> MemoryWriteResult:
        if partition not in WRITABLE_PARTITIONS:
            decision = self.gate_policy.evaluate(
                action="write_memory",
                risk_level="medium",
                evidence=evidence,
                target_path=self._path_for(partition),
                approved_by=approved_by,
            )
            decision = type(decision)(
                gate_id=decision.gate_id,
                risk_level=decision.risk_level,
                status="deny",
                reasons=[*decision.reasons, f"{partition} memory is read-only or unknown"],
                required_evidence=decision.required_evidence,
                approved_by=decision.approved_by,
                state_snapshot_id=decision.state_snapshot_id,
            )
            return MemoryWriteResult(partition=partition, key=key, decision=decision)

        path = self._path_for(partition)
        decision = self.gate_policy.evaluate(
            action="write_memory",
            risk_level="medium",
            evidence=evidence,
            target_path=path,
            approved_by=approved_by,
        )
        if decision.status != "allow":
            return MemoryWriteResult(partition=partition, key=key, decision=decision)

        path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "partition": partition,
            "key": key,
            "value": value,
            "evidence_ids": [item.id for item in evidence],
            "written_at": utc_now(),
            "approved_by": approved_by,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        return MemoryWriteResult(partition=partition, key=key, decision=decision, path=path)

    def read(self, partition: str, key: str) -> Any:
        path = self._path_for(partition)
        if not path.exists():
            return None
        found = None
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    record = json.loads(line)
                    if record.get("key") == key:
                        found = record.get("value")
        return found

    def list_partition(self, partition: str) -> list[dict[str, Any]]:
        path = self._path_for(partition)
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def _path_for(self, partition: str) -> Path:
        return self.root / f"{partition}.jsonl"
