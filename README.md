# Website Lead Extractor — Emails, Phones & Social Profiles

[![Built with Crawlee](https://img.shields.io/badge/built%20with-Crawlee-blueviolet)](https://crawlee.dev)
[![Runs on Apify](https://img.shields.io/badge/runs%20on-Apify-00A98F)](https://apify.com)

Give it a company website. It crawls the site (within the same domain, up to a
configurable depth) and returns every publicly listed email address, phone
number, and social profile link (LinkedIn, X/Twitter, Facebook, Instagram,
GitHub) it finds, as clean JSON.

Built for sales teams, recruiters, and researchers who need contact info from
a list of company sites without manually opening each "Contact" or "About"
page.

> **Status:** live on Apify, pending public Store listing approval. Code and
> README here are the source of truth in the meantime.

## Run it

Via the [Apify API](https://docs.apify.com/api/v2) (once the Store listing is
approved, this works for anyone with an Apify account):

```bash
curl "https://api.apify.com/v2/acts/website-lead-extractor/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "startUrls": [{ "url": "https://example.com" }],
    "maxDepth": 1,
    "maxPagesPerDomain": 20
  }'
```

Or clone this repo and run it locally with the [Apify CLI](https://docs.apify.com/cli):

```bash
git clone https://github.com/timmKal01/website-lead-extractor.git
cd website-lead-extractor
npm install
apify run
```

## Input

| Field | Type | Description |
|---|---|---|
| `startUrls` | array of URLs | Website(s) to scan. |
| `maxDepth` | integer (default `1`) | How many link-hops from each start URL to follow within the same domain, e.g. to reach a Contact page. |
| `maxPagesPerDomain` | integer (default `20`) | Safety cap on pages visited per domain. |

```json
{
  "startUrls": [{ "url": "https://example.com" }],
  "maxDepth": 1,
  "maxPagesPerDomain": 20
}
```

## Output

One record per page where contact info was found:

```json
{
  "url": "https://example.com/contact",
  "domain": "example.com",
  "emails": ["hello@example.com"],
  "phones": ["+1 415-555-0132"],
  "socialProfiles": {
    "linkedin": "https://linkedin.com/company/example",
    "twitter": "https://x.com/example"
  }
}
```

## How it works

Plain HTTP crawl via [Crawlee](https://crawlee.dev)'s `CheerioCrawler` — no
headless browser, no proxy. It reads only what's already rendered in the raw
HTML response, so it works on static/server-rendered sites; heavily
JS-rendered sites may need a browser-based crawler instead.

## Notes

- Only extracts information the site itself publishes publicly (e.g. a
  "Contact us" page) — it does not access anything gated behind a login.
- Respects a per-domain page cap so it won't run away on large sites.
