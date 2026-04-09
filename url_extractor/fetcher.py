from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import httpx

from .cleaning import normalize_url


@dataclass(slots=True)
class FetchResult:
    url: str
    final_url: str
    status_code: int
    html: str
    content_type: str | None = None
    elapsed_ms: int | None = None


@dataclass(slots=True)
class Fetcher:
    timeout_seconds: float = 15.0
    retries: int = 2
    concurrency: int = 8
    headers: dict[str, str] = field(default_factory=lambda: {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
    })

    def __post_init__(self) -> None:
        self._cache: dict[str, FetchResult | None] = {}
        self._semaphore = asyncio.Semaphore(self.concurrency)

    async def fetch(self, client: httpx.AsyncClient, url: str) -> FetchResult | None:
        normalized = normalize_url(url)
        if normalized in self._cache:
            return self._cache[normalized]

        async with self._semaphore:
            result = await self._fetch_with_retries(client, normalized)
            self._cache[normalized] = result
            return result

    async def _fetch_with_retries(self, client: httpx.AsyncClient, url: str) -> FetchResult | None:
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                response = await client.get(url, headers=self.headers, follow_redirects=True)
                content_type = response.headers.get("content-type", "")
                if response.status_code >= 400:
                    return None
                if "html" not in content_type.lower() and "xml" not in content_type.lower():
                    return None
                html = response.text
                if not html.strip():
                    return None
                elapsed_ms = int(response.elapsed.total_seconds() * 1000) if response.elapsed else None
                return FetchResult(
                    url=url,
                    final_url=str(response.url),
                    status_code=response.status_code,
                    html=html,
                    content_type=content_type,
                    elapsed_ms=elapsed_ms,
                )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt < self.retries:
                    await asyncio.sleep(0.4 * (2**attempt))
                continue
            except Exception as exc:  # pragma: no cover - defensive
                last_error = exc
                break

        _ = last_error
        return None
