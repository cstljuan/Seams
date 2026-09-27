#!/usr/bin/env python3
"""
Florida Grid Plan Monitor v8.2 (Local Edition)

Wave 1 executes classical spatial heuristics. 
Wave 2 utilizes an agentic local LLM (Ollama) armed with web search
to find precise land acquisition or permit coordinates for unbuilt facilities.

Install: python -m pip install ddgs requests beautifulsoup4 pypdf
For semantic ranking: ollama pull nomic-embed-text
Keep florida_grid_monitor.py alongside this file.

Environment variables:
    LOCAL_LLM_URL      Ollama base URL. Default: http://127.0.0.1:11434
    LOCAL_LLM_MODEL    Model name. Default: llama3.2 (or qwen3.5/gemma4 if available)
    LOCAL_LLM_TIMEOUT  Seconds to wait for one reply. Default: 180
    LOCAL_EMBED_MODEL  Ollama embedding model. Default: nomic-embed-text
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import math
import os
import re
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

# Imports the base v8 pipeline (Wave 1)
import florida_grid_monitor as monitor

DEFAULT_OUTPUT = Path("florida_future_grid_projects_local.csv")
DEFAULT_REVIEW_OUTPUT = Path("florida_grid_projects_review_local.csv")
DEFAULT_LLM_URL = "http://127.0.0.1:11434"
DEFAULT_LLM_MODEL = "llama3.2"
MAX_SEARCH_ROUNDS = 2
FLORIDA_LAT = (24.0, 31.5)
FLORIDA_LON = (-88.0, -79.5)
MAX_DOCUMENT_CHARS = 100_000
MAX_PAGE_BYTES = 10_000_000
MAX_PDF_PAGES = 40
PASSAGE_SIZE = 800
PASSAGE_OVERLAP = 150
MAX_RETRIEVED_PASSAGES = 6
MAX_EMBED_CANDIDATES = 64
EMBED_BATCH_SIZE = 16
_embedding_warning_logged = False

# Keep the base implementation before installing the wrapper, avoiding recursion.
_BASE_ENRICH_LOCATION = monitor.enrich_record_with_location

# Strict JSON Schema to physically constrain the LLM's output tokens
OLLAMA_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["search", "answer"]},
        "query": {"type": "string"},
        "found": {"type": "boolean"},
        "lat": {"type": "number"},
        "lon": {"type": "number"},
        "provenance": {"type": "string", "enum": ["Purchase", "Permit", "Document Provided", "NA"]},
        "evidence": {"type": "string"}
    },
    "required": ["action"]
}


def web_search(query: str, limit: int = 5) -> list[dict[str, str]]:
    """Read search-result documents before selecting passages for the model."""
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=limit):
                url = r.get("href", "") or r.get("url", "")
                page_text = ""
                if _public_web_url(url):
                    try:
                        page_text = _read_result(url, ddgs)
                    except Exception as exc:
                        logging.debug("Could not extract %s: %s", url, exc)
                results.append({
                    "title": r.get("title", ""),
                    "url": url,
                    "snippet": r.get("body", ""),
                    "page_text": page_text,
                })
    except Exception as exc:
        logging.warning("DDGS search failed for '%s': %s", query, exc)
    logging.info("DDGS returned %d result(s) for: %s", len(results), query)
    return results


def _public_web_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return (parsed.scheme in {"http", "https"} and bool(host)
            and host != "localhost" and not host.endswith(".local")
            and not re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", host))


def _read_result(url: str, ddgs: DDGS) -> str:
    """Bound downloads; pypdf handles text PDFs, DDGS handles ordinary pages."""
    if urlparse(url).path.lower().endswith(".pdf"):
        response = requests.get(url, timeout=20, stream=True)
        response.raise_for_status()
        try:
            data = bytearray()
            for block in response.iter_content(chunk_size=64 * 1024):
                data.extend(block)
                if len(data) > MAX_PAGE_BYTES:
                    raise ValueError("PDF exceeds maximum download size")
            reader = PdfReader(io.BytesIO(data), strict=False)
            pages = []
            for index, page in enumerate(reader.pages[:MAX_PDF_PAGES], start=1):
                pages.append(f"Page {index}: {page.extract_text() or ''}")
                if sum(map(len, pages)) >= MAX_DOCUMENT_CHARS:
                    break
            content = "\n".join(pages)
        finally:
            response.close()
    else:
        extract = getattr(ddgs, "extract", None)
        if callable(extract):
            content = extract(url, fmt="text_plain").get("content", "")
        else:
            response = requests.get(url, timeout=12)
            response.raise_for_status()
            content = (BeautifulSoup(response.content, "html.parser").get_text(" ", strip=True)
                       if "html" in response.headers.get("Content-Type", "").lower()
                       and len(response.content) <= MAX_PAGE_BYTES else "")
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")
    return re.sub(r"\s+", " ", str(content)).strip()[:MAX_DOCUMENT_CHARS]


def _format_results(results: list[dict[str, str]]) -> str:
    if not results:
        return "No search results."
    lines = []
    for index, item in enumerate(results, start=1):
        block = (f"{index}. {item['title']}\nURL: {item['url']}\n"
                 f"Search snippet: {item['snippet']}")
        if item.get("page_text"):
            block += f"\nExtracted page content:\n{item['page_text']}"
        lines.append(block)
    return "\n\n---\n\n".join(lines)


def _passages(results: list[dict[str, str]]) -> list[dict[str, str]]:
    """Split page text with overlap so coordinate pairs survive boundaries."""
    passages = []
    for item in results:
        text = item.get("page_text", "")
        for start in range(0, len(text), PASSAGE_SIZE - PASSAGE_OVERLAP):
            chunk = text[start:start + PASSAGE_SIZE].strip()
            if chunk:
                passages.append({**item, "page_text": chunk, "snippet": ""})
            if start + PASSAGE_SIZE >= len(text):
                break
        if item.get("snippet"):
            passages.append({**item, "page_text": "", "snippet": item["snippet"][:PASSAGE_SIZE]})
    return passages


def _terms(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]{3,}", text.lower())


def _lexical_scores(query: str, passages: list[dict[str, str]]) -> list[float]:
    """Small in-memory BM25 index for a single project's search results."""
    counts = [Counter(_terms(p["page_text"] or p["snippet"])) for p in passages]
    if not counts:
        return []
    query_terms = set(_terms(query)) - {"florida", "coordinates", "substation", "transmission", "project"}
    query_terms.update({"latitude", "longitude", "parcel", "permit"})
    n = len(counts)
    avg_length = max(1, sum(sum(c.values()) for c in counts) / n)
    frequency = {word: sum(word in c for c in counts) for word in query_terms}
    scores = []
    for count in counts:
        length = sum(count.values())
        score = 0.0
        for word in query_terms:
            tf = count[word]
            if tf:
                idf = math.log1p((n - frequency[word] + 0.5) / (frequency[word] + 0.5))
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / avg_length))
        scores.append(score)
    return scores


def _embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Use a local embedding model when installed; keep keyword retrieval available."""
    global _embedding_warning_logged
    if _embedding_warning_logged:
        return None
    base_url, _chat_model, timeout, api = _llm_settings()
    if api != "ollama":
        logging.warning("Semantic retrieval requires Ollama; using keyword retrieval")
        _embedding_warning_logged = True
        return None
    model = os.environ.get("LOCAL_EMBED_MODEL", "nomic-embed-text")
    vectors = []
    try:
        for start in range(0, len(texts), EMBED_BATCH_SIZE):
            response = requests.post(
                f"{base_url}/api/embed",
                json={"model": model, "input": texts[start:start + EMBED_BATCH_SIZE]},
                timeout=timeout,
            )
            response.raise_for_status()
            batch = response.json()["embeddings"]
            if len(batch) != len(texts[start:start + EMBED_BATCH_SIZE]):
                raise ValueError("Embedding count does not match input count")
            vectors.extend(batch)
    except (requests.RequestException, KeyError, TypeError, ValueError) as exc:
        logging.warning("Semantic retrieval unavailable (%s); using keyword ranking. "
                        "To enable it, run: ollama pull %s", exc, model)
        _embedding_warning_logged = True
        return None
    return vectors


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    length = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / length if length else 0.0


def _retrieve_passages(results: list[dict[str, str]], query: str) -> list[dict[str, str]]:
    """Fuse BM25 and embedding ranks; give explicit coordinate passages priority."""
    passages = _passages(results)
    if not passages:
        return []
    lexical = _lexical_scores(query, passages)
    lexical_order = sorted(range(len(passages)), key=lambda i: lexical[i], reverse=True)
    # Guarantee coordinate-bearing passages enter the semantic shortlist.
    coordinate = [i for i, p in enumerate(passages) if _matching_source_candidates(p)]
    candidate_ids = list(dict.fromkeys(lexical_order[:40] + coordinate[:24]))[:MAX_EMBED_CANDIDATES]
    vectors = _embed_texts([query] + [(passages[i]["page_text"] or passages[i]["snippet"])
                                     for i in candidate_ids])
    lexical_rank = {i: rank for rank, i in enumerate(lexical_order, start=1)}
    dense_rank = {}
    if vectors:
        dense_order = sorted(zip(candidate_ids, vectors[1:]),
                             key=lambda pair: _cosine(vectors[0], pair[1]), reverse=True)
        dense_rank = {i: rank for rank, (i, _) in enumerate(dense_order, start=1)}
    scores = {}
    for i in candidate_ids:
        scores[i] = 1 / (30 + lexical_rank[i])
        if i in dense_rank:
            scores[i] += 1 / (30 + dense_rank[i])
        if i in coordinate:
            scores[i] += 0.014
    selected = []
    per_url = Counter()
    for i in sorted(candidate_ids, key=lambda idx: scores[idx], reverse=True):
        url = passages[i]["url"]
        if per_url[url] >= 3:
            continue
        selected.append(passages[i])
        per_url[url] += 1
        if len(selected) >= MAX_RETRIEVED_PASSAGES:
            break
    logging.info("Selected %d passages from %d candidates (%s retrieval)",
                 len(selected), len(passages), "hybrid" if dense_rank else "keyword")
    return selected


def _matching_source_candidates(passage: dict[str, str]) -> bool:
    """Passages with a plausible Florida decimal pair merit a retrieval boost."""
    number = re.compile(r"(?<![\w.])[-+]?\d{1,3}\.\d{2,}(?![\d.])")
    text = passage["page_text"] or passage["snippet"]
    values = [(m.start(), float(m.group())) for m in number.finditer(text)]
    for index, (position, first) in enumerate(values):
        for next_position, second in values[index + 1:]:
            if next_position - position > 120:
                break
            if _in_florida(first, second) or _in_florida(second, first):
                return True
    return False


def _parse_model_json(text: str) -> dict | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.S)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


PREFERRED_MODELS = ("qwen3.5:9b", "qwen3:8b", "gemma3:12b", "gemma4:e4b")


def _installed_ollama_models(base_url: str, timeout: float) -> list[str]:
    response = requests.get(f"{base_url}/api/tags", timeout=min(timeout, 10))
    response.raise_for_status()
    names = []
    for item in response.json().get("models", []):
        name = item.get("name") or ""
        if name:
            names.append(name)
    return names


def _resolve_model(base_url: str, requested: str, timeout: float, api: str) -> str:
    if os.environ.get("LOCAL_LLM_MODEL"):
        return requested
    if api == "openai":
        return requested
    try:
        installed = _installed_ollama_models(base_url, timeout)
    except requests.RequestException:
        return requested
    if not installed:
        return requested
    if requested in installed:
        return requested

    by_base = {}
    for name in installed:
        by_base.setdefault(name.split(":", 1)[0], name)
    if requested.split(":", 1)[0] in by_base:
        return by_base[requested.split(":", 1)[0]]

    for preferred in PREFERRED_MODELS:
        if preferred in installed:
            return preferred
        base = preferred.split(":", 1)[0]
        if base in by_base:
            return by_base[base]

    for name in installed:
        lowered = name.lower()
        if "r1" not in lowered and "coder" not in lowered:
            return name
    return installed[0]


def _llm_settings() -> tuple[str, str, float, str]:
    base_url = os.environ.get("LOCAL_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
    requested = os.environ.get("LOCAL_LLM_MODEL", DEFAULT_LLM_MODEL)
    timeout = float(os.environ.get("LOCAL_LLM_TIMEOUT", "180"))
    api = os.environ.get("LOCAL_LLM_API", "ollama").strip().lower()
    model = _resolve_model(base_url, requested, timeout, api)
    return base_url, model, timeout, api


def local_chat(messages: list[dict[str, str]]) -> str:
    """Send one chat turn to Ollama enforcing the JSON schema."""
    base_url, model, timeout, api = _llm_settings()
    
    # Standard OpenAI API compatibility
    if api == "openai":
        endpoint = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
        response = requests.post(
            endpoint,
            json={
                "model": model, 
                "messages": messages, 
                "temperature": 0,
                "response_format": {"type": "json_object"}
            },
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    # Native Ollama API with schema enforcement.
    # num_ctx and think must be set: qwen3.5 otherwise loads a 262144 context
    # and spends the whole request in thinking mode on CPU.
    logging.info("Asking %s for a coordinate", model)
    response = requests.post(
        f"{base_url}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "format": OLLAMA_JSON_SCHEMA,
            "think": False,
            "options": {
                "temperature": 0,
                "num_ctx": 4096,
                "num_predict": 512,
            },
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json().get("message", {}).get("content", "")


def _project_query(record: monitor.ProjectRecord) -> str:
    parts = [
        record.project_name,
        record.planning_company,
        record.starting_substation,
        record.ending_substation,
        record.counties_crossed,
        "Florida",
        "substation OR transmission coordinates",
    ]
    text = " ".join(part for part in parts if monitor.has_value(part))
    return re.sub(r"\s+", " ", text)[:300]


def _in_florida(lat: float, lon: float) -> bool:
    return FLORIDA_LAT[0] <= lat <= FLORIDA_LAT[1] and FLORIDA_LON[0] <= lon <= FLORIDA_LON[1]


def _matching_source(lat: float, lon: float, results: list[dict[str, str]]) -> tuple[str, str] | None:
    """Find the proposed pair together in one retrieved snippet or page."""
    number = re.compile(r"(?<![\w.])[-+]?\d{1,3}\.\d{2,}(?![\d.])")
    for item in results:
        for field in ("page_text", "snippet"):
            content = item.get(field, "")
            values = [(m.start(), float(m.group())) for m in number.finditer(content)]
            for index, (position, first) in enumerate(values):
                for second_position, second in values[index + 1:]:
                    if second_position - position > 120:
                        break
                    if ((abs(first - lat) < 0.00005 and abs(second - lon) < 0.00005)
                            or (abs(first - lon) < 0.00005 and abs(second - lat) < 0.00005)):
                        excerpt = content[max(0, position - 90):second_position + 100]
                        return item["url"], re.sub(r"\s+", " ", excerpt).strip()
    return None


def _apply_answer(record: monitor.ProjectRecord, result: dict,
                  results: list[dict[str, str]]) -> bool:
    if not result.get("found"):
        return False
    try:
        lat = float(result["lat"])
        lon = float(result["lon"])
    except (KeyError, TypeError, ValueError):
        return False
    if not _in_florida(lat, lon):
        return False
    source = _matching_source(lat, lon, results)
    if not source:
        logging.warning("Rejected unverified local-model coordinate for %s", record.project_id)
        return False

    geometry = {"type": "Point", "coordinates": [lon, lat]}
    record.gis = json.dumps(geometry, separators=(",", ":"), ensure_ascii=False)
    record.centroid = f"{lat:.6f}, {lon:.6f}"
    record.location_method = "local_model_search"
    record.gis_source = source[0]
    record.location_confidence = "medium"
    record.spatial_role = "llm_grounded_coordinate"
    record.location_evidence = monitor.missing_text(
        f"{result.get('provenance') or 'Document Provided'}: "
        f"{source[1][:240]} ({source[0]})"
    )
    return True


def _execute_local_wave2(record: monitor.ProjectRecord) -> monitor.ProjectRecord:
    """Wave 2: Search the web, then ask the local model to extract a coordinate."""
    query = _project_query(record)
    results = web_search(query)
    if not results:
        return record
    selected = _retrieve_passages(results, query)
    if not selected:
        return record
    shown_passages = selected

    messages = [
        {
            "role": "system",
            "content": (
                "You locate Florida electric grid projects using supplied web evidence. "
                "Never guess or estimate coordinates. Set found=true only when an exact "
                "latitude/longitude pair is explicitly present in the supplied source "
                "content and clearly refers to the project's facility, property, permit, "
                "acquisition parcel, substation, or transmission asset. A city centroid, "
                "county centroid, company office, headquarters, or unrelated nearby "
                "substation is not acceptable. "
                "Reply with exactly one valid JSON object. "
                "To search for more data, use {\"action\": \"search\", \"query\": \"your query\"}. "
                "When coordinates are explicitly supported, return action=answer, "
                "found=true, lat, lon, provenance, and a short evidence explanation. "
                "If coordinates cannot be found, use {\"action\": \"answer\", \"found\": false}."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Project: {record.project_name}\n"
                f"Company: {record.planning_company}\n"
                f"Counties: {record.counties_crossed}\n"
                f"Substations: {record.starting_substation} to {record.ending_substation}\n\n"
                f"Search query: {query}\n"
                f"Ranked source passages:\n{_format_results(selected)}"
            ),
        },
    ]

    for _round in range(MAX_SEARCH_ROUNDS + 1):
        try:
            reply = local_chat(messages)
        except requests.RequestException as exc:
            logging.warning("Local LLM request failed for %s: %s", record.project_id, exc)
            return record

        parsed = _parse_model_json(reply)
        if not parsed:
            logging.debug("Local model returned invalid JSON for %s", record.project_id)
            return record

        action = str(parsed.get("action") or "answer").lower()
        if action == "search" and _round < MAX_SEARCH_ROUNDS:
            next_query = str(parsed.get("query") or "").strip()
            if not next_query:
                return record
            
            results = web_search(next_query)
            selected = _retrieve_passages(results, query + " " + next_query)
            shown_passages = selected
            # Each round sees the project and its latest sources within num_ctx.
            messages = [messages[0], {
                "role": "user",
                "content": (
                    f"Project: {record.project_name}\n"
                    f"Company: {record.planning_company}\n"
                    f"Counties: {record.counties_crossed}\n"
                    f"Substations: {record.starting_substation} to {record.ending_substation}\n"
                    f"Search query: {next_query}\n"
                    f"Ranked source passages:\n{_format_results(selected)}"
                ),
            }]
            time.sleep(1.0)
            continue

        _apply_answer(record, parsed, shown_passages)
        return record

    return record


def _enrich_with_local_wave2(session: requests.Session,
                             record: monitor.ProjectRecord) -> monitor.ProjectRecord:
    """Run the base GIS hierarchy, then try web evidence for missing GIS geometry."""
    record = _BASE_ENRICH_LOCATION(session, record)
    if monitor.has_value(record.gis):
        return record
    logging.info("Wave 1 produced no strict GIS geometry for %s; trying local Wave 2",
                 record.project_name)
    return _execute_local_wave2(record)


def _local_model_ready() -> bool:
    base_url, model, timeout, api = _llm_settings()
    try:
        if api == "openai":
            root = base_url.removesuffix("/chat/completions").removesuffix("/v1")
            requests.get(f"{root}/v1/models", timeout=min(timeout, 10)).raise_for_status()
        else:
            requests.get(f"{base_url}/api/tags", timeout=min(timeout, 10)).raise_for_status()
    except requests.RequestException as exc:
        logging.error(
            "Local model is not reachable at %s (%s). "
            "Start the Ollama app, or set LOCAL_LLM_URL and LOCAL_LLM_MODEL.",
            base_url,
            exc,
        )
        return False
    logging.info("Wave 2 will use local model %s at %s", model, base_url)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Florida grid monitor using a local model with web search instead of Gemini."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--review-output", type=Path, default=DEFAULT_REVIEW_OUTPUT)
    parser.add_argument("--snapshots", type=Path, default=monitor.DEFAULT_SNAPSHOT_DIR)
    parser.add_argument("--min-confidence", type=float, default=monitor.DEFAULT_MIN_CONFIDENCE)
    parser.add_argument("--no-gis", action="store_true", help="Skip GIS enrichment.")
    parser.add_argument("--fresh", action="store_true", help="Rebuild output from scratch.")
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    if not 0 <= args.min_confidence <= 1:
        parser.error("--min-confidence must be between 0 and 1")
    if not args.no_gis and not _local_model_ready():
        raise SystemExit(1)

    # run_once calls this function directly; replace it with the wrapper.
    monitor.enrich_record_with_location = _enrich_with_local_wave2

    if args.fresh:
        for path in (args.output, args.review_output):
            if path.exists():
                path.unlink()
        logging.info("Fresh rebuild requested; prior local output/review CSVs removed.")

    if not args.weekly:
        monitor.run_once(
            args.output,
            args.review_output,
            args.snapshots,
            args.min_confidence,
            args.no_gis,
        )
        return

    while True:
        try:
            monitor.run_once(
                args.output,
                args.review_output,
                args.snapshots,
                args.min_confidence,
                args.no_gis,
            )
        except Exception:
            logging.exception("Weekly run failed")
        time.sleep(monitor.WEEK_SECONDS)


if __name__ == "__main__":
    main()
