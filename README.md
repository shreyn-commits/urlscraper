# URL Scraper

Async, URL-based company extraction with layered heuristics for publicly accessible pages.

## What it extracts

- `company_name`
- `website`
- `linkedin_url`

## Project Structure

```text
main.py
pyproject.toml
requirements.txt
url_extractor/
  __init__.py
  __main__.py
  cleaning.py
  cli.py
  extractors.py
  fetcher.py
  models.py
  pipeline.py
```

## Install

```bash
pip install -r requirements.txt
```

## Run

Single URL:

```bash
python main.py --url https://example.com
```

Batch from JSON:

```bash
python main.py --input urls.json --output results.json
```

Batch from CSV:

```bash
python main.py --input urls.csv --output results.json
```

## Input Formats

JSON:

```json
[
  "https://www.reddit.com/r/startups/comments/xyz",
  "https://directorysite.com/company/abc",
  "https://forum.com/thread/123"
]
```

CSV:

```csv
url
https://example.com
https://example.org
```

## Output Schema

```json
{
  "url": "https://example.com",
  "company_name": "Example",
  "website": "https://example.com",
  "linkedin_url": "https://www.linkedin.com/company/example",
  "confidence_score": 0.9
}
```

If the extractor cannot reach a confidence threshold for a field, that field is returned as `null` rather than guessed.

## Extraction Logic

The pipeline uses five layers:

1. Structured metadata
   - `og:site_name`
   - `og:title`
   - JSON-LD `Organization`
   - `meta[name="author"]`
   - `sameAs` and organization URLs
2. Link analysis
   - scans all anchor tags
   - prefers LinkedIn company links
   - picks external websites while ignoring social and tracking domains
3. Content heuristics
   - looks for patterns like `Company:`, `About:`, `We are`, `Founded by`
   - checks headings and bold text
4. Domain inference
   - infers a company name from the URL domain when the page looks like a company site
5. Reddit/forum handling
   - relies on the document order of outbound links so post-body links are preferred
   - does not crawl additional pages

## Confidence Policy

- `company_name` is accepted from strong metadata, heading, content, or corroborated domain inference.
- `website` is accepted from external links or strong source-domain inference.
- `linkedin_url` is accepted only from explicit company-oriented LinkedIn signals.
- The final `confidence_score` is capped at `1.0`.
