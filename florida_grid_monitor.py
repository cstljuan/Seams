#!/usr/bin/env python3
"""
florida_grid_monitor.py

Weekly monitor for public Florida planning_company / regulator websites that may publish
future electric transmission-line and substation projects.

The script:
1. Crawls a GIS-prioritized set of public Florida sources.
2. Extracts text from HTML and PDF documents.
3. Locates text blocks likely to describe future transmission/substation work.
4. Heuristically extracts:
   - planning_company/company
   - project name
   - starting substation
   - ending substation
   - voltage
   - approximate line mileage
   - counties crossed
   - regulatory case / docket number
   - filing dates
   - project type
   - projected year
   - cost
   - construction duration (if stated)
   - GIS geometry when a reliable public GIS match is available
   - a GIS-derived centroid (or address-geocoded centroid as fallback)
   - street address, when the source text includes one
   - projected locations
5. Merges results into a CSV while retaining first_seen / last_seen timestamps.
6. Can run once or continuously every 7 days.

This is intended as a transparent hackathon/data-science collector, not a
production regulatory-data service. Always validate high-value rows against
their source URL/source excerpt.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import logging
import re
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

USER_AGENT = (
    "FloridaGridPlanMonitor/4.0 "
    "(public-data research; weekly low-rate crawler)"
)

DEFAULT_OUTPUT = Path("florida_future_grid_projects.csv")
DEFAULT_SNAPSHOT_DIR = Path("grid_monitor_snapshots")

REQUEST_TIMEOUT = 30
RATE_LIMIT_SECONDS = 1.25
WEEK_SECONDS = 7 * 24 * 60 * 60

# Public GIS/geocoding enrichment services. These are used only to enrich
# projects discovered from the planning/regulatory sources below.
HIFLD_SUBSTATIONS_QUERY_URL = (
    "https://services1.arcgis.com/CD5mKowwN6nIaqd8/ArcGIS/rest/services/"
    "project_renewable_us_substations_2022/FeatureServer/10/query"
)
HIFLD_SUBSTATIONS_LAYER_URL = (
    "https://services1.arcgis.com/CD5mKowwN6nIaqd8/ArcGIS/rest/services/"
    "project_renewable_us_substations_2022/FeatureServer/10"
)
HIFLD_TRANSMISSION_LAYER_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/"
    "Transmission_Lines/FeatureServer/0"
)
CENSUS_GEOCODER_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
)
GIS_MATCH_THRESHOLD = 0.58

FUTURE_KEYWORDS = re.compile(
    r"\b("
    r"planned|proposed|future|projected|expected|scheduled|"
    r"construction|construct|upgrade|expansion|new|replace|rebuild|"
    r"in[- ]service|completion|complete|need date|forecast|application|petition"
    r")\b",
    re.I,
)

GRID_KEYWORDS = re.compile(
    r"\b("
    r"transmission|substation|switchyard|switching station|"
    r"\d{2,3}\s*kv|kilovolt|power line|interconnection|"
    r"reconductoring|transformer"
    r")\b",
    re.I,
)

LINK_KEYWORDS = re.compile(
    r"(transmission|substation|site.?plan|ten.?year|grid|project|"
    r"capital|budget|planning|reliability|siting|electric|"
    r"agenda|filing|docket|case|petition|application|order.?1000|btpp)",
    re.I,
)

PDF_RE = re.compile(r"\.pdf(?:$|\?)", re.I)

SOURCES = [
    # GIS-forward / strong location sources first. `gis_priority` controls crawl order.
    {
        "name": "Florida DEP - Siting Coordination Office",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://floridadep.gov/program-content/water/siting-coordination-office",
        "max_pages": 18,
        "gis_priority": 100,
        "gis_reference": "Florida DEP GIS / transmission siting records",
    },
    {
        "name": "Florida PSC - Ten-Year Site Plans",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://www.psc.state.fl.us/ten-year-site-plans",
        "max_pages": 12,
        "gis_priority": 90,
        "gis_reference": "Florida PSC service-territory mapping and filings",
    },
    {
        "name": "FPL - Transmission Projects",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/reliability/andytown-oasis-project.html",
        "max_pages": 8,
        "gis_priority": 85,
        "gis_reference": "FPL project maps / corridor records",
    },
    {
        "name": "FPL - Ten-Year Site Plan",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/content/dam/fplgp/us/en/about/pdf/ten-year-site-plan.pdf",
        "max_pages": 1,
        "gis_priority": 80,
        "gis_reference": "FPL bulk transmission-system maps",
    },
    {
        "name": "JEA - Capital / Transmission Projects",
        "company_hint": "JEA",
        "url": "https://www.jea.com/About/Procurement/Current_Bid_Openings/",
        "max_pages": 10,
        "gis_priority": 75,
        "gis_reference": "JEA project-area maps and named substations",
    },
    {
        "name": "Gainesville Regional Utilities - Public Meetings",
        "company_hint": "Gainesville Regional Utilities",
        "url": "https://www.gru.com/OurCompany/GRUAuthority.aspx",
        "max_pages": 10,
        "gis_priority": 70,
        "gis_reference": "GRU system/project maps",
    },
    {
        "name": "Tampa Electric - Current Grid Projects",
        "company_hint": "Tampa Electric",
        "url": "https://www.tampaelectric.com/company/ourpowersystem/projects/",
        "max_pages": 10,
        "gis_priority": 60,
        "gis_reference": "TECO project maps / regulatory maps when available",
    },
    {
        "name": "Duke Energy Florida - News / Grid",
        "company_hint": "Duke Energy Florida",
        "url": "https://news.duke-energy.com/releases?c=23893",
        "max_pages": 10,
        "gis_priority": 55,
        "gis_reference": "Duke project maps / DEP siting records when available",
    },
    {
        "name": "OUC - News / Infrastructure",
        "company_hint": "Orlando Utilities Commission",
        "url": "https://www.ouc.com/about/news/",
        "max_pages": 10,
        "gis_priority": 50,
        "gis_reference": "OUC project maps when available",
    },
    {
        "name": "FRCC - Order 1000 / Regional Planning",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://www.frcc.com/order1000/",
        "max_pages": 12,
        "gis_priority": 40,
        "gis_reference": "FRCC regional system maps",
    },
]


COMPANY_PATTERNS = [
    (re.compile(r"\bFlorida Power\s*&\s*Light\b|\bFPL\b", re.I), "Florida Power & Light"),
    (re.compile(r"\bDuke Energy Florida\b|\bDEF\b", re.I), "Duke Energy Florida"),
    (re.compile(r"\bTampa Electric\b|\bTECO\b", re.I), "Tampa Electric"),
    (re.compile(r"\bJEA\b", re.I), "JEA"),
    (re.compile(r"\bOrlando Utilities Commission\b|\bOUC\b", re.I), "Orlando Utilities Commission"),
    (re.compile(r"\bGainesville Regional Utilities\b|\bGRU\b", re.I), "Gainesville Regional Utilities"),
    (re.compile(r"\bLakeland Electric\b", re.I), "Lakeland Electric"),
    (re.compile(r"\bFlorida Municipal Power Agency\b|\bFMPA\b", re.I), "Florida Municipal Power Agency"),
]

TYPE_PATTERNS = [
    (re.compile(r"\b(new|construct(?:ion)?)\b.*\btransmission\b", re.I), "New transmission line"),
    (re.compile(r"\btransmission\b.*\b(new|construct(?:ion)?)\b", re.I), "New transmission line"),
    (re.compile(r"\b(rebuild|reconduct|uprate|upgrade|replace)\w*\b.*\btransmission\b", re.I), "Transmission upgrade"),
    (re.compile(r"\b(new|construct(?:ion)?)\b.*\bsubstation\b", re.I), "New substation"),
    (re.compile(r"\bsubstation\b.*\b(new|construct(?:ion)?)\b", re.I), "New substation"),
    (re.compile(r"\b(upgrade|expand|replace|rebuild)\w*\b.*\bsubstation\b", re.I), "Substation upgrade"),
    (re.compile(r"\bswitchyard\b|\bswitching station\b", re.I), "Switchyard / switching station"),
    (re.compile(r"\btransmission\b", re.I), "Transmission project"),
    (re.compile(r"\bsubstation\b", re.I), "Substation project"),
]

YEAR_RE = re.compile(r"\b(20(?:2[6-9]|3\d|4\d))\b")
KV_RE = re.compile(r"\b(\d{2,3})\s*(?:kV|kilovolt)\b", re.I)
MILES_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b", re.I)

MONEY_RE = re.compile(
    r"(?P<currency>\$)\s*(?P<num>\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*"
    r"(?P<unit>billion|million|thousand|bn|m|k)?",
    re.I,
)

COUNTY_RE = re.compile(r"\b([A-Z][A-Za-z .'-]+)\s+County\b")

CASE_PATTERNS = [
    re.compile(r"\bDocket\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
    re.compile(r"\bCase\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
    re.compile(r"\bPSC\s+Docket\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
    re.compile(r"\bSiting\s+Case\s*[:#-]?\s*([A-Z0-9-]{4,})", re.I),
]

DATE_PATTERNS = [
    re.compile(
        r"\b(?:filed|filing date|application date|petition date|submitted|submission date)"
        r"\s*(?:on|:)?\s*"
        r"((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        r"\s+\d{1,2},?\s+\d{4})",
        re.I,
    ),
    re.compile(
        r"\b(?:filed|filing date|application date|petition date|submitted|submission date)"
        r"\s*(?:on|:)?\s*(\d{1,2}/\d{1,2}/\d{4})",
        re.I,
    ),
]

DURATION_PATTERNS = [
    re.compile(r"\b(\d+(?:\.\d+)?)\s*(months?|mos?)\b", re.I),
    re.compile(r"\b(\d+(?:\.\d+)?)\s*(years?|yrs?)\b", re.I),
]

SUBSTATION_PAIR_PATTERNS = [
    re.compile(
        r"\bfrom\s+(?:the\s+)?([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+Substation"
        r".{0,180}?\bto\s+(?:the\s+)?([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+Substation",
        re.I,
    ),
    re.compile(
        r"\bbetween\s+(?:the\s+)?([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+Substation"
        r".{0,180}?\band\s+(?:the\s+)?([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+Substation",
        re.I,
    ),
    re.compile(
        r"\b([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s*-\s*"
        r"([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+"
        r"(?:500|230|161|138|115|69)\s*kV\b",
        re.I,
    ),
]

SINGLE_SUBSTATION_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9 &'()./-]{2,60}?)\s+(?:Substation|Switchyard|Switching Station)\b",
    re.I,
)


@dataclass
class ProjectRecord:
    project_id: str

    planning_company: str
    project_name: str
    project_type: str

    # Spatial fields. `gis` stores compact GeoJSON geometry. `centroid` stores
    # one base coordinate as "latitude, longitude" without separate lat/lon columns.
    gis: str
    centroid: str
    address: str
    location_method: str
    gis_source: str
    location_confidence: str

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
    source_excerpt: str

    first_seen: str
    last_seen: str
    active: str = "yes"


CSV_FIELDS = [f.name for f in ProjectRecord.__dataclass_fields__.values()]
MISSING_TEXT = "NA"
NUMERIC_FIELDS = {
    "voltage_kv",
    "approximate_line_mileage",
    "projected_year",
    "cost",
}
TEXT_FIELDS = {
    "planning_company",
    "project_name",
    "project_type",
    "gis",
    "centroid",
    "address",
    "location_method",
    "gis_source",
    "location_confidence",
    "starting_substation",
    "ending_substation",
    "counties_crossed",
    "regulatory_case_number",
    "filing_dates",
    "construction_time",
    "projected_locations",
    "source_name",
    "source_url",
    "source_excerpt",
}


# Decimal degrees with a separator, optional hemisphere letters.
COORD_PAIR_RE = re.compile(
    r"(?P<lat>[+-]?\d{1,2}\.\d{3,})\s*°?\s*(?P<lat_hemi>[NSns])?"
    r"\s*[,/]\s*"
    r"(?P<lon>[+-]?\d{1,3}\.\d{3,})\s*°?\s*(?P<lon_hemi>[EWew])?"
)
COORD_HEMI_RE = re.compile(
    r"(?P<lat>\d{1,2}\.\d{3,})\s*°?\s*(?P<lat_hemi>[NSns])\s*[, ]+\s*"
    r"(?P<lon>\d{1,3}\.\d{3,})\s*°?\s*(?P<lon_hemi>[EWew])"
)
LAT_LABEL_RE = re.compile(
    r"\b(?:lat(?:itude)?)\s*[:=]?\s*([+-]?\d{1,2}\.\d{3,})\s*°?\s*([NSns])?",
    re.I,
)
LON_LABEL_RE = re.compile(
    r"\b(?:lon(?:gitude)?)\s*[:=]?\s*([+-]?\d{1,3}\.\d{3,})\s*°?\s*([EWew])?",
    re.I,
)
DMS_RE = re.compile(
    r"(?P<deg>\d{1,3})\s*°\s*(?P<min>\d{1,2})\s*[′']\s*"
    r"(?P<sec>\d{1,2}(?:\.\d+)?)\s*[″\"]?\s*(?P<hemi>[NSEWnsew])"
)
ADDRESS_RE = re.compile(
    r"\b(\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}"
    r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|"
    r"Highway|Hwy|Way|Court|Ct|Parkway|Pkwy|Trail|Trl|Circle|Cir|Terrace|Ter)\b"
    r"(?:,?\s*(?:MS|Suite|Ste|Unit)\s*[A-Z0-9-]+)?"
    r"(?:,?\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})?"
    r"(?:,?\s*(?:Florida|FL)\b)?"
    r"(?:\s+\d{5}(?:-\d{4})?)?)",
    re.I,
)
COST_UNITS = {
    "billion": 1_000_000_000,
    "bn": 1_000_000_000,
    "million": 1_000_000,
    "m": 1_000_000,
    "thousand": 1_000,
    "k": 1_000,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", text).strip()


def get_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    })
    return s


def fetch(session: requests.Session, url: str) -> requests.Response | None:
    try:
        r = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        r.raise_for_status()
        return r
    except requests.RequestException as exc:
        logging.warning("Fetch failed: %s (%s)", url, exc)
        return None


def pdf_to_text(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return clean_text("\n".join(parts))
    except Exception as exc:
        logging.warning("PDF parse failed: %s", exc)
        return ""


def html_to_text_and_links(html: str, base_url: str) -> tuple[str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    text = clean_text(soup.get_text(" ", strip=True))
    links = []
    base_domain = urlparse(base_url).netloc.lower()

    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"].strip())
        parsed = urlparse(href)

        if parsed.scheme not in {"http", "https"}:
            continue

        if parsed.netloc.lower() != base_domain:
            continue

        label = clean_text(a.get_text(" ", strip=True))
        combined = f"{label} {href}"

        if LINK_KEYWORDS.search(combined) or PDF_RE.search(href):
            links.append(href.split("#")[0])

    return text, list(dict.fromkeys(links))


def crawl_source(session: requests.Session, source: dict) -> list[tuple[str, str]]:
    queue = [source["url"]]
    seen = set()
    documents = []

    while queue and len(seen) < source["max_pages"]:
        url = queue.pop(0)
        if url in seen:
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
            text = pdf_to_text(response.content)
            if text:
                documents.append((final_url, text))
            continue

        if "html" not in ctype and "text" not in ctype and ctype:
            continue

        text, links = html_to_text_and_links(response.text, final_url)

        if text:
            documents.append((final_url, text))

        for link in links:
            if link not in seen and link not in queue:
                queue.append(link)

    return documents


def split_candidate_blocks(text: str) -> list[str]:
    pieces = re.split(r"(?<=[.!?])\s+|\s{3,}", text)
    pieces = [clean_text(p) for p in pieces if len(clean_text(p)) >= 20]

    blocks = []

    for i, piece in enumerate(pieces):
        if not GRID_KEYWORDS.search(piece):
            continue

        start = max(0, i - 3)
        end = min(len(pieces), i + 5)
        block = clean_text(" ".join(pieces[start:end]))

        if GRID_KEYWORDS.search(block) and FUTURE_KEYWORDS.search(block):
            blocks.append(block[:3000])

    unique = {}

    for block in blocks:
        fingerprint = hashlib.sha1(block.lower().encode("utf-8")).hexdigest()
        unique[fingerprint] = block

    return list(unique.values())


def detect_company(block: str, company_hint: str) -> str:
    for pattern, company in COMPANY_PATTERNS:
        if pattern.search(block):
            return company
    return company_hint


def detect_type(block: str) -> str:
    for pattern, project_type in TYPE_PATTERNS:
        if pattern.search(block):
            return project_type
    return "Transmission / substation project"


def detect_year(block: str) -> str:
    years = sorted({int(y) for y in YEAR_RE.findall(block)})
    return "; ".join(str(y) for y in years[:8])


def detect_cost(block: str) -> str:
    matches = []

    for match in MONEY_RE.finditer(block):
        raw = clean_text(match.group(0))
        number = float(match.group("num").replace(",", ""))
        unit = (match.group("unit") or "").lower()

        if unit or number >= 100000:
            matches.append(raw)

    return "; ".join(dict.fromkeys(matches[:5]))


def detect_duration(block: str) -> str:
    values = []

    for pattern in DURATION_PATTERNS:
        for match in pattern.finditer(block):
            values.append(clean_text(match.group(0)))

    return "; ".join(dict.fromkeys(values[:5]))


def detect_substations(block: str) -> tuple[str, str]:
    for pattern in SUBSTATION_PAIR_PATTERNS:
        match = pattern.search(block)
        if match:
            start = clean_text(match.group(1))
            end = clean_text(match.group(2))
            return start, end

    singles = []
    seen = set()

    for match in SINGLE_SUBSTATION_RE.finditer(block):
        name = clean_text(match.group(1))
        key = name.lower()

        if key not in seen:
            seen.add(key)
            singles.append(name)

    if len(singles) >= 2:
        return singles[0], singles[1]

    if len(singles) == 1:
        return singles[0], ""

    return "", ""


def detect_counties(block: str) -> str:
    counties = []

    for county in COUNTY_RE.findall(block):
        county = clean_text(county)
        if county.lower() not in {c.lower() for c in counties}:
            counties.append(county)

    return "; ".join(f"{county} County" for county in counties[:10])


def detect_case_number(block: str) -> str:
    values = []

    for pattern in CASE_PATTERNS:
        for match in pattern.finditer(block):
            values.append(clean_text(match.group(1)))

    return "; ".join(dict.fromkeys(values[:5]))


def detect_filing_dates(block: str) -> str:
    dates = []

    for pattern in DATE_PATTERNS:
        for match in pattern.finditer(block):
            dates.append(clean_text(match.group(1)))

    return "; ".join(dict.fromkeys(dates[:6]))


def detect_locations(
    block: str,
    counties: str,
    start_substation: str,
    end_substation: str,
) -> str:
    locations = []

    if start_substation:
        locations.append(start_substation)

    if end_substation:
        locations.append(end_substation)

    if counties:
        locations.extend([x.strip() for x in counties.split(";") if x.strip()])

    city_context_re = re.compile(
        r"\b(?:City of|near|in|at|from|to|between)\s+"
        r"([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})"
    )

    for city in city_context_re.findall(block):
        city = clean_text(city)

        if not re.search(
            r"\b(the|a|an|construct|construction|project|service|existing|new)\b",
            city,
            re.I,
        ):
            locations.append(city)

    output = []
    seen = set()

    for location in locations:
        key = location.lower()

        if key not in seen:
            seen.add(key)
            output.append(location)

    return "; ".join(output[:12])


def detect_voltage(block: str) -> str:
    values = list(dict.fromkeys(KV_RE.findall(block)))
    return "; ".join(values[:6])


def detect_miles(block: str) -> str:
    values = list(dict.fromkeys(MILES_RE.findall(block)))
    return "; ".join(values[:6])


def guess_project_name(block: str, source_name: str) -> str:
    patterns = [
        r"\b([A-Z][A-Za-z0-9&'(). /-]{3,110}?(?:Transmission Line|Transmission Project|Substation|Switchyard|Switching Station))\b",
        r"\b([A-Z][A-Za-z0-9&'(). /-]{3,80}?\s*-\s*[A-Z][A-Za-z0-9&'(). /-]{3,80}?\s+(?:500|230|161|138|115|69)\s*kV(?:\s+Transmission(?:\s+Line)?)?)\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, block, re.I)
        if match:
            return clean_text(match.group(1))[:220]

    words = block.split()
    return f"{source_name}: {' '.join(words[:18])}"[:220]


def make_project_id(
    planning_company: str,
    name: str,
    start_substation: str,
    end_substation: str,
    voltage: str,
    case_number: str,
) -> str:
    canonical = "|".join(
        clean_text(value).lower()
        for value in (
            planning_company,
            name,
            start_substation,
            end_substation,
            voltage,
            case_number,
        )
    )

    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:20]


def _apply_hemisphere(value: float, hemisphere: str | None) -> float:
    if not hemisphere:
        return value
    sign = -1 if hemisphere.upper() in {"S", "W"} else 1
    return sign * abs(value)


def _valid_coordinate(latitude: float, longitude: float) -> bool:
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


def _in_florida(latitude: float, longitude: float) -> bool:
    return 24.0 <= latitude <= 31.5 and -88.0 <= longitude <= -79.5


def _orient_pair(latitude: float, longitude: float) -> tuple[float, float]:
    if _in_florida(latitude, longitude):
        return latitude, longitude
    if _in_florida(longitude, latitude):
        return longitude, latitude
    return latitude, longitude


def _choose_coordinates(candidates: list[tuple[float, float]]) -> tuple[float, float]:
    usable = []
    for latitude, longitude in candidates:
        latitude, longitude = _orient_pair(latitude, longitude)
        if _valid_coordinate(latitude, longitude):
            usable.append((latitude, longitude))

    for latitude, longitude in usable:
        if _in_florida(latitude, longitude):
            return latitude, longitude

    if usable:
        return usable[0]
    return 0.0, 0.0


def detect_coordinates(text: str) -> tuple[float, float]:
    """Return latitude and longitude. Unlabeled pairs must fall inside Florida."""
    if not text:
        return 0.0, 0.0

    candidates = []

    latitude_match = LAT_LABEL_RE.search(text)
    longitude_match = LON_LABEL_RE.search(text)
    if latitude_match and longitude_match:
        latitude = _apply_hemisphere(float(latitude_match.group(1)), latitude_match.group(2))
        longitude = _apply_hemisphere(float(longitude_match.group(1)), longitude_match.group(2))
        latitude, longitude = _orient_pair(latitude, longitude)
        if _valid_coordinate(latitude, longitude):
            candidates.append((latitude, longitude))

    for pattern in (COORD_HEMI_RE, COORD_PAIR_RE):
        for match in pattern.finditer(text):
            latitude = _apply_hemisphere(float(match.group("lat")), match.group("lat_hemi"))
            longitude = _apply_hemisphere(float(match.group("lon")), match.group("lon_hemi"))
            latitude, longitude = _orient_pair(latitude, longitude)
            labeled = bool(match.group("lat_hemi") or match.group("lon_hemi"))
            if not _valid_coordinate(latitude, longitude):
                continue
            if labeled or _in_florida(latitude, longitude):
                candidates.append((latitude, longitude))

    dms_values = []
    for match in DMS_RE.finditer(text):
        degrees = float(match.group("deg"))
        minutes = float(match.group("min"))
        seconds = float(match.group("sec"))
        value = degrees + minutes / 60 + seconds / 3600
        value = _apply_hemisphere(value, match.group("hemi"))
        dms_values.append((value, match.group("hemi").upper()))

    for index, (latitude, hemisphere) in enumerate(dms_values):
        if hemisphere not in {"N", "S"}:
            continue
        for longitude, other in dms_values[index + 1 : index + 3]:
            if other in {"E", "W"} and _valid_coordinate(latitude, longitude):
                candidates.append((latitude, longitude))
                break

    return _choose_coordinates(candidates)


def detect_address(text: str) -> str:
    if not text:
        return ""

    for match in ADDRESS_RE.finditer(text):
        address = clean_text(match.group(1))
        if len(address) >= 8:
            return address[:180]

    return ""


def parse_voltage(text: str, *, allow_bare: bool = False) -> float:
    labeled = [float(value) for value in KV_RE.findall(text or "")]
    if labeled:
        return max(labeled)
    if not allow_bare:
        return 0.0

    bare = []
    for value in re.findall(r"\b(\d{2,3})(?:\.\d+)?\b", text or ""):
        number = float(value)
        if 30 <= number <= 800:
            bare.append(number)
    return max(bare) if bare else 0.0


def parse_miles(text: str, *, allow_bare: bool = False) -> float:
    labeled = [float(value) for value in MILES_RE.findall(text or "")]
    if labeled:
        return labeled[0]
    if allow_bare and re.fullmatch(r"\d+(?:\.\d+)?", (text or "").strip()):
        return float(text)
    return 0.0


def parse_year(text: str) -> int:
    years = [int(value) for value in YEAR_RE.findall(text or "")]
    stripped = (text or "").strip()
    if not years and re.fullmatch(r"20\d{2}", stripped):
        years = [int(stripped)]
    return min(years) if years else 0


def parse_cost(text: str) -> float:
    stripped = (text or "").strip()
    if not stripped or stripped in {MISSING_TEXT, "0"}:
        return 0.0

    best = 0.0
    for match in MONEY_RE.finditer(stripped):
        number = float(match.group("num").replace(",", ""))
        unit = (match.group("unit") or "").lower()
        if unit:
            number *= COST_UNITS[unit]
        elif number < 100000:
            continue
        best = max(best, number)

    if best:
        return best
    if re.fullmatch(r"\d+(?:\.\d+)?", stripped):
        return float(stripped)
    return 0.0


def missing_text(value: str) -> str:
    text = clean_text(value or "")
    return text if text and text.upper() != "NA" else MISSING_TEXT


def has_value(value) -> bool:
    if isinstance(value, (int, float)):
        return value != 0
    text = clean_text(str(value or ""))
    return text not in {"", MISSING_TEXT, "0"}


def format_cell(field: str, value) -> str:
    if field in NUMERIC_FIELDS:
        if field == "projected_year":
            number = parse_year(str(value)) if not isinstance(value, (int, float)) else int(value)
        elif field == "cost":
            number = value if isinstance(value, (int, float)) else parse_cost(str(value))
        elif field == "voltage_kv":
            number = value if isinstance(value, (int, float)) else parse_voltage(str(value), allow_bare=True)
        elif field == "approximate_line_mileage":
            number = value if isinstance(value, (int, float)) else parse_miles(str(value), allow_bare=True)
        else:
            try:
                number = float(value)
            except (TypeError, ValueError):
                number = 0

        if not number:
            return "0"
        if float(number).is_integer():
            return str(int(number))
        return f"{float(number):.4f}".rstrip("0").rstrip(".")

    if field == "active":
        text_value = clean_text(str(value or ""))
        return text_value or "yes"
    if field in {"project_id", "first_seen", "last_seen"}:
        return clean_text(str(value or ""))

    return missing_text(str(value or ""))


def _arcgis_escape(value: str) -> str:
    return (value or "").replace("'", "''")


def _normalize_station_name(name: str) -> str:
    name = clean_text(name or "")
    name = re.sub(r"\b(?:substation|switchyard|switching station)\b", "", name, flags=re.I)
    name = re.sub(r"^(?:the)\s+", "", name, flags=re.I)
    return clean_text(name.strip(" -,:;"))


def _geojson_compact(geometry: dict | None) -> str:
    if not geometry:
        return ""
    return json.dumps(geometry, separators=(",", ":"), ensure_ascii=False)


def _geometry_centroid(geometry: dict | None) -> tuple[float, float] | None:
    """Return (latitude, longitude) for Point/LineString/MultiLineString GeoJSON."""
    if not geometry:
        return None

    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if not coords:
        return None

    if gtype == "Point":
        lon, lat = coords[:2]
        return float(lat), float(lon)

    def line_centroid(line):
        if not line:
            return None
        if len(line) == 1:
            lon, lat = line[0][:2]
            return float(lat), float(lon)

        total = 0.0
        weighted_lon = 0.0
        weighted_lat = 0.0
        for a, b in zip(line, line[1:]):
            x1, y1 = float(a[0]), float(a[1])
            x2, y2 = float(b[0]), float(b[1])
            # Euclidean degrees are sufficient for the centroid estimate; this is
            # not used as an engineering distance calculation.
            length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
            if length == 0:
                continue
            weighted_lon += ((x1 + x2) / 2.0) * length
            weighted_lat += ((y1 + y2) / 2.0) * length
            total += length
        if total == 0:
            lon, lat = line[0][:2]
            return float(lat), float(lon)
        return weighted_lat / total, weighted_lon / total

    if gtype == "LineString":
        return line_centroid(coords)

    if gtype == "MultiLineString":
        centroids = [line_centroid(line) for line in coords if line]
        centroids = [c for c in centroids if c]
        if centroids:
            return (
                sum(c[0] for c in centroids) / len(centroids),
                sum(c[1] for c in centroids) / len(centroids),
            )

    if gtype == "Polygon":
        ring = coords[0] if coords else []
        if ring:
            # Polygon fallback: average of vertices. The monitor primarily emits
            # Point and endpoint-derived LineString geometries.
            xs = [float(p[0]) for p in ring]
            ys = [float(p[1]) for p in ring]
            return sum(ys) / len(ys), sum(xs) / len(xs)

    return None


def _format_centroid(point: tuple[float, float] | None) -> str:
    if not point:
        return ""
    lat, lon = point
    if not _valid_coordinate(lat, lon):
        return ""
    return f"{lat:.6f}, {lon:.6f}"


def _candidate_score(feature: dict, station_name: str, county: str, voltage: float) -> float:
    props = feature.get("properties") or {}
    candidate = clean_text(str(props.get("NAME") or ""))
    target = _normalize_station_name(station_name)
    name_score = SequenceMatcher(None, target.lower(), candidate.lower()).ratio() if target and candidate else 0.0

    county_score = 0.0
    if county:
        wanted = county.lower().replace(" county", "").strip()
        got = clean_text(str(props.get("COUNTY") or "")).lower().replace(" county", "").strip()
        if wanted and got and wanted == got:
            county_score = 0.20

    voltage_score = 0.0
    try:
        max_volt = float(props.get("MAX_VOLT") or 0)
    except (TypeError, ValueError):
        max_volt = 0.0
    if voltage and max_volt:
        if abs(max_volt - voltage) <= 1:
            voltage_score = 0.12
        elif abs(max_volt - voltage) <= 50:
            voltage_score = 0.05

    return name_score + county_score + voltage_score


def query_hifld_substation(
    session: requests.Session,
    station_name: str,
    counties: str = "",
    voltage: float = 0.0,
) -> dict | None:
    """Match a named Florida substation to the public HIFLD ArcGIS layer."""
    target = _normalize_station_name(station_name)
    if not target or target.upper() == MISSING_TEXT:
        return None

    # Use the first county as a ranking hint, not a hard filter, because project
    # descriptions may list multiple counties along the line.
    county_hint = ""
    if counties and counties.upper() != MISSING_TEXT:
        county_hint = counties.split(";")[0].strip()

    # Search the whole normalized name first, then individual meaningful tokens.
    search_terms = [target]
    tokens = [t for t in re.findall(r"[A-Za-z0-9]+", target) if len(t) >= 4]
    search_terms.extend(tokens[:3])

    features = []
    seen_ids = set()
    for term in search_terms:
        where = f"STATE='FL' AND NAME LIKE '%{_arcgis_escape(term)}%'"
        params = {
            "where": where,
            "outFields": "ID,NAME,CITY,STATE,ZIP,COUNTY,LATITUDE,LONGITUDE,MAX_VOLT,SOURCE",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": 50,
        }
        try:
            response = session.get(HIFLD_SUBSTATIONS_QUERY_URL, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logging.debug("HIFLD substation lookup failed for %s: %s", target, exc)
            continue

        for feature in payload.get("features", []):
            props = feature.get("properties") or {}
            fid = props.get("ID") or json.dumps(feature.get("geometry"), sort_keys=True)
            if fid in seen_ids:
                continue
            seen_ids.add(fid)
            features.append(feature)

        if features:
            # Usually the full-name query is sufficient; keep API use low.
            break

    if not features:
        return None

    scored = [
        (_candidate_score(feature, target, county_hint, voltage), feature)
        for feature in features
    ]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]
    if best_score < GIS_MATCH_THRESHOLD:
        return None

    best["_match_score"] = best_score
    return best


def geocode_address(
    session: requests.Session,
    address: str,
    context: str = "",
) -> tuple[tuple[float, float] | None, str]:
    """Geocode an address with the public U.S. Census Geocoder."""
    address = clean_text(address or "")
    if not address or address.upper() == MISSING_TEXT:
        return None, ""

    query = address
    if not re.search(r"\b(?:Florida|FL)\b", query, re.I):
        query += ", Florida"

    params = {
        "address": query,
        "benchmark": "Public_AR_Current",
        "format": "json",
    }
    try:
        response = session.get(CENSUS_GEOCODER_URL, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        matches = payload.get("result", {}).get("addressMatches", [])
    except (requests.RequestException, ValueError) as exc:
        logging.debug("Address geocode failed for %s: %s", query, exc)
        return None, ""

    if not matches:
        return None, ""

    match = matches[0]
    coords = match.get("coordinates") or {}
    try:
        lon = float(coords.get("x"))
        lat = float(coords.get("y"))
    except (TypeError, ValueError):
        return None, ""

    if not _in_florida(lat, lon):
        return None, ""

    matched_address = clean_text(str(match.get("matchedAddress") or query))
    return (lat, lon), matched_address


def enrich_record_with_location(session: requests.Session, record: ProjectRecord) -> ProjectRecord:
    """GIS-first location enrichment, with address geocoding only as fallback."""
    start_name = "" if record.starting_substation == MISSING_TEXT else record.starting_substation
    end_name = "" if record.ending_substation == MISSING_TEXT else record.ending_substation
    counties = "" if record.counties_crossed == MISSING_TEXT else record.counties_crossed

    start_feature = query_hifld_substation(
        session, start_name, counties, record.voltage_kv
    ) if start_name else None
    end_feature = query_hifld_substation(
        session, end_name, counties, record.voltage_kv
    ) if end_name else None

    geometry = None
    matched_names = []
    scores = []

    def point_from(feature):
        if not feature:
            return None
        geom = feature.get("geometry") or {}
        if geom.get("type") == "Point" and geom.get("coordinates"):
            return [float(geom["coordinates"][0]), float(geom["coordinates"][1])]
        props = feature.get("properties") or {}
        try:
            lon = float(props.get("LONGITUDE"))
            lat = float(props.get("LATITUDE"))
            return [lon, lat]
        except (TypeError, ValueError):
            return None

    start_point = point_from(start_feature)
    end_point = point_from(end_feature)

    for feature in (start_feature, end_feature):
        if feature:
            props = feature.get("properties") or {}
            matched_names.append(clean_text(str(props.get("NAME") or "")))
            scores.append(float(feature.get("_match_score") or 0))

    if start_point and end_point:
        geometry = {"type": "LineString", "coordinates": [start_point, end_point]}
        record.location_method = "hifld_substation_endpoints"
        record.location_confidence = "high" if min(scores or [0]) >= 0.78 else "medium"
    elif start_point or end_point:
        geometry = {"type": "Point", "coordinates": start_point or end_point}
        record.location_method = "hifld_substation_point"
        record.location_confidence = "high" if (scores and max(scores) >= 0.78) else "medium"

    if geometry:
        record.gis = _geojson_compact(geometry)
        record.centroid = _format_centroid(_geometry_centroid(geometry))
        detail = "; ".join(n for n in matched_names if n)
        record.gis_source = HIFLD_SUBSTATIONS_LAYER_URL + (f" | matched: {detail}" if detail else "")
        return record

    # Secondary fallback: coordinates explicitly published in the source text.
    lat, lon = detect_coordinates(record.source_excerpt)
    if lat and lon:
        record.centroid = _format_centroid((lat, lon))
        record.location_method = "source_published_coordinate"
        record.gis_source = record.source_url
        record.location_confidence = "medium"
        return record

    # Final fallback requested by the user: geocode a usable street address.
    if record.address and record.address != MISSING_TEXT:
        point, matched_address = geocode_address(
            session,
            record.address,
            record.projected_locations,
        )
        if point:
            record.centroid = _format_centroid(point)
            record.location_method = "address_geocode"
            record.gis_source = "U.S. Census Geocoder"
            record.location_confidence = "medium"
            if matched_address:
                record.address = matched_address
            return record

    record.gis = MISSING_TEXT
    record.centroid = MISSING_TEXT
    record.location_method = MISSING_TEXT
    record.gis_source = MISSING_TEXT
    record.location_confidence = "none"
    return record


def prepare_row(row: dict) -> dict:
    """Normalize fields and migrate legacy latitude/longitude into one centroid field."""
    excerpt = row.get("source_excerpt") or ""
    prepared = {field: row.get(field, "") for field in CSV_FIELDS}

    prepared["voltage_kv"] = parse_voltage(
        str(row.get("voltage_kv") or ""), allow_bare=True
    ) or parse_voltage(excerpt)
    prepared["approximate_line_mileage"] = parse_miles(
        str(row.get("approximate_line_mileage") or ""), allow_bare=True,
    ) or parse_miles(excerpt)
    prepared["projected_year"] = parse_year(
        str(row.get("projected_year") or "")
    ) or parse_year(excerpt)
    prepared["cost"] = parse_cost(str(row.get("cost") or "")) or parse_cost(excerpt)

    address = missing_text(str(row.get("address") or ""))
    if address == MISSING_TEXT:
        address = missing_text(detect_address(excerpt))
    prepared["address"] = address

    # Backward compatibility: if an older CSV has separate coordinates, collapse
    # them into the new centroid field instead of keeping latitude/longitude columns.
    centroid = clean_text(str(row.get("centroid") or ""))
    if not centroid or centroid.upper() == MISSING_TEXT:
        try:
            legacy_lat = float(row.get("latitude") or 0)
            legacy_lon = float(row.get("longitude") or 0)
        except (TypeError, ValueError):
            legacy_lat, legacy_lon = 0.0, 0.0
        if legacy_lat and legacy_lon and _valid_coordinate(legacy_lat, legacy_lon):
            centroid = f"{legacy_lat:.6f}, {legacy_lon:.6f}"
            if not prepared.get("location_method"):
                prepared["location_method"] = "legacy_coordinate"
            if not prepared.get("location_confidence"):
                prepared["location_confidence"] = "medium"
    prepared["centroid"] = centroid or MISSING_TEXT

    return {field: format_cell(field, prepared.get(field, "")) for field in CSV_FIELDS}


def extract_records(source: dict, url: str, text: str, now: str) -> list[ProjectRecord]:
    records = []

    for block in split_candidate_blocks(text):
        planning_company = detect_company(block, source["company_hint"])
        project_type = detect_type(block)
        projected_year = parse_year(block)
        cost = parse_cost(block)
        construction_time = detect_duration(block)

        start_substation, end_substation = detect_substations(block)
        counties = detect_counties(block)
        case_number = detect_case_number(block)
        filing_dates = detect_filing_dates(block)

        voltage_text = detect_voltage(block)
        voltage = parse_voltage(block)
        mileage = parse_miles(block)
        address = detect_address(block)

        projected_locations = detect_locations(
            block,
            counties,
            start_substation,
            end_substation,
        )

        project_name = guess_project_name(block, source["name"])

        if not (
            projected_year
            or cost
            or projected_locations
            or construction_time
            or case_number
            or filing_dates
            or address
        ):
            continue

        project_id = make_project_id(
            planning_company,
            project_name,
            start_substation,
            end_substation,
            voltage_text,
            case_number,
        )

        records.append(
            ProjectRecord(
                project_id=project_id,

                planning_company=missing_text(planning_company),
                project_name=missing_text(project_name),
                project_type=missing_text(project_type),

                gis=MISSING_TEXT,
                centroid=MISSING_TEXT,
                address=missing_text(address),
                location_method=MISSING_TEXT,
                gis_source=missing_text(source.get("gis_reference", "")),
                location_confidence="none",

                starting_substation=missing_text(start_substation),
                ending_substation=missing_text(end_substation),
                voltage_kv=voltage,
                approximate_line_mileage=mileage,
                counties_crossed=missing_text(counties),
                regulatory_case_number=missing_text(case_number),
                filing_dates=missing_text(filing_dates),

                projected_year=projected_year,
                cost=cost,
                construction_time=missing_text(construction_time),
                projected_locations=missing_text(projected_locations),

                source_name=missing_text(source["name"]),
                source_url=missing_text(url),
                source_excerpt=missing_text(block[:1800]),

                first_seen=now,
                last_seen=now,
                active="yes",
            )
        )

    return records


def save_snapshot(snapshot_dir: Path, source_name: str, url: str, text: str) -> None:
    day = datetime.now().strftime("%Y-%m-%d")
    safe_source = re.sub(r"[^A-Za-z0-9._-]+", "_", source_name)[:60]
    url_hash = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]

    folder = snapshot_dir / day
    folder.mkdir(parents=True, exist_ok=True)

    path = folder / f"{safe_source}_{url_hash}.txt"
    path.write_text(
        f"SOURCE URL: {url}\n\n{text}",
        encoding="utf-8",
    )


def load_existing(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}

    rows = {}

    with path.open("r", newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            key = row.get("project_id", "")
            if key:
                rows[key] = row

    return rows


def merge_and_write(
    path: Path,
    new_records: list[ProjectRecord],
    now: str,
) -> tuple[int, int]:
    old = load_existing(path)
    seen_this_run = set()
    added = 0

    for record in new_records:
        seen_this_run.add(record.project_id)
        new_row = asdict(record)

        if record.project_id in old:
            old_row = old[record.project_id]
            new_row["first_seen"] = old_row.get("first_seen") or record.first_seen
            old[record.project_id] = new_row
        else:
            old[record.project_id] = new_row
            added += 1

    for key, row in old.items():
        if key not in seen_this_run:
            row["active"] = "not_seen_latest_run"

    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
        writer.writeheader()

        for row in sorted(
            old.values(),
            key=lambda r: (
                str(r.get("planning_company", "")),
                str(r.get("projected_year", "")),
                str(r.get("project_name", "")),
            ),
        ):
            writer.writerow(prepare_row(row))

    return added, len(old)


def run_once(output: Path, snapshot_dir: Path) -> None:
    now = utc_now()
    session = get_session()
    all_records = []

    for source in sorted(SOURCES, key=lambda s: s.get("gis_priority", 0), reverse=True):
        logging.info("Starting source: %s", source["name"])

        documents = crawl_source(session, source)
        logging.info("  Retrieved %d document/page(s)", len(documents))

        source_records = []

        for url, text in documents:
            save_snapshot(
                snapshot_dir,
                source["name"],
                url,
                text,
            )

            extracted = extract_records(
                source,
                url,
                text,
                now,
            )
            for record in extracted:
                source_records.append(enrich_record_with_location(session, record))

        logging.info(
            "  Extracted %d candidate record(s)",
            len(source_records),
        )

        all_records.extend(source_records)

    best = {}

    for record in all_records:
        score = sum(
            has_value(value)
            for value in [
                record.starting_substation,
                record.ending_substation,
                record.voltage_kv,
                record.approximate_line_mileage,
                record.counties_crossed,
                record.regulatory_case_number,
                record.filing_dates,
                record.projected_year,
                record.cost,
                record.construction_time,
                record.address,
                record.centroid,
                record.gis,
            ]
        )
        if has_value(record.gis):
            score += 150
        elif has_value(record.centroid):
            score += 100

        existing = best.get(record.project_id)

        if existing is None or score > existing[0]:
            best[record.project_id] = (score, record)

    unique_records = [pair[1] for pair in best.values()]

    added, total = merge_and_write(
        output,
        unique_records,
        now,
    )

    logging.info(
        "Finished. %d candidate projects this run; %d newly added; %d total rows in %s",
        len(unique_records),
        added,
        total,
        output,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Monitor public Florida websites for future "
            "transmission/substation plans."
        )
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"CSV path (default: {DEFAULT_OUTPUT})",
    )

    parser.add_argument(
        "--snapshots",
        type=Path,
        default=DEFAULT_SNAPSHOT_DIR,
        help=f"Raw-text snapshot directory (default: {DEFAULT_SNAPSHOT_DIR})",
    )

    parser.add_argument(
        "--weekly",
        action="store_true",
        help=(
            "Run immediately, then repeat every 7 days. "
            "For production, an OS scheduler is preferred."
        ),
    )

    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not args.weekly:
        run_once(
            args.output,
            args.snapshots,
        )
        return

    while True:
        try:
            run_once(
                args.output,
                args.snapshots,
            )
        except Exception:
            logging.exception("Weekly run failed")

        logging.info("Sleeping for 7 days...")
        time.sleep(WEEK_SECONDS)


if __name__ == "__main__":
    main()
