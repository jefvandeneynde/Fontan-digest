# Fontan Digest

A mobile-first, continuously updated literature dashboard dedicated to the Fontan circulation.

The site is designed for clinicians and researchers who want one place to review new Fontan literature, understand why a paper may matter, mark papers as seen, and save important work for deeper reading.

## Core features

- Automatic PubMed ingestion with DOI/publisher links.
- Fontan-focused subtopic classification.
- Responsive feed for phone and desktop.
- Filters for unseen/saved status, date window, journal, article type, subtopic, year and free text.
- Sort by newest, research relevance or journal.
- Inline abstracts with expandable full text.
- A concise **Link to our research** panel on every article, with an expandable detailed explanation.
- Research links aligned with the current SAFER-Fontan programme: systemic venous congestion/PVP, PCWP, exercise physiology, EDPVR/diastolic function, spironolactone + dapagliflozin, fibrosis/CMR/FAPI-PET, vascular function, biomarkers and extracardiac organ involvement.
- **Seen** and **Save for deep read** state stored in the browser.
- Unseen-only view for fast routine triage.
- Weekly/monthly/yearly windows for different review rhythms.
- Export/import of personal reading state for backup or moving between browsers.
- Paperpile shortcut in addition to PubMed and publisher links.
- Installable PWA shell for phone/home-screen use.

## Data sources

V1 uses PubMed as the authoritative primary source. The code is structured so Europe PMC, Crossref, society feeds and publisher RSS feeds can be added without changing the front-end model.

## Editable taxonomy

`config/topics.json` controls the Fontan subtopics, matching terms and relevance weights. It can be edited at any time without redesigning the site.

`config/research_links.json` controls how papers are mapped to active SAFER-Fontan research axes and what explanatory text is displayed.

## Automatic refresh

`.github/workflows/update-fontan-digest.yml` refreshes the literature four times per day and can also be run manually from GitHub Actions.

The first run bootstraps approximately two years of Fontan literature. Subsequent runs merge new records into the archive.

## Deployment

The application lives under `/docs` and is designed for GitHub Pages.

**Settings → Pages → Deploy from a branch → `main` → `/docs`**

Expected URL:

`https://jefvandeneynde.github.io/Fontan-digest/`

## Personal vs shared use

The public literature feed and research-link descriptions are shared. Seen/saved/notes state is local to each browser in V1, so colleagues can use the same site without seeing your personal reading state.

A later version can add optional authenticated cross-device sync while keeping each user's state private.
