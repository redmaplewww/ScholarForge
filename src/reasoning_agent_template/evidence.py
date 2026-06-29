from __future__ import annotations

import json
from pathlib import Path

from reasoning_agent_template.models import EvidenceItem, stable_hash, utc_now


class EvidenceLedger:
    """Append-only JSONL ledger for citable evidence."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def record(
        self,
        *,
        source_type: str,
        uri: str,
        locator: str,
        content: str,
        summary: str,
        confidence: float,
        used_for: list[str] | None = None,
    ) -> EvidenceItem:
        content_hash = stable_hash(content)
        identity = stable_hash("|".join([source_type, uri, locator, content_hash]))
        item = EvidenceItem(
            id=f"ev_{identity[:12]}",
            source_type=source_type,
            uri=uri,
            locator=locator,
            content_hash=content_hash,
            summary=summary,
            confidence=confidence,
            collected_at=utc_now(),
            used_for=used_for or [],
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True) + "\n")
        return item

    def list(self) -> list[EvidenceItem]:
        if not self.path.exists():
            return []
        items: list[EvidenceItem] = []
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    items.append(EvidenceItem.from_dict(json.loads(line)))
        return items
