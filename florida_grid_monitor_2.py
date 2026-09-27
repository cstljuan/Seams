#!/usr/bin/env python3
"""
Florida Grid Plan Monitor v9.0 (RAG Edition)

Weekly public-data monitor for future Florida transmission-line and substation projects.
This version implements a full local Retrieval-Augmented Generation (RAG) architecture:
  - Phase 1 (Ingestion): Downloads and chunks PDFs/HTML.
  - Phase 2 (Retrieval): Uses Hybrid Search (BM25 keyword + SentenceTransformer semantic vectors)
    to instantly isolate paragraphs discussing new grid infrastructure, bypassing the need to regex 
    massive documents.
  - Phase 3 (Extraction): Passes highly concentrated chunks to Wave 1 spatial heuristics, and 
    defaults to Wave 2 Gemini Agentic Search for exact coordinates.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import logging
import math
import os
import random
import re
import sqlite3
import time
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin, urlparse

import numpy as np
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from duckduckgo_search import DDGS
    HAS_DDGS = True
except ImportError:
    HAS_DDGS = False

try:
    from google import genai
    from google.genai import types
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

# ---------------- RAG Dependencies ----------------
try:
    from sentence_transformers import SentenceTransformer
    import faiss
    from rank_bm25 import BM25Okapi
    HAS_RAG = True
except ImportError:
    HAS_RAG = False

USER_AGENT = (
    "FloridaGridPlanMonitor/9.0 "
    "(public-data research; hybrid-search crawler)"
)
DEFAULT_OUTPUT = Path("florida_future_grid_projects.csv")
DEFAULT_REVIEW_OUTPUT = Path("florida_grid_projects_review.csv")
DEFAULT_SNAPSHOT_DIR = Path("grid_monitor_snapshots")
CACHE_DB_PATH = Path("grid_monitor_cache.sqlite")

REQUEST_TIMEOUT = 30
RATE_LIMIT_SECONDS = 1.25
WEEK_SECONDS = 7 * 24 * 60 * 60
DEFAULT_MIN_CONFIDENCE = 0.52
GIS_MATCH_THRESHOLD = 0.60
MISSING_TEXT = "NA"

# RAG Configuration
CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
TOP_K_CHUNKS = 15  # Number of paragraphs to extract from massive documents
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Authoritative DHS HIFLD & Census services
HIFLD_SUBSTATIONS_QUERY_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Electric_Substations/FeatureServer/0/query"
)
HIFLD_SUBSTATIONS_LAYER_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Electric_Substations/FeatureServer/0"
)
HIFLD_TRANSMISSION_LINES_QUERY_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Transmission_Lines/FeatureServer/0/query"
)
HIFLD_TRANSMISSION_LINES_LAYER_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Transmission_Lines/FeatureServer/0"
)
CENSUS_GEOCODER_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
)
TIGER_COUNTY_QUERY_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/State_County/MapServer/1/query"
)
TIGER_PLACE_QUERY_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "Places_CouSub_ConCity_SubMCD/MapServer/4/query"
)

OVERPASS_API_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
OSM_SOURCE_LABEL = "OpenStreetMap via Overpass API"
FLORIDA_BBOX = (24.3963, -87.6349, 31.0009, -79.9743)


# ---------------- Persistent SQLite Cache ----------------

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS gis_cache (
            cache_namespace TEXT,
            cache_key TEXT,
            cache_value TEXT,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (cache_namespace, cache_key)
        )
    """)
    conn.commit()
    return conn

DB_CONN = get_db_connection()

def get_cache(namespace: str, key: any) -> tuple[bool, any]:
    key_str = json.dumps(key)
    cursor = DB_CONN.execute(
        "SELECT cache_value FROM gis_cache WHERE cache_namespace = ? AND cache_key = ?",
        (namespace, key_str)
    )
    row = cursor.fetchone()
    if row:
        return True, json.loads(row[0])
    return False, None

def set_cache(namespace: str, key: any, value: any) -> None:
    key_str = json.dumps(key)
    val_str = json.dumps(value)
    DB_CONN.execute(
        """INSERT OR REPLACE INTO gis_cache (cache_namespace, cache_key, cache_value, last_seen)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)""",
        (namespace, key_str, val_str)
    )
    DB_CONN.commit()


# ---------------- Local RAG Implementation (Hybrid Search) ----------------

class HybridSearcher:
    """Combines FAISS semantic search and BM25 keyword search."""
    def __init__(self, chunks: list[str]):
        self.chunks = chunks
        if not HAS_RAG:
            return

        # 1. Initialize Semantic Vector Model
        self.encoder = SentenceTransformer(EMBEDDING_MODEL_NAME)
        embeddings = self.encoder.encode(chunks, show_progress_bar=False)

        # 2. Build FAISS Index
        dimension = embeddings.shape[1]
        self.faiss_index = faiss.IndexFlatL2(dimension)
        self.faiss_index.add(np.array(embeddings, dtype=np.float32))

        # 3. Build BM25 Index
        tokenized_chunks = [chunk.lower().split() for chunk in chunks]
        self.bm25 = BM25Okapi(tokenized_chunks)

    def search(self, query: str, top_k: int = TOP_K_CHUNKS) -> list[str]:
        if not HAS_RAG:
            # Fallback to the old regex method if libraries are missing
            return split_candidate_blocks(" ".join(self.chunks))

        if len(self.chunks) == 0:
            return []

        actual_k = min(top_k, len(self.chunks))

        # Semantic Scores
        query_embedding = self.encoder.encode([query]).astype(np.float32)
        distances, faiss_indices = self.faiss_index.search(query_embedding, actual_k)

        # Normalize FAISS distances (lower is better) to a 0-1 score
        max_dist = max(distances[0]) if distances[0].size > 0 and max(distances[0]) > 0 else 1
        semantic_scores = 1 - (distances[0] / max_dist)

        # BM25 Scores
        tokenized_query = query.lower().split()
        bm25_scores = self.bm25.get_scores(tokenized_query)
        if max(bm25_scores) > 0:
            bm25_scores = bm25_scores / max(bm25_scores) # Normalize 0-1

        # Reciprocal Rank Fusion / Combined Scoring
        combined_scores = {}
        for i, idx_semantic in enumerate(faiss_indices[0]):
            if idx_semantic < len(self.chunks):
                combined_scores[idx_semantic] = semantic_scores[i] * 0.5

        for i, score_bm25 in enumerate(bm25_scores):
            if i in combined_scores:
                combined_scores[i] += score_bm25 * 0.5
            else:
                combined_scores[i] = score_bm25 * 0.5

        # Sort and return top chunks
        ranked_indices = sorted(combined_scores, key=combined_scores.get, reverse=True)[:actual_k]

        # Post-filter: Ensure the chunks actually talk about the future/grid
        filtered_chunks = []
        for idx in ranked_indices:
            chunk = self.chunks[idx]
            if GRID_KEYWORDS.search(chunk) and FUTURE_KEYWORDS.search(chunk):
                filtered_chunks.append(chunk)

        return filtered_chunks

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    words = clean_text(text).split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        if len(chunk) > 50: # Ignore tiny fragments
            chunks.append(chunk)
    return chunks

# ---------------- Regex Configurations ----------------

SUBSTATION_ABBREVIATIONS = [
    (re.compile(r"\bst\.?\b", re.I), "saint"),
    (re.compile(r"\bft\.?\b", re.I), "fort"),
    (re.compile(r"\bmt\.?\b", re.I), "mount"),
    (re.compile(r"\bsw\b", re.I), "southwest"),
    (re.compile(r"\bnw\b", re.I), "northwest"),
    (re.compile(r"\bse\b", re.I), "southeast"),
    (re.compile(r"\bne\b", re.I), "northeast"),
    (re.compile(r"\bsec\b", re.I), "solar energy center"),
    (re.compile(r"\bpcec\b", re.I), "pea ridge"),
]

SOURCES = [
    {
        "name": "Florida DEP - Siting Coordination Office",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://floridadep.gov/taxonomy/term/454",
        "max_pages": 22,
        "gis_priority": 100,
        "parser": "dep",
        "gis_reference": "Florida DEP GIS / transmission siting records",
    },
    {
        "name": "Florida PSC - Ten-Year Site Plans",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://www.psc.state.fl.us/electric",
        "max_pages": 15,
        "gis_priority": 95,
        "parser": "generic",
        "gis_reference": "Florida PSC filings / service-territory GIS",
    },
    {
        "name": "FPL - Ten-Year Site Plan",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/content/dam/fplgp/us/en/about/pdf/ten-year-site-plan.pdf",
        "max_pages": 1,
        "gis_priority": 90,
        "parser": "fpl_schedule10",
        "gis_reference": "FPL Schedule 10 + HIFLD/Florida GIS enrichment",
    },
    {
        "name": "FPL - Transmission Projects",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/reliability/andytown-oasis-project.html",
        "max_pages": 10,
        "gis_priority": 85,
        "parser": "generic",
        "gis_reference": "FPL project maps / corridor records",
    },
    {
        "name": "JEA - Capital / Transmission Projects",
        "company_hint": "JEA",
        "url": "https://ebill.jea.com/construction/",
        "seed_urls": [
            "https://ebill.jea.com/construction/",
            "https://ebill.jea.com/about/procurement/bid_results/",
        ],
        "max_pages": 18,
        "gis_priority": 75,
        "parser": "generic",
        "gis_reference": "JEA project maps and named substations",
    },
    {
        "name": "Gainesville Regional Utilities - Public Meetings",
        "company_hint": "Gainesville Regional Utilities",
        "url": "https://www.gru.com/OurCompany/GRUAuthority.aspx",
        "max_pages": 12,
        "gis_priority": 70,
        "parser": "generic",
        "gis_reference": "GRU system/project maps",
    },
    {
        "name": "Tampa Electric - Current Grid Projects",
        "company_hint": "Tampa Electric",
        "url": "https://www.tampaelectric.com/company/ourpowersystem/projects/",
        "max_pages": 12,
        "gis_priority": 65,
        "parser": "generic",
        "gis_reference": "TECO project/regulatory maps",
    },
    {
        "name": "Duke Energy Florida - News / Grid",
        "company_hint": "Duke Energy Florida",
        "url": "https://news.duke-energy.com/releases?c=23893",
        "max_pages": 12,
        "gis_priority": 60,
        "parser": "generic",
        "gis_reference": "Duke project maps / DEP siting records",
    },
]

COMPANY_PATTERNS = [
    (re.compile(r"\bFlorida Power\s*&\s*Light\b|\bFPL\b", re.I), "Florida Power & Light"),
    (re.compile(r"\bDuke Energy Florida\b|\bDEF\b", re.I), "Duke Energy Florida"),
    (re.compile(r"\bTampa Electric\b|\bTECO\b", re.I), "Tampa Electric"),
    (re.compile(r"\bJEA\b", re.I), "JEA"),
    (re.compile(r"\bOrlando Utilities Commission\b|\bOUC\b", re.I), "Orlando Utilities Commission"),
    (re.compile(r"\bGainesville Regional Utilities\b|\bGRU\b", re.I), "Gainesville Regional Utilities"),
]

FUTURE_KEYWORDS = re.compile(
    r"\b(planned|proposed|future|projected|expected|scheduled|construction|construct|"
    r"upgrade|expansion|new|replace|rebuild|in[- ]service|completion|complete|"
    r"need date|forecast|application|petition|anticipated)\b", re.I,
)
GRID_KEYWORDS = re.compile(
    r"\b(transmission|substation|switchyard|switching station|\d{2,3}\s*kv|"
    r"kilovolt|power line|interconnection|reconductoring|transformer|bus extension)\b", re.I,
)
LINK_KEYWORDS = re.compile(
    r"(transmission|substation|site.?plan|ten.?year|grid|project|capital|budget|"
    r"planning|reliability|siting|electric|filing|docket|case|petition|application|"
    r"order.?1000|btpp)", re.I,
)
PDF_RE = re.compile(r"\.pdf(?:$|\?)", re.I)

NON_PROJECT_PATTERNS = [
    re.compile(p, re.I)
    for p in [
        r"frequently asked questions", r"trees and power lines", r"line clearing program",
        r"hurricane season", r"storm preparedness", r"reliability criteria", 
        r"vegetation request", r"news releases?\s*\|", r"outage alerts",
    ]
]

YEAR_RE = re.compile(r"\b(20(?:2[5-9]|3\d|4\d))\b")
KV_RE = re.compile(r"\b(\d{2,3})\s*(?:kV|kilovolt)\b", re.I)
MILES_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b", re.I)
COUNTY_RE = re.compile(r"\b([A-Z][A-Za-z .'-]{1,35})\s+County\b")
MONEY_RE = re.compile(
    r"(?P<currency>\$)\s*(?P<num>\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*"
    r"(?P<unit>billion|million|thousand|bn|m|k)?", re.I,
)
CASE_PATTERNS = [
    re.compile(r"\bDocket\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
    re.compile(r"\bCase\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
]
DATE_PATTERNS = [
    re.compile(r"\b(?:filed|application date)\s*(?:on|:)?\s*(\d{1,2}/\d{1,2}/\d{4})", re.I),
]
DURATION_PATTERNS = [
    re.compile(r"\b(\d+(?:\.\d+)?)\s*(months?|mos?)\b", re.I),
    re.compile(r"\b(\d+(?:\.\d+)?)\s*(years?|yrs?)\b", re.I),
]

STATION_TOKEN_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9&'().-]*(?:\s+[A-Z][A-Za-z0-9&'().-]*){0,5})\s+"
    r"(?i:Substation|Switchyard|Switching Station)\b"
)
BAD_STATION_WORDS = {
    "add", "breaker", "breakers", "construct", "construction", "connect", "connected",
    "center", "transformer", "transmission", "approximately", "line", "lines", "terminal",
    "array", "bus", "main", "step", "project", "existing", "new", "adjacent", "energy",
    "solar", "battery", "system", "facility", "facilities", "none", "the",
}

COORD_PAIR_RE = re.compile(
    r"(?P<lat>[+-]?\d{1,2}\.\d{3,})\s*°?\s*(?P<lat_hemi>[NSns])?\s*[,/]\s*"
    r"(?P<lon>[+-]?\d{1,3}\.\d{3,})\s*°?\s*(?P<lon_hemi>[EWew])?"
)
ADDRESS_RE = re.compile(
    r"\b(\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|"
    r"Highway|Hwy|Way|Court|Ct|Parkway|Pkwy|Trail|Trl|Circle|Cir|Terrace|Ter)\b"
    r"(?:,?\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})?"
    r"(?:,?\s*(?:Florida|FL)\b)?(?:\s+\d{5}(?:-\d{4})?)?)", re.I,
)
BAD_ADDRESS_RE = re.compile(
    r"\b(schedule|chapter|section|page|transmission facilities|voltage|kV|MVA|"
    r"company|discussion item|status report)\b", re.I,
)
ADMIN_ADDRESS_RE = re.compile(
    r"\b3900\s+Commonwealth\s+(?:Boulevard|Blvd)\b|"
    r"\bFlorida Department of Environmental Protection\b.{0,180}\bTallahassee\b|"
    r"\bDEP\s+(?:headquarters|office)\b", re.I,
)
COST_UNITS = {
    "billion": 1_000_000_000, "bn": 1_000_000_000,
    "million": 1_000_000, "m": 1_000_000,
    "thousand": 1_000, "k": 1_000,
}

@dataclass
class SourceDocument:
    url: str
    text: str
    page_number: int = 0
    kind: str = "html"

@dataclass
class ProjectRecord:
    project_id: str
    planning_company: str
    project_name: str
    project_type: str
    record_confidence: float
    parser_type: str
    review_reason: str

    gis: str
    centroid: str
    address: str
    location_method: str
    gis_source: str
    location_confidence: str
    spatial_role: str
    location_evidence: str
    gis_provenance: str
    is_regional_fallback: str

    starting_substation: str
    ending_substation: str
    voltage_kv: float
    approximate_line_mileage: float
    counties_crossed: str
    regulatory_case_number: str
    filing_dates: str

    projected_year: float
    cost: float
    construction_time: str
    projected_locations: str

    source_name: str
    source_url: str
    source_page: int
    source_excerpt: str
    first_seen: str
    last_seen: str
    active: str = "yes"

CSV_FIELDS = [f.name for f in ProjectRecord.__dataclass_fields__.values()]
NUMERIC_FIELDS = {
    "record_confidence", "voltage_kv", "approximate_line_mileage", "projected_year", "cost", "source_page"
}

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def clean_text(text: str) -> str:
    text = (text or "").replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", text).strip()

def normalize_name(text: str) -> str:
    text = clean_text(text).lower()
    text = re.sub(r"\b(?:florida power & light|fpl|duke energy florida|tampa electric|project)\b", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return clean_text(text)

def missing_text(value: str) -> str:
    value = clean_text(value or "")
    return value if value and value.upper() != MISSING_TEXT else MISSING_TEXT

def has_value(value) -> bool:
    if isinstance(value, (int, float)):
        return value != 0
    return clean_text(str(value or "")) not in {"", MISSING_TEXT, "0"}

def get_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    })
    return session

def fetch(session: requests.Session, url: str) -> requests.Response | None:
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        response.raise_for_status()
        return response
    except requests.RequestException as exc:
        logging.warning("Fetch failed: %s (%s)", url, exc)
        return None

def pdf_to_documents(content: bytes, url: str) -> list[SourceDocument]:
    docs: list[SourceDocument] = []
    if pdfplumber is not None:
        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page_num, page in enumerate(pdf.pages, start=1):
                    text = clean_text(page.extract_text(x_tolerance=1, y_tolerance=3) or "")
                    if text:
                        docs.append(SourceDocument(url=url, text=text, page_number=page_num, kind="pdf"))
            if docs:
                return docs
        except Exception as exc:
            logging.debug("pdfplumber failed for %s: %s", url, exc)

    try:
        reader = PdfReader(io.BytesIO(content))
        for page_num, page in enumerate(reader.pages, start=1):
            try:
                text = clean_text(page.extract_text() or "")
            except Exception:
                text = ""
            if text:
                docs.append(SourceDocument(url=url, text=text, page_number=page_num, kind="pdf"))
    except Exception as exc:
        logging.warning("PDF parse failed for %s: %s", url, exc)
    return docs

def _same_site_domain(base_domain: str, other_domain: str) -> bool:
    base_domain = base_domain.lower().split(":")[0]
    other_domain = other_domain.lower().split(":")[0]
    if base_domain == other_domain:
        return True
    if base_domain.endswith("jea.com") and other_domain.endswith("jea.com"):
        return True
    return False

def _link_priority(label: str, href: str) -> int:
    combined = f"{label} {href}".lower()
    score = 0
    for phrase, points in [
        ("transmission line project", 100), ("electric reliability project", 90),
        ("substation", 80), ("transmission", 75), ("ten-year site plan", 70),
    ]:
        if phrase in combined:
            score += points
    if href.lower().endswith(".pdf"):
        score += 20
    return score

def html_to_text_and_links(html: str, base_url: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = clean_text(soup.get_text(" ", strip=True))
    base_domain = urlparse(base_url).netloc.lower()
    ranked: list[tuple[int, str]] = []
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"].strip()).split("#")[0]
        parsed = urlparse(href)
        if parsed.scheme not in {"http", "https"} or not _same_site_domain(base_domain, parsed.netloc):
            continue
        label = clean_text(a.get_text(" ", strip=True))
        combined = f"{label} {href}"
        if LINK_KEYWORDS.search(combined) or PDF_RE.search(href):
            ranked.append((_link_priority(label, href), href))
    ranked.sort(key=lambda item: item[0], reverse=True)
    links = []
    seen = set()
    for _, href in ranked:
        if href not in seen:
            seen.add(href)
            links.append(href)
    return text, links

def should_skip_url(url: str) -> bool:
    lower = url.lower()
    return any(part in lower for part in [
        "/trees", "hurricane", "storm-prep", "storm_secure_underground",
        "privacy", "careers", "billing", "outage-map",
    ])

def crawl_source(session: requests.Session, source: dict) -> list[SourceDocument]:
    queue = list(dict.fromkeys(source.get("seed_urls") or [source["url"]]))
    seen: set[str] = set()
    docs: list[SourceDocument] = []
    while queue and len(seen) < source["max_pages"]:
        url = queue.pop(0)
        if url in seen or should_skip_url(url):
            continue
        seen.add(url)
        logging.info("[%s] %s", source["name"], url)
        response = fetch(session, url)
        time.sleep(RATE_LIMIT_SECONDS)
        if not response:
            continue
        ctype = response.headers.get("content-type", "").lower()
        final_url = response.url
        if "pdf" in ctype or PDF_RE.search(final_url):
            docs.extend(pdf_to_documents(response.content, final_url))
            continue
        if ctype and "html" not in ctype and "text" not in ctype:
            continue
        text, links = html_to_text_and_links(response.text, final_url)
        if text:
            docs.append(SourceDocument(url=final_url, text=text, page_number=0, kind="html"))
        for link in links:
            if link not in seen and link not in queue and not should_skip_url(link):
                queue.append(link)
    return docs

def detect_company(text: str, hint: str) -> str:
    for pattern, company in COMPANY_PATTERNS:
        if pattern.search(text):
            return company
    return hint

def parse_voltage(text: str, allow_bare: bool = False) -> float:
    vals = [float(v) for v in KV_RE.findall(text or "")]
    if vals:
        return max(vals)
    if allow_bare:
        vals = [float(v) for v in re.findall(r"\b(\d{2,3})\b", text or "") if 30 <= float(v) <= 800]
        return max(vals) if vals else 0.0
    return 0.0

def parse_miles(text: str, allow_bare: bool = False) -> float:
    vals = [float(v) for v in MILES_RE.findall(text or "")]
    if vals:
        return vals[0]
    stripped = clean_text(text)
    if allow_bare and re.fullmatch(r"\d+(?:\.\d+)?", stripped):
        return float(stripped)
    return 0.0

def parse_year(text: str) -> int:
    years = [int(v) for v in YEAR_RE.findall(text or "")]
    return max(years) if years else 0

def parse_cost(text: str) -> float:
    best = 0.0
    for match in MONEY_RE.finditer(text or ""):
        number = float(match.group("num").replace(",", ""))
        unit = (match.group("unit") or "").lower()
        if unit:
            number *= COST_UNITS[unit]
        elif number < 100000:
            continue
        best = max(best, number)
    return best

def detect_counties(text: str) -> str:
    out: list[str] = []
    for county in COUNTY_RE.findall(text or ""):
        county = clean_text(county)
        if len(county.split()) > 5:
            continue
        full = f"{county} County"
        if full.lower() not in {x.lower() for x in out}:
            out.append(full)
    return "; ".join(out[:8])

def detect_case_number(text: str) -> str:
    values: list[str] = []
    for pattern in CASE_PATTERNS:
        values.extend(clean_text(m.group(1)) for m in pattern.finditer(text or ""))
    return "; ".join(dict.fromkeys(values))

def detect_filing_dates(text: str) -> str:
    values: list[str] = []
    for pattern in DATE_PATTERNS:
        values.extend(clean_text(m.group(1)) for m in pattern.finditer(text or ""))
    return "; ".join(dict.fromkeys(values))

def detect_duration(text: str) -> str:
    values: list[str] = []
    for pattern in DURATION_PATTERNS:
        values.extend(clean_text(m.group(0)) for m in pattern.finditer(text or ""))
    return "; ".join(dict.fromkeys(values[:4]))

def station_name_is_valid(name: str) -> bool:
    name = clean_text(name)
    if not name or len(name) > 55:
        return False
    tokens = re.findall(r"[A-Za-z]+", name.lower())
    if not tokens:
        return False
    bad = sum(1 for token in tokens if token in BAD_STATION_WORDS)
    if bad >= max(1, len(tokens) // 2):
        return False
    if any(ch in name for ch in [":", ";"]):
        return False
    return True

def extract_station_names(text: str) -> list[str]:
    names: list[str] = []
    for match in STATION_TOKEN_RE.finditer(text or ""):
        name = clean_text(match.group(1)).strip(" -,:;.")
        words = name.split()
        while len(words) > 1 and words[0].lower() in BAD_STATION_WORDS:
            words.pop(0)
        name = " ".join(words)
        if station_name_is_valid(name) and name.lower() not in {n.lower() for n in names}:
            names.append(name)
    return names

def detect_substations_strict(text: str) -> tuple[str, str]:
    pair_patterns = [
        re.compile(
            r"(?i:transmission\s+bus\s+at)\s+([A-Z][A-Za-z0-9&'(). -]{1,40}?)\s+"
            r"(?i:Substation|Switchyard).{0,180}?(?i:connect(?:ing)?\s+(?:a\s+)?(?:new\s+)?)"
            r"([A-Z][A-Za-z0-9&'(). -]{1,40}?)\s+(?i:Substation|Switchyard)"
        ),
        re.compile(
            r"(?i:\bfrom)\s+(?:the\s+)?(?:new\s+)?([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+"
            r"(?i:Substation|Switchyard).{0,180}?(?i:\bto)\s+(?:the\s+)?(?:new\s+)?"
            r"([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+(?i:Substation|Switchyard)"
        ),
        re.compile(
            r"(?i:\bfrom)\s+([A-Z][A-Za-z0-9&'().-]{1,30})\s+"
            r"(?:500|230|161|138|115|69)\s*(?i:kV)\s+(?i:to)\s+"
            r"([A-Z][A-Za-z0-9&'().-]{1,30})\s+(?i:Substation|Switchyard)"
        ),
        re.compile(
            r"\b([A-Z][A-Za-z0-9&'().-]{1,30})\s*[-–]\s*"
            r"([A-Z][A-Za-z0-9&'().-]{1,30})\s+(?:500|230|161|138|115|69)\s*(?i:kV)"
        ),
    ]
    for pattern in pair_patterns:
        match = pattern.search(text or "")
        if match:
            a = re.sub(r"^FPL\s+", "", clean_text(match.group(1)).strip(" -,:;."), flags=re.I)
            b = re.sub(r"^FPL\s+", "", clean_text(match.group(2)).strip(" -,:;."), flags=re.I)
            if station_name_is_valid(a) and station_name_is_valid(b):
                return a, b
    names = extract_station_names(text)
    if len(names) >= 2:
        return names[0], names[1]
    if names:
        return names[0], ""
    return "", ""

def detect_address(text: str) -> str:
    for match in ADDRESS_RE.finditer(text or ""):
        address = clean_text(match.group(1))
        if BAD_ADDRESS_RE.search(address):
            continue
        if not re.match(r"^\d{1,6}\s+", address):
            continue
        return address[:180]
    return ""

def detect_coordinates(text: str) -> tuple[float, float]:
    for match in COORD_PAIR_RE.finditer(text or ""):
        lat = float(match.group("lat"))
        lon = float(match.group("lon"))
        if match.group("lat_hemi") and match.group("lat_hemi").upper() == "S":
            lat = -abs(lat)
        if match.group("lon_hemi") and match.group("lon_hemi").upper() == "W":
            lon = -abs(lon)
        if 24.0 <= lat <= 31.5 and -88.0 <= lon <= -79.5:
            return lat, lon
    return 0.0, 0.0

def project_type_from_text(project_name: str, text: str, mileage: float) -> str:
    combined = f"{project_name} {text}".lower()
    if "battery energy storage" in project_name.lower() or "bess" in project_name.lower():
        if re.search(r"new\s+\d{2,3}(?:/\d{2,3}(?:\.\d+)?)?\s*kv\s+substation", combined):
            return "New substation / battery interconnection"
        return "Battery interconnection"
    if "solar energy center" in project_name.lower() or "solar" in project_name.lower():
        if re.search(r"new\s+\d{2,3}(?:/\d{2,3}(?:\.\d+)?)?\s*kv\s+substation", combined):
            return "New substation / generator interconnection"
        return "Generator interconnection"
    if re.search(r"\b(rebuild|reconduct|uprate|upgrade|replace)\w*\b", combined) and "transmission" in combined:
        return "Transmission upgrade"
    if re.search(r"\bnew\b.{0,60}\bsubstation\b|\bconstruct\b.{0,60}\bsubstation\b", combined):
        return "New substation"
    if re.search(r"\b(upgrade|expand|replace|rebuild)\w*\b.{0,60}\bsubstation\b", combined):
        return "Substation upgrade"
    if mileage > 0 or re.search(r"\bconstruct\b.{0,100}\b(?:transmission )?line\b", combined):
        return "New transmission line"
    if "switchyard" in combined or "switching station" in combined:
        return "Switchyard / switching station"
    if "substation" in combined:
        return "Substation project"
    return "Transmission project"

def make_project_id(company: str, project_name: str, counties: str, voltage: float, case_number: str) -> str:
    canonical = "|".join([
        normalize_name(company), normalize_name(project_name), normalize_name(counties),
        str(int(voltage) if voltage else 0), normalize_name(case_number),
    ])
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:20]

def base_record(
    source: dict, doc: SourceDocument, now: str, *,
    project_name: str, project_type: str,
    start: str = "", end: str = "", voltage: float = 0.0, mileage: float = 0.0,
    counties: str = "", case_number: str = "", filing_dates: str = "",
    projected_year: int = 0, cost: float = 0.0, construction_time: str = "",
    address: str = "", projected_locations: str = "", excerpt: str = "",
    parser_type: str = "generic",
) -> ProjectRecord:
    company = detect_company(excerpt or doc.text, source["company_hint"])
    project_id = make_project_id(company, project_name, counties, voltage, case_number)
    return ProjectRecord(
        project_id=project_id,
        planning_company=missing_text(company),
        project_name=missing_text(project_name),
        project_type=missing_text(project_type),
        record_confidence=0.0,
        parser_type=parser_type,
        review_reason=MISSING_TEXT,
        gis=MISSING_TEXT,
        centroid=MISSING_TEXT,
        address=missing_text(address),
        location_method=MISSING_TEXT,
        gis_source=missing_text(source.get("gis_reference", "")),
        location_confidence="none",
        spatial_role=MISSING_TEXT,
        location_evidence=MISSING_TEXT,
        gis_provenance="NA",
        is_regional_fallback="no",
        starting_substation=missing_text(start),
        ending_substation=missing_text(end),
        voltage_kv=voltage,
        approximate_line_mileage=mileage,
        counties_crossed=missing_text(counties),
        regulatory_case_number=missing_text(case_number),
        filing_dates=missing_text(filing_dates),
        projected_year=projected_year,
        cost=cost,
        construction_time=missing_text(construction_time),
        projected_locations=missing_text(projected_locations),
        source_name=source["name"],
        source_url=doc.url,
        source_page=doc.page_number,
        source_excerpt=missing_text((excerpt or doc.text)[:2200]),
        first_seen=now,
        last_seen=now,
        active="yes",
    )

FPL_SCHEDULE10_HEADER = re.compile(
    r"Schedule\s+10\s+Status Report and Specifications of Proposed Transmission Lines", re.I,
)

def _fpl_field(section: str, number: int, next_number: int | None) -> str:
    if next_number is None:
        pattern = rf"\({number}\)\s*[^:]+:\s*(.*)$"
    else:
        pattern = rf"\({number}\)\s*[^:]+:\s*(.*?)\s*\({next_number}\)"
    match = re.search(pattern, section, re.I | re.S)
    return clean_text(match.group(1)) if match else ""

def _extract_timing(text: str) -> tuple[int, int, str]:
    start_match = re.search(r"Start\s*date\s*:\s*(20\d{2})", text or "", re.I)
    end_match = re.search(r"End\s*date\s*:\s*(20\d{2})", text or "", re.I)
    start = int(start_match.group(1)) if start_match else 0
    end = int(end_match.group(1)) if end_match else 0
    label = f"{start}-{end}" if start and end else str(end or start or "")
    return start, end, label

def _clean_fpl_project_title(raw: str) -> str:
    title = clean_text(raw)
    title = re.sub(r"^Florida Power\s*&\s*Light Company\s+\d+\s+Page\s+\d+\s+of\s+\d+\s*", "", title, flags=re.I)
    title = re.sub(r"^Florida Power\s*&\s*Light Company\s+\d+\s*", "", title, flags=re.I)

    county_title = re.search(r"(.{3,140}?\([^()]{2,50}County\))", title, re.I)
    if county_title:
        title = county_title.group(1)
    else:
        named = re.search(
            r"([A-Z][A-Za-z0-9&'(). /–-]{3,140}?(?:Transmission Line(?: Project)?|Substation(?: Project)?|Electric Reliability Project))",
            title, re.I
        )
        if named:
            title = named.group(1)

    title = re.split(r"\b(?:The|This)\s+[A-Z][A-Za-z0-9&'(). -]{2,80}\s+(?:will|is|was)\b", title, maxsplit=1)[0]
    return clean_text(title).strip(" -:;")[:180]

def extract_fpl_schedule10_records(source: dict, doc: SourceDocument, now: str) -> list[ProjectRecord]:
    text = doc.text
    matches = list(FPL_SCHEDULE10_HEADER.finditer(text))
    if not matches and "(1) Point of Origin and Termination:" not in text:
        return []

    starts = [m.start() for m in matches] if matches else [0]
    records: list[ProjectRecord] = []
    for idx, start_pos in enumerate(starts):
        end_pos = starts[idx + 1] if idx + 1 < len(starts) else len(text)
        section = text[start_pos:end_pos]
        header_match = FPL_SCHEDULE10_HEADER.search(section)
        after_header = section[header_match.end():] if header_match else section
        title_match = re.search(r"(.*?)\s*\(1\)\s*Point of Origin and Termination\s*:", after_header, re.I | re.S)
        if not title_match:
            continue
        project_name = _clean_fpl_project_title(title_match.group(1))
        if not project_name or len(project_name) < 4:
            continue

        origin = _fpl_field(after_header, 1, 2)
        line_length_field = _fpl_field(after_header, 4, 5)
        voltage_field = _fpl_field(after_header, 5, 6)
        timing_field = _fpl_field(after_header, 6, 7)
        investment_field = _fpl_field(after_header, 7, 8)
        substations_field = _fpl_field(after_header, 8, 9)
        participation_field = _fpl_field(after_header, 9, None)

        description = participation_field
        mileage = parse_miles(line_length_field, allow_bare=True)
        origin_names = extract_station_names(origin)
        sub_names = extract_station_names(substations_field)
        narrative_start, narrative_end = detect_substations_strict(description)

        start_station = origin_names[0] if origin_names else (sub_names[0] if sub_names else "")
        end_station = origin_names[1] if len(origin_names) > 1 else ""
        if mileage > 0 and narrative_start and narrative_end:
            start_station, end_station = narrative_start, narrative_end
        elif not start_station and narrative_start:
            start_station = narrative_start
            end_station = narrative_end
        elif not end_station:
            candidates = [n for n in sub_names[1:] + origin_names[1:] if n.lower() != start_station.lower()]
            end_station = candidates[0] if candidates else ""

        voltage = parse_voltage(voltage_field, allow_bare=True)
        _, end_year, construction_time = _extract_timing(timing_field)
        projected_year = end_year or parse_year(timing_field)
        counties = detect_counties(project_name + " " + section)
        cost = parse_cost(investment_field)
        project_type = project_type_from_text(project_name, section, mileage)
        projected_locations = "; ".join(dict.fromkeys(
            [x for x in [start_station, end_station] + ([c.strip() for c in counties.split(";")] if counties else []) if x]
        ))

        record = base_record(
            source, doc, now,
            project_name=project_name, project_type=project_type,
            start=start_station, end=end_station, voltage=voltage,
            mileage=mileage, counties=counties, projected_year=projected_year,
            cost=cost, construction_time=construction_time,
            projected_locations=projected_locations, excerpt=section,
            parser_type="fpl_schedule10",
        )
        records.append(record)
    return records

def split_candidate_blocks(text: str) -> list[str]:
    pieces = re.split(r"(?<=[.!?])\s+|\s{3,}", text or "")
    pieces = [clean_text(p) for p in pieces if len(clean_text(p)) >= 25]
    blocks: list[str] = []
    for i, piece in enumerate(pieces):
        if not GRID_KEYWORDS.search(piece):
            continue
        block = clean_text(" ".join(pieces[max(0, i - 2): min(len(pieces), i + 4)]))[:2200]
        if GRID_KEYWORDS.search(block) and FUTURE_KEYWORDS.search(block):
            blocks.append(block)
    return list(dict.fromkeys(blocks))

def guess_project_name(block: str, source_name: str) -> str:
    patterns = [
        r"\b([A-Z][A-Za-z0-9&'(). /-]{3,100}?(?:Transmission Line Project|Transmission Line|Transmission Project))\b",
        r"\b([A-Z][A-Za-z0-9&'(). /-]{3,85}?(?:Substation|Switchyard|Switching Station))\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, block, re.I)
        if match:
            name = clean_text(match.group(1))
            if not BAD_ADDRESS_RE.search(name):
                return name[:180]
    return f"{source_name}: {' '.join(block.split()[:12])}"[:180]

def generic_records(source: dict, doc: SourceDocument, now: str, parser_type: str = "generic") -> list[ProjectRecord]:
    # ---------------- HYBRID SEARCH INTERCEPT ----------------
    # If the document is massive, we use RAG to find the grid paragraphs 
    # rather than applying regex to every line.
    blocks_to_process = []
    if HAS_RAG and len(doc.text) > 5000:
        chunks = chunk_text(doc.text)
        searcher = HybridSearcher(chunks)
        query = "planned proposed future new transmission line 230kV 500kV substation switchyard rebuild upgrade"
        blocks_to_process = searcher.search(query)
    else:
        blocks_to_process = split_candidate_blocks(doc.text)

    records: list[ProjectRecord] = []
    for block in blocks_to_process:
        project_name = guess_project_name(block, source["name"])
        start, end = detect_substations_strict(block)
        voltage = parse_voltage(block)
        mileage = parse_miles(block)
        counties = detect_counties(block)
        case_number = detect_case_number(block)
        filing_dates = detect_filing_dates(block)
        projected_year = parse_year(block)
        cost = parse_cost(block)
        duration = detect_duration(block)
        address = detect_address(block)
        project_type = project_type_from_text(project_name, block, mileage)
        locations = "; ".join(dict.fromkeys([x for x in [start, end] + ([c.strip() for c in counties.split(";")] if counties else []) if x]))
        records.append(base_record(
            source, doc, now,
            project_name=project_name, project_type=project_type,
            start=start, end=end, voltage=voltage, mileage=mileage,
            counties=counties, case_number=case_number, filing_dates=filing_dates,
            projected_year=projected_year, cost=cost, construction_time=duration,
            address=address, projected_locations=locations, excerpt=block,
            parser_type=parser_type,
        ))
    return records

def extract_dep_records(source: dict, doc: SourceDocument, now: str) -> list[ProjectRecord]:
    text = doc.text
    if re.search(r"transmission\s+line\s+project", text, re.I):
        start_station = end_station = ""
        match = re.search(
            r"beginning\s+at\s+(?:the\s+)?([A-Z][A-Za-z0-9&'(). -]{1,55}?)\s+Substation"
            r".{0,500}?ending\s+at\s+(?:the\s+)?([A-Z][A-Za-z0-9&'(). -]{1,55}?)\s+Substation",
            text, re.I
        )
        if match:
            start_station = clean_text(match.group(1))
            end_station = clean_text(match.group(2))
        else:
            start_station, end_station = detect_substations_strict(text)

        voltage = parse_voltage(text)
        mileage = parse_miles(text)
        counties = detect_counties(text)
        case_number = detect_case_number(text)
        extras = []
        for pattern in [r"\b(TA\d{2}-\d{1,3})\b", r"\b(20\d{6})\b", r"\b(\d{2}-\d{6}TL)\b"]:
            extras.extend(re.findall(pattern, text, re.I))
        case_number = "; ".join(dict.fromkeys([x for x in ([case_number] if case_number else []) + extras if x]))
        filing_dates = detect_filing_dates(text)

        if start_station and end_station:
            project_name = f"{start_station}-{end_station} {int(voltage) if voltage else ''} kV Transmission Line Project".replace("  ", " ")
        else:
            title = re.search(r"([A-Z][A-Za-z0-9&'(). /–-]{3,160}?Transmission Line Project)", text, re.I)
            project_name = clean_text(title.group(1)) if title else guess_project_name(text[:1800], source["name"])

        projected_locations = "; ".join(dict.fromkeys(
            [x for x in [start_station, end_station] + ([c.strip() for c in counties.split(";")] if counties else []) if x]
        ))
        record = base_record(
            source, doc, now,
            project_name=project_name, project_type="New transmission line",
            start=start_station, end=end_station, voltage=voltage, mileage=mileage,
            counties=counties, case_number=case_number, filing_dates=filing_dates,
            projected_year=parse_year(text), cost=parse_cost(text),
            construction_time=detect_duration(text), address=detect_address(text), 
            projected_locations=projected_locations, excerpt=text, 
            parser_type="dep_project_page",
        )
        return [record]

    return generic_records(source, doc, now, parser_type="dep_listing")

def extract_records(source: dict, doc: SourceDocument, now: str) -> list[ProjectRecord]:
    parser = source.get("parser", "generic")
    if parser == "fpl_schedule10":
        return extract_fpl_schedule10_records(source, doc, now)
    if parser == "dep":
        return extract_dep_records(source, doc, now)
    return generic_records(source, doc, now, parser_type="generic")

def validate_record(record: ProjectRecord) -> tuple[float, str]:
    score = 0.0
    reasons: list[str] = []
    text = record.source_excerpt if record.source_excerpt != MISSING_TEXT else ""

    if record.parser_type == "fpl_schedule10": score += 0.20
    elif record.parser_type == "dep_project_page": score += 0.12

    if record.project_name != MISSING_TEXT and not record.project_name.startswith(record.source_name):
        score += 0.16
    else:
        reasons.append("generic_or_missing_project_name")

    if record.project_type not in {MISSING_TEXT, "Transmission project"}: score += 0.08
    if record.voltage_kv: score += 0.13
    else: reasons.append("missing_voltage")
    if record.starting_substation != MISSING_TEXT: score += 0.14
    else: reasons.append("missing_starting_substation")
    if record.ending_substation != MISSING_TEXT: score += 0.08
    if record.approximate_line_mileage or record.project_type.startswith("Substation") or "interconnection" in record.project_type.lower():
        score += 0.06
    if record.counties_crossed != MISSING_TEXT: score += 0.07
    if record.projected_year: score += 0.07
    else: reasons.append("missing_projected_year")
    if record.regulatory_case_number != MISSING_TEXT: score += 0.05
    if record.filing_dates != MISSING_TEXT: score += 0.03
    if record.address != MISSING_TEXT: score += 0.02

    negative_hits = [p.pattern for p in NON_PROJECT_PATTERNS if p.search(text)]
    strong_identity = record.starting_substation != MISSING_TEXT and (record.voltage_kv or record.regulatory_case_number != MISSING_TEXT)
    if negative_hits and not strong_identity:
        score -= 0.45
        reasons.append("non_project_page_signal")

    if record.parser_type in {"generic", "dep_listing"}:
        if record.starting_substation == MISSING_TEXT and record.regulatory_case_number == MISSING_TEXT:
            score -= 0.12
        if not record.projected_year and not FUTURE_KEYWORDS.search(text):
            score -= 0.08

    score = max(0.0, min(1.0, round(score, 3)))
    if not reasons: reasons.append("accepted_structured_evidence")
    return score, ";".join(dict.fromkeys(reasons))

def _arcgis_escape(value: str) -> str:
    return (value or "").replace("'", "''")

def _normalize_station_name(name: str) -> str:
    name = clean_text(name or "")
    for pattern, repl in SUBSTATION_ABBREVIATIONS:
        name = pattern.sub(repl, name)
    name = re.sub(r"\b(?:substation|switchyard|switching station)\b", "", name, flags=re.I)
    return clean_text(name.strip(" -,:;"))

def _candidate_owner_text(props: dict) -> str:
    chunks = []
    for key, value in props.items():
        upper = str(key).upper()
        if any(token in upper for token in ["OWNER", "UTILITY", "COMPANY", "OPERATOR"]):
            chunks.append(str(value or ""))
    return clean_text(" ".join(chunks))

def _utility_aliases(company: str) -> list[str]:
    mapping = {
        "Florida Power & Light": ["florida power & light", "fpl"],
        "Duke Energy Florida": ["duke energy florida", "duke"],
        "Tampa Electric": ["tampa electric", "teco"],
        "Orlando Utilities Commission": ["orlando utilities commission", "ouc"],
        "Gainesville Regional Utilities": ["gainesville regional utilities", "gru"],
        "JEA": ["jea"],
    }
    return mapping.get(company, [company.lower()] if company and company != MISSING_TEXT else [])

def _candidate_score(feature: dict, station_name: str, counties: str, voltage: float, company: str) -> float:
    props = feature.get("properties") or {}
    candidate = clean_text(str(props.get("NAME") or ""))
    target = _normalize_station_name(station_name)
    name_score = SequenceMatcher(None, target.lower(), candidate.lower()).ratio() if target and candidate else 0.0
    if name_score < 0.45: return 0.0
    total = 0.55 * name_score
    if target.lower() == candidate.lower(): total += 0.08

    wanted_counties = {
        clean_text(c).lower().replace(" county", "")
        for c in (counties or "").split(";") if clean_text(c)
    }
    got_county = clean_text(str(props.get("COUNTY") or "")).lower().replace(" county", "")
    if got_county and got_county in wanted_counties: total += 0.20

    try: max_volt = float(props.get("MAX_VOLT") or 0)
    except (TypeError, ValueError): max_volt = 0.0
    if voltage and max_volt:
        if abs(max_volt - voltage) <= 1: total += 0.15
        elif abs(max_volt - voltage) <= 25: total += 0.08

    owner_text = _candidate_owner_text(props).lower()
    aliases = _utility_aliases(company)
    if owner_text and any(alias in owner_text for alias in aliases): total += 0.10
    return min(1.0, total)

def query_hifld_substation(session: requests.Session, station_name: str, counties: str = "", voltage: float = 0.0, company: str = "") -> dict | None:
    target = _normalize_station_name(station_name)
    cache_key = (target.lower(), clean_text(counties).lower(), float(voltage or 0), clean_text(company).lower())

    found, cached = get_cache("hifld_substation", cache_key)
    if found: return cached

    if not target or target.upper() == MISSING_TEXT or not station_name_is_valid(target):
        set_cache("hifld_substation", cache_key, None)
        return None

    terms = [target]
    terms.extend([t for t in re.findall(r"[A-Za-z0-9]+", target) if len(t) >= 4][:2])
    features: list[dict] = []
    seen: set[str] = set()
    for term in terms:
        params = {
            "where": f"STATE='FL' AND NAME LIKE '%{_arcgis_escape(term)}%'",
            "outFields": "*", "returnGeometry": "true", "outSR": "4326",
            "f": "geojson", "resultRecordCount": 50,
        }
        try:
            response = session.get(HIFLD_SUBSTATIONS_QUERY_URL, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logging.debug("HIFLD lookup failed for %s: %s", target, exc)
            continue
        for feature in payload.get("features", []):
            props = feature.get("properties") or {}
            key = str(props.get("ID") or json.dumps(feature.get("geometry"), sort_keys=True))
            if key not in seen:
                seen.add(key)
                features.append(feature)
        if features: break

    if not features:
        set_cache("hifld_substation", cache_key, None)
        return None

    scored = [(_candidate_score(f, target, counties, voltage, company), f) for f in features]
    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best = scored[0]
    if best_score < GIS_MATCH_THRESHOLD:
        set_cache("hifld_substation", cache_key, None)
        return None

    best["_match_score"] = best_score
    set_cache("hifld_substation", cache_key, best)
    return best

def _point_from_feature(feature: dict | None) -> list[float] | None:
    if not feature: return None
    geom = feature.get("geometry") or {}
    if geom.get("type") == "Point" and geom.get("coordinates"):
        return [float(geom["coordinates"][0]), float(geom["coordinates"][1])]
    props = feature.get("properties") or {}
    try: return [float(props.get("LONGITUDE")), float(props.get("LATITUDE"))]
    except (TypeError, ValueError): return None

def _feature_name(feature: dict | None) -> str:
    return clean_text(str(((feature or {}).get("properties") or {}).get("NAME") or ""))

def _feature_exact_station_match(feature: dict | None, station_name: str) -> bool:
    if not feature or not station_name: return False
    return _normalize_station_name(_feature_name(feature)).lower() == _normalize_station_name(station_name).lower()

def _geojson_compact(geometry: dict | None) -> str:
    return json.dumps(geometry, separators=(",", ":"), ensure_ascii=False) if geometry else ""

def _line_weighted_center(lines: list[list[list[float]]]) -> tuple[float, float] | None:
    weighted_lat = weighted_lon = total = 0.0
    for coords in lines:
        for a, b in zip(coords, coords[1:]):
            lon1, lat1 = float(a[0]), float(a[1])
            lon2, lat2 = float(b[0]), float(b[1])
            length = math.hypot(lon2 - lon1, lat2 - lat1)
            if length <= 0: continue
            weighted_lon += ((lon1 + lon2) / 2.0) * length
            weighted_lat += ((lat1 + lat2) / 2.0) * length
            total += length
    if total: return weighted_lat / total, weighted_lon / total
    pts = [p for line in lines for p in line]
    if pts: return sum(float(p[1]) for p in pts) / len(pts), sum(float(p[0]) for p in pts) / len(pts)
    return None

def _polygon_centroid(ring: list[list[float]]) -> tuple[float, float, float] | None:
    if not ring or len(ring) < 3: return None
    area2 = cx = cy = 0.0
    pts = ring if ring[0] == ring[-1] else ring + [ring[0]]
    for a, b in zip(pts, pts[1:]):
        x1, y1 = float(a[0]), float(a[1])
        x2, y2 = float(b[0]), float(b[1])
        cross = x1 * y2 - x2 * y1
        area2 += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross
    if abs(area2) < 1e-12:
        lon = sum(float(p[0]) for p in ring) / len(ring)
        lat = sum(float(p[1]) for p in ring) / len(ring)
        return lat, lon, 0.0
    area = area2 / 2.0
    return cy / (3.0 * area2), cx / (3.0 * area2), abs(area)

def _geometry_centroid(geometry: dict | None) -> tuple[float, float] | None:
    if not geometry: return None
    gtype = geometry.get("type"); coords = geometry.get("coordinates")
    if gtype == "Point" and coords: return float(coords[1]), float(coords[0])
    if gtype == "MultiPoint" and coords:
        return sum(float(p[1]) for p in coords) / len(coords), sum(float(p[0]) for p in coords) / len(coords)
    if gtype == "LineString" and coords: return _line_weighted_center([coords])
    if gtype == "MultiLineString" and coords: return _line_weighted_center(coords)
    if gtype == "Polygon" and coords:
        result = _polygon_centroid(coords[0])
        return (result[0], result[1]) if result else None
    if gtype == "MultiPolygon" and coords:
        weighted_lat = weighted_lon = total_area = 0.0; fallback = []
        for poly in coords:
            if not poly: continue
            result = _polygon_centroid(poly[0])
            if not result: continue
            lat, lon, area = result; fallback.append((lat, lon))
            w = area or 1.0; weighted_lat += lat * w; weighted_lon += lon * w; total_area += w
        if total_area: return weighted_lat / total_area, weighted_lon / total_area
        if fallback: return sum(x[0] for x in fallback) / len(fallback), sum(x[1] for x in fallback) / len(fallback)
    return None

def _format_centroid(point: tuple[float, float] | None) -> str:
    if not point: return ""
    lat, lon = point
    if not (24.0 <= lat <= 31.5 and -88.0 <= lon <= -79.5): return ""
    return f"{lat:.6f}, {lon:.6f}"

def _haversine_miles(a: list[float], b: list[float]) -> float:
    lon1, lat1 = map(math.radians, [float(a[0]), float(a[1])])
    lon2, lat2 = map(math.radians, [float(b[0]), float(b[1])])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3958.7613 * 2 * math.asin(min(1.0, math.sqrt(h)))

def extract_planned_station_names(text: str) -> list[str]:
    names = []
    pattern = re.compile(
        r"\b(?:new|planned|future)\s+([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+"
        r"(?:Substation|Switchyard|Switching Station)\b", re.I,
    )
    for match in pattern.finditer(text or ""):
        name = clean_text(match.group(1)).strip(" -,:;.")
        if station_name_is_valid(name) and name.lower() not in {n.lower() for n in names}: names.append(name)
    return names

def extract_existing_station_names(text: str) -> list[str]:
    names = []
    patterns = [
        re.compile(r"\bexisting\s+([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+(?:Substation|Switchyard)\b", re.I),
        re.compile(r"\btransmission\s+bus\s+at\s+([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+(?:Substation|Switchyard)\b", re.I),
        re.compile(r"\bconnected\s+to\s+the\s+transmission\s+bus\s+at\s+([A-Z][A-Za-z0-9&'(). -]{1,45}?)\s+(?:Substation|Switchyard)\b", re.I),
    ]
    for pattern in patterns:
        for match in pattern.finditer(text or ""):
            name = clean_text(match.group(1)).strip(" -,:;.")
            if station_name_is_valid(name) and name.lower() not in {n.lower() for n in names}: names.append(name)
    return names

NAMED_LINE_PATTERNS = [
    re.compile(
        r"(?i:bifurcat(?:e|ing)|loop(?:ing)?|extending|extend|from)\s+"
        r"(?i:(?:the\s+)?(?:adjacent\s+)?(?:new\s+)?(?:FPL\s+)?)"
        r"([A-Z][A-Za-z0-9 &'().]{0,35}?)\s*[-–]\s*"
        r"([A-Z][A-Za-z0-9 &'().]{0,35}?)\s+(\d{2,3})\s*(?i:kV)\s+(?i:(?:transmission\s+)?line)\b"
    ),
    re.compile(
        r"\b([A-Z][A-Za-z0-9&'().]{1,22}(?:\s+[A-Z][A-Za-z0-9&'().]{1,22}){0,3})\s*[-–]\s*"
        r"([A-Z][A-Za-z0-9&'().]{1,22}(?:\s+[A-Z][A-Za-z0-9&'().]{1,22}){0,3})\s+"
        r"(\d{2,3})\s*(?i:kV)\s+(?i:(?:transmission\s+)?line)\b"
    ),
]

def _clean_named_line_endpoint(value: str) -> str:
    value = clean_text(value).strip(" -,:;.")
    value = re.sub(r"^(?:FPL|DEF|Duke Energy Florida)\s+", "", value, flags=re.I)
    navigation_words = {"search", "office", "coordination", "division", "home", "water", "plant", "project", "projects", "program", "content", "menu"}
    tokens = value.split()
    if any(t.lower() in navigation_words for t in tokens[:-1]): return ""
    return value if station_name_is_valid(value) else ""

def extract_named_transmission_lines(text: str) -> list[tuple[str, str, float]]:
    out = []; seen = set()
    for pattern in NAMED_LINE_PATTERNS:
        for match in pattern.finditer(text or ""):
            a, b, voltage = _clean_named_line_endpoint(match.group(1)), _clean_named_line_endpoint(match.group(2)), float(match.group(3))
            if a and b and a.lower() != b.lower():
                key = tuple(sorted([a.lower(), b.lower()])) + (voltage,)
                if key not in seen:
                    seen.add(key); out.append((a, b, voltage))
    return out

def _arcgis_geojson(session: requests.Session, url: str, params: dict) -> dict | None:
    try:
        response = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict) and payload.get("error"): return None
        return payload if isinstance(payload, dict) else None
    except (requests.RequestException, ValueError): return None

def _flatten_line_parts(geometry: dict | None) -> list[list[list[float]]]:
    if not geometry: return []
    gtype = geometry.get("type"); coords = geometry.get("coordinates") or []
    if gtype == "LineString": return [coords] if len(coords) >= 2 else []
    if gtype == "MultiLineString": return [line for line in coords if len(line) >= 2]
    return []

def _point_segment_distance_miles(point: list[float], a: list[float], b: list[float]) -> float:
    lon0, lat0 = float(point[0]), float(point[1])
    mean_lat = math.radians((float(a[1]) + float(b[1]) + lat0) / 3.0)
    xscale = 69.172 * max(0.2, math.cos(mean_lat))
    yscale = 69.0
    ax, ay = (float(a[0]) - lon0) * xscale, (float(a[1]) - lat0) * yscale
    bx, by = (float(b[0]) - lon0) * xscale, (float(b[1]) - lat0) * yscale
    vx, vy = bx - ax, by - ay
    denom = vx * vx + vy * vy
    if denom <= 1e-12: return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax * vx + ay * vy) / denom))
    qx, qy = ax + t * vx, ay + t * vy
    return math.hypot(qx, qy)

def _point_to_line_distance_miles(point: list[float], geometry: dict | None) -> float:
    best = float("inf")
    for line in _flatten_line_parts(geometry):
        for a, b in zip(line, line[1:]): best = min(best, _point_segment_distance_miles(point, a, b))
    return best

def _feature_identity(feature: dict | None) -> tuple:
    if not feature: return ()
    props = feature.get("properties") or {}
    for key in ("GlobalID", "GLOBALID", "OBJECTID", "ID", "OSM_ID"):
        value = props.get(key)
        if value not in (None, ""): return (str(key).upper(), str(value))
    point = _point_from_feature(feature)
    if point: return ("POINT", round(point[0], 6), round(point[1], 6))
    return ("NAME", _normalize_station_name(_feature_name(feature)).lower())

def _overpass_json(session: requests.Session, query: str) -> dict | None:
    for url in OVERPASS_API_URLS:
        try:
            response = session.post(url, data={"data": query}, timeout=25, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict): return payload
        except (requests.RequestException, ValueError): continue
    return None

def _osm_regex(value: str) -> str:
    value = clean_text(value); escaped = re.escape(value)
    return escaped.replace(r"\ ", " ").replace(r"\&", "&").replace(r"\'", "'").replace(r'\"', r'\\"')

def _osm_element_geometry(element: dict) -> dict | None:
    etype = element.get("type")
    if etype == "node" and "lon" in element and "lat" in element:
        return {"type": "Point", "coordinates": [float(element["lon"]), float(element["lat"])]}
    geometry = element.get("geometry") or []; coords = []
    for p in geometry:
        if "lon" in p and "lat" in p: coords.append([float(p["lon"]), float(p["lat"])])
    if len(coords) >= 2: return {"type": "LineString", "coordinates": coords}
    center = element.get("center") or {}
    if "lon" in center and "lat" in center: return {"type": "Point", "coordinates": [float(center["lon"]), float(center["lat"])]}
    if len(coords) == 1: return {"type": "Point", "coordinates": coords[0]}
    return None

def _osm_feature(element: dict) -> dict | None:
    geometry = _osm_element_geometry(element)
    if not geometry: return None
    tags = element.get("tags") or {}
    props = {
        "NAME": clean_text(str(tags.get("name") or tags.get("ref") or "")),
        "OWNER": clean_text(str(tags.get("operator") or tags.get("owner") or "")),
        "VOLTAGE": clean_text(str(tags.get("voltage") or "")),
        "OSM_ID": f"{element.get('type')}:{element.get('id')}",
        "OSM_POWER": clean_text(str(tags.get("power") or "")),
    }
    return {"type": "Feature", "properties": props, "geometry": geometry}

def _osm_voltage_kv(value) -> float:
    text = clean_text(str(value or ""))
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match: return 0.0
    v = float(match.group(0))
    return v / 1000.0 if v > 2000 else v

def _osm_operator_pattern(company: str) -> str:
    aliases = [a for a in _utility_aliases(company) if a]
    if not aliases: return ""
    return "|".join(_osm_regex(a) for a in aliases)

def _load_osm_utility_substations(session: requests.Session, company: str) -> list[dict]:
    key = clean_text(company).lower()
    found, cached = get_cache("osm_utility", key)
    if found: return cached

    operator_pattern = _osm_operator_pattern(company)
    if not operator_pattern:
        set_cache("osm_utility", key, [])
        return []

    s, w, n, e = FLORIDA_BBOX
    query = f"""[out:json][timeout:30];
(nwr["power"="substation"]["operator"~"{operator_pattern}",i]({s},{w},{n},{e}););
out center tags geom 2000;"""
    payload = _overpass_json(session, query) or {}
    features = []
    for element in payload.get("elements", []):
        feature = _osm_feature(element)
        if not feature: continue
        if feature.get("geometry", {}).get("type") != "Point":
            center = _geometry_centroid(feature.get("geometry"))
            if center: feature["geometry"] = {"type": "Point", "coordinates": [center[1], center[0]]}
        if _point_from_feature(feature): features.append(feature)

    set_cache("osm_utility", key, features)
    return features

def _score_osm_station_feature(feature: dict, target: str, voltage: float, company: str) -> float:
    props = feature.get("properties") or {}
    candidate = _normalize_station_name(str(props.get("NAME") or ""))
    if not candidate: return 0.0
    name_score = SequenceMatcher(None, target.lower(), candidate.lower()).ratio()
    if name_score < 0.72: return 0.0
    score = 0.76 * name_score
    owner = clean_text(str(props.get("OWNER") or "")).lower()
    if owner and any(alias in owner for alias in _utility_aliases(company)): score += 0.14
    got_v = _osm_voltage_kv(props.get("VOLTAGE"))
    if voltage and got_v:
        if abs(got_v - voltage) <= 1: score += 0.10
        elif abs(got_v - voltage) <= 25: score += 0.05
    return min(1.0, score)

def query_osm_substation(session: requests.Session, station_name: str, voltage: float = 0.0, company: str = "") -> dict | None:
    target = _normalize_station_name(station_name)
    if not target: return None
    cache_key = (target.lower(), float(voltage or 0), clean_text(company).lower())

    found, cached = get_cache("osm_substation", cache_key)
    if found: return cached

    candidates = []
    for feature in _load_osm_utility_substations(session, company):
        score = _score_osm_station_feature(feature, target, voltage, company)
        if score > 0:
            feature["_match_score"] = score
            candidates.append((score, feature))
    candidates.sort(key=lambda x: x[0], reverse=True)
    if candidates and candidates[0][0] >= 0.68:
        result = candidates[0][1]
        set_cache("osm_substation", cache_key, result)
        return result

    s, w, n, e = FLORIDA_BBOX
    pattern = _osm_regex(target)
    query = f"""[out:json][timeout:25];
(nwr["power"="substation"]["name"~"{pattern}",i]({s},{w},{n},{e}););
out center tags geom 80;"""
    payload = _overpass_json(session, query) or {}
    for element in payload.get("elements", []):
        feature = _osm_feature(element)
        if not feature: continue
        if feature.get("geometry", {}).get("type") != "Point":
            center = _geometry_centroid(feature.get("geometry"))
            if center: feature["geometry"] = {"type": "Point", "coordinates": [center[1], center[0]]}
        score = _score_osm_station_feature(feature, target, voltage, company)
        if score > 0:
            feature["_match_score"] = score
            candidates.append((score, feature))

    candidates.sort(key=lambda x: x[0], reverse=True)
    result = candidates[0][1] if candidates and candidates[0][0] >= 0.68 else None
    set_cache("osm_substation", cache_key, result)
    return result

def _resolve_station_asset(session: requests.Session, station_name: str, counties: str, voltage: float, company: str) -> tuple[dict | None, str, str]:
    feature = query_hifld_substation(session, station_name, counties, voltage, company)
    if feature and _point_from_feature(feature): return feature, HIFLD_SUBSTATIONS_LAYER_URL, "HIFLD"
    feature = query_osm_substation(session, station_name, voltage, company)
    if feature and _point_from_feature(feature): return feature, OSM_SOURCE_LABEL, "OSM"
    return None, "", ""

def query_osm_transmission_line_between(session: requests.Session, point_a: list[float], point_b: list[float], voltage: float = 0.0, company: str = "") -> dict | None:
    if not point_a or not point_b: return None
    key_points = tuple(round(x, 4) for x in point_a + point_b)
    cache_key = (key_points, float(voltage or 0), clean_text(company).lower())

    found, cached = get_cache("osm_line", cache_key)
    if found: return cached

    pad = 0.10
    south, north = min(point_a[1], point_b[1]) - pad, max(point_a[1], point_b[1]) + pad
    west, east = min(point_a[0], point_b[0]) - pad, max(point_a[0], point_b[0]) + pad
    query = f"""[out:json][timeout:30];
(way["power"="line"]({south},{west},{north},{east});
relation["power"="line"]({south},{west},{north},{east}););
out tags geom 1200;"""
    payload = _overpass_json(session, query) or {}
    scored = []
    aliases = _utility_aliases(company)
    for element in payload.get("elements", []):
        feature = _osm_feature(element)
        if not feature or not _flatten_line_parts(feature.get("geometry")): continue
        d1 = _point_to_line_distance_miles(point_a, feature.get("geometry"))
        d2 = _point_to_line_distance_miles(point_b, feature.get("geometry"))
        if max(d1, d2) > 8.0: continue
        proximity = max(0.0, 1.0 - (d1 + d2) / 16.0)
        props = feature.get("properties") or {}
        score = 0.78 * proximity
        got_v = _osm_voltage_kv(props.get("VOLTAGE"))
        if voltage and got_v:
            if abs(got_v - voltage) <= 1: score += 0.17
            elif abs(got_v - voltage) <= 25: score += 0.08
        owner = clean_text(str(props.get("OWNER") or "")).lower()
        if owner and any(alias in owner for alias in aliases): score += 0.05
        feature["_match_score"] = min(1.0, score)
        scored.append((feature["_match_score"], feature))

    scored.sort(key=lambda x: x[0], reverse=True)
    result = scored[0][1] if scored and scored[0][0] >= 0.56 else None
    set_cache("osm_line", cache_key, result)
    return result

def _is_administrative_address(record: ProjectRecord, address: str) -> bool:
    address = clean_text(address)
    excerpt = "" if record.source_excerpt == MISSING_TEXT else record.source_excerpt
    if not address: return True
    if ADMIN_ADDRESS_RE.search(address): return True
    if "florida dep" in record.source_name.lower() or "floridadep.gov" in record.source_url.lower():
        if "tallahassee" in address.lower() and re.search(r"Florida Department of Environmental Protection|Siting Coordination Office|Commonwealth", excerpt, re.I):
            return True
    return False

def _line_feature_score(feature: dict, a: str, b: str, voltage: float, company: str) -> float:
    props = feature.get("properties") or {}
    sub1, sub2 = clean_text(str(props.get("SUB_1") or "")), clean_text(str(props.get("SUB_2") or ""))
    target_a, target_b = _normalize_station_name(a), _normalize_station_name(b)
    s11 = SequenceMatcher(None, target_a.lower(), _normalize_station_name(sub1).lower()).ratio() if sub1 else 0
    s22 = SequenceMatcher(None, target_b.lower(), _normalize_station_name(sub2).lower()).ratio() if sub2 else 0
    s12 = SequenceMatcher(None, target_a.lower(), _normalize_station_name(sub2).lower()).ratio() if sub2 else 0
    s21 = SequenceMatcher(None, target_b.lower(), _normalize_station_name(sub1).lower()).ratio() if sub1 else 0
    endpoint_score = max((s11 + s22) / 2.0, (s12 + s21) / 2.0)
    name = clean_text(str(props.get("NAME") or "")).lower()
    if endpoint_score < 0.40 and target_a.lower() not in name and target_b.lower() not in name: return 0.0
    score = 0.70 * endpoint_score
    try: got_v = float(props.get("VOLTAGE") or 0)
    except (TypeError, ValueError): got_v = 0.0
    if voltage and got_v:
        if abs(got_v - voltage) <= 1: score += 0.20
        elif abs(got_v - voltage) <= 25: score += 0.10
    owner = clean_text(str(props.get("OWNER") or "")).lower()
    if owner and any(alias in owner for alias in _utility_aliases(company)): score += 0.10
    return min(1.0, score)

def _spatial_line_score(feature: dict, p1: list[float], p2: list[float], voltage: float, company: str) -> float:
    geometry = feature.get("geometry")
    if not _flatten_line_parts(geometry): return 0.0
    d1 = _point_to_line_distance_miles(p1, geometry)
    d2 = _point_to_line_distance_miles(p2, geometry)
    if max(d1, d2) > 10.0: return 0.0
    proximity = max(0.0, 1.0 - (d1 + d2) / 20.0)
    score = 0.78 * proximity
    props = feature.get("properties") or {}
    try: got_v = float(props.get("VOLTAGE") or 0)
    except (TypeError, ValueError): got_v = 0.0
    if voltage and got_v:
        if abs(got_v - voltage) <= 1: score += 0.17
        elif abs(got_v - voltage) <= 25: score += 0.08
    owner = clean_text(str(props.get("OWNER") or "")).lower()
    if owner and any(alias in owner for alias in _utility_aliases(company)): score += 0.05
    return min(1.0, score)

def query_hifld_transmission_line(session: requests.Session, station_a: str, station_b: str, voltage: float = 0.0, company: str = "", counties: str = "") -> dict | None:
    a, b = _normalize_station_name(station_a), _normalize_station_name(station_b)
    if not a or not b or a.lower() == b.lower(): return None
    cache_key = (a.lower(), b.lower(), float(voltage or 0), clean_text(company).lower(), clean_text(counties).lower())
    reverse_key = (b.lower(), a.lower(), float(voltage or 0), clean_text(company).lower(), clean_text(counties).lower())

    found, cached = get_cache("hifld_line", cache_key)
    if found: return cached
    found, cached = get_cache("hifld_line", reverse_key)
    if found: return cached

    fa, _, _ = _resolve_station_asset(session, a, counties, voltage, company)
    fb, _, _ = _resolve_station_asset(session, b, counties, voltage, company)
    p1, p2 = _point_from_feature(fa), _point_from_feature(fb)

    if p1 and p2 and _haversine_miles(p1, p2) > 0.05:
        pad = 0.10
        xmin, xmax = min(p1[0], p2[0]) - pad, max(p1[0], p2[0]) + pad
        ymin, ymax = min(p1[1], p2[1]) - pad, max(p1[1], p2[1]) + pad
        spatial_params = {
            "where": "1=1",
            "geometry": f"{xmin},{ymin},{xmax},{ymax}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*", "returnGeometry": "true",
            "outSR": "4326", "f": "geojson", "resultRecordCount": 1000,
        }
        payload = _arcgis_geojson(session, HIFLD_TRANSMISSION_LINES_QUERY_URL, spatial_params) or {}
        scored = [(_spatial_line_score(f, p1, p2, voltage, company), f) for f in payload.get("features", [])]
        scored = [x for x in scored if x[0] > 0]
        scored.sort(key=lambda x: x[0], reverse=True)
        if scored and scored[0][0] >= 0.56:
            best = scored[0][1]
            best["_match_score"] = scored[0][0]
            best["_source_url"] = HIFLD_TRANSMISSION_LINES_LAYER_URL
            set_cache("hifld_line", cache_key, best)
            return best

    ea, eb = _arcgis_escape(a.upper()), _arcgis_escape(b.upper())
    where = f"((SUB_1 LIKE '%{ea}%' AND SUB_2 LIKE '%{eb}%') OR (SUB_1 LIKE '%{eb}%' AND SUB_2 LIKE '%{ea}%'))"
    params = {
        "where": where, "outFields": "*", "returnGeometry": "true",
        "outSR": "4326", "f": "geojson", "resultRecordCount": 100,
    }
    payload = _arcgis_geojson(session, HIFLD_TRANSMISSION_LINES_QUERY_URL, params) or {}
    scored = [(_line_feature_score(f, a, b, voltage, company), f) for f in payload.get("features", [])]
    scored.sort(key=lambda x: x[0], reverse=True)
    if scored and scored[0][0] >= 0.58:
        best = scored[0][1]
        best["_match_score"] = scored[0][0]
        best["_source_url"] = HIFLD_TRANSMISSION_LINES_LAYER_URL
        set_cache("hifld_line", cache_key, best)
        return best

    set_cache("hifld_line", cache_key, None)
    return None

def _discover_official_links(session: requests.Session, source_url: str) -> tuple[list[str], list[str]]:
    found, cached = get_cache("official_links", source_url)
    if found: return cached

    if PDF_RE.search(source_url):
        map_links = [source_url] if re.search(r"corridor|route|map|preferred", source_url, re.I) else []
        result = ([], map_links)
        set_cache("official_links", source_url, result)
        return result

    response = fetch(session, source_url)
    if not response or "html" not in response.headers.get("content-type", "").lower():
        result = ([], [])
        set_cache("official_links", source_url, result)
        return result

    soup = BeautifulSoup(response.text, "html.parser")
    gis_links, map_links = [], []
    candidates = []
    for tag in soup.find_all(["a", "iframe", "img"]):
        raw = tag.get("href") or tag.get("src")
        if not raw: continue
        href = urljoin(source_url, raw.strip()).split("#")[0]
        label = clean_text(tag.get_text(" ", strip=True) if tag.name == "a" else (tag.get("alt") or tag.get("title") or ""))
        candidates.append((label, href))
    for raw in re.findall(r"https?://[^\s\"'<>]+", response.text):
        if re.search(r"FeatureServer|MapServer|arcgis\.com/(?:home/item|apps/|sharing/rest/content/items/)", raw, re.I):
            candidates.append(("", raw.replace("&amp;", "&")))
    for label, href in candidates:
        combined = f"{label} {href}"
        if re.search(r"FeatureServer|MapServer|\.geojson(?:$|\?)|\.kml(?:$|\?)|\.kmz(?:$|\?)", href, re.I):
            if href not in gis_links: gis_links.append(href)
        elif re.search(r"arcgis\.com/(?:home/item|apps/|sharing/rest/content/items/)", href, re.I):
            if href not in gis_links: gis_links.append(href)
        if re.search(r"corridor|preferred\s+corridor|route\s+map|project\s+map|map", combined, re.I) and re.search(r"\.pdf|\.png|\.jpe?g", href, re.I):
            if href not in map_links: map_links.append(href)

    result = (gis_links[:12], map_links[:12])
    set_cache("official_links", source_url, result)
    return result

def _extract_arcgis_item_id(url: str) -> str:
    match = re.search(r"(?:items/|\bid=)([0-9a-f]{32})", url, re.I)
    return match.group(1) if match else ""

def _resolve_arcgis_item_url(session: requests.Session, url: str) -> str:
    item_id = _extract_arcgis_item_id(url)
    if not item_id: return url
    item_url = f"https://www.arcgis.com/sharing/rest/content/items/{item_id}"
    try:
        response = session.get(item_url, params={"f": "json"}, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        return clean_text(str(payload.get("url") or url))
    except (requests.RequestException, ValueError): return url

def _kml_geometry(text: str) -> dict | None:
    try: root = ET.fromstring(text)
    except ET.ParseError: return None
    coords_nodes = root.findall(".//{*}coordinates")
    paths = []
    for node in coords_nodes:
        pts = []
        for chunk in (node.text or "").replace("\n", " ").split():
            parts = chunk.split(",")
            if len(parts) >= 2:
                try: lon, lat = float(parts[0]), float(parts[1])
                except ValueError: continue
                if 24 <= lat <= 31.5 and -88 <= lon <= -79.5: pts.append([lon, lat])
        if len(pts) >= 2: paths.append(pts)
        elif len(pts) == 1: return {"type": "Point", "coordinates": pts[0]}
    if len(paths) == 1: return {"type": "LineString", "coordinates": paths[0]}
    if len(paths) > 1: return {"type": "MultiLineString", "coordinates": paths}
    return None

def _official_feature_score(feature: dict, record: ProjectRecord) -> float:
    props = feature.get("properties") or {}
    hay = normalize_name(" ".join(str(v) for v in props.values() if v is not None))
    name_tokens = [t for t in normalize_name(record.project_name).split() if len(t) >= 5 and t not in {"transmission", "project", "substation", "energy", "center"}]
    score = sum(1.0 for t in name_tokens[:8] if t in hay)
    for station in [record.starting_substation, record.ending_substation]:
        st = normalize_name(station)
        if st and st != "na" and st in hay: score += 2.0
    case = normalize_name(record.regulatory_case_number)
    if case and case != "na" and case in hay: score += 3.0
    return score

def _geometry_from_geojson_payload(payload: dict, record: ProjectRecord) -> dict | None:
    if not isinstance(payload, dict): return None
    if payload.get("type") in {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"}:
        return payload
    features = payload.get("features") if payload.get("type") == "FeatureCollection" else None
    if not features and payload.get("type") == "Feature": return payload.get("geometry")
    if not features: return None
    usable = [f for f in features if f.get("geometry")]
    if len(usable) == 1: return usable[0].get("geometry")
    scored = [(_official_feature_score(f, record), f) for f in usable]
    scored.sort(key=lambda x: x[0], reverse=True)
    if scored and scored[0][0] >= 2.0: return scored[0][1].get("geometry")
    return None

def _fetch_official_geometry(session: requests.Session, link: str, record: ProjectRecord) -> dict | None:
    link = _resolve_arcgis_item_url(session, link)
    lower = link.lower().split("?")[0]
    try:
        if lower.endswith(".geojson"):
            response = session.get(link, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return _geometry_from_geojson_payload(response.json(), record)
        if lower.endswith(".kml"):
            response = session.get(link, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            return _kml_geometry(response.text)
        if lower.endswith(".kmz"):
            response = session.get(link, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
                if names: return _kml_geometry(zf.read(names[0]).decode("utf-8", errors="ignore"))
        if re.search(r"/(?:FeatureServer|MapServer)/\d+/?$", link, re.I):
            query_url = link.rstrip("/") + "/query"
            payload = _arcgis_geojson(session, query_url, {
                "where": "1=1", "outFields": "*", "returnGeometry": "true",
                "outSR": "4326", "f": "geojson", "resultRecordCount": 2000,
            })
            return _geometry_from_geojson_payload(payload or {}, record)
    except (requests.RequestException, ValueError, zipfile.BadZipFile): return None
    return None

def _official_map_geometry(session: requests.Session, map_url: str) -> dict | None:
    if not PDF_RE.search(map_url): return None
    response = fetch(session, map_url)
    if not response: return None
    texts = [d.text for d in pdf_to_documents(response.content, map_url)]
    pairs = []
    for text in texts:
        for match in COORD_PAIR_RE.finditer(text or ""):
            lat = float(match.group("lat"))
            lon = float(match.group("lon"))
            if match.group("lat_hemi") and match.group("lat_hemi").upper() == "S": lat = -abs(lat)
            if match.group("lon_hemi") and match.group("lon_hemi").upper() == "W": lon = -abs(lon)
            if 24 <= lat <= 31.5 and -88 <= lon <= -79.5 and [lon, lat] not in pairs:
                pairs.append([lon, lat])
    if len(pairs) >= 2: return {"type": "LineString", "coordinates": pairs}
    if len(pairs) == 1: return {"type": "Point", "coordinates": pairs[0]}
    return None

def geocode_address(session: requests.Session, address: str) -> tuple[tuple[float, float] | None, str]:
    address = clean_text(address)
    if not address or address == MISSING_TEXT or BAD_ADDRESS_RE.search(address): return None, ""
    query = address if re.search(r"\b(?:Florida|FL)\b", address, re.I) else address + ", Florida"
    params = {"address": query, "benchmark": "Public_AR_Current", "format": "json"}
    try:
        response = session.get(CENSUS_GEOCODER_URL, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        matches = response.json().get("result", {}).get("addressMatches", [])
    except (requests.RequestException, ValueError): return None, ""
    if not matches: return None, ""
    coords = matches[0].get("coordinates") or {}
    try: lon, lat = float(coords.get("x")), float(coords.get("y"))
    except (TypeError, ValueError): return None, ""
    if not (24.0 <= lat <= 31.5 and -88.0 <= lon <= -79.5): return None, ""
    return (lat, lon), clean_text(str(matches[0].get("matchedAddress") or query))

def detect_cities(text: str) -> list[str]:
    out = []
    for match in re.finditer(r"\bCity of\s+([A-Z][A-Za-z .'-]{2,40}?)(?=\s+(?:and|in|within|County)\b|[,;.]|$)", text or ""):
        city = clean_text(match.group(1))
        if city and city.lower() not in {x.lower() for x in out}: out.append(city)
    return out

def _tiger_centroid(session: requests.Session, kind: str, name: str) -> tuple[float, float] | None:
    key = (kind, clean_text(name).lower())
    found, cached = get_cache("tiger", key)
    if found: return cached

    if kind == "county":
        clean_name = re.sub(r"\s+County$", "", clean_text(name), flags=re.I)
        url = TIGER_COUNTY_QUERY_URL
        where = f"STATE='12' AND NAME='{_arcgis_escape(clean_name)}'"
    else:
        clean_name = clean_text(name)
        url = TIGER_PLACE_QUERY_URL
        where = f"GEOID LIKE '12%' AND BASENAME='{_arcgis_escape(clean_name)}'"

    payload = _arcgis_geojson(session, url, {
        "where": where, "outFields": "*", "returnGeometry": "true",
        "outSR": "4326", "f": "geojson", "resultRecordCount": 20,
    }) or {}
    features = payload.get("features", [])
    point = _geometry_centroid(features[0].get("geometry")) if features else None

    set_cache("tiger", key, point)
    return point

def _set_gis_location(record: ProjectRecord, geometry: dict, method: str, source: str,
                      confidence: str, spatial_role: str, evidence: str) -> ProjectRecord:
    record.gis = _geojson_compact(geometry)
    record.centroid = _format_centroid(_geometry_centroid(geometry)) or MISSING_TEXT
    record.location_method = method
    record.gis_source = source
    record.location_confidence = confidence
    record.spatial_role = spatial_role
    record.location_evidence = missing_text(evidence)

    if "centroid_estimate" in spatial_role or "centroid_fallback" in method:
        record.is_regional_fallback = "yes"
    else:
        record.is_regional_fallback = "no"

    if "synthetic" in method or "derived" in method or "inferred" in method:
        record.gis_provenance = "Interp"
    elif "fallback" in method:
        record.gis_provenance = "NA"
    else:
        record.gis_provenance = "Document Provided"

    return record

# ---------------- Two-Wave Geoparsing System ----------------

def _enrich_record_regex_wave1(session: requests.Session, record: ProjectRecord) -> ProjectRecord:
    excerpt = "" if record.source_excerpt == MISSING_TEXT else record.source_excerpt
    counties = "" if record.counties_crossed == MISSING_TEXT else record.counties_crossed
    company = "" if record.planning_company == MISSING_TEXT else record.planning_company
    start = "" if record.starting_substation == MISSING_TEXT else record.starting_substation
    end = "" if record.ending_substation == MISSING_TEXT else record.ending_substation
    discovered_gis, discovered_maps = _discover_official_links(session, record.source_url)

    for link in discovered_gis:
        geometry = _fetch_official_geometry(session, link, record)
        if geometry and _geometry_centroid(geometry):
            return _set_gis_location(
                record, geometry, "official_project_gis", link, "high",
                "official_project_geometry", f"Official source linked project GIS: {link}",
            )

    lat, lon = detect_coordinates(excerpt)
    if lat and lon:
        return _set_gis_location(
            record, {"type": "Point", "coordinates": [lon, lat]},
            "official_source_coordinate", record.source_url, "high",
            "official_project_coordinate", "Official source published explicit coordinates.",
        )

    planned_names = extract_planned_station_names(excerpt)
    structured = [x for x in [start, end] if x]
    planned_lower = {p.lower() for p in planned_names}

    planned_candidates = planned_names + [x for x in structured if x.lower() in planned_lower]
    seen_planned = set()
    for name in planned_candidates:
        if name.lower() in seen_planned: continue
        seen_planned.add(name.lower())
        feature = query_hifld_substation(session, name, counties, record.voltage_kv, company)
        if feature and _feature_exact_station_match(feature, name):
            point = _point_from_feature(feature)
            if point:
                return _set_gis_location(
                    record, {"type": "Point", "coordinates": point},
                    "hifld_exact_planned_facility", HIFLD_SUBSTATIONS_LAYER_URL, "high",
                    "exact_planned_facility", f"Exact HIFLD facility match: {_feature_name(feature)}",
                )
        osm = query_osm_substation(session, name, record.voltage_kv, company)
        if osm and _feature_exact_station_match(osm, name):
            point = _point_from_feature(osm)
            if point:
                return _set_gis_location(
                    record, {"type": "Point", "coordinates": point},
                    "osm_exact_planned_facility", OSM_SOURCE_LABEL, "medium",
                    "exact_planned_facility", f"Exact OpenStreetMap substation match: {_feature_name(osm)}",
                )

    existing_candidates = extract_existing_station_names(excerpt)
    existing_candidates.extend(x for x in structured if x.lower() not in planned_lower)
    existing_candidates.extend(
        x for x in extract_station_names(excerpt)
        if x.lower() not in planned_lower and x.lower() not in {n.lower() for n in existing_candidates}
    )
    matched_existing = []; seen_assets = set()
    for name in existing_candidates[:12]:
        feature, source, provider = _resolve_station_asset(session, name, counties, record.voltage_kv, company)
        point = _point_from_feature(feature)
        ident = _feature_identity(feature)
        if not feature or not point or not ident or ident in seen_assets: continue
        if any(_haversine_miles(point, old[2]) < 0.03 for old in matched_existing): continue
        seen_assets.add(ident); matched_existing.append((name, feature, point, source, provider))
        if len(matched_existing) >= 4: break

    named_lines = extract_named_transmission_lines(excerpt)

    for a, b, voltage in named_lines:
        line_voltage = voltage or record.voltage_kv
        feature = query_hifld_transmission_line(session, a, b, line_voltage, company, counties)
        geometry = (feature or {}).get("geometry")
        if geometry and _geometry_centroid(geometry):
            score = float(feature.get("_match_score") or 0)
            return _set_gis_location(
                record, geometry, "hifld_named_transmission_line",
                str(feature.get("_source_url") or HIFLD_TRANSMISSION_LINES_LAYER_URL),
                "high" if score >= 0.80 else "medium", "existing_transmission_line_anchor",
                f"Spatially matched named line: {a}-{b} {int(line_voltage)} kV; HIFLD score={score:.2f}",
            )

        fa, _, _ = _resolve_station_asset(session, a, counties, line_voltage, company)
        fb, _, _ = _resolve_station_asset(session, b, counties, line_voltage, company)
        pa, pb = _point_from_feature(fa), _point_from_feature(fb)
        if pa and pb and _haversine_miles(pa, pb) > 0.05:
            osm_line = query_osm_transmission_line_between(session, pa, pb, line_voltage, company)
            geometry = (osm_line or {}).get("geometry")
            if geometry and _geometry_centroid(geometry):
                score = float(osm_line.get("_match_score") or 0)
                return _set_gis_location(
                    record, geometry, "osm_named_transmission_line", OSM_SOURCE_LABEL,
                    "medium" if score >= 0.68 else "low", "existing_transmission_line_anchor",
                    f"OpenStreetMap power=line matched between {a} and {b} ({int(line_voltage)} kV); score={score:.2f}",
                )

    for a, b, voltage in named_lines:
        line_voltage = voltage or record.voltage_kv
        fa, source_a, _ = _resolve_station_asset(session, a, counties, line_voltage, company)
        fb, source_b, _ = _resolve_station_asset(session, b, counties, line_voltage, company)
        pa, pb = _point_from_feature(fa), _point_from_feature(fb)
        if pa and pb and _feature_identity(fa) != _feature_identity(fb) and _haversine_miles(pa, pb) > 0.05:
            sources = "; ".join(dict.fromkeys(x for x in [source_a, source_b] if x))
            return _set_gis_location(
                record, {"type": "LineString", "coordinates": [pa, pb]},
                "synthetic_facility_corridor", sources or HIFLD_SUBSTATIONS_LAYER_URL,
                "medium", "estimated_corridor_line",
                f"Synthesized linear corridor connecting terminal facilities {a} and {b}.",
            )

    if len(matched_existing) >= 2:
        a, b = matched_existing[0], matched_existing[1]
        if _feature_identity(a[1]) != _feature_identity(b[1]) and _haversine_miles(a[2], b[2]) > 0.05:
            geometry = {"type": "LineString", "coordinates": [a[2], b[2]]}
            min_score = min(float(a[1].get("_match_score") or 0), float(b[1].get("_match_score") or 0))
            sources = "; ".join(dict.fromkeys([a[3], b[3]]))
            return _set_gis_location(
                record, geometry, "derived_existing_endpoint_pair",
                sources, "high" if min_score >= 0.85 else "medium", "existing_endpoint_anchor",
                f"Distinct existing endpoint assets: {_feature_name(a[1])}; {_feature_name(b[1])}",
            )

    if matched_existing:
        name, feature, point, source, provider = matched_existing[0]
        return _set_gis_location(
            record, {"type": "Point", "coordinates": point},
            "hifld_existing_endpoint" if provider == "HIFLD" else "osm_existing_endpoint",
            source, "medium" if provider == "HIFLD" else "low", "existing_endpoint_anchor",
            f"Existing {provider} connection asset: {_feature_name(feature) or name}",
        )

    map_note = ""
    for map_url in discovered_maps:
        geometry = _official_map_geometry(session, map_url)
        if geometry and _geometry_centroid(geometry):
            return _set_gis_location(
                record, geometry, "official_map_derived", map_url, "medium",
                "official_map_derived",
                f"Geometry derived from coordinates printed in official project/corridor map: {map_url}",
            )
        if not map_note: map_note = f"Official map found but not machine-georeferenceable: {map_url}"

    if record.address != MISSING_TEXT:
        if _is_administrative_address(record, record.address):
            record.address = MISSING_TEXT
        else:
            point, matched = geocode_address(session, record.address)
            if point:
                lat, lon = point
                geom = {"type": "Point", "coordinates": [lon, lat]}
                record = _set_gis_location(
                    record, geom, "address_geocode", "U.S. Census Geocoder",
                    "medium", "geocoded_address",
                    (map_note + "; " if map_note else "") + "Validated project-specific street-address geocode."
                )
                if matched: record.address = matched
                return record

    cities = detect_cities(excerpt)
    for city in cities[:3]:
        point = _tiger_centroid(session, "city", city)
        if point and _format_centroid(point):
            lat, lon = point
            geom = {"type": "Point", "coordinates": [lon, lat]}
            return _set_gis_location(
                record, geom, "city_centroid_fallback", TIGER_PLACE_QUERY_URL.rsplit("/query", 1)[0],
                "low", "city_centroid_estimate",
                (map_note + "; " if map_note else "") + f"Census TIGERweb city centroid: {city}"
            )

    county_names = [c.strip() for c in counties.split(";") if c.strip() and c.strip().lower().endswith("county")]
    county_points = []
    for county in county_names[:8]:
        point = _tiger_centroid(session, "county", county)
        if point: county_points.append((county, point))
    if county_points:
        lat = sum(p[1][0] for p in county_points) / len(county_points)
        lon = sum(p[1][1] for p in county_points) / len(county_points)
        geom = {"type": "Point", "coordinates": [lon, lat]}
        return _set_gis_location(
            record, geom, "county_centroid_fallback", TIGER_COUNTY_QUERY_URL.rsplit("/query", 1)[0],
            "low", "county_centroid_estimate",
            (map_note + "; " if map_note else "") + "Census TIGERweb county centroid(s): " + "; ".join(x[0] for x in county_points)
        )

    record.gis = MISSING_TEXT
    record.centroid = MISSING_TEXT
    record.location_method = MISSING_TEXT
    record.gis_source = MISSING_TEXT
    record.location_confidence = "none"
    record.spatial_role = MISSING_TEXT
    record.location_evidence = missing_text(map_note)
    record.is_regional_fallback = "yes"
    record.gis_provenance = "NA"
    return record


def web_search_duckduckgo(query: str, limit: int = 5) -> str:
    """Perform a local, free web search to decouple scraping from the LLM quota."""
    if not HAS_DDGS:
        return "DuckDuckGo library missing. Unable to perform search."

    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=limit):
                results.append(
                    f"Title: {r.get('title', '')}\n"
                    f"Snippet: {r.get('body', '')}\n"
                    f"URL: {r.get('href', '')}\n"
                )
    except Exception as exc:
        logging.warning("DuckDuckGo search failed for '%s': %s", query, exc)

    if not results:
        return "No search results found."
    return "\n---\n".join(results)


def _execute_gemini_wave2(record: ProjectRecord) -> ProjectRecord:
    if not HAS_GENAI:
        logging.warning("google-genai SDK not installed. Skipping Wave 2 AI search.")
        return record
    if not os.environ.get("GEMINI_API_KEY"):
        logging.warning("GEMINI_API_KEY not found. Skipping Wave 2 AI search.")
        return record

    # 1. Perform the web search locally FIRST (costs 0 tokens, hits 0 Gemini quotas)
    search_query = f"{record.project_name} {record.planning_company} {record.counties_crossed} Florida substation coordinates"
    search_results_text = web_search_duckduckgo(search_query)

    # 2. Inject the local search results into a standard text prompt
    client = genai.Client()
    config = types.GenerateContentConfig(
        temperature=0.0,
        response_mime_type="application/json"
    )

    prompt = f"""
    You are an expert geospatial analyst. I have scraped the following web search results regarding a Florida electric grid project.
    Review the snippets carefully to find exact geographic coordinates (latitude and longitude) or specific property appraiser records.

    Project Info:
    Name: {record.project_name}
    Company: {record.planning_company}
    Counties: {record.counties_crossed}
    Substations: {record.starting_substation} to {record.ending_substation}

    Web Search Snippets:
    {search_results_text}

    Return ONLY valid JSON matching this schema:
    {{
        "found": true or false,
        "lat": float (between 24.0 and 31.5, or 0.0 if found is false),
        "lon": float (between -88.0 and -79.5, or 0.0 if found is false),
        "provenance": "Purchase" or "Permit" or "Document Provided",
        "evidence": "String detailing the specific source, permit number, or property record found in the snippets."
    }}
    """

    max_retries = 5
    base_delay = 2.0
    model_name = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config
            )

            text = response.text.strip()
            if text.startswith("```json"): text = text[7:-3].strip()
            elif text.startswith("```"): text = text[3:-3].strip()

            result = json.loads(text)

            if result.get("found") and isinstance(result.get("lat"), (float, int)) and isinstance(result.get("lon"), (float, int)):
                lat = float(result["lat"])
                lon = float(result["lon"])
                if 24.0 <= lat <= 31.5 and -88.0 <= lon <= -79.5:
                    geom = {"type": "Point", "coordinates": [lon, lat]}
                    record.gis = json.dumps(geom, separators=(",", ":"), ensure_ascii=False)
                    record.centroid = f"{lat:.6f}, {lon:.6f}"
                    record.location_method = "llm_parsing_local_search"
                    record.gis_source = "DuckDuckGo + Gemini Extraction"
                    record.location_confidence = "medium"
                    record.spatial_role = "llm_grounded_coordinate"
                    record.location_evidence = missing_text(result.get("evidence", ""))
                    record.gis_provenance = str(result.get("provenance", "Document Provided"))
                    record.is_regional_fallback = "no"

            # Pacing throttle to honor standard API quotas
            time.sleep(2.0) 
            break

        except Exception as e:
            error_msg = str(e).lower()
            if "429" in error_msg or "quota" in error_msg or "resource_exhausted" in error_msg:
                if attempt < max_retries - 1:
                    sleep_time = (base_delay ** attempt) + random.uniform(0.1, 1.0)
                    logging.warning("Gemini API rate limit hit (429). Retrying in %.2fs (Attempt %d/%d)...", sleep_time, attempt + 1, max_retries)
                    time.sleep(sleep_time)
                else:
                    logging.error("Gemini API rate limit failed after %d retries for %s.", max_retries, record.project_id)
            else:
                logging.debug("Gemini extraction failed for %s: %s", record.project_id, e)
                break

    return record


def enrich_record_with_location(session: requests.Session, record: ProjectRecord) -> ProjectRecord:
    record = _enrich_record_regex_wave1(session, record)
    if record.is_regional_fallback == "yes" or record.gis_provenance == "NA":
        record = _execute_gemini_wave2(record)
    return record

# ---------------- File Writing / Pipeline ----------------

def format_cell(field: str, value) -> str:
    if field in NUMERIC_FIELDS:
        try: number = float(value or 0)
        except (TypeError, ValueError): number = 0.0
        if field == "record_confidence": return f"{number:.3f}"
        if not number: return "0"
        if field in {"projected_year", "source_page"}: return str(int(number))
        if float(number).is_integer(): return str(int(number))
        return f"{number:.4f}".rstrip("0").rstrip(".")
    if field in {"project_id", "first_seen", "last_seen"}: return clean_text(str(value or ""))
    if field == "active": return clean_text(str(value or "")) or "yes"
    return missing_text(str(value or ""))

def prepare_row(record_or_row) -> dict:
    row = asdict(record_or_row) if isinstance(record_or_row, ProjectRecord) else dict(record_or_row)
    return {field: format_cell(field, row.get(field, "")) for field in CSV_FIELDS}

def quality_score(record: ProjectRecord) -> float:
    score = record.record_confidence * 100
    if has_value(record.gis): score += 40
    elif has_value(record.centroid): score += 20
    score += sum(2 for field in [
        record.starting_substation, record.ending_substation, record.counties_crossed,
        record.regulatory_case_number, record.filing_dates,
    ] if has_value(field))
    return score

def dedupe_records(records: list[ProjectRecord]) -> list[ProjectRecord]:
    best: dict[str, ProjectRecord] = {}
    for record in records:
        current = best.get(record.project_id)
        if current is None or quality_score(record) > quality_score(current):
            best[record.project_id] = record
    return list(best.values())

def load_existing(path: Path) -> dict[str, dict]:
    if not path.exists(): return {}
    rows: dict[str, dict] = {}
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            key = row.get("project_id", "")
            if key: rows[key] = row
    return rows

def merge_and_write(path: Path, records: list[ProjectRecord]) -> tuple[int, int]:
    old = load_existing(path)
    seen: set[str] = set()
    added = 0
    for record in records:
        seen.add(record.project_id)
        row = prepare_row(record)
        if record.project_id in old: row["first_seen"] = old[record.project_id].get("first_seen") or row["first_seen"]
        else: added += 1
        old[record.project_id] = row
    for key, row in old.items():
        if key not in seen: row["active"] = "not_seen_latest_run"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in sorted(old.values(), key=lambda r: (r.get("planning_company", ""), r.get("projected_year", ""), r.get("project_name", ""))):
            writer.writerow({field: row.get(field, MISSING_TEXT) for field in CSV_FIELDS})
    return added, len(old)

def write_review(path: Path, records: list[ProjectRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for record in sorted(records, key=lambda r: (r.source_name, -r.record_confidence, r.project_name)):
            writer.writerow(prepare_row(record))

def save_snapshot(snapshot_dir: Path, source_name: str, doc: SourceDocument) -> None:
    day = datetime.now().strftime("%Y-%m-%d")
    safe_source = re.sub(r"[^A-Za-z0-9._-]+", "_", source_name)[:60]
    url_hash = hashlib.sha1(doc.url.encode("utf-8")).hexdigest()[:10]
    folder = snapshot_dir / day
    folder.mkdir(parents=True, exist_ok=True)
    page = f"_p{doc.page_number:04d}" if doc.page_number else ""
    path = folder / f"{safe_source}_{url_hash}{page}.txt"
    path.write_text(f"SOURCE URL: {doc.url}\nPAGE: {doc.page_number}\n\n{doc.text}", encoding="utf-8")

def run_once(output: Path, review_output: Path, snapshot_dir: Path, min_confidence: float, no_gis: bool = False) -> None:
    now = utc_now()
    session = get_session()
    accepted: list[ProjectRecord] = []
    review: list[ProjectRecord] = []

    for source in sorted(SOURCES, key=lambda s: s.get("gis_priority", 0), reverse=True):
        logging.info("Starting source: %s", source["name"])
        docs = crawl_source(session, source)
        logging.info("  Retrieved %d page/document(s)", len(docs))
        source_accepted = source_review = 0
        for doc in docs:
            save_snapshot(snapshot_dir, source["name"], doc)
            candidates = extract_records(source, doc, now)
            for record in candidates:
                score, reason = validate_record(record)
                record.record_confidence = score
                record.review_reason = missing_text(reason)
                if score >= min_confidence:
                    if not no_gis: record = enrich_record_with_location(session, record)
                    accepted.append(record)
                    source_accepted += 1
                else:
                    review.append(record)
                    source_review += 1
        logging.info("  Accepted %d; review %d", source_accepted, source_review)

    accepted = dedupe_records(accepted)
    review = dedupe_records(review)
    added, total = merge_and_write(output, accepted)
    write_review(review_output, review)
    logging.info("Finished: %d accepted (%d new; %d total historical rows), %d quarantined to %s", len(accepted), added, total, len(review), review_output)

def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor Florida future transmission/substation plans.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--review-output", type=Path, default=DEFAULT_REVIEW_OUTPUT)
    parser.add_argument("--snapshots", type=Path, default=DEFAULT_SNAPSHOT_DIR)
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
    parser.add_argument("--no-gis", action="store_true", help="Skip GIS enrichment.")
    parser.add_argument("--fresh", action="store_true", help="Rebuild output from scratch.")
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()

    logging.basicConfig(level=getattr(logging, args.log_level), format="%(asctime)s %(levelname)s %(message)s")
    if not 0 <= args.min_confidence <= 1: parser.error("--min-confidence must be between 0 and 1")

    if args.fresh:
        for path in (args.output, args.review_output):
            if path.exists(): path.unlink()
        logging.info("Fresh rebuild requested; prior output/review CSVs removed.")

    if not args.weekly:
        run_once(args.output, args.review_output, args.snapshots, args.min_confidence, args.no_gis)
        return
    while True:
        try: run_once(args.output, args.review_output, args.snapshots, args.min_confidence, args.no_gis)
        except Exception: logging.exception("Weekly run failed")
        time.sleep(WEEK_SECONDS)

if __name__ == "__main__":
    main()
