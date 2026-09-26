#!/usr/bin/env python3
"""
load_projects_to_mongo.py

Load florida_future_grid_projects.csv into the GridClusterDB MongoDB cluster.

Each CSV row becomes one document. Rows are matched on project_id, so running
the script again updates existing projects instead of inserting duplicates.
Numeric fields, including latitude and longitude, are stored as numbers.
Missing numbers are 0 and missing text is NA.

The database user and password are read from .env (MONGO_USER, MONGO_PASSWORD).
A full connection string in MONGODB_URI or --uri overrides that file.

Example:
    python load_projects_to_mongo.py
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

from pymongo import MongoClient, UpdateOne
from pymongo.errors import PyMongoError

from florida_grid_monitor import MISSING_TEXT, NUMERIC_FIELDS

DEFAULT_CSV = Path("florida_future_grid_projects.csv")
DEFAULT_DATABASE = "florida_grid"
DEFAULT_COLLECTION = "projects"
BATCH_SIZE = 500

CLUSTER_HOST = "gridclusterdb.zn0i2ye.mongodb.net"
ENV_FILE = Path(".env")


def load_env_file(path: Path = ENV_FILE) -> None:
    """Load KEY=VALUE pairs from .env. Existing environment variables win."""
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def connection_uri(explicit_uri: str) -> str:
    load_env_file()

    if explicit_uri:
        return explicit_uri

    env_uri = os.environ.get("MONGODB_URI", "").strip()
    if env_uri:
        return env_uri

    user = os.environ.get("MONGO_USER", "").strip()
    password = os.environ.get("MONGO_PASSWORD", "")
    if not user or not password:
        raise SystemExit(
            "Put MONGO_USER and MONGO_PASSWORD in .env, "
            "or set MONGODB_URI to a full connection string."
        )

    return (
        f"mongodb+srv://{quote_plus(user)}:{quote_plus(password)}"
        f"@{CLUSTER_HOST}/?appName=GridClusterDB"
    )


def coerce_value(field: str, value: str):
    text = (value or "").strip()

    if field in NUMERIC_FIELDS:
        if text in {"", MISSING_TEXT}:
            return 0
        try:
            number = float(text)
        except ValueError:
            return 0
        if number == 0:
            return 0
        if field in {"latitude", "longitude"} or not number.is_integer():
            return number
        return int(number)

    return text or MISSING_TEXT


def load_rows(path: Path) -> tuple[list[dict], int]:
    if not path.exists():
        raise SystemExit(f"CSV not found: {path}")

    documents = []
    skipped = 0

    with path.open("r", newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            project_id = (row.get("project_id") or "").strip()
            if not project_id:
                skipped += 1
                continue
            documents.append(
                {field: coerce_value(field, raw) for field, raw in row.items()}
            )

    return documents, skipped


def upsert_documents(collection, documents: list[dict]) -> tuple[int, int]:
    inserted = 0
    updated = 0

    for start in range(0, len(documents), BATCH_SIZE):
        batch = documents[start : start + BATCH_SIZE]
        operations = [
            UpdateOne(
                {"project_id": document["project_id"]},
                {"$set": document},
                upsert=True,
            )
            for document in batch
        ]
        result = collection.bulk_write(operations, ordered=False)
        inserted += result.upserted_count
        updated += result.modified_count

    return inserted, updated


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Upsert Florida grid-project CSV rows into MongoDB."
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV,
        help=f"CSV to load. Default: {DEFAULT_CSV}",
    )
    parser.add_argument(
        "--database",
        default=DEFAULT_DATABASE,
        help=f"Database name. Default: {DEFAULT_DATABASE}",
    )
    parser.add_argument(
        "--collection",
        default=DEFAULT_COLLECTION,
        help=f"Collection name. Default: {DEFAULT_COLLECTION}",
    )
    parser.add_argument(
        "--uri",
        default="",
        help="Full MongoDB URI. Overrides MONGO_PASSWORD and MONGODB_URI.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read the CSV and report the row count without connecting.",
    )
    args = parser.parse_args(argv)

    documents, skipped = load_rows(args.csv)
    print(f"Read {len(documents)} projects from {args.csv}")
    if skipped:
        print(f"Skipped {skipped} rows with no project_id")

    if args.dry_run:
        print("Dry run only. Nothing was written.")
        return 0

    if not documents:
        print("No projects to load.")
        return 0

    uri = connection_uri(args.uri)
    client = MongoClient(uri, serverSelectionTimeoutMS=15000)

    try:
        client.admin.command("ping")
        collection = client[args.database][args.collection]
        collection.create_index("project_id", unique=True)
        inserted, updated = upsert_documents(collection, documents)
    except PyMongoError as exc:
        print(f"MongoDB error: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()

    unchanged = len(documents) - inserted - updated
    print(
        f"Wrote {args.database}.{args.collection}: "
        f"{inserted} inserted, {updated} updated, {unchanged} unchanged"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
