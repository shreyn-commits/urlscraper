from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

TRACKING_PARAMS = {
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "src",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}

TRACKING_DOMAINS = {
    "bit.ly",
    "buff.ly",
    "l.facebook.com",
    "lnkd.in",
    "t.co",
    "tinyurl.com",
    "trk.linkedin.com",
    "www.facebook.com",
}

SOCIAL_DOMAINS = {
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "reddit.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "youtu.be",
}

COMMON_SECOND_LEVEL_SUFFIXES = {"ac", "co", "com", "edu", "gov", "net", "org"}


def collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return url.strip()

    kept_query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False) if k not in TRACKING_PARAMS]
    clean = parsed._replace(fragment="", query=urlencode(kept_query, doseq=True), path=parsed.path or "")
    return urlunparse(clean)


def _split_host(host: str) -> list[str]:
    host = host.lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    return [part for part in host.split(".") if part]


def registrable_domain(host: str) -> str:
    host = host.lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    if not host or host.count(".") == 0 or re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host):
        return host

    parts = _split_host(host)
    if len(parts) <= 2:
        return ".".join(parts)

    if len(parts[-1]) == 2 and len(parts) >= 3 and parts[-2] in COMMON_SECOND_LEVEL_SUFFIXES:
        return ".".join(parts[-3:])

    return ".".join(parts[-2:])


def host_from_url(url: str) -> str:
    parsed = urlparse(url)
    return (parsed.hostname or parsed.netloc or "").lower()


def domain_from_url(url: str) -> str:
    return registrable_domain(host_from_url(url))


def normalize_website(url: str) -> str | None:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return None
    domain = registrable_domain(parsed.hostname or parsed.netloc)
    return f"{parsed.scheme}://{domain}" if domain else None


def is_tracking_or_social(url: str) -> bool:
    host = domain_from_url(url)
    if not host:
        return True
    return host in TRACKING_DOMAINS or host in SOCIAL_DOMAINS


def clean_company_name(name: str) -> str:
    text = collapse_whitespace(name)
    text = re.sub(r'^[\\"\']+|[\\"\']+$', "", text).strip()
    text = re.sub(r"\s*[|·•/\\]+\s*", " ", text)
    text = re.sub(r"\b(official site|homepage|home page|website|about us)\b", "", text, flags=re.I)
    text = collapse_whitespace(text)
    return text.rstrip(" -|:")


def split_title_candidate(text: str) -> str:
    cleaned = collapse_whitespace(text)
    if not cleaned:
        return ""

    separators = [r"\s+\|\s+", r"\s+•\s+", r"\s+·\s+", r"\s+-\s+", r"\s+—\s+", r"\s+/\s+"]
    for separator in separators:
        if re.search(separator, cleaned):
            pieces = [piece.strip() for piece in re.split(separator, cleaned) if piece.strip()]
            if pieces:
                cleaned = pieces[0]
                break

    return collapse_whitespace(clean_company_name(cleaned))


def infer_company_name_from_domain(domain: str) -> str | None:
    if not domain:
        return None
    parts = _split_host(domain)
    if len(parts) < 2:
        return None
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in COMMON_SECOND_LEVEL_SUFFIXES:
        slug = parts[-3]
    else:
        slug = parts[-2]
    slug = re.sub(r"^(app|www|m|mobile|blog|api|shop|store|go|links?)$", "", slug, flags=re.I)
    slug = slug.strip("-_")
    if not slug:
        return None
    words = [word for word in re.split(r"[-_]+", slug) if word]
    cleaned = " ".join(word.capitalize() if word.islower() else word for word in words)
    return collapse_whitespace(cleaned) or None


def title_case_from_text(text: str) -> str | None:
    cleaned = split_title_candidate(text)
    if not cleaned or len(cleaned) > 120:
        return None
    return cleaned

