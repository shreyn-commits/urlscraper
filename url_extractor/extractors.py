from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from .cleaning import (
    clean_company_name,
    collapse_whitespace,
    domain_from_url,
    infer_company_name_from_domain,
    is_tracking_or_social,
    normalize_url,
    normalize_website,
    title_case_from_text,
)


ORGANIZATION_TYPES = {
    "organization",
    "corporation",
    "company",
    "localbusiness",
    "brand",
}


@dataclass(slots=True)
class Candidate:
    value: str
    confidence: float
    source: str


def _iter_jsonld_nodes(obj: Any) -> Iterable[dict[str, Any]]:
    if isinstance(obj, dict):
        yield obj
        graph = obj.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from _iter_jsonld_nodes(item)
    elif isinstance(obj, list):
        for item in obj:
            yield from _iter_jsonld_nodes(item)


def _parse_jsonld(script_text: str) -> list[dict[str, Any]]:
    text = script_text.strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    return list(_iter_jsonld_nodes(parsed))


def _type_matches_organization(value: Any) -> bool:
    if isinstance(value, str):
        return value.lower() in ORGANIZATION_TYPES
    if isinstance(value, list):
        return any(_type_matches_organization(item) for item in value)
    return False


def extract_metadata_candidates(soup: BeautifulSoup) -> tuple[list[Candidate], list[Candidate], list[Candidate]]:
    name_candidates: list[Candidate] = []
    website_candidates: list[Candidate] = []
    linkedin_candidates: list[Candidate] = []

    def add_name(value: str | None, confidence: float, source: str) -> None:
        cleaned = title_case_from_text(value or "")
        if cleaned:
            name_candidates.append(Candidate(cleaned, confidence, source))

    def add_website(value: str | None, confidence: float, source: str) -> None:
        normalized = normalize_website(value or "")
        if normalized:
            website_candidates.append(Candidate(normalized, confidence, source))

    def add_linkedin(value: str | None, confidence: float, source: str) -> None:
        normalized = normalize_url(value or "")
        if "linkedin.com/company/" in normalized:
            linkedin_candidates.append(Candidate(normalized, confidence, source))
        elif "linkedin.com/in/" in normalized:
            linkedin_candidates.append(Candidate(normalized, confidence, source))

    for meta in soup.find_all("meta"):
        key = (meta.get("property") or meta.get("name") or meta.get("itemprop") or "").strip().lower()
        content = collapse_whitespace(meta.get("content") or "")
        if not content:
            continue
        if key == "og:site_name":
            add_name(content, 0.85, "meta:og:site_name")
        elif key in {"og:title", "twitter:title", "title"}:
            add_name(content, 0.55, f"meta:{key}")
        elif key in {"application-name", "author", "article:author"}:
            add_name(content, 0.2, f"meta:{key}")
        elif key in {"og:url", "twitter:url", "url"}:
            add_website(content, 0.8, f"meta:{key}")

    for script in soup.find_all("script", attrs={"type": re.compile(r"ld\+json", re.I)}):
        for node in _parse_jsonld(script.get_text(" ", strip=True)):
            if not _type_matches_organization(node.get("@type")):
                continue
            name = node.get("name")
            url = node.get("url")
            same_as = node.get("sameAs")
            if isinstance(name, str):
                add_name(name, 0.9, "jsonld:organization.name")
            if isinstance(url, str):
                add_website(url, 0.95, "jsonld:organization.url")
            if isinstance(same_as, str):
                if "linkedin.com/" in same_as:
                    add_linkedin(same_as, 0.95, "jsonld:organization.sameAs")
            elif isinstance(same_as, list):
                for item in same_as:
                    if isinstance(item, str) and "linkedin.com/" in item:
                        add_linkedin(item, 0.95, "jsonld:organization.sameAs")

    return name_candidates, website_candidates, linkedin_candidates


def extract_link_candidates(soup: BeautifulSoup, source_url: str) -> tuple[list[Candidate], list[Candidate]]:
    website_candidates: list[Candidate] = []
    linkedin_candidates: list[Candidate] = []
    source_domain = domain_from_url(source_url)

    for anchor in soup.find_all("a", href=True):
        href = collapse_whitespace(anchor.get("href") or "")
        if not href:
            continue
        absolute = urljoin(source_url, href)
        normalized = normalize_url(absolute)
        domain = domain_from_url(normalized)

        text = collapse_whitespace(anchor.get_text(" ", strip=True))
        if "linkedin.com/company/" in normalized:
            linkedin_candidates.append(Candidate(normalized, 0.95, "link:linkedin-company"))
            continue
        elif "linkedin.com/in/" in normalized:
            if any(token in text.lower() for token in ("company", "official", "brand", "startup", "business")):
                linkedin_candidates.append(Candidate(normalized, 0.45, "link:linkedin-profile"))
            continue

        if not domain or is_tracking_or_social(normalized):
            continue

        if domain != source_domain:
            website_candidates.append(Candidate(normalize_website(normalized) or normalized, 0.9, "link:external"))

    return website_candidates, linkedin_candidates


def extract_content_candidates(soup: BeautifulSoup, source_url: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    text_blob = collapse_whitespace(soup.get_text(" ", strip=True))
    if not text_blob:
        return candidates

    patterns = [
        (r"(?:^|[\.\n])\s*Company\s*:\s*([A-Z0-9][^|\n]{1,80})", 0.7, "content:company-label"),
        (r"(?:^|[\.\n])\s*About\s*:\s*([A-Z0-9][^|\n]{1,80})", 0.6, "content:about-label"),
        (r"\bWe are\s+([A-Z][A-Za-z0-9&'().,\-\s]{1,80})", 0.55, "content:we-are"),
        (r"\bFounded by\s+([A-Z][A-Za-z0-9&'().,\-\s]{1,80})", 0.35, "content:founded-by"),
    ]
    for pattern, confidence, source in patterns:
        match = re.search(pattern, text_blob, flags=re.I)
        if match:
            candidate = clean_company_name(match.group(1))
            candidate = re.split(r"[|•·\n\r\t]", candidate)[0].strip()
            if candidate and len(candidate) <= 120:
                candidates.append(Candidate(candidate, confidence, source))

    for heading in soup.find_all(["h1", "h2", "h3"]):
        heading_text = title_case_from_text(heading.get_text(" ", strip=True))
        if heading_text:
            candidates.append(Candidate(heading_text, 0.65, f"heading:{heading.name}"))

    for strong in soup.find_all(["strong", "b"]):
        text = title_case_from_text(strong.get_text(" ", strip=True))
        if text and 2 <= len(text) <= 80:
            candidates.append(Candidate(text, 0.45, f"bold:{strong.name}"))

    if source_url and "reddit.com" in domain_from_url(source_url):
        for anchor in soup.find_all("a", href=True):
            text = collapse_whitespace(anchor.get_text(" ", strip=True))
            if text and len(text.split()) <= 6 and any(char.isalpha() for char in text):
                candidates.append(Candidate(text, 0.3, "reddit:anchor-text"))

    return candidates


def extract_domain_candidates(source_url: str) -> tuple[list[Candidate], list[Candidate], list[Candidate]]:
    website_candidates: list[Candidate] = []
    name_candidates: list[Candidate] = []
    linkedin_candidates: list[Candidate] = []

    website = normalize_website(source_url)
    if website:
        website_candidates.append(Candidate(website, 0.8, "domain:source"))

    inferred_name = infer_company_name_from_domain(domain_from_url(source_url))
    if inferred_name:
        name_candidates.append(Candidate(inferred_name, 0.35, "domain:inferred-name"))

    return name_candidates, website_candidates, linkedin_candidates


def select_best_candidate(candidates: list[Candidate], threshold: float) -> Candidate | None:
    if not candidates:
        return None
    best = max(candidates, key=lambda candidate: candidate.confidence)
    return best if best.confidence >= threshold else None


def is_likely_company_site(source_url: str) -> bool:
    domain = domain_from_url(source_url)
    if not domain:
        return False
    if any(marker in domain for marker in ("reddit.com", "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com")):
        return False
    return True
