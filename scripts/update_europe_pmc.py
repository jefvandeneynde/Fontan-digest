#!/usr/bin/env python3
"""Supplement the Fontan Digest archive with Europe PMC records.

This runs after the PubMed refresh. Existing PubMed records remain authoritative;
Europe PMC is used to enrich duplicates and add records (for example preprints)
that are not yet present in PubMed.
"""

from __future__ import annotations

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
API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
USER_AGENT = "Fontan-Digest/1.0 (+https://github.com/jefvandeneynde/Fontan-digest)"


def strip_markup(value: str | None) -> str:
    if not value:
        return ""
    return clean_text(re.sub(r"<[^>]+>", " ", value))


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def normalize_doi(value: str | None) -> str:
    doi = str(value or "").strip().lower()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
    return doi


def request_json(params: dict) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def search_europe_pmc(query: str, max_records: int) -> list[dict]:
    # Europe PMC's indexed-date behavior is not identical to PubMed's. Fetch the most
    # recent matching records and apply our publication-date window locally instead.
    results: list[dict] = []
    cursor = "*"
    search_query = f"{query} sort_date:y"

    while len(results) < max_records:
        page_size = min(1000, max_records - len(results))
        payload = request_json({
            "query": search_query,
            "resultType": "core",
            "format": "json",
            "pageSize": str(page_size),
            "cursorMark": cursor,
        })
        page = payload.get("resultList", {}).get("result", []) or []
        results.extend(page)
        next_cursor = payload.get("nextCursorMark")
        if not page or not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
    return results[:max_records]


def author_names(record: dict) -> list[str]:
    authors = record.get("authorList", {}).get("author", []) if isinstance(record.get("authorList"), dict) else []
    names = []
    for author in as_list(authors):
        if not isinstance(author, dict):
            continue
        name = author.get("fullName") or " ".join(x for x in [author.get("lastName"), author.get("initials")] if x)
        if name:
            names.append(clean_text(name))
    if not names and record.get("authorString"):
        names = [clean_text(x) for x in str(record["authorString"]).split(",") if clean_text(x)]
    return names


def journal_name(record: dict) -> str:
    info = record.get("journalInfo") if isinstance(record.get("journalInfo"), dict) else {}
    journal = info.get("journal") if isinstance(info.get("journal"), dict) else {}
    report = record.get("bookOrReportDetails") if isinstance(record.get("bookOrReportDetails"), dict) else {}
    return clean_text(journal.get("title") or record.get("journalTitle") or report.get("publisher"))


def publication_types(record: dict) -> list[str]:
    value = record.get("pubTypeList")
    if isinstance(value, dict):
        value = value.get("pubType")
    return [clean_text(str(x)) for x in as_list(value) if clean_text(str(x))]


def published_date(record: dict) -> str:
    for key in ("firstPublicationDate", "electronicPublicationDate", "journalInfo"):
        value = record.get(key)
        if key == "journalInfo" and isinstance(value, dict):
            value = value.get("printPublicationDate")
        if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            return value
    year = str(record.get("pubYear") or "")
    return f"{year}-01-01" if year.isdigit() else ""


def explicit_fontan_match(record: dict) -> bool:
    text = f"{strip_markup(record.get('title'))} {strip_markup(record.get('abstractText'))}".lower()
    return any(term in text for term in (
        "fontan",
        "total cavopulmonary connection",
        "total cavopulmonary",
        "tcpc",
    ))


def within_window(record: dict, start: date, end: date) -> bool:
    published = published_date(record)
    if not published:
        return False
    try:
        day = date.fromisoformat(published)
    except ValueError:
        return False
    return start <= day <= end


def make_article(record: dict, topics, link_config, major_journals) -> dict | None:
    title = strip_markup(record.get("title"))
    if not title:
        return None

    pmid = clean_text(record.get("pmid"))
    source_id = clean_text(record.get("id"))
    source_code = clean_text(record.get("source")) or "EPMC"
    doi = normalize_doi(record.get("doi"))
    pmcid = clean_text(record.get("pmcid"))
    abstract = strip_markup(record.get("abstractText"))
    authors = author_names(record)
    journal = journal_name(record)
    pub_types = publication_types(record)
    article_type = classify_article_type(pub_types, title)
    published = published_date(record)

    combined = clean_text(f"{title} {abstract} {' '.join(pub_types)}")
    topic_ids, topic_labels, topic_score = classify_topics(combined, topics)
    links, link_score = research_links(combined, link_config)
    relevance = topic_score + link_score + major_journal_bonus(journal, major_journals) + article_type_bonus(article_type)

    if links:
        teaser = links[0]["teaser"]
        detail = "\n\n".join(link["detail"] for link in links[:2] if link.get("detail"))
    else:
        teaser = "Relevant to the broader Fontan evidence base; no direct match to a prespecified SAFER-Fontan mechanistic axis was identified automatically."
        detail = "This paper concerns the Fontan circulation but did not trigger a direct automated match to the current SAFER-Fontan research axes. It may still be useful for background, clinical context, surveillance or hypothesis generation."

    epmc_url = f"https://europepmc.org/article/{urllib.parse.quote(source_code)}/{urllib.parse.quote(source_id)}" if source_id else "https://europepmc.org/"
    publisher_url = f"https://doi.org/{urllib.parse.quote(doi, safe='/:;()')}" if doi else epmc_url
    pubmed_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else epmc_url
    source_label = "Europe PMC preprint" if source_code.upper() == "PPR" else "Europe PMC"

    return {
        "id": f"pmid-{pmid}" if pmid else f"epmc-{source_code.lower()}-{source_id or normalize_doi(doi)}",
        "source": source_label,
        "source_coverage": ["Europe PMC"],
        "pmid": pmid,
        "pmcid": pmcid,
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
        "pubmed_url": pubmed_url,
        "publisher_url": publisher_url,
        "full_text_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/" if pmcid else "",
        "has_full_text": bool(pmcid),
        "retrieved_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def main():
    sources = read_json(CONFIG / "sources.json")
    cfg = sources.get("europe_pmc", {})
    if not cfg.get("enabled", False):
        print("Europe PMC source disabled")
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
    raw_all = search_europe_pmc(cfg["query"], int(cfg.get("max_records", 3000)))
    raw = [record for record in raw_all if explicit_fontan_match(record) and within_window(record, start, today)]
    print(f"Europe PMC recent Fontan records {start} to {today}: {len(raw)} of {len(raw_all)} recent-search candidates")

    by_pmid = {a.get("pmid"): a for a in existing if a.get("pmid")}
    by_doi = {normalize_doi(a.get("doi")): a for a in existing if normalize_doi(a.get("doi"))}
    added = 0
    enriched = 0

    for record in raw:
        candidate = make_article(record, topics, links_config, sources.get("major_journals", []))
        if not candidate:
            continue
        duplicate = None
        if candidate.get("pmid") and candidate["pmid"] in by_pmid:
            duplicate = by_pmid[candidate["pmid"]]
        elif candidate.get("doi") and candidate["doi"] in by_doi:
            duplicate = by_doi[candidate["doi"]]

        if duplicate is not None:
            coverage = set(duplicate.get("source_coverage") or [duplicate.get("source", "PubMed")])
            coverage.add("Europe PMC")
            duplicate["source_coverage"] = sorted(x for x in coverage if x)
            if not duplicate.get("abstract") and candidate.get("abstract"):
                duplicate["abstract"] = candidate["abstract"]
            if not duplicate.get("pmcid") and candidate.get("pmcid"):
                duplicate["pmcid"] = candidate["pmcid"]
                duplicate["full_text_url"] = candidate["full_text_url"]
                duplicate["has_full_text"] = True
            enriched += 1
            continue

        existing.append(candidate)
        if candidate.get("pmid"):
            by_pmid[candidate["pmid"]] = candidate
        if candidate.get("doi"):
            by_doi[candidate["doi"]] = candidate
        added += 1

    existing.sort(key=lambda a: (a.get("published") or "0000-00-00", a.get("relevance_score", 0)), reverse=True)
    max_records = max(int(sources.get("pubmed", {}).get("max_records", 3000)), int(cfg.get("max_records", 3000)))
    existing = existing[:max_records]
    generated_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    payload["generated_at"] = generated_at
    payload["count"] = len(existing)
    payload["articles"] = existing
    payload["sources"] = ["PubMed", "Europe PMC"]
    write_json(article_path, payload)

    meta_path = DATA / "meta.json"
    meta = read_json(meta_path) if meta_path.exists() else {}
    meta.update({
        "generated_at": generated_at,
        "count": len(existing),
        "source": "PubMed + Europe PMC",
        "sources": ["PubMed", "Europe PMC"],
        "europe_pmc_query": cfg["query"],
    })
    write_json(meta_path, meta)
    print(f"Europe PMC: added {added}, enriched {enriched}; archive now {len(existing)}")


if __name__ == "__main__":
    main()
