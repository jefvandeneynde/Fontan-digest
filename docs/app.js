const DATA_URL = 'data/articles.json';
const TOPICS_URL = 'data/topics.json';
const STORAGE_KEY = 'fontanDigestState.v2';
const LEGACY_STORAGE_KEY = 'fontanDigestState.v1';

const els = {};
let articles = [];
let topicsConfig = { groups: [] };
let state = loadState();
let renderLimit = 60;
let lastRenderedIds = [];
let topicCache = new Map();
let cloud = null;
let cloudUser = null;
let cloudPushTimer = null;
let cloudPulling = false;

const SECTION_LABELS = [
  'Background', 'Introduction', 'Rationale', 'Objective', 'Objectives', 'Aim', 'Aims',
  'Design', 'Setting', 'Participants', 'Patients', 'Population', 'Intervention', 'Interventions',
  'Methods', 'Method', 'Materials and Methods', 'Measurements', 'Main Outcome Measures', 'Outcomes',
  'Results', 'Findings', 'Discussion', 'Conclusion', 'Conclusions', 'Interpretation',
  'Clinical Relevance', 'Trial Registration', 'Registration'
];
const KEYWORD_COLORS = new Set(['yellow','mint','blue','pink','purple','orange']);

function freshState() {
  return {
    version: 2,
    lastModified: new Date().toISOString(),
    seen: {},
    saved: {},
    notes: {},
    keywords: [],
    journalPrefs: {},
    topicOverrides: {},
    customTopics: [],
    preferences: {
      defaultView: 'unseen',
      defaultDateWindow: '30',
      respectHiddenJournals: true
    },
    view: 'latest',
    sort: 'newest',
    filters: {
      search: '',
      dateWindow: '30',
      journalQuery: '',
      type: 'all',
      year: 'all',
      abstractOnly: false,
      fullTextOnly: false,
      topics: []
    }
  };
}

function normalizeState(raw = {}) {
  const defaults = freshState();
  const legacyFilters = raw.filters || {};
  return {
    ...defaults,
    ...raw,
    version: 2,
    lastModified: raw.lastModified || defaults.lastModified,
    seen: raw.seen || {},
    saved: raw.saved || {},
    notes: raw.notes || {},
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    journalPrefs: raw.journalPrefs || {},
    topicOverrides: raw.topicOverrides || {},
    customTopics: Array.isArray(raw.customTopics) ? raw.customTopics : [],
    preferences: { ...defaults.preferences, ...(raw.preferences || {}) },
    filters: {
      ...defaults.filters,
      ...legacyFilters,
      journalQuery: legacyFilters.journalQuery ?? (legacyFilters.journal && legacyFilters.journal !== 'all' ? legacyFilters.journal : '')
    }
  };
}

function loadState() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return normalizeState(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return normalizeState(JSON.parse(legacy));
  } catch (error) {
    console.warn('Could not load Fontan Digest state', error);
  }
  return freshState();
}

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveState({ push = true, touch = true } = {}) {
  if (touch) state.lastModified = new Date().toISOString();
  persistLocal();
  if (push) scheduleCloudPush();
}

function cacheElements() {
  [
    'workspace','statTotal','statUnseen','statWeek','statSaved','updatedAt','unseenBadge','syncStatus',
    'searchInput','dateWindow','journalFilter','journalOptions','typeFilter','yearFilter','abstractOnly','fullTextOnly',
    'topicFilters','topicSearch','clearFilters','selectAllTopics','sortSelect','sortSelectMobile','feed','emptyState','emptyReset',
    'researchRadar','radarTitle','radarText','radarThemes','feedTitle','viewKicker','resultCount','filtersPanel',
    'mobileFiltersButton','mobileOverlay','markVisibleSeen','activeKeywordLegend','feedView','settingsView',
    'keywordTerm','keywordColor','addKeyword','keywordList','defaultView','defaultDateWindow','respectHiddenJournals',
    'journalSettingsSearch','journalSettingsStatus','applyJournalSetting','journalPreferenceList','topicSettingsList',
    'customTopicLabel','customTopicWeight','customTopicTerms','addCustomTopic','exportState','importState','resetPersonalSettings',
    'cloudStatusBadge','cloudSetupMessage','cloudAuthControls','syncEmail','sendMagicLink','syncNow','signOutSync','syncMessage'
  ].forEach(id => els[id] = document.getElementById(id));
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function smartTitleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const small = new Set(['a','an','and','as','at','but','by','for','from','in','into','nor','of','on','or','per','the','to','via','with']);
  return text.split(/(\s+|[-/])/).map((part, index, all) => {
    if (/^\s+$|^[-/]$/.test(part)) return part;
    if (/^[A-Z0-9]{2,}$/.test(part)) return part;
    const lower = part.toLowerCase();
    const isFirstWord = !all.slice(0, index).some(x => /[A-Za-z]/.test(x));
    if (!isFirstWord && small.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

function displayJournal(articleOrName) {
  const raw = typeof articleOrName === 'string' ? articleOrName : (articleOrName?.journal || '');
  return smartTitleCase(raw) || 'Journal Unavailable';
}

function journalKey(name) {
  return String(name || '').trim().toLowerCase();
}

function journalStatus(articleOrName) {
  return state.journalPrefs[journalKey(displayJournal(articleOrName))] || 'normal';
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

function activeKeywords() {
  return (state.keywords || []).filter(k => k && k.enabled !== false && String(k.term || '').trim());
}

function highlightText(text) {
  const value = String(text || '');
  const keywords = activeKeywords().sort((a,b) => String(b.term).length - String(a.term).length);
  if (!keywords.length || !value) return esc(value);

  const alternatives = keywords.map(k => escapeRegExp(String(k.term).trim())).join('|');
  let regex;
  try {
    regex = new RegExp(`(?<![A-Za-z0-9])(${alternatives})(?![A-Za-z0-9])`, 'gi');
  } catch {
    regex = new RegExp(`(${alternatives})`, 'gi');
  }

  let output = '';
  let last = 0;
  for (const match of value.matchAll(regex)) {
    const matched = match[0];
    const start = match.index ?? 0;
    output += esc(value.slice(last, start));
    const keyword = keywords.find(k => String(k.term).toLowerCase() === matched.toLowerCase()) || keywords[0];
    const color = KEYWORD_COLORS.has(keyword.color) ? keyword.color : 'yellow';
    output += `<mark class="keyword-hit kw-${color}">${esc(matched)}</mark>`;
    last = start + matched.length;
  }
  output += esc(value.slice(last));
  return output;
}

function structuredAbstractHtml(text) {
  const value = String(text || '').trim();
  if (!value) return '<p>No abstract is available from PubMed for this record.</p>';
  const labels = SECTION_LABELS.map(escapeRegExp).join('|');
  const regex = new RegExp(`(?:^|\\s)(${labels}):\\s*`, 'gi');
  const matches = [...value.matchAll(regex)];
  if (!matches.length) return `<p>${highlightText(value)}</p>`;

  const sections = [];
  const first = matches[0];
  const intro = value.slice(0, first.index).trim();
  if (intro) sections.push(`<div class="abstract-section"><span>${highlightText(intro)}</span></div>`);

  matches.forEach((match, i) => {
    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = i + 1 < matches.length ? (matches[i + 1].index || value.length) : value.length;
    const content = value.slice(contentStart, contentEnd).trim();
    const label = smartTitleCase(match[1]);
    sections.push(`<div class="abstract-section"><strong>${esc(label)}</strong><span>${highlightText(content)}</span></div>`);
  });
  return sections.join('');
}

function baseTopics() {
  const result = [];
  (topicsConfig.groups || []).forEach(group => {
    (group.topics || []).forEach(topic => {
      const override = state.topicOverrides?.[topic.id] || {};
      result.push({
        ...topic,
        ...override,
        id: topic.id,
        baseLabel: topic.label,
        group: group.label,
        enabled: override.enabled ?? topic.enabled ?? true,
        weight: Number(override.weight ?? topic.weight ?? 1),
        terms: Array.isArray(override.terms) ? override.terms : (topic.terms || []),
        custom: false
      });
    });
  });
  return result;
}

function effectiveTopics() {
  const custom = (state.customTopics || []).map(topic => ({
    ...topic,
    group: topic.group || 'My topics',
    enabled: topic.enabled !== false,
    weight: Number(topic.weight || 3),
    terms: Array.isArray(topic.terms) ? topic.terms : [],
    custom: true
  }));
  return [...baseTopics(), ...custom];
}

function invalidateTopicCache() {
  topicCache = new Map();
}

function articleTopicInfo(article) {
  if (topicCache.has(article.id)) return topicCache.get(article.id);
  const combined = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
  const backendIds = new Set(article.topics || []);
  const matched = effectiveTopics().filter(topic => {
    if (!topic.enabled) return false;
    if (backendIds.has(topic.id)) return true;
    return (topic.terms || []).some(term => term && combined.includes(String(term).toLowerCase()));
  });
  const info = {
    ids: matched.map(t => t.id),
    labels: matched.map(t => t.label),
    score: matched.reduce((sum,t) => sum + Number(t.weight || 0), 0)
  };
  topicCache.set(article.id, info);
  return info;
}

function personalRelevance(article) {
  let score = Number(article.relevance_score || 0) + articleTopicInfo(article).score;
  const status = journalStatus(article);
  if (status === 'preferred') score += 18;
  if (isSaved(article)) score += 3;
  return score;
}

function setControlsFromState() {
  els.searchInput.value = state.filters.search || '';
  els.dateWindow.value = state.filters.dateWindow || state.preferences.defaultDateWindow || '30';
  els.journalFilter.value = state.filters.journalQuery || '';
  els.abstractOnly.checked = Boolean(state.filters.abstractOnly);
  els.fullTextOnly.checked = Boolean(state.filters.fullTextOnly);
  els.sortSelect.value = state.sort || 'newest';
  els.sortSelectMobile.value = state.sort || 'newest';
  els.defaultView.value = state.preferences.defaultView || 'unseen';
  els.defaultDateWindow.value = state.preferences.defaultDateWindow || '30';
  els.respectHiddenJournals.checked = state.preferences.respectHiddenJournals !== false;
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === state.view));
}

function allJournalNames() {
  return [...new Set(articles.map(displayJournal).filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function populateSelects() {
  const journals = allJournalNames();
  els.journalOptions.innerHTML = journals.map(v => `<option value="${esc(v)}"></option>`).join('');

  const types = [...new Set(articles.map(a => a.article_type).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const years = [...new Set(articles.map(a => a.year).filter(Boolean))].sort((a,b) => b-a);
  fillSelect(els.typeFilter, types, 'All types');
  fillSelect(els.yearFilter, years, 'All years');
  els.typeFilter.value = types.includes(state.filters.type) ? state.filters.type : 'all';
  els.yearFilter.value = years.map(String).includes(String(state.filters.year)) ? String(state.filters.year) : 'all';
}

function fillSelect(select, values, allLabel) {
  select.innerHTML = `<option value="all">${esc(allLabel)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function renderTopicFilters() {
  const selected = new Set(state.filters.topics || []);
  const q = String(els.topicSearch?.value || '').trim().toLowerCase();
  const groups = new Map();
  effectiveTopics().filter(t => t.enabled).forEach(topic => {
    if (q && !`${topic.label} ${(topic.terms || []).join(' ')}`.toLowerCase().includes(q)) return;
    if (!groups.has(topic.group)) groups.set(topic.group, []);
    groups.get(topic.group).push(topic);
  });

  els.topicFilters.innerHTML = [...groups.entries()].map(([group, topics]) => {
    const choices = topics.map(topic => `
      <label class="topic-check">
        <input type="checkbox" value="${esc(topic.id)}" ${selected.has(topic.id) ? 'checked' : ''}>
        <span>${esc(topic.label)}</span>
      </label>`).join('');
    return `<div class="topic-group"><div class="topic-group-title">${esc(group)}</div>${choices}</div>`;
  }).join('') || '<p class="field-help">No subtopics match.</p>';

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
  const topicInfo = articleTopicInfo(article);
  const q = (f.search || '').trim().toLowerCase();
  if (q) {
    const haystack = [article.title, article.abstract, displayJournal(article), ...(article.authors || []), ...topicInfo.labels].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (f.dateWindow !== 'all' && daysAgo(article.published) > Number(f.dateWindow)) return false;
  const journalQuery = String(f.journalQuery || '').trim().toLowerCase();
  if (journalQuery && !displayJournal(article).toLowerCase().includes(journalQuery)) return false;
  if (!journalQuery && state.preferences.respectHiddenJournals !== false && journalStatus(article) === 'hidden') return false;
  if (f.type !== 'all' && article.article_type !== f.type) return false;
  if (f.year !== 'all' && String(article.year) !== String(f.year)) return false;
  if (f.abstractOnly && !article.abstract) return false;
  if (f.fullTextOnly && !article.has_full_text) return false;

  const selectedTopics = f.topics || [];
  if (selectedTopics.length && !selectedTopics.some(topic => topicInfo.ids.includes(topic))) return false;

  if (state.view === 'unseen' && isSeen(article)) return false;
  if (state.view === 'saved' && !isSaved(article)) return false;
  if (state.view === 'priority' && !(article.high_priority || personalRelevance(article) >= 55)) return false;
  if (state.view === 'week' && daysAgo(article.published) > 7) return false;

  return true;
}

function sortArticles(items) {
  const result = [...items];
  if (state.sort === 'relevance') {
    result.sort((a,b) => personalRelevance(b) - personalRelevance(a) || String(b.published).localeCompare(String(a.published)));
  } else if (state.sort === 'journal') {
    result.sort((a,b) => displayJournal(a).localeCompare(displayJournal(b)) || String(b.published).localeCompare(String(a.published)));
  } else if (state.sort === 'oldest') {
    result.sort((a,b) => String(a.published || '').localeCompare(String(b.published || '')));
  } else {
    result.sort((a,b) => String(b.published || '').localeCompare(String(a.published || '')) || personalRelevance(b) - personalRelevance(a));
  }
  return result;
}

function researchLabels(article) {
  return (article.research_links || []).slice(0, 2).map(link => `<span class="tag">${esc(link.label)}</span>`).join('');
}

function topicTags(article) {
  return articleTopicInfo(article).labels.slice(0, 4).map(label => `<span class="tag">${esc(label)}</span>`).join('');
}

function cardHtml(article) {
  const seen = isSeen(article);
  const saved = isSaved(article);
  const landing = article.publisher_url || article.pubmed_url;
  const note = state.notes[article.id] || '';
  const fullText = article.full_text_url ? `<a class="article-link" href="${esc(article.full_text_url)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">PMC full text ↗</a>` : '';
  const priority = (article.high_priority || personalRelevance(article) >= 55) ? '<span class="tag priority">◆ High research relevance</span>' : '';
  const preferred = journalStatus(article) === 'preferred' ? '<span class="tag preferred">♥ Preferred journal</span>' : '';
  const open = article.has_full_text ? '<span class="tag open">Open in PMC</span>' : '';
  const unseen = seen ? '' : '<span class="unseen-marker" title="Unseen"></span>';

  return `<article class="paper-card ${seen ? 'seen' : ''}" data-id="${esc(article.id)}">
    <div class="card-top">
      <div class="card-title-wrap">
        <div class="meta-line"><span>${unseen}<span class="journal-name">${esc(displayJournal(article))}</span></span><span>${esc(formatDate(article.published))}</span><span>${esc(article.article_type || 'Article')}</span></div>
        <h3 class="paper-title"><a href="${esc(landing)}" target="_blank" rel="noreferrer" data-open-article="${esc(article.id)}">${highlightText(article.title)}</a></h3>
        <div class="meta-line"><span>${esc(authorText(article.authors))}</span>${article.doi ? `<span>DOI ${esc(article.doi)}</span>` : ''}${article.pmid ? `<span>PMID ${esc(article.pmid)}</span>` : ''}</div>
      </div>
      <div class="card-actions-top">
        <button class="icon-action ${seen ? 'active seen-action' : ''}" type="button" data-action="seen" title="Mark as seen">${seen ? '✓ Seen' : '○ Seen'}</button>
        <button class="icon-action ${saved ? 'active saved' : ''}" type="button" data-action="save" title="Save for in-depth reading">${saved ? '★ Saved' : '☆ Save'}</button>
      </div>
    </div>

    <div class="tags">${priority}${preferred}<span class="tag type">${esc(article.article_type || 'Article')}</span>${open}${topicTags(article)}</div>

    <div class="abstract clamped">${structuredAbstractHtml(article.abstract)}</div>
    ${article.abstract ? '<button class="toggle-detail" type="button" data-action="abstract">Show full abstract</button>' : ''}

    <div class="research-link">
      <div class="research-link-head">↗ Link to our research ${researchLabels(article)}</div>
      <p class="research-teaser">${highlightText(article.research_teaser || '')}</p>
      <p class="research-detail hidden">${highlightText(article.research_detail || '')}</p>
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
      </div>
      <div class="relevance-score" title="Automated triage score plus your topic and journal preferences">Personal relevance ${personalRelevance(article)}</div>
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
  els.feed.querySelectorAll('textarea[data-note]').forEach(textarea => textarea.addEventListener('change', () => {
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

function renderKeywordLegend() {
  const keywords = activeKeywords();
  els.activeKeywordLegend.hidden = !keywords.length;
  els.activeKeywordLegend.innerHTML = keywords.length
    ? `<span>Highlighting:</span>${keywords.map(k => `<span class="keyword-chip kw-${KEYWORD_COLORS.has(k.color) ? k.color : 'yellow'}">${esc(k.term)}</span>`).join('')}<button class="text-button" type="button" data-open-settings>edit</button>`
    : '';
  els.activeKeywordLegend.querySelector('[data-open-settings]')?.addEventListener('click', () => switchView('settings'));
}

function renderFeed() {
  const filtered = sortArticles(articles.filter(matchesFilters));
  const visible = filtered.slice(0, renderLimit);
  lastRenderedIds = visible.map(a => a.id);
  const [kicker, title] = viewLabels();
  els.viewKicker.textContent = kicker;
  els.feedTitle.textContent = title;
  els.resultCount.textContent = `${filtered.length} paper${filtered.length === 1 ? '' : 's'} match this view${filtered.length > renderLimit ? ` · showing ${visible.length}` : ''}`;
  renderKeywordLegend();
  els.feed.innerHTML = visible.map(cardHtml).join('');
  if (filtered.length > renderLimit) {
    els.feed.insertAdjacentHTML('beforeend', `<button id="loadMore" class="secondary-button load-more" type="button">Load 60 more · ${filtered.length - renderLimit} remaining</button>`);
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
  week.forEach(article => articleTopicInfo(article).labels.forEach(label => topicCounts.set(label, (topicCounts.get(label) || 0) + 1)));
  const themes = [...topicCounts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
  const direct = week.filter(a => a.high_priority || personalRelevance(a) >= 55).length;
  const top = [...week].sort((a,b) => personalRelevance(b) - personalRelevance(a))[0];

  if (!week.length) {
    els.radarTitle.textContent = 'No newly indexed papers in the last 7 days';
    els.radarText.textContent = 'The archive is still available below. PubMed indexing can lag behind online publication, so the next refresh may add newly indexed work.';
    els.radarThemes.innerHTML = '<span class="radar-chip">Archive remains searchable</span>';
    return;
  }

  els.radarTitle.textContent = `${week.length} new paper${week.length === 1 ? '' : 's'} this week`;
  els.radarText.textContent = direct
    ? `${direct} ${direct === 1 ? 'paper maps' : 'papers map'} strongly to current SAFER-Fontan research axes and your preferences.${top ? ` Highest current relevance: “${top.title}”.` : ''}`
    : 'New Fontan literature is available, although none crossed the current high-relevance threshold.';
  els.radarThemes.innerHTML = themes.length
    ? themes.map(([label,count]) => `<span class="radar-chip"><strong>${count}</strong>${esc(label)}</span>`).join('')
    : '<span class="radar-chip">General Fontan literature</span>';
}

function render() {
  updateStats();
  const settingsMode = state.view === 'settings';
  els.feedView.hidden = settingsMode;
  els.settingsView.hidden = !settingsMode;
  els.filtersPanel.hidden = settingsMode;
  els.workspace.classList.toggle('settings-layout', settingsMode);
  document.querySelectorAll('.view-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === state.view));
  if (settingsMode) {
    renderSettings();
  } else {
    renderRadar();
    renderFeed();
  }
}

function switchView(view) {
  state.view = view;
  if (view === 'week') {
    state.filters.dateWindow = '7';
    els.dateWindow.value = '7';
  }
  renderLimit = 60;
  saveState();
  render();
  window.scrollTo({ top: document.querySelector('.view-nav').offsetTop, behavior: 'smooth' });
}

function resetFilters() {
  state.filters = {
    search:'',
    dateWindow: state.preferences.defaultDateWindow || '30',
    journalQuery:'',
    type:'all',
    year:'all',
    abstractOnly:false,
    fullTextOnly:false,
    topics:[]
  };
  renderLimit = 60;
  setControlsFromState();
  populateSelects();
  renderTopicFilters();
  saveState();
  render();
}

function wireControls() {
  document.querySelectorAll('.view-tab').forEach(tab => tab.addEventListener('click', () => switchView(tab.dataset.view)));

  els.searchInput.addEventListener('input', () => { state.filters.search = els.searchInput.value; renderLimit = 60; saveState(); renderFeed(); });
  els.dateWindow.addEventListener('change', () => { state.filters.dateWindow = els.dateWindow.value; renderLimit = 60; saveState(); renderFeed(); });
  els.journalFilter.addEventListener('input', () => { state.filters.journalQuery = els.journalFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.typeFilter.addEventListener('change', () => { state.filters.type = els.typeFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.yearFilter.addEventListener('change', () => { state.filters.year = els.yearFilter.value; renderLimit = 60; saveState(); renderFeed(); });
  els.abstractOnly.addEventListener('change', () => { state.filters.abstractOnly = els.abstractOnly.checked; renderLimit = 60; saveState(); renderFeed(); });
  els.fullTextOnly.addEventListener('change', () => { state.filters.fullTextOnly = els.fullTextOnly.checked; renderLimit = 60; saveState(); renderFeed(); });
  els.topicSearch.addEventListener('input', renderTopicFilters);

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
  els.markVisibleSeen.addEventListener('click', markVisibleSeen);

  els.addKeyword.addEventListener('click', addKeyword);
  els.keywordTerm.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword(); } });
  els.defaultView.addEventListener('change', () => { state.preferences.defaultView = els.defaultView.value; saveState(); });
  els.defaultDateWindow.addEventListener('change', () => { state.preferences.defaultDateWindow = els.defaultDateWindow.value; saveState(); });
  els.respectHiddenJournals.addEventListener('change', () => { state.preferences.respectHiddenJournals = els.respectHiddenJournals.checked; saveState(); });
  els.applyJournalSetting.addEventListener('click', applyJournalSetting);
  els.journalSettingsSearch.addEventListener('input', renderJournalPreferences);
  els.addCustomTopic.addEventListener('click', addCustomTopic);
  els.exportState.addEventListener('click', exportState);
  els.importState.addEventListener('change', importState);
  els.resetPersonalSettings.addEventListener('click', resetPersonalSettings);
  els.sendMagicLink.addEventListener('click', sendMagicLink);
  els.syncNow.addEventListener('click', syncFromCloud);
  els.signOutSync.addEventListener('click', signOutCloud);
}

function markVisibleSeen() {
  const timestamp = new Date().toISOString();
  lastRenderedIds.forEach(id => state.seen[id] = state.seen[id] || timestamp);
  saveState();
  render();
}

function openMobileFilters() {
  els.filtersPanel.hidden = false;
  els.filtersPanel.classList.add('open');
  els.mobileOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeMobileFilters() {
  els.filtersPanel.classList.remove('open');
  els.mobileOverlay.hidden = true;
  document.body.style.overflow = '';
  if (state.view === 'settings') els.filtersPanel.hidden = true;
}

function addKeyword() {
  const term = els.keywordTerm.value.trim();
  if (!term) return;
  if ((state.keywords || []).some(k => String(k.term).toLowerCase() === term.toLowerCase())) {
    els.keywordTerm.value = '';
    return;
  }
  state.keywords.push({ id:`kw-${Date.now()}`, term, color: els.keywordColor.value, enabled:true });
  els.keywordTerm.value = '';
  saveState();
  renderSettings();
}

function renderKeywords() {
  const list = state.keywords || [];
  els.keywordList.innerHTML = list.length ? list.map(keyword => {
    const color = KEYWORD_COLORS.has(keyword.color) ? keyword.color : 'yellow';
    return `<div class="setting-row" data-keyword-id="${esc(keyword.id)}">
      <span class="keyword-chip kw-${color}">${esc(keyword.term)}</span>
      <div class="setting-row-actions">
        <select data-keyword-color aria-label="Color for ${esc(keyword.term)}">
          ${['yellow','mint','blue','pink','purple','orange'].map(c => `<option value="${c}" ${c === color ? 'selected' : ''}>${smartTitleCase(c)}</option>`).join('')}
        </select>
        <label class="mini-toggle"><input data-keyword-enabled type="checkbox" ${keyword.enabled !== false ? 'checked' : ''}> on</label>
        <button class="text-button danger-text" data-remove-keyword type="button">Remove</button>
      </div>
    </div>`;
  }).join('') : '<p class="empty-settings">No highlight keywords yet.</p>';

  els.keywordList.querySelectorAll('[data-keyword-id]').forEach(row => {
    const id = row.dataset.keywordId;
    row.querySelector('[data-keyword-color]').addEventListener('change', event => {
      const keyword = state.keywords.find(k => k.id === id);
      if (keyword) keyword.color = event.target.value;
      saveState(); renderSettings();
    });
    row.querySelector('[data-keyword-enabled]').addEventListener('change', event => {
      const keyword = state.keywords.find(k => k.id === id);
      if (keyword) keyword.enabled = event.target.checked;
      saveState();
    });
    row.querySelector('[data-remove-keyword]').addEventListener('click', () => {
      state.keywords = state.keywords.filter(k => k.id !== id);
      saveState(); renderSettings();
    });
  });
}

function applyJournalSetting() {
  const typed = els.journalSettingsSearch.value.trim();
  if (!typed) return;
  const match = allJournalNames().find(name => name.toLowerCase() === typed.toLowerCase())
    || allJournalNames().find(name => name.toLowerCase().includes(typed.toLowerCase()))
    || smartTitleCase(typed);
  const key = journalKey(match);
  const status = els.journalSettingsStatus.value;
  if (status === 'normal') delete state.journalPrefs[key]; else state.journalPrefs[key] = status;
  els.journalSettingsSearch.value = '';
  saveState();
  renderJournalPreferences();
}

function renderJournalPreferences() {
  const names = allJournalNames();
  const q = String(els.journalSettingsSearch?.value || '').trim().toLowerCase();
  const modified = names.filter(name => journalStatus(name) !== 'normal');
  const candidates = q ? names.filter(name => name.toLowerCase().includes(q)).slice(0, 20) : modified;

  els.journalPreferenceList.innerHTML = candidates.length ? candidates.map(name => {
    const status = journalStatus(name);
    return `<div class="setting-row">
      <strong>${esc(name)}</strong>
      <div class="setting-row-actions">
        <span class="status-badge status-${status}">${esc(smartTitleCase(status))}</span>
        <button class="text-button" data-journal-name="${esc(name)}" data-next-status="preferred" type="button">Prefer</button>
        <button class="text-button" data-journal-name="${esc(name)}" data-next-status="hidden" type="button">Hide</button>
        ${status !== 'normal' ? `<button class="text-button" data-journal-name="${esc(name)}" data-next-status="normal" type="button">Reset</button>` : ''}
      </div>
    </div>`;
  }).join('') : `<p class="empty-settings">${q ? 'No journal matches that search.' : 'No journal preferences yet. Start typing a journal name above.'}</p>`;

  els.journalPreferenceList.querySelectorAll('[data-journal-name]').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.journalName;
    const next = button.dataset.nextStatus;
    const key = journalKey(name);
    if (next === 'normal') delete state.journalPrefs[key]; else state.journalPrefs[key] = next;
    saveState();
    renderJournalPreferences();
  }));
}

function renderTopicSettings() {
  const topics = effectiveTopics();
  els.topicSettingsList.innerHTML = topics.map(topic => `
    <details class="topic-setting" data-topic-id="${esc(topic.id)}" ${topic.custom ? 'open' : ''}>
      <summary>
        <span><strong>${esc(topic.label)}</strong><small>${esc(topic.group)}</small></span>
        <span class="topic-summary-meta">${topic.enabled ? 'On' : 'Off'} · weight ${topic.weight}</span>
      </summary>
      <div class="topic-edit-grid">
        <label>Display name<input data-topic-label type="text" value="${esc(topic.label)}"></label>
        <label>Importance<select data-topic-weight>${[1,2,3,4,5].map(w => `<option value="${w}" ${Number(topic.weight) === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="switch-row settings-switch"><span>Enabled</span><input data-topic-enabled type="checkbox" ${topic.enabled ? 'checked' : ''}><i></i></label>
        <label class="topic-terms-label">Matching terms<textarea data-topic-terms>${esc((topic.terms || []).join(', '))}</textarea></label>
        <div class="topic-edit-actions"><button class="secondary-button small-button" data-save-topic type="button">Save topic</button>${topic.custom ? '<button class="danger-button small-button" data-remove-topic type="button">Remove custom topic</button>' : '<button class="text-button" data-reset-topic type="button">Reset to shared default</button>'}</div>
      </div>
    </details>`).join('');

  els.topicSettingsList.querySelectorAll('[data-topic-id]').forEach(box => {
    const id = box.dataset.topicId;
    const topic = topics.find(t => t.id === id);
    box.querySelector('[data-save-topic]').addEventListener('click', () => {
      const patch = {
        label: box.querySelector('[data-topic-label]').value.trim() || topic.label,
        weight: Number(box.querySelector('[data-topic-weight]').value),
        enabled: box.querySelector('[data-topic-enabled]').checked,
        terms: box.querySelector('[data-topic-terms]').value.split(',').map(x => x.trim()).filter(Boolean)
      };
      if (topic.custom) {
        const target = state.customTopics.find(t => t.id === id);
        Object.assign(target, patch);
      } else {
        state.topicOverrides[id] = patch;
      }
      invalidateTopicCache();
      saveState();
      renderTopicFilters();
      renderSettings();
    });
    box.querySelector('[data-reset-topic]')?.addEventListener('click', () => {
      delete state.topicOverrides[id];
      invalidateTopicCache();
      saveState();
      renderTopicFilters();
      renderSettings();
    });
    box.querySelector('[data-remove-topic]')?.addEventListener('click', () => {
      state.customTopics = state.customTopics.filter(t => t.id !== id);
      state.filters.topics = state.filters.topics.filter(x => x !== id);
      invalidateTopicCache();
      saveState();
      renderTopicFilters();
      renderSettings();
    });
  });
}

function addCustomTopic() {
  const label = els.customTopicLabel.value.trim();
  const terms = els.customTopicTerms.value.split(',').map(x => x.trim()).filter(Boolean);
  if (!label || !terms.length) return;
  state.customTopics.push({
    id: `custom-${Date.now()}`,
    label,
    group: 'My topics',
    weight: Number(els.customTopicWeight.value || 3),
    enabled: true,
    terms
  });
  els.customTopicLabel.value = '';
  els.customTopicTerms.value = '';
  invalidateTopicCache();
  saveState();
  renderTopicFilters();
  renderSettings();
}

function renderSettings() {
  setControlsFromState();
  renderKeywords();
  renderJournalPreferences();
  renderTopicSettings();
  updateCloudUi();
}

function resetPersonalSettings() {
  if (!confirm('Reset keywords, journal preferences, topic customizations and feed preferences? Seen/saved papers and notes will be kept.')) return;
  const keep = { seen: state.seen, saved: state.saved, notes: state.notes };
  const fresh = freshState();
  state = { ...fresh, ...keep, view: 'settings' };
  invalidateTopicCache();
  saveState();
  renderTopicFilters();
  renderSettings();
}

function exportState() {
  const payload = { exported_at: new Date().toISOString(), app: 'Fontan Digest', state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fontan-digest-state-${new Date().toISOString().slice(0,10)}.json`;
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
    const incoming = normalizeState(parsed.state || parsed);
    state = incoming;
    invalidateTopicCache();
    saveState();
    setControlsFromState();
    populateSelects();
    renderTopicFilters();
    render();
  } catch (error) {
    alert('This file could not be imported as Fontan Digest reading state.');
  } finally {
    event.target.value = '';
  }
}

function syncConfigValid() {
  const cfg = window.FONTAN_SYNC_CONFIG || {};
  return Boolean(cfg.url && cfg.anonKey && window.supabase?.createClient);
}

async function initCloudSync() {
  if (!syncConfigValid()) {
    updateCloudUi();
    return;
  }
  const cfg = window.FONTAN_SYNC_CONFIG;
  cloud = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const { data } = await cloud.auth.getSession();
  cloudUser = data?.session?.user || null;
  updateCloudUi();
  if (cloudUser) await syncFromCloud();

  cloud.auth.onAuthStateChange((_event, session) => {
    cloudUser = session?.user || null;
    updateCloudUi();
    if (cloudUser) setTimeout(syncFromCloud, 0);
  });
}

function updateCloudUi(message = '') {
  const configured = syncConfigValid();
  if (!configured) {
    els.syncStatus.innerHTML = '<span class="sync-dot"></span><span>Local only</span>';
    els.cloudStatusBadge.textContent = 'Backend setup needed';
    els.cloudStatusBadge.className = 'status-badge status-hidden';
    els.cloudSetupMessage.hidden = false;
    els.cloudAuthControls.hidden = true;
    if (message) els.cloudSetupMessage.textContent = message;
    return;
  }

  els.cloudSetupMessage.hidden = true;
  els.cloudAuthControls.hidden = false;
  if (cloudUser) {
    els.syncStatus.classList.add('connected');
    els.syncStatus.innerHTML = '<span class="sync-dot"></span><span>Cloud synced</span>';
    els.cloudStatusBadge.textContent = 'Connected';
    els.cloudStatusBadge.className = 'status-badge status-preferred';
    els.syncEmail.value = cloudUser.email || '';
    els.syncEmail.disabled = true;
    els.sendMagicLink.hidden = true;
    els.signOutSync.hidden = false;
  } else {
    els.syncStatus.classList.remove('connected');
    els.syncStatus.innerHTML = '<span class="sync-dot"></span><span>Sync available</span>';
    els.cloudStatusBadge.textContent = 'Sign in';
    els.cloudStatusBadge.className = 'status-badge';
    els.syncEmail.disabled = false;
    els.sendMagicLink.hidden = false;
    els.signOutSync.hidden = true;
  }
  els.syncMessage.textContent = message;
}

async function sendMagicLink() {
  if (!cloud) return;
  const email = els.syncEmail.value.trim();
  if (!email) return;
  updateCloudUi('Sending sign-in link…');
  const redirect = `${window.location.origin}${window.location.pathname}`;
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  updateCloudUi(error ? `Could not send link: ${error.message}` : 'Check your email and open the sign-in link on this device.');
}

async function signOutCloud() {
  if (!cloud) return;
  await cloud.auth.signOut();
  cloudUser = null;
  updateCloudUi('Signed out. Local data remains on this device.');
}

function scheduleCloudPush() {
  if (!cloud || !cloudUser || cloudPulling) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(pushCloudState, 900);
}

async function pushCloudState() {
  if (!cloud || !cloudUser || cloudPulling) return;
  const payload = JSON.parse(JSON.stringify(state));
  const { error } = await cloud.from('fontan_digest_user_state').upsert({
    user_id: cloudUser.id,
    state: payload,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) updateCloudUi(`Sync error: ${error.message}`);
  else updateCloudUi('Synced just now.');
}

async function syncFromCloud() {
  if (!cloud || !cloudUser) return;
  cloudPulling = true;
  updateCloudUi('Syncing…');
  try {
    const { data, error } = await cloud.from('fontan_digest_user_state')
      .select('state,updated_at')
      .eq('user_id', cloudUser.id)
      .maybeSingle();
    if (error) throw error;

    if (!data?.state) {
      cloudPulling = false;
      await pushCloudState();
      return;
    }

    const remote = normalizeState(data.state);
    const remoteTime = Date.parse(remote.lastModified || data.updated_at || 0) || 0;
    const localTime = Date.parse(state.lastModified || 0) || 0;
    if (remoteTime > localTime) {
      state = remote;
      invalidateTopicCache();
      persistLocal();
      setControlsFromState();
      populateSelects();
      renderTopicFilters();
      render();
      updateCloudUi('Loaded your latest state from the cloud.');
    } else if (localTime > remoteTime) {
      cloudPulling = false;
      await pushCloudState();
      return;
    } else {
      updateCloudUi('Up to date.');
    }
  } catch (error) {
    updateCloudUi(`Sync error: ${error.message}`);
  } finally {
    cloudPulling = false;
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

    await initCloudSync();
  } catch (error) {
    els.feed.innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h3>Could not load the digest</h3><p>${esc(error.message)}</p><p>Run the Update Fontan Digest workflow in GitHub Actions and reload this page.</p></div>`;
    els.updatedAt.textContent = 'Data unavailable';
  }

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        state = normalizeState(JSON.parse(event.newValue));
        invalidateTopicCache();
        setControlsFromState();
        renderTopicFilters();
        render();
      } catch {}
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', boot);
