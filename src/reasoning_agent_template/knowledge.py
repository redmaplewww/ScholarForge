from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from reasoning_agent_template.evidence import EvidenceLedger
from reasoning_agent_template.models import KnowledgeChunk, stable_hash


SUPPORTED_EXTENSIONS = {".md", ".txt", ".json"}


@dataclass(frozen=True)
class _IndexedChunk:
    source: Path
    start_line: int
    end_line: int
    text: str
    content_hash: str


class LocalKnowledgeBase:
    """Tiny local document index for template tests and starter projects."""

    def __init__(self, root: Path, *, ledger: EvidenceLedger | None = None):
        self.root = Path(root)
        self.ledger = ledger
        self._chunks: list[_IndexedChunk] = []

    def ingest(self) -> list[_IndexedChunk]:
        self._chunks = []
        if not self.root.exists():
            return []
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
                text = self._read_text(path)
                lines = text.splitlines() or [text]
                cleaned = "\n".join(line for line in lines if line.strip())
                if cleaned.strip():
                    self._chunks.append(
                        _IndexedChunk(
                            source=path,
                            start_line=1,
                            end_line=max(1, len(lines)),
                            text=cleaned.strip(),
                            content_hash=stable_hash(cleaned.strip()),
                        )
                    )
        return list(self._chunks)

    def retrieve(self, query: str, *, top_k: int = 5) -> list[KnowledgeChunk]:
        if not self._chunks:
            self.ingest()
        query_terms = _terms(query)
        scored: list[tuple[float, _IndexedChunk]] = []
        for chunk in self._chunks:
            text_terms = _terms(chunk.text)
            overlap = len(query_terms.intersection(text_terms))
            if overlap:
                scored.append((overlap / max(1, len(query_terms)), chunk))
        scored.sort(key=lambda item: (-item[0], str(item[1].source)))

        results: list[KnowledgeChunk] = []
        for score, chunk in scored[:top_k]:
            span = f"lines {chunk.start_line}-{chunk.end_line}"
            evidence_id = ""
            if self.ledger is not None:
                evidence = self.ledger.record(
                    source_type="file",
                    uri=str(chunk.source),
                    locator=span,
                    content=chunk.text,
                    summary=_summarize(chunk.text),
                    confidence=min(1.0, 0.5 + score),
                    used_for=["knowledge:retrieve"],
                )
                evidence_id = evidence.id
            results.append(
                KnowledgeChunk(
                    source=str(chunk.source),
                    span=span,
                    text=chunk.text,
                    content_hash=chunk.content_hash,
                    score=score,
                    evidence_id=evidence_id,
                )
            )
        return results

    def cite(self, chunk: KnowledgeChunk) -> str:
        return f"[{chunk.evidence_id}] {chunk.source}#{chunk.span}"

    def _read_text(self, path: Path) -> str:
        text = path.read_text(encoding="utf-8")
        if path.suffix.lower() == ".json":
            try:
                return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                return text
        return text


def _terms(value: str) -> set[str]:
    terms: set[str] = set()
    for token in re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]+", value.lower()):
        if re.fullmatch(r"[\u4e00-\u9fff]+", token):
            terms.update(token)
            terms.update(token[index : index + 2] for index in range(max(0, len(token) - 1)))
        elif len(token) > 2:
            terms.add(token)
    return terms


def _summarize(value: str, limit: int = 180) -> str:
    collapsed = " ".join(value.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3] + "..."
