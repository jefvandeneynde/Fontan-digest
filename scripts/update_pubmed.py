#!/usr/bin/env python3
"""Refresh the Fontan Digest from PubMed using only Python's standard library."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
DATA = ROOT / "docs" / "data"
DATA.mkdir(parents=True, exist_ok=True)

USER_AGENT = "Fontan-Digest/1.0 (+https://github.com/jefvandeneynde/Fontan-digest)"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload):
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def request_text(url: str, timeout: int = 45) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/xml,text/xml,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def node_text(node) -> str:
    if node is None:
        return ""
    return clean_text("".join(node.itertext()))


def pubdate_from_node(pubdate) -> str:
    if pubdate is None:
        return ""
    year = node_text(pubdate.find("Year"))
    month = node_text(pubdate.find("Month"))
    day = node_text(pubdate.find("Day"))
    medline = node_text(pubdate.find("MedlineDate"))

    months = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }

    if year:
        m = 1
        if month:
            if month.isdigit():
                m = max(1, min(12, int(month)))
            else:
                m = months.get(month[:3].lower(), 1)
        d = 1
        if day.isdigit():
            d = max(1, min(28, int(day)))
        try:
            return date(int(year), m, d).isoformat()
        except ValueError:
            return f"{year}-01-01"

    match = re.search(r"(19|20)\d{2}", medline)
    return f"{match.group(0)}-01-01" if match else ""


def article_date(pubmed_article) -> str:
    article = pubmed_article.find(".//Article")
    article_date_node = article.find("ArticleDate") if article is not None else None
    if article_date_node is not None:
        y = node_text(article_date_node.find("Year"))
        m = node_text(article_date_node.find("Month"))
        d = node_text(article_date_node.find("Day"))
        if y and m and d:
            try:
                return date(int(y), int(m), int(d)).isoformat()
            except ValueError:
                pass

    pubdate = pubmed_article.find(".//JournalIssue/PubDate")
    return pubdate_from_node(pubdate)


def extract_abstract(article_node) -> str:
    parts = []
    for abstract_text in article_node.findall(".//Abstract/AbstractText"):
        text = node_text(abstract_text)
        if not text:
            continue
        label = abstract_text.attrib.get("Label") or abstract_text.attrib.get("NlmCategory")
        if label and label.upper() not in {"UNASSIGNED", "ABSTRACT"}:
            parts.append(f"{label.title()}: {text}")
        else:
            parts.append(text)
    return clean_text(" ".join(parts))


def extract_authors(article_node) -> list[str]:
    authors = []
    for author in article_node.findall(".//AuthorList/Author"):
        collective = node_text(author.find("CollectiveName"))
        if collective:
            authors.append(collective)
            continue
        last = node_text(author.find("LastName"))
        initials = node_text(author.find("Initials"))
        fore = node_text(author.find("ForeName"))
        name = " ".join(x for x in [last, initials or fore] if x)
        if name:
            authors.append(name)
    return authors


def classify_article_type(publication_types: list[str], title: str) -> str:
    values = " | ".join(publication_types).lower()
    t = title.lower()
    if "practice guideline" in values or "guideline" in values or "guideline" in t or "consensus" in t or "scientific statement" in t:
        return "Guideline / consensus"
    if "meta-analysis" in values:
        return "Meta-analysis"
    if "systematic review" in values or "systematic review" in t:
        return "Systematic review"
    if "randomized controlled trial" in values or "randomised controlled trial" in values or "clinical trial" in values:
        return "Clinical trial"
    if "review" in values:
        return "Review"
    if "editorial" in values or "comment" in values:
        return "Editorial / commentary"
    if "case reports" in values or "case report" in t:
        return "Case report"
    if "letter" in values:
        return "Letter"
    if "observational study" in values or "multicenter study" in values or "comparative study" in values:
        return "Original research"
    if "journal article" in values:
        return "Original research"
    return "Other"


def flatten_topics(topic_config):
    topics = []
    for group in topic_config.get("groups", []):
        for topic in group.get("topics", []):
            if topic.get("enabled", True):
                t = dict(topic)
                t["group"] = group.get("label", "")
                topics.append(t)
    return topics


def match_terms(text: str, terms: list[str]) -> list[str]:
    low = text.lower()
    hits = []
    for term in terms:
        if term.lower() in low:
            hits.append(term)
    return hits


def classify_topics(text: str, topics) -> tuple[list[str], list[str], int]:
    ids, labels, score = [], [], 0
    for topic in topics:
        hits = match_terms(text, topic.get("terms", []))
        if hits:
            ids.append(topic["id"])
            labels.append(topic["label"])
            score += int(topic.get("weight", 1)) * min(3, len(hits))
    return ids, labels, score


def research_links(text: str, link_config) -> tuple[list[dict], int]:
    matched = []
    total_score = 0
    for axis in link_config.get("axes", []):
        hits = match_terms(text, axis.get("terms", []))
        if not hits:
            continue
        score = int(axis.get("priority", 1)) * min(3, len(hits))
        total_score += score
        matched.append({
            "id": axis["id"],
            "label": axis["label"],
            "priority": axis.get("priority", 1),
            "score": score,
            "matched_terms": hits[:6],
            "teaser": axis.get("teaser", ""),
            "detail": axis.get("detail", ""),
        })
    matched.sort(key=lambda x: (x["score"], x["priority"]), reverse=True)
    return matched[:3], total_score


def major_journal_bonus(journal: str, major_journals: list[str]) -> int:
    j = journal.lower()
    for major in major_journals:
        if major.lower() in j or j in major.lower():
            return 12
    return 0


def article_type_bonus(article_type: str) -> int:
    return {
        "Guideline / consensus": 12,
        "Clinical trial": 10,
        "Meta-analysis": 8,
        "Systematic review": 7,
        "Original research": 5,
        "Review": 4,
    }.get(article_type, 0)


def parse_pubmed_article(pubmed_article, topics, link_config, major_journals):
    medline = pubmed_article.find("MedlineCitation")
    article = pubmed_article.find(".//Article")
    if medline is None or article is None:
        return None

    pmid = node_text(medline.find("PMID"))
    title = node_text(article.find("ArticleTitle"))
    if not pmid or not title:
        return None

    abstract = extract_abstract(article)
    authors = extract_authors(article)
    journal = node_text(article.find("Journal/Title"))
    journal_abbrev = node_text(medline.find("MedlineJournalInfo/MedlineTA"))
    publication_types = [node_text(x) for x in article.findall("PublicationTypeList/PublicationType") if node_text(x)]
    a_type = classify_article_type(publication_types, title)
    published = article_date(pubmed_article)

    doi = ""
    pmcid = ""
    pii = ""
    for article_id in pubmed_article.findall(".//PubmedData/ArticleIdList/ArticleId"):
        value = node_text(article_id)
        id_type = article_id.attrib.get("IdType", "").lower()
        if id_type == "doi":
            doi = value
        elif id_type == "pmc":
            pmcid = value
        elif id_type == "pii":
            pii = value

    combined = clean_text(f"{title} {abstract} {' '.join(publication_types)}")
    topic_ids, topic_labels, topic_score = classify_topics(combined, topics)
    links, link_score = research_links(combined, link_config)
    relevance = topic_score + link_score + major_journal_bonus(journal, major_journals) + article_type_bonus(a_type)

    if links:
        teaser = links[0]["teaser"]
        detail_parts = []
        for link in links[:2]:
            detail_parts.append(link["detail"])
        detail = "\n\n".join(detail_parts)
    else:
        teaser = "Relevant to the broader Fontan evidence base; no direct match to a prespecified SAFER-Fontan mechanistic axis was identified automatically."
        detail = "This paper concerns the Fontan circulation but did not trigger a direct automated match to the current SAFER-Fontan research axes. It may still be useful for background, clinical context, surveillance or hypothesis generation."

    high_priority = relevance >= 45 or bool(major_journal_bonus(journal, major_journals) and links)

    return {
        "id": f"pmid-{pmid}",
        "source": "PubMed",
        "pmid": pmid,
        "pmcid": pmcid,
        "doi": doi,
        "pii": pii,
        "title": title,
        "abstract": abstract,
        "authors": authors,
        "journal": journal or journal_abbrev,
        "journal_abbrev": journal_abbrev,
        "published": published,
        "year": int(published[:4]) if published[:4].isdigit() else None,
        "publication_types": publication_types,
        "article_type": a_type,
        "topics": topic_ids,
        "topic_labels": topic_labels,
        "research_links": links,
        "research_teaser": teaser,
        "research_detail": detail,
        "relevance_score": relevance,
        "high_priority": high_priority,
        "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "publisher_url": f"https://doi.org/{urllib.parse.quote(doi, safe='/:;()')}" if doi else f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "full_text_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/" if pmcid else "",
        "has_full_text": bool(pmcid),
        "retrieved_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def esearch_ids(query: str, start: date, end: date, retmax: int) -> list[str]:
    params = {
        "db": "pubmed",
        "term": query,
        "retmode": "json",
        "retmax": str(retmax),
        "datetype": "edat",
        "mindate": start.strftime("%Y/%m/%d"),
        "maxdate": end.strftime("%Y/%m/%d"),
        "sort": "pub date",
    }
    url = f"{EUTILS}/esearch.fcgi?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("esearchresult", {}).get("idlist", [])


def efetch(ids: list[str]) -> list[ET.Element]:
    articles = []
    for idx in range(0, len(ids), 200):
        chunk = ids[idx: idx + 200]
        params = {"db": "pubmed", "id": ",".join(chunk), "retmode": "xml"}
        url = f"{EUTILS}/efetch.fcgi?{urllib.parse.urlencode(params)}"
        xml_text = request_text(url)
        root = ET.fromstring(xml_text)
        articles.extend(root.findall("PubmedArticle"))
        time.sleep(0.36)
    return articles


def load_existing() -> list[dict]:
    path = DATA / "articles.json"
    if not path.exists():
        return []
    try:
        payload = read_json(path)
        return payload.get("articles", payload if isinstance(payload, list) else [])
    except Exception:
        return []


def merge_articles(existing: list[dict], incoming: list[dict], max_records: int) -> list[dict]:
    merged = {}
    for article in existing + incoming:
        key = article.get("pmid") or article.get("doi") or article.get("id")
        if key:
            merged[key] = article

    def sort_key(a):
        return (a.get("published") or "0000-00-00", a.get("relevance_score", 0))

    result = sorted(merged.values(), key=sort_key, reverse=True)
    return result[:max_records]


def main():
    topics_config = read_json(CONFIG / "topics.json")
    links_config = read_json(CONFIG / "research_links.json")
    sources_config = read_json(CONFIG / "sources.json")
    pubmed_cfg = sources_config["pubmed"]
    topics = flatten_topics(topics_config)
    existing = load_existing()

    today = date.today()
    days = int(pubmed_cfg["update_days"] if existing else pubmed_cfg["bootstrap_days"])
    start = today - timedelta(days=days)

    ids = esearch_ids(pubmed_cfg["query"], start, today, int(pubmed_cfg["max_records"]))
    print(f"PubMed search {start} to {today}: {len(ids)} records")

    raw_articles = efetch(ids)
    incoming = []
    for raw in raw_articles:
        article = parse_pubmed_article(raw, topics, links_config, sources_config.get("major_journals", []))
        if article:
            incoming.append(article)

    merged = merge_articles(existing, incoming, int(pubmed_cfg["max_records"]))
    generated_at = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    write_json(DATA / "articles.json", {
        "generated_at": generated_at,
        "query_window_start": start.isoformat(),
        "query_window_end": today.isoformat(),
        "count": len(merged),
        "articles": merged,
    })
    write_json(DATA / "topics.json", topics_config)
    write_json(DATA / "research_links.json", links_config)
    write_json(DATA / "meta.json", {
        "generated_at": generated_at,
        "count": len(merged),
        "source": "PubMed",
        "programme": links_config.get("programme", "SAFER-Fontan"),
        "query": pubmed_cfg["query"],
    })

    print(f"Saved {len(merged)} articles")


if __name__ == "__main__":
    main()
