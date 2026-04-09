const TRACKING_PARAMS = new Set([
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
]);

const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
]);

const COMMON_SECOND_LEVEL_SUFFIXES = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);

function collapseWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const headers = ["url", "company_name", "website", "linkedin_url", "confidence_score"];
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))].join("\n");
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function registrableDomain(host) {
  host = String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".")) {
    return host;
  }

  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }

  if (parts[parts.length - 1].length === 2 && COMMON_SECOND_LEVEL_SUFFIXES.has(parts[parts.length - 2])) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function domainFromUrl(rawUrl) {
  return registrableDomain(hostFromUrl(rawUrl));
}

function normalizeUrl(rawUrl) {
  try {
    const input = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(rawUrl || "").trim();
  }
}

function normalizeWebsite(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const domain = registrableDomain(url.hostname);
    return domain ? `${url.protocol}//${domain}` : null;
  } catch {
    return null;
  }
}

function buildFetchCandidates(rawUrl) {
  const candidates = [];
  const normalized = normalizeUrl(rawUrl);
  const withHttps = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;

  try {
    const url = new URL(withHttps);
    candidates.push(url.toString());

    if (url.hostname === "reddit.com" || url.hostname === "www.reddit.com") {
      const oldReddit = new URL(url.toString());
      oldReddit.hostname = "old.reddit.com";
      candidates.push(oldReddit.toString());
    }

    if (url.hostname.startsWith("www.")) {
      const noWww = new URL(url.toString());
      noWww.hostname = url.hostname.replace(/^www\./, "");
      candidates.push(noWww.toString());
    } else if (!url.hostname.startsWith("www.") && !url.hostname.startsWith("old.")) {
      const withWww = new URL(url.toString());
      withWww.hostname = `www.${url.hostname}`;
      candidates.push(withWww.toString());
    }
  } catch {
    candidates.push(withHttps);
  }

  return [...new Set(candidates)];
}

function isTrackingOrSocial(rawUrl) {
  const domain = domainFromUrl(rawUrl);
  return !domain || SOCIAL_DOMAINS.has(domain) || domain.includes("tracking") || domain.includes("doubleclick");
}

function cleanCompanyName(name) {
  let text = collapseWhitespace(name);
  text = text.replace(/^["'()\[\]]+|["'()\[\]]+$/g, "");
  text = text.replace(/\s*[|./\\]+\s*/g, " ");
  text = text.replace(/\b(official site|homepage|home page|website|about us)\b/gi, "");
  return collapseWhitespace(text).replace(/[\s\-|:]+$/, "");
}

function splitTitleCandidate(text) {
  let cleaned = collapseWhitespace(text);
  if (!cleaned) {
    return "";
  }

  for (const separator of [/\s+\|\s+/, /\s+-\s+/, /\s+\/\s+/]) {
    if (separator.test(cleaned)) {
      const parts = cleaned.split(separator).map((part) => part.trim()).filter(Boolean);
      if (parts.length) {
        cleaned = parts[0];
        break;
      }
    }
  }

  return collapseWhitespace(cleanCompanyName(cleaned));
}

function inferCompanyNameFromDomain(domain) {
  if (!domain) {
    return null;
  }

  const parts = String(domain).toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const slug =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && COMMON_SECOND_LEVEL_SUFFIXES.has(parts[parts.length - 2])
      ? parts[parts.length - 3]
      : parts[parts.length - 2];
  const safe = slug.replace(/^(app|www|m|mobile|blog|api|shop|store|go|links?)$/i, "").replace(/^[-_]+|[-_]+$/g, "");
  if (!safe) {
    return null;
  }

  return collapseWhitespace(
    safe
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => (word === word.toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word))
      .join(" ")
  );
}

function extractMetaContent(html, names) {
  const values = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const match = html.match(regex);
    if (match) {
      values.push(collapseWhitespace(match[1]));
    }
  }
  return values;
}

function extractJsonLd(html) {
  const items = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const raw = collapseWhitespace(match[1]);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object") {
          items.push(node);
          if (Array.isArray(node["@graph"])) {
            for (const sub of node["@graph"]) {
              if (sub && typeof sub === "object") {
                items.push(sub);
              }
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return items;
}

function stripTags(html) {
  return collapseWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function findCompanyName(html, sourceUrl) {
  const metaCandidates = extractMetaContent(html, ["og:site_name", "application-name", "author", "og:title"]);
  const meta = metaCandidates.find(Boolean);
  if (meta) {
    const cleaned = splitTitleCandidate(meta);
    if (cleaned) {
      return { value: cleaned, source: "metadata" };
    }
  }

  for (const node of extractJsonLd(html)) {
    const typeValue = node["@type"];
    const typeText = Array.isArray(typeValue) ? typeValue.join(" ") : String(typeValue || "");
    if (/organization|corporation|company|brand|localbusiness/i.test(typeText)) {
      const name = cleanCompanyName(node.name || "");
      if (name) {
        return { value: name, source: "jsonld" };
      }
    }
  }

  const text = stripTags(html);
  const patterns = [
    /(?:^|[.\n])\s*Company\s*:\s*([A-Z0-9][^|\n]{1,80})/i,
    /(?:^|[.\n])\s*About\s*:\s*([A-Z0-9][^|\n]{1,80})/i,
    /\bWe are\s+([A-Z][A-Za-z0-9&'().,\-\s]{1,80})/i,
    /\bFounded by\s+([A-Z][A-Za-z0-9&'().,\-\s]{1,80})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const cleaned = cleanCompanyName(match[1]);
      if (cleaned) {
        return { value: cleaned, source: "content" };
      }
    }
  }

  for (const selector of [/<h[1-3][^>]*>([\s\S]{1,160}?)<\/h[1-3]>/i, /<(?:strong|b)[^>]*>([\s\S]{1,120}?)<\/(?:strong|b)>/i]) {
    const match = html.match(selector);
    if (match) {
      const cleaned = cleanCompanyName(match[1]);
      if (cleaned) {
        return { value: cleaned, source: "content" };
      }
    }
  }

  const inferred = inferCompanyNameFromDomain(domainFromUrl(sourceUrl));
  if (inferred) {
    return { value: inferred, source: "domain" };
  }

  return { value: null, source: null };
}

function pickWebsite(html, sourceUrl) {
  const sourceDomain = domainFromUrl(sourceUrl);
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const href = normalizeUrl(match[1]);
    if (href.includes("linkedin.com/company/")) {
      continue;
    }
    const domain = domainFromUrl(href);
    if (!domain || isTrackingOrSocial(href) || domain === sourceDomain) {
      continue;
    }
    const normalized = normalizeWebsite(href);
    if (normalized) {
      return normalized;
    }
  }

  for (const node of extractJsonLd(html)) {
    if (typeof node.url === "string") {
      const normalized = normalizeWebsite(node.url);
      if (normalized) {
        return normalized;
      }
    }
  }

  return normalizeWebsite(sourceUrl);
}

function pickLinkedIn(html) {
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const href = normalizeUrl(match[1]);
    if (href.includes("linkedin.com/company/")) {
      return href;
    }
  }

  for (const node of extractJsonLd(html)) {
    const sameAs = node.sameAs;
    if (Array.isArray(sameAs)) {
      for (const value of sameAs) {
        if (typeof value === "string" && value.includes("linkedin.com/company/")) {
          return normalizeUrl(value);
        }
      }
    } else if (typeof sameAs === "string" && sameAs.includes("linkedin.com/company/")) {
      return normalizeUrl(sameAs);
    }
  }

  return null;
}

function computeConfidence({ companyName, website, linkedinUrl, companySource }) {
  let score = 0;
  if (linkedinUrl) score += 0.4;
  if (website) score += 0.3;
  if (companyName) {
    if (companySource === "metadata" || companySource === "jsonld") score += 0.2;
    else if (companySource === "domain") score += 0.1;
    else score += 0.15;
  }
  return Math.min(1, Number(score.toFixed(2)));
}

async function scrapeUrl(url) {
  const normalizedInput = normalizeUrl(url);
  const candidates = buildFetchCandidates(normalizedInput);
  let response = null;
  let lastStatus = null;

  for (const candidate of candidates) {
    response = await fetch(candidate, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: new URL(candidate).origin,
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });

    if (response.ok) {
      break;
    }

    lastStatus = response.status;
    if (![403, 404, 429].includes(response.status)) {
      break;
    }
  }

  if (!response || !response.ok) {
    throw new Error(
      lastStatus === 403
        ? "The target site blocked the scrape request with a 403. Try a more public URL or a company homepage."
        : `Request failed with status ${lastStatus || "unknown"}`
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/html|xml/i.test(contentType)) {
    throw new Error("The URL did not return HTML content.");
  }

  const html = await response.text();
  if (!html.trim()) {
    throw new Error("The page returned no HTML.");
  }

  const company = findCompanyName(html, response.url);
  let company_name = company.value;
  const companySource = company.source;
  let website = pickWebsite(html, response.url);
  let linkedin_url = pickLinkedIn(html);

  if (website && isTrackingOrSocial(website)) {
    website = null;
  }

  if (linkedin_url && !linkedin_url.includes("linkedin.com/company/")) {
    linkedin_url = null;
  }

  if (company_name && company_name.length > 120) {
    company_name = null;
  }

  const confidence_score = computeConfidence({ companyName: company_name, website, linkedinUrl: linkedin_url, companySource });

  if (company_name && confidence_score < 0.2) company_name = null;
  if (website && confidence_score < 0.3) website = null;
  if (linkedin_url && confidence_score < 0.4) linkedin_url = null;

  return {
    url: normalizedInput,
    company_name,
    website,
    linkedin_url,
    confidence_score,
  };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
    });

    const rawUrl = collapseWhitespace(body.url || body.input || "");
    if (!rawUrl) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Provide a public URL." }));
    }

    const row = await scrapeUrl(rawUrl);
    const csv = toCsv([row]);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ rows: [row], csv }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message || "Scrape failed" }));
  }
}

module.exports = handler;
