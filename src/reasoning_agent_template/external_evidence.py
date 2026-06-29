from __future__ import annotations

import json
import re
from typing import Any, Callable
from urllib import error, parse, request

from reasoning_agent_template.evidence import EvidenceLedger
from reasoning_agent_template.models import KnowledgeChunk, stable_hash


SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
CROSSREF_URL = "https://api.crossref.org/works"


class ExternalEvidenceSearch:
    """Network-backed evidence search for papers and user-provided experience."""

    def __init__(
        self,
        *,
        ledger: EvidenceLedger,
        timeout_seconds: int = 8,
        urlopen: Callable[..., Any] | None = None,
    ):
        self.ledger = ledger
        self.timeout_seconds = timeout_seconds
        self.urlopen = urlopen or request.urlopen

    def retrieve(self, query: str, *, top_k: int = 5, sources: list[str] | None = None) -> list[KnowledgeChunk]:
        requested = set(sources or [])
        results: list[KnowledgeChunk] = []

        if "user_experience" in requested:
            results.extend(self._user_experience(query))

        if "papers" in requested:
            paper_query = _paper_query(query)
            results.extend(self._semantic_scholar(paper_query, top_k=max(1, top_k - len(results))))
            if len(results) < top_k:
                results.extend(self._crossref(paper_query, top_k=top_k - len(results)))

        return _dedupe(results)[:top_k]

    def _semantic_scholar(self, query: str, *, top_k: int) -> list[KnowledgeChunk]:
        params = {
            "query": query,
            "limit": str(max(1, top_k)),
            "fields": "title,abstract,year,url,authors,citationCount,venue",
        }
        data = self._get_json(f"{SEMANTIC_SCHOLAR_URL}?{parse.urlencode(params)}")
        rows = data.get("data", []) if isinstance(data, dict) else []
        results: list[KnowledgeChunk] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = _first_text(row.get("title"))
            if not title:
                continue
            paper_id = _first_text(row.get("paperId")) or stable_hash(title)[:12]
            abstract = _clean_text(_first_text(row.get("abstract")))
            year = _first_text(row.get("year"))
            venue = _first_text(row.get("venue"))
            authors = ", ".join(
                _first_text(author.get("name"))
                for author in row.get("authors", [])
                if isinstance(author, dict) and _first_text(author.get("name"))
            )
            citation_count = _first_text(row.get("citationCount")) or "0"
            uri = _first_text(row.get("url")) or f"https://www.semanticscholar.org/paper/{paper_id}"
            text = _join_parts(
                [
                    f"Title: {title}",
                    f"Year: {year}" if year else "",
                    f"Venue: {venue}" if venue else "",
                    f"Authors: {authors}" if authors else "",
                    f"Citations: {citation_count}",
                    f"Abstract: {abstract}" if abstract else "",
                ]
            )
            evidence = self.ledger.record(
                source_type="paper",
                uri=uri,
                locator=f"Semantic Scholar paperId={paper_id}",
                content=text,
                summary=_summarize(text),
                confidence=_paper_confidence(row.get("citationCount")),
                used_for=["external:semantic_scholar"],
            )
            results.append(
                KnowledgeChunk(
                    source=uri,
                    span=evidence.locator,
                    text=text,
                    content_hash=stable_hash(text),
                    score=evidence.confidence,
                    evidence_id=evidence.id,
                )
            )
        return results

    def _crossref(self, query: str, *, top_k: int) -> list[KnowledgeChunk]:
        params = {
            "query.bibliographic": query,
            "rows": str(max(1, top_k)),
            "select": "DOI,title,abstract,published-print,published-online,container-title,URL,author,is-referenced-by-count",
        }
        data = self._get_json(f"{CROSSREF_URL}?{parse.urlencode(params)}")
        rows = (((data or {}).get("message") or {}).get("items") or []) if isinstance(data, dict) else []
        results: list[KnowledgeChunk] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = _first_text(row.get("title"))
            if not title:
                continue
            doi = _first_text(row.get("DOI"))
            uri = _first_text(row.get("URL")) or (f"https://doi.org/{doi}" if doi else f"https://api.crossref.org/works/{stable_hash(title)[:12]}")
            year = _crossref_year(row)
            journal = _first_text(row.get("container-title"))
            abstract = _strip_tags(_first_text(row.get("abstract")))
            authors = _crossref_authors(row.get("author"))
            citation_count = _first_text(row.get("is-referenced-by-count")) or "0"
            text = _join_parts(
                [
                    f"Title: {title}",
                    f"Year: {year}" if year else "",
                    f"Journal: {journal}" if journal else "",
                    f"Authors: {authors}" if authors else "",
                    f"Citations: {citation_count}",
                    f"DOI: {doi}" if doi else "",
                    f"Abstract: {abstract}" if abstract else "",
                ]
            )
            evidence = self.ledger.record(
                source_type="paper",
                uri=uri,
                locator=f"Crossref DOI={doi or 'unknown'}",
                content=text,
                summary=_summarize(text),
                confidence=_paper_confidence(row.get("is-referenced-by-count")),
                used_for=["external:crossref"],
            )
            results.append(
                KnowledgeChunk(
                    source=uri,
                    span=evidence.locator,
                    text=text,
                    content_hash=stable_hash(text),
                    score=evidence.confidence,
                    evidence_id=evidence.id,
                )
            )
        return results

    def _user_experience(self, query: str) -> list[KnowledgeChunk]:
        markers = ["我的经验", "我的观察", "我发现", "我们项目", "我们团队", "根据我的", "our experience", "i observed"]
        if not any(marker in query.lower() for marker in markers):
            return []
        content = _clean_text(query)
        evidence = self.ledger.record(
            source_type="user_experience",
            uri="user://current-message",
            locator="prompt",
            content=content,
            summary=_summarize(content),
            confidence=0.65,
            used_for=["external:user_experience"],
        )
        return [
            KnowledgeChunk(
                source=evidence.uri,
                span=evidence.locator,
                text=content,
                content_hash=evidence.content_hash,
                score=evidence.confidence,
                evidence_id=evidence.id,
            )
        ]

    def _get_json(self, url: str) -> dict[str, Any]:
        req = request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "reasoning-agent-template/0.1",
            },
            method="GET",
        )
        try:
            with self.urlopen(req, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except (OSError, error.URLError, json.JSONDecodeError, TypeError, AttributeError):
            return {}


def _paper_query(query: str) -> str:
    text = query.strip()
    mappings = {
        "大语言模型": "large language models",
        "大型语言模型": "large language models",
        "医学诊断": "medical diagnosis",
        "医疗诊断": "medical diagnosis",
        "临床诊断": "clinical diagnosis",
        "诊断": "diagnosis",
        "临床": "clinical",
        "最新研究": "recent research",
        "研究进展": "research progress",
        "综述": "review",
        "论文": "papers",
        "文献": "literature",
        "关键论文": "key papers",
        "人工智能": "artificial intelligence",
    }
    additions = [english for chinese, english in mappings.items() if chinese in text]
    if additions:
        return " ".join(dict.fromkeys(additions))
    return re.sub(r"\s+", " ", text)


def _dedupe(results: list[KnowledgeChunk]) -> list[KnowledgeChunk]:
    seen: set[str] = set()
    unique: list[KnowledgeChunk] = []
    for result in results:
        key = result.evidence_id or result.content_hash
        if key in seen:
            continue
        seen.add(key)
        unique.append(result)
    return unique


def _first_text(value: Any) -> str:
    if isinstance(value, list):
        return _first_text(value[0]) if value else ""
    if value is None:
        return ""
    return str(value).strip()


def _clean_text(value: str) -> str:
    return " ".join(str(value).split())


def _join_parts(parts: list[str]) -> str:
    return "\n".join(part for part in parts if part)


def _summarize(value: str, limit: int = 220) -> str:
    collapsed = _clean_text(value)
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3] + "..."


def _paper_confidence(citation_count: Any) -> float:
    try:
        citations = int(citation_count or 0)
    except (TypeError, ValueError):
        citations = 0
    return min(0.95, 0.72 + min(citations, 100) / 500)


def _strip_tags(value: str) -> str:
    return _clean_text(re.sub(r"<[^>]+>", " ", value))


def _crossref_year(row: dict[str, Any]) -> str:
    for key in ("published-print", "published-online"):
        parts = ((row.get(key) or {}).get("date-parts") or [])
        if parts and parts[0]:
            return _first_text(parts[0][0])
    return ""


def _crossref_authors(value: Any) -> str:
    if not isinstance(value, list):
        return ""
    names = []
    for author in value[:8]:
        if not isinstance(author, dict):
            continue
        given = _first_text(author.get("given"))
        family = _first_text(author.get("family"))
        name = " ".join(part for part in [given, family] if part)
        if name:
            names.append(name)
    return ", ".join(names)
