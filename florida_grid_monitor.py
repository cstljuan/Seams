#!/usr/bin/env python3
"""
florida_grid_monitor.py

Weekly monitor for public Florida planning_company / regulator websites that may publish
future electric transmission-line and substation projects.

The script:
1. Crawls a curated set of public Florida sources.
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
import logging
import re
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

USER_AGENT = (
    "FloridaGridPlanMonitor/3.0 "
    "(public-data research; weekly low-rate crawler)"
)

DEFAULT_OUTPUT = Path("florida_future_grid_projects.csv")
DEFAULT_SNAPSHOT_DIR = Path("grid_monitor_snapshots")

REQUEST_TIMEOUT = 30
RATE_LIMIT_SECONDS = 1.25
WEEK_SECONDS = 7 * 24 * 60 * 60

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
    {
        "name": "Florida PSC - Ten-Year Site Plans",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://www.psc.state.fl.us/ten-year-site-plans",
        "max_pages": 12,
    },
    {
        "name": "Florida DEP - Siting Coordination Office",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://floridadep.gov/program-content/water/siting-coordination-office",
        "max_pages": 18,
    },
    {
        "name": "FPL - Ten-Year Site Plan",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/content/dam/fplgp/us/en/about/pdf/ten-year-site-plan.pdf",
        "max_pages": 1,
    },
    {
        "name": "FPL - Transmission Projects",
        "company_hint": "Florida Power & Light",
        "url": "https://www.fpl.com/reliability/andytown-oasis-project.html",
        "max_pages": 8,
    },
    {
        "name": "Duke Energy Florida - News / Grid",
        "company_hint": "Duke Energy Florida",
        "url": "https://news.duke-energy.com/releases?c=23893",
        "max_pages": 10,
    },
    {
        "name": "Tampa Electric - Current Grid Projects",
        "company_hint": "Tampa Electric",
        "url": "https://www.tampaelectric.com/company/ourpowersystem/projects/",
        "max_pages": 10,
    },
    {
        "name": "FRCC - Order 1000 / Regional Planning",
        "company_hint": "Multiple Florida Utilities",
        "url": "https://www.frcc.com/order1000/",
        "max_pages": 12,
    },
    {
        "name": "JEA - Capital / Transmission Projects",
        "company_hint": "JEA",
        "url": "https://www.jea.com/About/Procurement/Current_Bid_Openings/",
        "max_pages": 10,
    },
    {
        "name": "OUC - News / Infrastructure",
        "company_hint": "Orlando Utilities Commission",
        "url": "https://www.ouc.com/about/news/",
        "max_pages": 10,
    },
    {
        "name": "Gainesville Regional Utilities - Public Meetings",
        "company_hint": "Gainesville Regional Utilities",
        "url": "https://www.gru.com/OurCompany/GRUAuthority.aspx",
        "max_pages": 10,
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

    starting_substation: str
    ending_substation: str
    voltage_kv: str
    approximate_line_mileage: str
    counties_crossed: str
    regulatory_case_number: str
    filing_dates: str

    projected_year: str
    cost: str
    construction_time: str
    projected_locations: str

    source_name: str
    source_url: str
    source_excerpt: str

    first_seen: str
    last_seen: str
    active: str = "yes"


CSV_FIELDS = [f.name for f in ProjectRecord.__dataclass_fields__.values()]


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


def extract_records(source: dict, url: str, text: str, now: str) -> list[ProjectRecord]:
    records = []

    for block in split_candidate_blocks(text):
        planning_company = detect_company(block, source["company_hint"])
        project_type = detect_type(block)
        projected_year = detect_year(block)
        cost = detect_cost(block)
        construction_time = detect_duration(block)

        start_substation, end_substation = detect_substations(block)
        counties = detect_counties(block)
        case_number = detect_case_number(block)
        filing_dates = detect_filing_dates(block)

        voltage = detect_voltage(block)
        mileage = detect_miles(block)

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
        ):
            continue

        project_id = make_project_id(
            planning_company,
            project_name,
            start_substation,
            end_substation,
            voltage,
            case_number,
        )

        records.append(
            ProjectRecord(
                project_id=key,

                planning_company=planning_company,
                project_name=project_name,
                starting_substation=start_substation,
                ending_substation=end_substation,
                voltage_kv=voltage,
                approximate_line_mileage=mileage,
                counties_crossed=counties,
                regulatory_case_number=case_number,
                filing_dates=filing_dates,

                project_type=project_type,
                projected_year=projected_year,
                cost=cost,
                construction_time=construction_time,
                projected_locations=projected_locations,

                source_name=source["name"],
                source_url=url,
                source_excerpt=block[:1800],

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
                r.get("planning_company", ""),
                r.get("projected_year", ""),
                r.get("project_name", ""),
            ),
        ):
            writer.writerow(
                {field: row.get(field, "") for field in CSV_FIELDS}
            )

    return added, len(old)


def run_once(output: Path, snapshot_dir: Path) -> None:
    now = utc_now()
    session = get_session()
    all_records = []

    for source in SOURCES:
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

            source_records.extend(
                extract_records(
                    source,
                    url,
                    text,
                    now,
                )
            )

        logging.info(
            "  Extracted %d candidate record(s)",
            len(source_records),
        )

        all_records.extend(source_records)

    best = {}

    for record in all_records:
        score = sum(
            bool(value)
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
                record.projected_locations,
            ]
        )

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
