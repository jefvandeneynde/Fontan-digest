const DATA_URL = 'data/articles.json';
const TOPICS_URL = 'data/topics.json';
const STORAGE_KEY = 'fontanDigestState.v1';

const els = {};
let articles = [];
let topicsConfig = { groups: [] };
let state = loadState();
let renderLimit = 60;

function loadState() {
  const defaults = {
    seen: {},
    saved: {},
    notes: {},
    view: 'latest',
    sort: 'newest',
    filters: {
      search: '',
      dateWindow: '30',
      journal: 'all',
      type: 'all',
      year: 'all',
      abstractOnly: false,
      fullTextOnly: false,
      topics: []
    }
  };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...defaults,
      ...raw,
      seen: raw.seen || {},
      saved: raw.saved || {},
      notes: raw.notes || {},
      filters: { ...defaults.filters, ...(raw.filters || {}) }
    };
  } catch {
    return defaults;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cacheElements() {
  [
    'statTotal','statUnseen','statWeek','statSaved','updatedAt','unseenBadge','searchInput','dateWindow',
    'journalFilter','typeFilter','yearFilter','abstractOnly','fullTextOnly','topicFilters','clearFilters',
    'selectAllTopics','sortSelect','sortSelectMobile','feed','emptyState','emptyReset','researchRadar',
    'radarTitle','radarText','radarThemes','feedTitle','viewKicker','resultCount','filtersPanel',
    'mobileFiltersButton','mobileOverlay','backupButton','backupDialog','exportState','importState'
  ].forEach(id => els[id] = document.getElementById(id));
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function dateObj(value) {
  const d = value ? new Date(`${value}T12:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function formatDate(value) {
  const d = dateObj(value);
  if (!d) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function daysAgo(value) {
  const d = dateObj(value);
  if (!d) return Infinity;
  return (Date.now() - d.getTime()) / 86400000;
}

function isSeen(article) { return Boolean(state.seen[article.id]); }
function isSaved(article) { return Boolean(state.saved[article.id]); }

function authorText(authors = []) {
  if (!authors.length) return 'Authors unavailable';
  if (authors.length <= 4) return authors.join(', ');
  return `${authors.slice(0, 4).join(', ')} et al.`;
}

function setControlsFromState() {
  els.searchInput.value = state.filters.search || '';
  els.dateWindow.value = state.filters.dateWindow || '30';
  els.abstractOnly.checked = Boolean(state.filters.abstractOnly);
  els.fullTextOnly.checked = Boolean(state.filters.fullTextOnly);
  els.sortSelect.value = state.sort || 'newest';
  els.sortSelectMobile.value = state.sort || 'newest';
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === state.view));
}

function populateSelects() {
  const journals = [...new Set(articles.map(a => a.journal).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const types = [...new Set(articles.map(a => a.article_type).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const years = [...new Set(articles.map(a => a.year).filter(Boolean))].sort((a,b) => b-a);

  fillSelect(els.journalFilter, journals, 'All journals');
  fillSelect(els.typeFilter, types, 'All types');
  fillSelect(els.yearFilter, years, 'All years');

  els.journalFilter.value = journals.includes(state.filters.journal) ? state.filters.journal : 'all';
  els.typeFilter.value = types.includes(state.filters.type) ? state.filters.type : 'all';
  els.yearFilter.value = years.map(String).includes(String(state.filters.year)) ? String(state.filters.year) : 'all';
}

function fillSelect(select, values, allLabel) {
  select.innerHTML = `<option value="all">${esc(allLabel)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function renderTopicFilters() {
  const selected = new Set(state.filters.topics || []);
  els.topicFilters.innerHTML = topicsConfig.groups.map(group => {
    const choices = (group.topics || []).filter(t => t.enabled !== false).map(topic => `
      <label class="topic-check">
        <input type="checkbox" value="${esc(topic.id)}" ${selected.has(topic.id) ? 'checked' : ''}>
        <span>${esc(topic.label)}</span>
      </label>`).join('');
    return `<div class="topic-group"><div class="topic-group-title">${esc(group.label)}</div>${choices}</div>`;
  }).join('');

  els.topicFilters.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      state.filters.topics = [...els.topicFilters.querySelectorAll('input:checked')].map(x => x.value);
      renderLimit = 60;
      saveState();
      render();
    });
  });
}

function matchesFilters(article) {
  const f = state.filters;
  const q = (f.search || '').trim().toLowerCase();
  if (q) {
    const haystack = [article.title, article.abstract, article.journal, ...(article.authors || []), ...(article.topic_labels || [])].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (f.dateWindow !== 'all' && daysAgo(article.published) > Number(f.dateWindow)) return false;
  if (f.journal !== 'all' && article.journal !== f.journal) return false;
  if (f.type !== 'all' && article.article_type !== f.type) return false;
  if (f.year !== 'all' && String(article.year) !== String(f.year)) return false;
  if (f.abstractOnly && !article.abstract) return false;
  if (f.fullTextOnly && !article.has_full_text) return false;

  const selectedTopics = f.topics || [];
  if (selectedTopics.length && !selectedTopics.some(topic => (article.topics || []).includes(topic))) return false;

  if (state.view === 'unseen' && isSeen(article)) return false;
  if (state.view === 'saved' && !isSaved(article)) return false;
  if (state.view === 'priority' && !article.high_priority) return false;
  if (state.view === 'week' && daysAgo(article.published) > 7) return false;

  return true;
}

function sortArticles(items) {
  const result = [...items];
  if (state.sort === 'relevance') {
    result.sort((a,b) => (b.relevance_score || 0) - (a.relevance_score || 0) || String(b.published).localeCompare(String(a.published)));
  } else if (state.sort === 'journal') {
    result.sort((a,b) => String(a.journal || '').localeCompare(String(b.journal || '')) || String(b.published).localeCompare(String(a.published)));
  } else if (state.sort === 'oldest') {
    result.sort((a,b) => String(a.published || '').localeCompare(String(b.published || '')));
  } else {
    result.sort((a,b) => String(b.published || '').localeCompare(String(a.published || '')) || (b.relevance_score || 0) - (a.relevance_score || 0));
  }
  return result;
}

function researchLabels(article) {
  return (article.research_links || []).slice(0, 2).map(link => `<span class="tag">${esc(link.label)}</span>`).join('');
}

function topicTags(article) {
  return (article.topic_labels || []).slice(0, 3).map(label => `<span class="tag">${esc(label)}</span>`).join('');
}

function cardHtml(article) {
  const seen = isSeen(article);
  const saved = isSaved(article);
  const abstract = article.abstract || 'No abstract is available from PubMed for this record.';
  const landing = article.publisher_url || article.pubmed_url;
  const note = state.notes[article.id] || '';
  const fullText = article.full_text_url ? `<a class="article-link" href="${esc(article.full_text_url)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">PMC full text ↗</a>` : '';
  const priority = article.high_priority ? '<span class="tag priority">◆ High research relevance</span>' : '';
  const open = article.has_full_text ? '<span class="tag open">Open in PMC</span>' : '';
  const unseen = seen ? '' : '<span class="unseen-marker" title="Unseen"></span>';

  return `<article class="paper-card ${seen ? 'seen' : ''}" data-id="${esc(article.id)}">
    <div class="card-top">
      <div class="card-title-wrap">
        <div class="meta-line"><span>${unseen}<span class="journal-name">${esc(article.journal || 'Journal unavailable')}</span></span><span>${esc(formatDate(article.published))}</span><span>${esc(article.article_type || 'Article')}</span></div>
        <h3 class="paper-title"><a href="${esc(landing)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">${esc(article.title)}</a></h3>
        <div class="meta-line"><span>${esc(authorText(article.authors))}</span>${article.doi ? `<span>DOI ${esc(article.doi)}</span>` : ''}${article.pmid ? `<span>PMID ${esc(article.pmid)}</span>` : ''}</div>
      </div>
      <div class="card-actions-top">
        <button class="icon-action ${seen ? 'active seen-action' : ''}" type="button" data-action="seen" title="Mark as seen">${seen ? '✓ Seen' : '○ Seen'}</button>
        <button class="icon-action ${saved ? 'active saved' : ''}" type="button" data-action="save" title="Save for in-depth reading">${saved ? '★ Saved' : '☆ Save'}</button>
      </div>
    </div>

    <div class="tags">${priority}<span class="tag type">${esc(article.article_type || 'Article')}</span>${open}${topicTags(article)}</div>

    <div class="abstract clamped">${esc(abstract)}</div>
    ${article.abstract ? '<button class="toggle-detail" type="button" data-action="abstract">Show full abstract</button>' : ''}

    <div class="research-link">
      <div class="research-link-head">↗ Link to our research ${researchLabels(article)}</div>
      <p class="research-teaser">${esc(article.research_teaser || '')}</p>
      <p class="research-detail hidden">${esc(article.research_detail || '')}</p>
      <button class="toggle-detail" type="button" data-action="research">Why this matters</button>
    </div>

    <details class="notes" ${note ? 'open' : ''}>
      <summary>✎ Personal note${note ? ' · saved' : ''}</summary>
      <textarea data-note="${esc(article.id)}" placeholder="A question, idea, analysis to revisit…">${esc(note)}</textarea>
    </details>

    <div class="card-footer">
      <div class="link-buttons">
        <a class="article-link" href="${esc(article.pubmed_url)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">PubMed ↗</a>
        <a class="article-link" href="${esc(landing)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">Publisher ↗</a>
        ${fullText}
        <a class="article-link paperpile" href="${esc(landing)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}" title="Open the article landing page; use the Paperpile browser extension to save it">P Paperpile</a>
      </div>
      <div class="relevance-score" title="Automated triage score based on research-axis matches, subtopics, article type and journal">Research score ${Number(article.relevance_score || 0)}</div>
    </div>
  </article>`;
}

function wireCards() {
  els.feed.querySelectorAll('[data-action="seen"]').forEach(button => button.addEventListener('click', event => {
    const card = event.currentTarget.closest('.paper-card');
    toggleSeen(card.dataset.id);
  }));
  els.feed.querySelectorAll('[data-action="save"]').forEach(button => button.addEventListener('click', event => {
    const card = event.currentTarget.closest('.paper-card');
    toggleSaved(card.dataset.id);
  }));
  els.feed.querySelectorAll('[data-action="abstract"]').forEach(button => button.addEventListener('click', event => {
    const card = event.currentTarget.closest('.paper-card');
    const text = card.querySelector('.abstract');
    const expanded = !text.classList.contains('clamped');
    text.classList.toggle('clamped', expanded);
    button.textContent = expanded ? 'Show full abstract' : 'Collapse abstract';
  }));
  els.feed.querySelectorAll('[data-action="research"]').forEach(button => button.addEventListener('click', event => {
    const box = event.currentTarget.closest('.research-link');
    const detail = box.querySelector('.research-detail');
    const teaser = box.querySelector('.research-teaser');
    const opening = detail.classList.contains('hidden');
    detail.classList.toggle('hidden', !opening);
    teaser.classList.toggle('hidden', opening);
    button.textContent = opening ? 'Show brief link' : 'Why this matters';
  }));
  els.feed.querySelectorAll('[data-open-article]').forEach(link => link.addEventListener('click', () => markSeen(link.dataset.openArticle)));
  els.feed.querySelectorAll('textarea[data-note]').forEach(textarea => textarea.addEventListener('input', () => {
    const id = textarea.dataset.note;
    const value = textarea.value.trim();
    if (value) state.notes[id] = value; else delete state.notes[id];
    saveState();
  }));
  const loadMore = document.getElementById('loadMore');
  if (loadMore) loadMore.addEventListener('click', () => { renderLimit += 60; renderFeed(); });
}

function markSeen(id) {
  if (!state.seen[id]) {
    state.seen[id] = new Date().toISOString();
    saveState();
    updateStats();
  }
}

function toggleSeen(id) {
  if (state.seen[id]) delete state.seen[id]; else state.seen[id] = new Date().toISOString();
  saveState();
  render();
}

function toggleSaved(id) {
  if (state.saved[id]) delete state.saved[id]; else state.saved[id] = new Date().toISOString();
  saveState();
  render();
}

function viewLabels() {
  const map = {
    latest: ['Latest literature', 'Recent papers'],
    unseen: ['Your reading queue', 'Unseen papers'],
    saved: ['Deep-reading list', 'Saved papers'],
    priority: ['Research radar', 'High-relevance papers'],
    week: ['Weekly digest', 'This week in Fontan']
  };
  return map[state.view] || map.latest;
}

function renderFeed() {
  const filtered = sortArticles(articles.filter(matchesFilters));
  const visible = filtered.slice(0, renderLimit);
  const [kicker, title] = viewLabels();
  els.viewKicker.textContent = kicker;
  els.feedTitle.textContent = title;
  els.resultCount.textContent = `${filtered.length} paper${filtered.length === 1 ? '' : 's'} match this view${filtered.length > renderLimit ? ` · showing ${visible.length}` : ''}`;
  els.feed.innerHTML = visible.map(cardHtml).join('');
  if (filtered.length > renderLimit) {
    els.feed.insertAdjacentHTML('beforeend', `<button id="loadMore" class="secondary-button" type="button">Load 60 more · ${filtered.length - renderLimit} remaining</button>`);
  }
  els.emptyState.hidden = filtered.length !== 0;
  wireCards();
}

function updateStats() {
  const unseen = articles.filter(a => !isSeen(a)).length;
  const week = articles.filter(a => daysAgo(a.published) <= 7).length;
  const saved = articles.filter(isSaved).length;
  els.statTotal.textContent = articles.length.toLocaleString();
  els.statUnseen.textContent = unseen.toLocaleString();
  els.statWeek.textContent = week.toLocaleString();
  els.statSaved.textContent = saved.toLocaleString();
  els.unseenBadge.textContent = unseen.toLocaleString();
}

function renderRadar() {
  const week = articles.filter(a => daysAgo(a.published) <= 7);
  const topicCounts = new Map();
  week.forEach(article => (article.topic_labels || []).forEach(label => topicCounts.set(label, (topicCounts.get(label) || 0) + 1)));
  const themes = [...topicCounts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
  const direct = week.filter(a => a.high_priority).length;
  const top = [...week].sort((a,b) => (b.relevance_score || 0) - (a.relevance_score || 0))[0];

  if (!week.length) {
    els.radarTitle.textContent = 'No newly indexed papers in the last 7 days';
    els.radarText.textContent = 'The archive is still available below. PubMed indexing can lag behind online publication, so the next refresh may add newly indexed work.';
    els.radarThemes.innerHTML = '<span class="radar-chip">Archive remains searchable</span>';
    return;
  }

  els.radarTitle.textContent = `${week.length} new paper${week.length === 1 ? '' : 's'} this week`;
  els.radarText.textContent = direct
    ? `${direct} ${direct === 1 ? 'paper maps' : 'papers map'} strongly to current SAFER-Fontan research axes.${top ? ` Highest automated relevance: “${top.title}”.` : ''}`
    : `New Fontan literature is available, although none crossed the current high-relevance threshold for SAFER-Fontan.`;
  els.radarThemes.innerHTML = themes.length
    ? themes.map(([label,count]) => `<span class="radar-chip"><strong>${count}</strong>${esc(label)}</span>`).join('')
    : '<span class="radar-chip">General Fontan literature</span>';
}

function render() {
  updateStats();
  renderRadar();
  renderFeed();
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === state.view));
}

function resetFilters() {
  state.filters = { search:'', dateWindow:'30', journal:'all', type:'all', year:'all', abstractOnly:false, fullTextOnly:false, topics:[] };
  renderLimit = 60;
  setControlsFromState();
  populateSelects();
  renderTopicFilters();
  saveState();
  render();
}

function wireControls() {
  document.querySelectorAll('.view-tab').forEach(tab => tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    if (state.view === 'week') {
      state.filters.dateWindow = '7';
      els.dateWindow.value = '7';
    }
    renderLimit = 60;
    saveState();
    render();
  }));

  els.searchInput.addEventListener('input', () => { state.filters.search = els.searchInput.value; renderLimit = 60; saveState(); renderFeed(); });
  els.dateWindow.addEventListener('change', () => { state.filters.dateWindow = els.dateWindow.value; renderLimit = 60; saveState(); renderFeed(); });
  els.journalFilter.addEventListener('change', () => { state.filters.journal = els.journalFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.typeFilter.addEventListener('change', () => { state.filters.type = els.typeFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.yearFilter.addEventListener('change', () => { state.filters.year = els.yearFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.abstractOnly.addEventListener('change', () => { state.filters.abstractOnly = els.abstractOnly.checked; renderLimit = 60; saveState(); renderFeed(); });
  els.fullTextOnly.addEventListener('change', () => { state.filters.fullTextOnly = els.fullTextOnly.checked; renderLimit = 60; saveState(); renderFeed(); });

  [els.sortSelect, els.sortSelectMobile].forEach(select => select.addEventListener('change', () => {
    state.sort = select.value;
    els.sortSelect.value = state.sort;
    els.sortSelectMobile.value = state.sort;
    saveState();
    renderFeed();
  }));

  els.clearFilters.addEventListener('click', resetFilters);
  els.emptyReset.addEventListener('click', resetFilters);
  els.selectAllTopics.addEventListener('click', () => {
    state.filters.topics = [];
    renderTopicFilters();
    saveState();
    renderFeed();
  });

  els.mobileFiltersButton.addEventListener('click', openMobileFilters);
  els.mobileOverlay.addEventListener('click', closeMobileFilters);

  els.backupButton.addEventListener('click', () => els.backupDialog.showModal());
  els.exportState.addEventListener('click', exportState);
  els.importState.addEventListener('change', importState);
}

function openMobileFilters() {
  els.filtersPanel.classList.add('open');
  els.mobileOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeMobileFilters() {
  els.filtersPanel.classList.remove('open');
  els.mobileOverlay.hidden = true;
  document.body.style.overflow = '';
}

function exportState() {
  const payload = { exported_at: new Date().toISOString(), app: 'Fontan Digest', state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fontan-digest-reading-state-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importState(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.state || parsed;
    if (!incoming || typeof incoming !== 'object') throw new Error('Invalid state file');
    state = {
      ...state,
      ...incoming,
      seen: incoming.seen || {},
      saved: incoming.saved || {},
      notes: incoming.notes || {},
      filters: { ...state.filters, ...(incoming.filters || {}) }
    };
    saveState();
    setControlsFromState();
    populateSelects();
    renderTopicFilters();
    render();
    els.backupDialog.close();
  } catch (error) {
    alert('This file could not be imported as Fontan Digest reading state.');
  } finally {
    event.target.value = '';
  }
}

async function boot() {
  cacheElements();
  wireControls();
  setControlsFromState();

  try {
    const [articleResponse, topicResponse] = await Promise.all([
      fetch(DATA_URL, { cache:'no-store' }),
      fetch(TOPICS_URL, { cache:'no-store' })
    ]);
    if (!articleResponse.ok) throw new Error(`Article data: ${articleResponse.status}`);
    const payload = await articleResponse.json();
    articles = payload.articles || [];
    if (topicResponse.ok) topicsConfig = await topicResponse.json();

    populateSelects();
    renderTopicFilters();
    render();

    if (payload.generated_at) {
      const updated = new Date(payload.generated_at);
      els.updatedAt.textContent = `Updated ${updated.toLocaleString('en-GB', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`;
    } else {
      els.updatedAt.textContent = articles.length ? 'Loaded' : 'Waiting for first literature refresh';
    }
  } catch (error) {
    els.feed.innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h3>Could not load the digest</h3><p>${esc(error.message)}</p><p>Run the Update Fontan Digest workflow in GitHub Actions and reload this page.</p></div>`;
    els.updatedAt.textContent = 'Data unavailable';
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', boot);
