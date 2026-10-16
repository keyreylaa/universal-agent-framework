---
name: data-extraction
description: Choose the cheapest adequate retrieval method for a web target and extract data from it with validated, deduplicated output. Activates when a task requires harvesting data from websites, HTTP endpoints, or downloadable exports, including paginated listings, JSON APIs, HTML tables, RSS feeds, and sitemaps.
license: MIT
metadata:
  activation: contextual
  agents: claude, codex, opencode, omp
---

## Purpose

Extract data from web sources while spending the least effort that actually works. The first decision is the retrieval method, not the library: an official API or an existing export almost always beats parsing rendered HTML. This skill covers choosing a method, retrieving it safely, parsing defensively, and proving the extracted data matches an expected shape.

## When this activates

Activate when a task requires harvesting data from web pages, HTTP endpoints, or exports: paginated listings, tables, JSON endpoints, RSS, sitemaps, or bulk files.
Do not activate for a single page a human would read once; just fetch it. Do not activate when the requester already holds an official SDK, database, or exported dataset that answers the question. Do not activate to obtain data the requester is not authorized to access.

## Prerequisites

- Python 3 with `requests` and `beautifulsoup4` (optionally `lxml`); or Node.js 18+ with the built-in `fetch` and an HTML parser such as `cheerio`.
- The `scrapy` package only when the crawling-framework tier below is genuinely justified.
- Network egress to the target host.
If a library is absent, install it or fall back to the standard library (`urllib.request`, `html.parser`, `json`, `csv`), which covers tier 3 and below. Verify any flag or option against the tool's own `--help` before relying on it.

## Procedure

1. State the target and the exact requested fields: URLs, field list, and output format, written down before any code. Ambiguity here causes a re-scrape later.
2. Check the terms of service, `robots.txt` (`urllib.robotparser` is enough), and access requirements. If policy forbids automated collection, stop and report; robots is a policy signal, not an authorization grant.
3. Check for an official API or documented export first. If one exists, use it and skip the rest of this ladder.
4. Pick the simplest adequate retrieval method, arguing each rung explicitly:
   1. Official API or documented export. Documented, stable, authorized; one request, no parsing. Always try this first.
   2. Structured data already present: a JSON endpoint the page itself calls, embedded `application/ld+json`, RSS, a sitemap, or a bulk file. The site already publishes machine-readable data, so coupling to its HTML is unnecessary work.
   3. Plain HTTP request plus HTML parsing: `requests` + BeautifulSoup, or `fetch` + a parser. Adequate for static HTML with no script execution.
   4. Crawling framework (Scrapy). Justify only when breadth (many URLs), built-in retry/politeness, and item pipelines earn back the setup cost.
   5. Browser automation (Playwright/Puppeteer/Selenium). Use only when the data genuinely requires JavaScript execution that no request-level alternative provides. Otherwise it is pure overhead: slower, heavier, more brittle, and harder to make polite.
5. Validate input URLs: allow only `http`/`https` schemes and an explicit host allowlist; reject `localhost`, loopback, link-local, and private-range addresses to avoid server-side request forgery. Resolve the host and check it with `ipaddress` before fetching user-supplied URLs.
6. Set explicit timeouts on every request (connect and read). Never rely on a default.
7. Handle HTTP errors and retry with bounded backoff; treat `429`/`503` as "slow down", not "retry immediately":
   ```python
   import requests
   from requests.adapters import HTTPAdapter
   from urllib3.util.retry import Retry
   session = requests.Session()
   session.mount("https://", HTTPAdapter(max_retries=Retry(
       total=4, backoff_factor=0.5,                      # bounded exponential backoff
       status_forcelist=(429, 500, 502, 503, 504),       # 429 retried with backoff
       allowed_methods=("GET", "HEAD"),
   )))
   resp = session.get(url, timeout=(5, 20), headers={"User-Agent": UA})
   resp.raise_for_status()                               # raises only after retries exhaust
   ```
8. Respect rate limits and use conservative concurrency: serialize by default, and if parallelizing, keep the pool small and honor `Retry-After` and any published limit.
9. Parse defensively. Missing elements must not crash the run; skip and log the record instead. Basic static extraction:
   ```python
   from bs4 import BeautifulSoup
   soup = BeautifulSoup(resp.text, "html.parser")
   items = [{"id": c.get("data-id"), "title": t.get_text(strip=True)}
            for c in soup.select(".item") if (t := c.select_one(".title"))]  # skip missing
   ```
   Pagination: stop on an empty page, never on an assumed total:
   ```python
   page = 1
   while page <= MAX_PAGES:
       batch = parse_items(fetch(f"{base}?page={page}").text)
       if not batch:
           break
       items.extend(batch)
       page += 1
   ```
   Prefer a structured source when one exists; do not re-parse HTML for data a JSON endpoint already returns:
   ```python
   data = resp.json()                    # or json.loads(resp.text)
   items = data.get("results", [])
   ```
10. Deduplicate on a stable key (an id, or a normalized URL), not on list position.
11. Validate the output against an expected schema before persisting:
    ```python
    SCHEMA = {"id": str, "title": str, "price": float}
    valid = lambda i: all(k in i and isinstance(i[k], t) for k, t in SCHEMA.items())
    kept = [i for i in items if valid(i)]
    ```
12. Persist in an appropriate format. JSON for nested records, CSV for tabular rows:
    ```python
    import csv, json
    json.dump(kept, open("out.json", "w"), ensure_ascii=False, indent=2)
    with open("out.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(SCHEMA)); w.writeheader(); w.writerows(kept)
    ```
13. Test parsing against saved fixtures, not the live site, so tests stay deterministic:
    ```python
    import unittest
    from pathlib import Path
    class TestParse(unittest.TestCase):
        def test_items(self):
            html = Path("fixtures/listing.html").read_text()
            self.assertEqual(parse_items(html)[0]["id"], "42")
    ```
14. Document operational limits: pages/rows fetched, observed rate limit, poll interval, and the selector set the parser depends on.

## Verification

- Run the parser against saved fixtures with the project's own test runner (`python -m unittest`, `pytest`, or the Node equivalent).
- Validate every persisted row against the schema; a successful HTTP response is not evidence the extracted data is correct.
- Spot-check counts and a few values against the live source after a bounded run.
- Confirm the output is deduplicated by the chosen key and that omitted records were logged with the selector that failed.

## Failure behavior

- `401`/`403` or a `robots.txt` disallow: stop and report; do not attempt to evade.
- Repeated `5xx` or timeouts: reduce concurrency, increase the backoff factor, cap total attempts, then fail with the URL and status.
- Missing elements: skip the record and log the selector plus URL. A high miss rate means the upstream markup changed, not that the site is down.
- Ambiguous target: take the narrowest reading (smallest crawl scope) and state the assumption.
- Silent upstream markup changes are the normal failure mode: a parser that keeps returning rows can still be returning the wrong data, so schema and fixture checks matter more than green HTTP status.

## Anti-patterns

Poor: arbitrary sleeps, no dedupe, and no schema check, so a single `429` or a renamed class produces a corrupt or truncated file with no signal.
```python
for url in urls:
    time.sleep(1)                  # arbitrary delay, unrelated to any limit
    html = requests.get(url).text  # no timeout, no retry: raises or hangs
    out.append(parse(html))        # duplicates and malformed rows flow through
```
Improved: bounded backoff instead of guesswork, a dedupe key, and validation before output, so throttling is handled and bad rows are filtered with a record of what was dropped.
```python
seen = set()
for url in urls:
    resp = fetch(url)              # timeout + bounded retry/backoff, honors 429
    for item in parse_items(resp.text):   # tolerates missing nodes
        key = item.get("id") or normalize(url)
        if key in seen:
            continue               # dedupe on a stable key
        seen.add(key)
        if valid(item):
            out.append(item)       # only schema-conforming rows persist
```

## Security

- Treat fetched content as untrusted input; never `eval` it, and never feed it into a shell.
- Restrict outbound requests to an explicit host allowlist and block loopback, link-local, and private-range targets to prevent SSRF.
- Hard prohibitions: no CAPTCHA bypass, no authentication circumvention, no access-control evasion, and no techniques intended to defeat anti-abuse systems.
- Respect applicable law, privacy requirements, and site policy; collect only the fields the task requires and avoid storing personal data beyond need.
- Keep credentials out of source; if a key is required, source it from the framework's secret store rather than committing it.

## Token notes

- Fetch one sample page, save it as a fixture, and iterate the parser against the file instead of re-fetching.
- Never paste whole HTML into context; work from a handful of selectors and the minimal field set, and reuse existing fixtures, parsers, and notes via `uaf search "<query>"` before writing new ones.

## Known limitations

- Anti-bot systems may block automated requests regardless of politeness; that is a policy boundary, not a puzzle to solve.
- Pages whose data only materializes after JavaScript may require the browser tier, which is heavier and less reliable to run in CI.
- Selector and schema checks catch shape errors, not semantic ones; a field can be well-formed and still wrong.
- Published rate limits are often undocumented, so the effective limit is only observable by running conservatively and watching for `429`.
