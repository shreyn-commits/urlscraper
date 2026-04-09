from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .extractors import (
    extract_content_candidates,
    extract_domain_candidates,
    extract_link_candidates,
    extract_metadata_candidates,
    is_likely_company_site,
    select_best_candidate,
)
from .fetcher import Fetcher
from .models import CompanyExtractionResult
from .cleaning import collapse_whitespace, domain_from_url


@dataclass(slots=True)
class ExtractionContext:
    url: str
    final_url: str
    source_domain: str
    soup: BeautifulSoup
    html: str


def _parse_html(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


def _build_context(url: str, final_url: str, html: str) -> ExtractionContext:
    soup = _parse_html(html)
    return ExtractionContext(
        url=url,
        final_url=final_url,
        source_domain=domain_from_url(final_url or url),
        soup=soup,
        html=html,
    )


def _pick_company_name(ctx: ExtractionContext) -> tuple[str | None, float, str | None]:
    meta_names, _, _ = extract_metadata_candidates(ctx.soup)
    _, link_names = extract_link_candidates(ctx.soup, ctx.final_url)
    content_names = extract_content_candidates(ctx.soup, ctx.final_url)
    domain_names, _, _ = extract_domain_candidates(ctx.final_url)

    candidates = meta_names + content_names + domain_names
    best = select_best_candidate(candidates, threshold=0.45)
    if best:
        return best.value, best.confidence, best.source

    best_link = select_best_candidate(link_names, threshold=0.45)
    if best_link:
        return best_link.value, best_link.confidence, best_link.source

    if is_likely_company_site(ctx.final_url):
        best_domain = select_best_candidate(domain_names, threshold=0.35)
        if best_domain:
            return best_domain.value, best_domain.confidence, best_domain.source
    return None, 0.0, None


def _pick_website(ctx: ExtractionContext) -> tuple[str | None, float, str | None]:
    _, meta_websites, _ = extract_metadata_candidates(ctx.soup)
    link_websites, _ = extract_link_candidates(ctx.soup, ctx.final_url)
    _, domain_websites, _ = extract_domain_candidates(ctx.final_url)

    candidates = link_websites + meta_websites
    if is_likely_company_site(ctx.final_url):
        candidates += domain_websites

    best = select_best_candidate(candidates, threshold=0.65)
    if best:
        return best.value, best.confidence, best.source
    return None, 0.0, None


def _pick_linkedin(ctx: ExtractionContext) -> tuple[str | None, float, str | None]:
    _, _, meta_linkedins = extract_metadata_candidates(ctx.soup)
    _, link_linkedins = extract_link_candidates(ctx.soup, ctx.final_url)
    candidates = meta_linkedins + link_linkedins
    best = select_best_candidate(candidates, threshold=0.8)
    if best:
        return best.value, best.confidence, best.source
    return None, 0.0, None


def _normalize_output_url(url: str) -> str:
    return collapse_whitespace(url)


def _compute_confidence(
    company_name: str | None,
    company_name_source: str | None,
    website: str | None,
    website_source: str | None,
    linkedin_url: str | None,
    linkedin_source: str | None,
) -> float:
    score = 0.0
    if linkedin_url:
        score += 0.4 if "company" in (linkedin_source or "") or "jsonld" in (linkedin_source or "") else 0.3
    if website:
        score += 0.3 if "link:" in (website_source or "") or "jsonld" in (website_source or "") else 0.2
    if company_name:
        if company_name_source and company_name_source.startswith("meta"):
            score += 0.2
        elif company_name_source and company_name_source.startswith("jsonld"):
            score += 0.2
        elif company_name_source and company_name_source.startswith("heading"):
            score += 0.15
        elif company_name_source and company_name_source.startswith("domain:"):
            score += 0.1
        else:
            score += 0.1
    return round(min(score, 1.0), 2)


async def extract_single_url(client: httpx.AsyncClient, fetcher: Fetcher, url: str) -> CompanyExtractionResult:
    result = await fetcher.fetch(client, url)
    if not result:
        return CompanyExtractionResult(
            url=url,
            company_name=None,
            website=None,
            linkedin_url=None,
            confidence_score=0.0,
        )

    ctx = _build_context(url, result.final_url, result.html)
    company_name, company_source_score, company_source = _pick_company_name(ctx)
    website, website_source_score, website_source = _pick_website(ctx)
    linkedin_url, linkedin_source_score, linkedin_source = _pick_linkedin(ctx)

    # Demote weak guesses by nulling them out unless the signal is strong enough.
    if company_source_score < 0.45:
        company_name = None
        company_source = None
    if website_source_score < 0.65:
        website = None
        website_source = None
    if linkedin_source_score < 0.8:
        linkedin_url = None
        linkedin_source = None

    confidence = _compute_confidence(
        company_name=company_name,
        company_name_source=company_source,
        website=website,
        website_source=website_source,
        linkedin_url=linkedin_url,
        linkedin_source=linkedin_source,
    )

    return CompanyExtractionResult(
        url=_normalize_output_url(url),
        company_name=company_name,
        website=website,
        linkedin_url=linkedin_url,
        confidence_score=confidence,
    )


async def extract_many(urls: Iterable[str], concurrency: int = 8, timeout: float = 15.0, retries: int = 2) -> list[CompanyExtractionResult]:
    fetcher = Fetcher(timeout_seconds=timeout, retries=retries, concurrency=concurrency)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    timeout_config = httpx.Timeout(timeout)

    async with httpx.AsyncClient(limits=limits, timeout=timeout_config, trust_env=True) as client:
        import asyncio

        tasks = [extract_single_url(client, fetcher, url) for url in urls]
        return list(await asyncio.gather(*tasks))
