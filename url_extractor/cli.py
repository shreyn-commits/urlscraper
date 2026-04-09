from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Iterable

from .models import CompanyExtractionResult
from .pipeline import extract_many


def _read_urls_from_json(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [str(item).strip() for item in data if str(item).strip()]
    if isinstance(data, dict):
        for key in ("urls", "data", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [str(item).strip() for item in value if str(item).strip()]
    raise ValueError("JSON input must be a list of URLs or an object with a list under urls/data/items.")


def _read_urls_from_csv(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames:
            lower_fields = [field.lower() for field in reader.fieldnames]
            url_field = reader.fieldnames[lower_fields.index("url")] if "url" in lower_fields else reader.fieldnames[0]
            urls = []
            for row in reader:
                value = (row.get(url_field) or "").strip()
                if value:
                    urls.append(value)
            return urls
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        return [row[0].strip() for row in reader if row and row[0].strip()]


def _read_urls_from_file(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        return _read_urls_from_json(path)
    if suffix == ".csv":
        return _read_urls_from_csv(path)
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract company_name, website, and linkedin_url from URLs.")
    parser.add_argument("--input", type=str, help="Path to a JSON, CSV, or newline-delimited URL file.")
    parser.add_argument("--url", action="append", default=[], help="Single URL to process. Repeatable.")
    parser.add_argument("--output", type=str, help="Write results to this JSON file. Defaults to stdout.")
    parser.add_argument("--concurrency", type=int, default=8, help="Maximum concurrent fetches.")
    parser.add_argument("--timeout", type=float, default=15.0, help="Per-request timeout in seconds.")
    parser.add_argument("--retries", type=int, default=2, help="Fetch retries per URL.")
    return parser


def _collect_urls(args: argparse.Namespace) -> list[str]:
    urls: list[str] = []
    if args.input:
        urls.extend(_read_urls_from_file(Path(args.input)))
    urls.extend(args.url or [])
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        url = url.strip()
        if url and url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


def _dump_results(results: list[CompanyExtractionResult], output: str | None) -> None:
    payload = [result.model_dump() for result in results]
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if output:
        Path(output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    urls = _collect_urls(args)
    if not urls:
        parser.error("provide at least one URL via --input or --url")
        return 2

    results = __import__("asyncio").run(
        extract_many(
            urls,
            concurrency=args.concurrency,
            timeout=args.timeout,
            retries=args.retries,
        )
    )
    _dump_results(results, args.output)
    return 0

