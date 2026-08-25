# Fontan Digest

A mobile-first, continuously updated literature dashboard dedicated to the Fontan circulation.

The site is designed for clinicians and researchers who want one place to review new Fontan literature, understand why a paper may matter, mark papers as seen, and save important work for deeper reading.

## Core features

- Automatic PubMed ingestion with DOI/publisher links.
- Fontan-focused subtopic classification.
- Responsive feed for phone and desktop and an installable PWA shell.
- Latest, unseen, saved, high-relevance and weekly views.
- Searchable filters for journal and subtopic: partial text such as `European` matches `European Heart Journal`.
- Filters for date window, article type, year, abstract availability and PMC full text.
- Sort by newest, oldest, personal research relevance or journal.
- Structured abstracts: labels such as **Background**, **Methods**, **Results** and **Conclusions** are displayed on separate lines with stronger visual contrast.
- User-defined Rayyan-style keyword highlighting in multiple colors across titles, abstracts and research-link text.
- A concise **Link to our research** panel on every article, with an expandable detailed explanation.
- Research links aligned with the current SAFER-Fontan programme: systemic venous congestion/PVP, PCWP, exercise physiology, EDPVR/diastolic function, spironolactone + dapagliflozin, fibrosis/CMR/FAPI-PET, vascular function, biomarkers and extracardiac organ involvement.
- Seen/unseen tracking, saved deep-reading list, personal notes and a **Mark visible seen** command.
- A dedicated **Settings** area for keywords, feed defaults, journal preferences and topic customization.
- Journals can be marked **Preferred**, **Normal** or **Hidden**. Preferred journals receive a personal relevance boost; hidden journals can be removed from the normal feed.
- Existing topics can be renamed, reweighted, enabled/disabled or given additional matching terms. Personal custom topics can be added without changing the shared taxonomy.
- Export/import remains available as a backup mechanism.

## Paperpile

The earlier Paperpile shortcut has been removed. A normal webpage cannot reliably invoke the Paperpile browser extension and Paperpile does not currently expose a supported public integration that would let this static site safely import/star records directly. The site therefore exposes reliable PubMed, publisher/DOI and PMC links only rather than presenting a button that appears to integrate with Paperpile but does not.

## Personal settings vs shared defaults

Fontan Digest deliberately separates two layers:

1. **Shared evidence layer** — literature records, default taxonomy and SAFER-Fontan research mapping live in this repository and are the same for everyone.
2. **Personal layer** — seen/saved state, notes, highlight keywords, journal preferences, personal topic edits and feed preferences belong to an individual user.

This separation means the site can later be shared with colleagues without one person's preferences rewriting everyone else's defaults.

The shared defaults are controlled by:

- `config/topics.json` — Fontan subtopics, matching terms and default relevance weights.
- `config/research_links.json` — mapping to active SAFER-Fontan research axes and explanatory text.
- `config/sources.json` — PubMed query/source settings and journal-level defaults.

Personal topic and journal changes made in the Settings UI take effect immediately in that user's feed. Publishing an individual's settings back into the repository as new shared defaults should be an explicit admin operation, not an automatic browser-side write, because embedding GitHub write credentials in a public GitHub Pages site would be unsafe.

## Cross-device synchronization

The V2 frontend includes optional authenticated Supabase synchronization for the entire personal state: seen/saved papers, notes, keywords, filters, journal preferences and topic customizations.

The database schema is in `supabase/schema.sql`. It enables Row Level Security so an authenticated user can only read or update their own record.

To activate it for the deployed site:

1. Create/select a Supabase project.
2. Run `supabase/schema.sql` in its SQL editor.
3. In Supabase Auth URL configuration, use the GitHub Pages site as the Site URL and allow it as a redirect URL.
4. Put the project's **Project URL** and **public anon/publishable key** in `docs/sync-config.js`.
5. Redeploy GitHub Pages.

Do **not** put a Supabase service-role key or other privileged secret into this public repository. The browser-facing anon/publishable key is intended to be public; access is protected by Row Level Security.

If cloud sync is not configured or is temporarily unavailable, local browser storage continues to work as a fallback.

## Data sources

The current ingestion layer uses PubMed as the authoritative primary source. The code is structured so Europe PMC, Crossref, society feeds and publisher RSS feeds can be added without changing the front-end model.

## Automatic refresh

`.github/workflows/update-fontan-digest.yml` refreshes the literature four times per day and can also be run manually from GitHub Actions. Literature refreshes are serialized to avoid simultaneous bot commits colliding with each other.

`.github/workflows/validate-web.yml` independently checks the JavaScript/static web application whenever the web UI changes, so cosmetic/settings updates do not unnecessarily trigger a PubMed refresh.

The first ingestion bootstrapped approximately two years of Fontan literature. Subsequent runs merge newly indexed records into the archive.

## Deployment

The application lives under `/docs` and is designed for GitHub Pages.

**Settings → Pages → Deploy from a branch → `main` → `/docs`**

Expected URL:

`https://jefvandeneynde.github.io/Fontan-digest/`
