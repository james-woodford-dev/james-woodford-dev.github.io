#!/usr/bin/env python3
"""
update_scholar.py
=================
Fetches publication data from Google Scholar using the `scholarly` library
and writes it to data/scholar.json, which publications.html renders.

Run automatically once a month by .github/workflows/update-scholar.yml,
or manually:

    pip install -r requirements.txt
    python scripts/update_scholar.py

The Scholar ID defaults to SCHOLAR_ID below; set the SCHOLAR_ID environment
variable to override it.

If the fetch fails (e.g. Google rate-limits the request), the existing
data/scholar.json is left untouched and the script exits non-zero.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Import errors are NOT caught here on purpose: a broken dependency should
# show its real traceback rather than a misleading "not installed" message.
from scholarly import scholarly

# ── Configuration ──────────────────────────────────────────────────────────────
DEFAULT_SCHOLAR_ID = "lofMBZ4AAAAJ"
SCHOLAR_ID = os.environ.get("SCHOLAR_ID", "").strip() or DEFAULT_SCHOLAR_ID

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "data" / "scholar.json"
# ──────────────────────────────────────────────────────────────────────────────


def venue_of(bib: dict) -> str:
    """Scholar stores the venue under different keys depending on pub type."""
    for key in ("journal", "conference", "booktitle", "venue", "publisher"):
        if bib.get(key):
            return str(bib[key])
    return ""


def year_of(bib: dict):
    try:
        return int(bib.get("pub_year"))
    except (TypeError, ValueError):
        return ""


def fetch_scholar_data(scholar_id: str) -> dict:
    """Fetch author profile and publications from Google Scholar."""
    print(f"Fetching Scholar data for ID: {scholar_id} …")

    author = scholarly.search_author_id(scholar_id)
    author = scholarly.fill(author, sections=["basics", "indices", "publications"])

    pubs_raw = author.get("publications", [])
    print(f"Found {len(pubs_raw)} publications. Fetching details …")

    publications = []
    for i, pub in enumerate(pubs_raw):
        try:
            pub = scholarly.fill(pub)
        except Exception as exc:  # keep the summary info we already have
            print(f"  Warning: could not fill pub #{i}: {exc}")
        bib = pub.get("bib", {})
        publications.append({
            "title":     bib.get("title", ""),
            "authors":   bib.get("author", ""),
            "venue":     venue_of(bib),
            "year":      year_of(bib),
            "abstract":  bib.get("abstract", ""),
            "citations": pub.get("num_citations", 0),
            "url":       pub.get("pub_url", ""),
        })

    # Newest first, then by citation count
    publications.sort(key=lambda p: (-(p["year"] or 0), -(p["citations"] or 0)))

    return {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "profile": {
            "name":         author.get("name", ""),
            "affiliation":  author.get("affiliation", ""),
            "email":        author.get("email_domain", ""),
            "interests":    author.get("interests", []),
            "citations":    author.get("citedby", 0),
            "citations_5y": author.get("citedby5y", 0),
            "h_index":      author.get("hindex", 0),
            "h_index_5y":   author.get("hindex5y", 0),
            "i10_index":    author.get("i10index", 0),
            "i10_index_5y": author.get("i10index5y", 0),
            "scholar_url":  f"https://scholar.google.com/citations?user={scholar_id}",
        },
        "publications": publications,
    }


def main() -> None:
    try:
        data = fetch_scholar_data(SCHOLAR_ID)
    except Exception as exc:
        print(f"ERROR: Could not fetch Scholar data: {type(exc).__name__}: {exc}")
        print("Existing data/scholar.json left unchanged.")
        sys.exit(1)

    # Guard against Scholar returning an empty/blocked response that would
    # wipe the publications list on the live site.
    if not data["publications"]:
        print("ERROR: Scholar returned no publications; refusing to overwrite data.")
        sys.exit(1)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

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
