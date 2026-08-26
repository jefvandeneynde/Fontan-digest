#!/usr/bin/env python3
"""Supplement Fontan Digest with recent Crossref publisher metadata.

Crossref is used as a conservative online-first discovery layer: only journal
articles with explicit Fontan/TCPC terminology in the title are eligible.
Existing PubMed/Europe PMC records remain authoritative and are deduplicated by DOI.
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

from update_pubmed import (
    article_type_bonus,
    classify_article_type,
    classify_topics,
    clean_text,
    flatten_topics,
    major_journal_bonus,
    read_json,
    research_links,
    write_json,
)

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
DATA = ROOT / "docs" / "data"
API = "https://api.crossref.org/works"
USER_AGENT = "Fontan-Digest/1.0 (+https://github.com/jefvandeneynde/Fontan-digest)"


def strip_markup(value: str | None) -> str:
    if not value:
        return ""
    return clean_text(re.sub(r"<[^>]+>", " ", html.unescape(str(value))))


def normalize_doi(value: str | None) -> str:
    doi = str(value or "").strip().lower()
    return re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)


def request_json(params: dict) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def first_string(value) -> str:
    if isinstance(value, list):
        return clean_text(value[0]) if value else ""
    return clean_text(value)


def date_from_parts(record: dict) -> str:
    for key in ("published-online", "published-print", "published", "issued"):
        node = record.get(key)
        if not isinstance(node, dict):
            continue
        parts = node.get("date-parts")
        if not isinstance(parts, list) or not parts or not isinstance(parts[0], list) or not parts[0]:
            continue
        values = parts[0]
        year = int(values[0])
        month = int(values[1]) if len(values) > 1 else 1
        day = int(values[2]) if len(values) > 2 else 1
        month = max(1, min(12, month))
        day = max(1, min(28, day))
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            continue
    return ""


def author_names(record: dict) -> list[str]:
    names = []
    for author in record.get("author", []) or []:
        if not isinstance(author, dict):
            continue
        literal = clean_text(author.get("name"))
        if literal:
            names.append(literal)
            continue
        name = " ".join(x for x in [clean_text(author.get("family")), clean_text(author.get("given"))] if x)
        if name:
            names.append(name)
    return names


def explicit_fontan_title(title: str) -> bool:
    low = title.lower()
    return any(term in low for term in ("fontan", "total cavopulmonary", "tcpc"))


def pubmed_search_url(doi: str) -> str:
    # Crossref can surface an online-first DOI before a PMID exists. Keep the visible
    # PubMed button useful and truthful by linking to a DOI search rather than duplicating
    # the publisher URL. Once PubMed indexes the paper, the primary PubMed ingest replaces
    # this record with the direct PMID URL during deduplication.
    return "https://pubmed.ncbi.nlm.nih.gov/?" + urllib.parse.urlencode({"term": f'"{doi}"[AID]'})


def crossref_records(query_title: str, start: date, end: date, max_records: int) -> list[dict]:
    params = {
        "query.title": query_title,
        "filter": f"from-pub-date:{start.isoformat()},until-pub-date:{end.isoformat()},type:journal-article",
        "rows": str(min(1000, max_records)),
        "sort": "published",
        "order": "desc",
    }
    payload = request_json(params)
    return payload.get("message", {}).get("items", []) or []


def make_article(record: dict, topics, link_config, major_journals) -> dict | None:
    title = first_string(record.get("title"))
    doi = normalize_doi(record.get("DOI"))
    if not title or not doi or not explicit_fontan_title(title):
        return None

    abstract = strip_markup(record.get("abstract"))
    authors = author_names(record)
    journal = first_string(record.get("container-title"))
    published = date_from_parts(record)
    pub_types = [clean_text(record.get("subtype"))] if record.get("subtype") else []
    article_type = classify_article_type(pub_types, title)
    combined = clean_text(f"{title} {abstract} {' '.join(pub_types)}")
    topic_ids, topic_labels, topic_score = classify_topics(combined, topics)
    links, link_score = research_links(combined, link_config)
    relevance = topic_score + link_score + major_journal_bonus(journal, major_journals) + article_type_bonus(article_type)

    if links:
        teaser = links[0]["teaser"]
        detail = "\n\n".join(link["detail"] for link in links[:2] if link.get("detail"))
    else:
        teaser = "Relevant to the broader Fontan evidence base; no direct match to a prespecified SAFER-Fontan mechanistic axis was identified automatically."
        detail = "This online-first publisher record concerns the Fontan circulation but did not trigger a direct automated match to the current SAFER-Fontan research axes. It may still be useful for background, clinical context, surveillance or hypothesis generation."

    publisher_url = clean_text(record.get("URL")) or f"https://doi.org/{urllib.parse.quote(doi, safe='/:;()')}"
    return {
        "id": f"doi-{doi}",
        "source": "Crossref early metadata",
        "source_coverage": ["Crossref"],
        "pmid": "",
        "pmcid": "",
        "doi": doi,
        "pii": "",
        "title": title,
        "abstract": abstract,
        "authors": authors,
        "journal": journal,
        "journal_abbrev": "",
        "published": published,
        "year": int(published[:4]) if published[:4].isdigit() else None,
        "publication_types": pub_types,
        "article_type": article_type,
        "topics": topic_ids,
        "topic_labels": topic_labels,
        "research_links": links,
        "research_teaser": teaser,
        "research_detail": detail,
        "relevance_score": relevance,
        "high_priority": relevance >= 45 or bool(major_journal_bonus(journal, major_journals) and links),
        "pubmed_url": pubmed_search_url(doi),
        "publisher_url": publisher_url,
        "full_text_url": "",
        "has_full_text": False,
        "retrieved_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def main():
    sources = read_json(CONFIG / "sources.json")
    cfg = sources.get("crossref", {})
    if not cfg.get("enabled", False):
        print("Crossref source disabled")
        return

    topics_config = read_json(CONFIG / "topics.json")
    links_config = read_json(CONFIG / "research_links.json")
    topics = flatten_topics(topics_config)
    article_path = DATA / "articles.json"
    payload = read_json(article_path)
    existing = payload.get("articles", [])

    today = date.today()
    days = int(cfg.get("update_days", 60) if existing else cfg.get("bootstrap_days", 730))
    start = today - timedelta(days=days)
    raw = crossref_records(cfg.get("query_title", "Fontan"), start, today, int(cfg.get("max_records", 1000)))
    print(f"Crossref search {start} to {today}: {len(raw)} candidate records")

    by_doi = {normalize_doi(a.get("doi")): a for a in existing if normalize_doi(a.get("doi"))}
    added = 0
    enriched = 0

    for record in raw:
        candidate = make_article(record, topics, links_config, sources.get("major_journals", []))
        if not candidate:
            continue
        doi = candidate["doi"]
        duplicate = by_doi.get(doi)
        if duplicate is not None:
            coverage = set(duplicate.get("source_coverage") or [duplicate.get("source", "PubMed")])
            coverage.add("Crossref")
            duplicate["source_coverage"] = sorted(x for x in coverage if x)
            if not duplicate.get("abstract") and candidate.get("abstract"):
                duplicate["abstract"] = candidate["abstract"]
            if not duplicate.get("pmid") and str(duplicate.get("source", "")).startswith("Crossref"):
                duplicate["pubmed_url"] = candidate["pubmed_url"]
                duplicate["publisher_url"] = candidate["publisher_url"]
            enriched += 1
            continue
        existing.append(candidate)
        by_doi[doi] = candidate
        added += 1

    existing.sort(key=lambda a: (a.get("published") or "0000-00-00", a.get("relevance_score", 0)), reverse=True)
    max_records = max(int(sources.get("pubmed", {}).get("max_records", 3000)), int(cfg.get("max_records", 1000)))
    existing = existing[:max_records]
    generated_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    payload["generated_at"] = generated_at
    payload["count"] = len(existing)
    payload["articles"] = existing
    payload["sources"] = ["PubMed", "Europe PMC", "Crossref"]
    write_json(article_path, payload)

    meta_path = DATA / "meta.json"
    meta = read_json(meta_path) if meta_path.exists() else {}
    meta.update({
        "generated_at": generated_at,
        "count": len(existing),
        "source": "PubMed + Europe PMC + Crossref",
        "sources": ["PubMed", "Europe PMC", "Crossref"],
        "crossref_query_title": cfg.get("query_title", "Fontan"),
    })
    write_json(meta_path, meta)
    print(f"Crossref: added {added}, enriched {enriched}; archive now {len(existing)}")


if __name__ == "__main__":
    main()
