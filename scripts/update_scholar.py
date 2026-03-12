#!/usr/bin/env python3
"""
update_scholar.py
=================
Fetches publication data from Google Scholar using the `scholarly` library
and writes it to data/scholar.json.

This script is run automatically once a month by the GitHub Actions workflow
at .github/workflows/update-scholar.yml.

SETUP
-----
1. Find your Google Scholar profile ID from the URL:
       https://scholar.google.com/citations?user=<YOUR_ID>
2. Either:
   a) Set it directly in this file (SCHOLAR_ID = "abc123xyz"), OR
   b) Add it as a GitHub repository secret named SCHOLAR_ID
      (Settings → Secrets and variables → Actions → New repository secret)
      The workflow will pass it as an environment variable automatically.

Usage (manual):
    pip install scholarly
    python scripts/update_scholar.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    from scholarly import scholarly, ProxyGenerator
except ImportError:
    print("ERROR: 'scholarly' is not installed.")
    print("Run: pip install scholarly")
    sys.exit(1)

# ── Configuration ──────────────────────────────────────────────────────────────
# Set your Google Scholar profile ID here, or pass it via the SCHOLAR_ID env var.
SCHOLAR_ID = os.environ.get("SCHOLAR_ID", "YOUR_GOOGLE_SCHOLAR_ID")

# Path to the output JSON file (relative to the repo root)
REPO_ROOT  = Path(__file__).resolve().parent.parent
OUTPUT     = REPO_ROOT / "data" / "scholar.json"

# Maximum number of publications to fetch full details for.
# Fetching full details for each pub makes additional requests.
# Set to None to fetch all (may be slow for large profiles).
MAX_PUBS_FULL = 50
# ──────────────────────────────────────────────────────────────────────────────


def write_placeholder() -> None:
    """Write an empty placeholder JSON so the website still loads gracefully."""
    data = {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%d"),
        "profile": {
            "name": "J. Woodford",
            "affiliation": "",
            "email": "",
            "interests": [],
            "citations": 0,
            "citations_5y": 0,
            "h_index": 0,
            "h_index_5y": 0,
            "i10_index": 0,
            "i10_index_5y": 0,
            "scholar_url": f"https://scholar.google.com/citations?user={SCHOLAR_ID}",
        },
        "publications": [],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Placeholder written to {OUTPUT}")


def fetch_scholar_data(scholar_id: str) -> dict:
    """Fetch author profile and publications from Google Scholar."""
    print(f"Fetching Scholar data for ID: {scholar_id} …")

    author = scholarly.search_author_id(scholar_id)
    author = scholarly.fill(author)

    publications = []
    pubs_raw = author.get("publications", [])
    print(f"Found {len(pubs_raw)} publications. Fetching details …")

    for i, pub in enumerate(pubs_raw):
        try:
            if MAX_PUBS_FULL is None or i < MAX_PUBS_FULL:
                pub = scholarly.fill(pub)
            bib = pub.get("bib", {})
            publications.append({
                "title":      bib.get("title",    ""),
                "authors":    bib.get("author",   ""),
                "venue":      bib.get("venue",    ""),
                "year":       bib.get("pub_year", ""),
                "abstract":   bib.get("abstract", ""),
                "citations":  pub.get("num_citations", 0),
                "url":        pub.get("pub_url", ""),
            })
        except Exception as exc:
            # If filling fails, save what we have without the extra details
            bib = pub.get("bib", {})
            publications.append({
                "title":     bib.get("title",    ""),
                "authors":   bib.get("author",   ""),
                "venue":     bib.get("venue",    ""),
                "year":      bib.get("pub_year", ""),
                "abstract":  "",
                "citations": pub.get("num_citations", 0),
                "url":       pub.get("pub_url", ""),
            })
            print(f"  Warning: could not fill pub #{i}: {exc}")

    # Sort newest first, then by citation count descending
    publications.sort(
        key=lambda p: (-(int(p.get("year") or 0)), -(p.get("citations") or 0))
    )

    return {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%d"),
        "profile": {
            "name":          author.get("name", ""),
            "affiliation":   author.get("affiliation", ""),
            "email":         author.get("email", ""),
            "interests":     author.get("interests", []),
            "citations":     author.get("citedby",   0),
            "citations_5y":  author.get("citedby5y", 0),
            "h_index":       author.get("hindex",    0),
            "h_index_5y":    author.get("hindex5y",  0),
            "i10_index":     author.get("i10index",  0),
            "i10_index_5y":  author.get("i10index5y", 0),
            "scholar_url":   f"https://scholar.google.com/citations?user={scholar_id}",
        },
        "publications": publications,
    }


def main() -> None:
    if SCHOLAR_ID == "YOUR_GOOGLE_SCHOLAR_ID":
        print(
            "Scholar ID is not configured.\n"
            "Set it in scripts/update_scholar.py (SCHOLAR_ID = '...') "
            "or as a GitHub repository secret named SCHOLAR_ID.\n"
            "Writing placeholder data instead."
        )
        write_placeholder()
        sys.exit(0)

    try:
        data = fetch_scholar_data(SCHOLAR_ID)
    except Exception as exc:
        print(f"ERROR: Could not fetch Scholar data: {exc}")
        # Preserve the existing JSON if the fetch fails so the site stays up
        if OUTPUT.exists():
            print("Keeping existing data/scholar.json.")
        else:
            write_placeholder()
        sys.exit(1)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    p = data["profile"]
    print(
        f"\n✓ Scholar data updated successfully\n"
        f"  Publications : {len(data['publications'])}\n"
        f"  Citations    : {p['citations']}\n"
        f"  h-index      : {p['h_index']}\n"
        f"  i10-index    : {p['i10_index']}\n"
        f"  Written to   : {OUTPUT}"
    )


if __name__ == "__main__":
    main()
