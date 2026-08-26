// Public browser configuration for Fontan Digest cloud sync.
// The publishable key is safe to expose in a client application; Row Level Security protects user data.
window.FONTAN_SYNC_CONFIG = {
  url: 'https://mrkszekzjipbecbmhqzq.supabase.co',
  anonKey: 'sb_publishable_iy3vr-St4ALVWtgg43Tkew_bCIb8m49'
};

// Small progressive-enhancement layer for the static GitHub Pages app.
// It runs after the main app has loaded so we can keep the shared data model simple.
window.addEventListener('load', () => {
  const ABSTRACT_HEADINGS = [
    'Purpose', 'Background', 'Background and Purpose', 'Background and Objectives',
    'Introduction', 'Importance', 'Context', 'Rationale',
    'Objective', 'Objectives', 'Aim', 'Aims', 'Hypothesis', 'Question',
    'Design', 'Study Design', 'Setting', 'Participants', 'Patients', 'Subjects',
    'Population', 'Sample', 'Exposure', 'Exposures', 'Intervention', 'Interventions',
    'Methods', 'Method', 'Materials and Methods', 'Patients and Methods',
    'Methods and Results', 'Measurements', 'Main Outcome Measures',
    'Main Outcomes and Measures', 'Outcome', 'Outcomes', 'Endpoints',
    'Data Sources', 'Study Selection', 'Eligibility Criteria', 'Data Extraction',
    'Data Extraction and Synthesis', 'Data Synthesis', 'Statistical Analysis',
    'Results', 'Findings', 'Discussion', 'Limitations',
    'Conclusion', 'Conclusions', 'Interpretation', 'Meaning',
    'Clinical Relevance', 'Clinical Implications', 'Perspective',
    'Trial Registration', 'Registration', 'Funding'
  ];

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Prefer an explicit, deliberately broad medical-abstract heading list rather than
  // treating every short phrase followed by a colon as a heading. This avoids false
  // positives such as ratios, locations, time points or ordinary prose containing colons.
  try {
    structuredAbstractHtml = function(text) {
      const value = String(text || '').trim();
      if (!value) return '<p>No abstract is available from PubMed for this record.</p>';

      const labels = ABSTRACT_HEADINGS
        .slice()
        .sort((a, b) => b.length - a.length)
        .map(escapeRegex)
        .join('|');
      const regex = new RegExp(`(?:^|\\s)(${labels}):\\s*`, 'gi');
      const matches = [...value.matchAll(regex)];
      if (!matches.length) return `<p>${highlightText(value)}</p>`;

      const sections = [];
      const first = matches[0];
      const intro = value.slice(0, first.index).trim();
      if (intro) sections.push(`<div class="abstract-section"><span>${highlightText(intro)}</span></div>`);

      matches.forEach((match, index) => {
        const contentStart = (match.index || 0) + match[0].length;
        const contentEnd = index + 1 < matches.length ? (matches[index + 1].index || value.length) : value.length;
        const content = value.slice(contentStart, contentEnd).trim();
        const canonical = ABSTRACT_HEADINGS.find(label => label.toLowerCase() === String(match[1]).toLowerCase()) || match[1];
        sections.push(`<div class="abstract-section"><strong>${esc(canonical)}</strong><span>${highlightText(content)}</span></div>`);
      });
      return sections.join('');
    };
  } catch (error) {
    console.warn('Could not enhance structured abstract rendering', error);
  }

  function selectedJournals() {
    return Array.isArray(state?.filters?.journals) ? state.filters.journals : [];
  }

  // Preserve all the normal filters, but make the journal text box search the checkbox
  // list instead of narrowing the article feed itself. Checked journals are OR'ed.
  try {
    const originalMatchesFilters = matchesFilters;
    matchesFilters = function(article) {
      const query = state.filters.journalQuery || '';
      let baseMatch = false;
      try {
        state.filters.journalQuery = '';
        baseMatch = originalMatchesFilters(article);
      } finally {
        state.filters.journalQuery = query;
      }
      if (!baseMatch) return false;

      const chosen = selectedJournals();
      if (!chosen.length) return true;
      const current = journalKey(displayJournal(article));
      return chosen.some(name => journalKey(name) === current);
    };
  } catch (error) {
    console.warn('Could not enhance journal filtering', error);
  }

  const style = document.createElement('style');
  style.textContent = `
    .journal-filter-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 5px}
    .journal-filter-tools span{font-size:.7rem;color:#7d8e96}
    .journal-checkbox-list{max-height:235px;overflow:auto;border:1px solid var(--line);background:#fff;border-radius:10px;padding:5px;scrollbar-width:thin}
    .journal-check{display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:7px;font-size:.77rem;color:#405763;cursor:pointer}
    .journal-check:hover{background:#f4f8f8}
    .journal-check input{accent-color:var(--teal);flex:0 0 auto}
    .journal-check.selected{background:#eef8f7;color:#23545b;font-weight:700}
    .journal-selected-divider{padding:7px 7px 4px;font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:#809198;font-weight:800;border-top:1px solid #edf1f2;margin-top:3px}
    .journal-selected-divider:first-child{border-top:0;margin-top:0}
    .journal-no-match{padding:9px 7px;color:#87969d;font-size:.75rem;font-style:italic}
  `;
  document.head.appendChild(style);

  const journalInput = document.getElementById('journalFilter');
  if (!journalInput) return;
  const block = journalInput.closest('.filter-block');
  if (!block) return;

  const oldHelp = block.querySelector('.field-help');
  if (oldHelp) oldHelp.textContent = 'Type to find a journal, then tick one or more. Multiple checked journals are combined.';

  const tools = document.createElement('div');
  tools.className = 'journal-filter-tools';
  tools.innerHTML = '<span id="journalSelectionCount">No journals selected</span><button id="clearJournalSelection" class="text-button" type="button">Clear selected</button>';

  const list = document.createElement('div');
  list.id = 'journalCheckboxList';
  list.className = 'journal-checkbox-list';
  list.setAttribute('aria-label', 'Journal filters');
  block.appendChild(tools);
  block.appendChild(list);

  function allJournals() {
    try {
      return [...new Set(articles.map(displayJournal).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  function renderJournalCheckboxes() {
    const journals = allJournals();
    if (!journals.length) {
      list.innerHTML = '<div class="journal-no-match">Loading journals…</div>';
      return;
    }

    const query = String(journalInput.value || '').trim().toLowerCase();
    const chosen = new Set(selectedJournals().map(journalKey));
    const selected = journals.filter(name => chosen.has(journalKey(name)));
    const matches = journals.filter(name => !chosen.has(journalKey(name)) && (!query || name.toLowerCase().includes(query)));

    const selectionCount = document.getElementById('journalSelectionCount');
    if (selectionCount) selectionCount.textContent = selected.length ? `${selected.length} selected` : 'No journals selected';

    const checkbox = (name, checked) => `
      <label class="journal-check ${checked ? 'selected' : ''}">
        <input type="checkbox" value="${esc(name)}" ${checked ? 'checked' : ''}>
        <span>${esc(name)}</span>
      </label>`;

    let html = '';
    if (selected.length) {
      html += '<div class="journal-selected-divider">Selected</div>';
      html += selected.map(name => checkbox(name, true)).join('');
    }
    if (selected.length && matches.length) html += '<div class="journal-selected-divider">Other journals</div>';
    html += matches.map(name => checkbox(name, false)).join('');
    if (!selected.length && !matches.length) html = '<div class="journal-no-match">No journal matches that search.</div>';
    list.innerHTML = html;
  }

  journalInput.removeAttribute('list');
  journalInput.placeholder = 'Find journals…';

  journalInput.addEventListener('input', () => {
    state.filters.journalQuery = journalInput.value;
    saveState();
    renderJournalCheckboxes();
  });

  list.addEventListener('change', event => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const current = new Map(selectedJournals().map(name => [journalKey(name), name]));
    const key = journalKey(checkbox.value);
    if (checkbox.checked) current.set(key, checkbox.value);
    else current.delete(key);
    state.filters.journals = [...current.values()];
    saveState();
    renderJournalCheckboxes();
    renderFeed();
  });

  document.getElementById('clearJournalSelection')?.addEventListener('click', () => {
    state.filters.journals = [];
    saveState();
    renderJournalCheckboxes();
    renderFeed();
  });

  // Existing reset handlers run first; redraw the checkbox list immediately afterwards.
  ['clearFilters', 'emptyReset'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => setTimeout(renderJournalCheckboxes, 0));
  });

  // The main app fetches its JSON after DOMContentLoaded. Wait until those records are
  // available, then redraw both the new checkbox list and the already-rendered cards so
  // the improved abstract parser is applied to the current page immediately.
  let attempts = 0;
  const waitForData = setInterval(() => {
    attempts += 1;
    if (typeof articles !== 'undefined' && articles.length) {
      clearInterval(waitForData);
      if (!Array.isArray(state.filters.journals)) state.filters.journals = [];
      renderJournalCheckboxes();
      renderFeed();
    } else if (attempts > 100) {
      clearInterval(waitForData);
    }
  }, 100);
});

// Avoid a fresh second device overwriting an existing cloud profile merely because its
// default local state has a newer timestamp. If the local browser has no meaningful
// personal data yet, the remote profile always wins on first sign-in.
window.addEventListener('load', () => {
  function hasMeaningfulPersonalState(candidate) {
    if (!candidate) return false;
    const nonEmptyObject = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
    if (nonEmptyObject(candidate.seen) || nonEmptyObject(candidate.saved) || nonEmptyObject(candidate.notes) ||
        nonEmptyObject(candidate.journalPrefs) || nonEmptyObject(candidate.topicOverrides)) return true;
    if (Array.isArray(candidate.keywords) && candidate.keywords.length) return true;
    if (Array.isArray(candidate.customTopics) && candidate.customTopics.length) return true;

    const prefs = candidate.preferences || {};
    if ((prefs.defaultView && prefs.defaultView !== 'unseen') ||
        (prefs.defaultDateWindow && String(prefs.defaultDateWindow) !== '30') ||
        prefs.respectHiddenJournals === false) return true;

    const filters = candidate.filters || {};
    if (String(filters.search || '').trim() || String(filters.journalQuery || '').trim() ||
        (Array.isArray(filters.journals) && filters.journals.length) ||
        (filters.type && filters.type !== 'all') || (filters.year && filters.year !== 'all') ||
        filters.abstractOnly || filters.fullTextOnly ||
        (Array.isArray(filters.topics) && filters.topics.length) ||
        (filters.dateWindow && String(filters.dateWindow) !== '30')) return true;

    return candidate.sort && candidate.sort !== 'newest';
  }

  try {
    syncFromCloud = async function() {
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
        const localHasPersonalData = hasMeaningfulPersonalState(state);

        if (!localHasPersonalData || remoteTime > localTime) {
          state = remote;
          invalidateTopicCache();
          persistLocal();
          setControlsFromState();
          populateSelects();
          renderTopicFilters();
          render();
          updateCloudUi(!localHasPersonalData ? 'Loaded your cloud profile on this device.' : 'Loaded your latest state from the cloud.');
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
    };
  } catch (error) {
    console.warn('Could not harden cloud synchronization', error);
  }
});

// V4 reading-workflow enhancements: dedicated Seen/Notes views, clickable metadata,
// preferred-journal filtering, better research explanations, saved timestamps and a
// safe owner route for manually running the source refresh workflow.
window.addEventListener('load', () => {
  if (!state.filters) state.filters = {};
  if (!Array.isArray(state.filters.journals)) state.filters.journals = [];
  if (typeof state.filters.preferredOnly !== 'boolean') state.filters.preferredOnly = false;
  if (!state.noteUpdatedAt || typeof state.noteUpdatedAt !== 'object') state.noteUpdatedAt = {};

  const extraStyle = document.createElement('style');
  extraStyle.textContent = `
    .filter-link{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-decoration-color:#9ab7bf;text-underline-offset:3px}
    .filter-link:hover{color:var(--teal);text-decoration-style:solid}
    .author-expander{border:0;background:transparent;color:inherit;padding:0;cursor:pointer;text-align:left;font-size:inherit}
    .author-expander:hover{color:var(--teal)}
    .save-stack{display:flex;flex-direction:column;align-items:center;gap:2px}
    .saved-at{font-size:.61rem;line-height:1.15;color:#9a7a3d;max-width:112px;text-align:center}
    .manual-refresh{border:1px solid rgba(255,255,255,.23);background:rgba(255,255,255,.08);color:#eef8fa;border-radius:8px;padding:5px 8px;font-size:.68rem;font-weight:800;cursor:pointer;margin-left:8px;white-space:nowrap}
    .manual-refresh:hover{background:rgba(255,255,255,.15)}
    .preferred-filter-row{margin-top:5px}
    .research-modal-backdrop{position:fixed;inset:0;background:rgba(4,30,43,.55);z-index:120;display:grid;place-items:center;padding:18px}
    .research-modal{width:min(760px,96vw);max-height:min(82vh,760px);overflow:auto;background:#fff;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:23px 24px;position:relative}
    .research-modal h3{margin:2px 42px 8px 0;color:var(--navy);font-size:1.22rem;line-height:1.35}
    .research-modal-close{position:absolute;right:15px;top:13px;border:0;background:#edf4f5;color:#47616d;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:1.2rem}
    .research-modal-summary{background:#eef8f7;border-left:4px solid var(--teal);border-radius:10px;padding:11px 13px;margin:13px 0;color:#35515d;font-size:.88rem}
    .research-modal ul{margin:12px 0 0;padding-left:20px}
    .research-modal li{margin:0 0 11px;color:#3e5662;font-size:.88rem;line-height:1.5}
    .research-modal li strong{color:#294653}
    .research-matched{display:inline-flex;flex-wrap:wrap;gap:5px;margin-top:5px}
    .research-matched span{font-size:.68rem;background:#eef3f4;color:#526a75;border-radius:6px;padding:3px 6px}
    .notes-tab-count{margin-left:4px}
    @media(max-width:900px){
      .filters.open{height:100dvh;max-height:100dvh;overflow-y:auto!important;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding-bottom:calc(52px + env(safe-area-inset-bottom))!important}
      .filters.open .topic-filters{padding-bottom:14px}
      .research-modal-backdrop{align-items:end;padding:0}
      .research-modal{width:100%;max-height:88dvh;border-radius:20px 20px 0 0;padding:20px 17px calc(26px + env(safe-area-inset-bottom))}
      .saved-at{max-width:95px}
    }
  `;
  document.head.appendChild(extraStyle);

  // Add Seen and Notes tabs without disturbing the existing tab logic.
  const nav = document.querySelector('.view-nav-inner');
  if (nav && !nav.querySelector('[data-view="seen"]')) {
    const unseen = nav.querySelector('[data-view="unseen"]');
    const seen = document.createElement('button');
    seen.className = 'view-tab';
    seen.dataset.view = 'seen';
    seen.type = 'button';
    seen.textContent = 'Seen';
    unseen?.insertAdjacentElement('afterend', seen);
    seen.addEventListener('click', () => switchView('seen'));
  }
  if (nav && !nav.querySelector('[data-view="notes"]')) {
    const saved = nav.querySelector('[data-view="saved"]');
    const notes = document.createElement('button');
    notes.className = 'view-tab';
    notes.dataset.view = 'notes';
    notes.type = 'button';
    notes.innerHTML = 'Notes <span class="tab-badge notes-tab-count">0</span>';
    saved?.insertAdjacentElement('afterend', notes);
    notes.addEventListener('click', () => switchView('notes'));
  }

  // Add Preferred journals as an explicit filter.
  const toggleStack = document.querySelector('.toggle-stack');
  if (toggleStack && !document.getElementById('preferredOnly')) {
    const row = document.createElement('label');
    row.className = 'switch-row preferred-filter-row';
    row.innerHTML = '<span>Preferred journals only</span><input id="preferredOnly" type="checkbox"><i></i>';
    toggleStack.appendChild(row);
    const input = row.querySelector('input');
    input.checked = Boolean(state.filters.preferredOnly);
    input.addEventListener('change', () => {
      state.filters.preferredOnly = input.checked;
      renderLimit = 60;
      saveState();
      renderFeed();
    });
  }

  // Add saved-time sorting.
  [document.getElementById('sortSelect'), document.getElementById('sortSelectMobile')].forEach(select => {
    if (select && !select.querySelector('option[value="saved-time"]')) {
      const option = document.createElement('option');
      option.value = 'saved-time';
      option.textContent = 'Time saved (newest)';
      select.appendChild(option);
    }
  });

  // Extend the filter/view engine rather than duplicating the base implementation.
  try {
    const inheritedMatchesFilters = matchesFilters;
    matchesFilters = function(article) {
      if (!inheritedMatchesFilters(article)) return false;
      if (state.filters.preferredOnly && journalStatus(article) !== 'preferred') return false;
      if (state.view === 'seen' && !isSeen(article)) return false;
      if (state.view === 'notes' && !String(state.notes?.[article.id] || '').trim()) return false;
      return true;
    };

    const inheritedViewLabels = viewLabels;
    viewLabels = function() {
      if (state.view === 'seen') return ['Reading history', 'Seen papers'];
      if (state.view === 'notes') return ['Your annotations', 'Personal notes'];
      return inheritedViewLabels();
    };

    const inheritedSortArticles = sortArticles;
    sortArticles = function(items) {
      if (state.sort === 'saved-time') {
        return [...items].sort((a, b) => {
          const bt = Date.parse(state.saved?.[b.id] || 0) || 0;
          const at = Date.parse(state.saved?.[a.id] || 0) || 0;
          return bt - at || String(b.published || '').localeCompare(String(a.published || ''));
        });
      }
      if (state.view === 'notes' && state.sort === 'newest') {
        return [...items].sort((a, b) => {
          const bt = Date.parse(state.noteUpdatedAt?.[b.id] || 0) || 0;
          const at = Date.parse(state.noteUpdatedAt?.[a.id] || 0) || 0;
          return bt - at || String(b.published || '').localeCompare(String(a.published || ''));
        });
      }
      return inheritedSortArticles(items);
    };
  } catch (error) {
    console.warn('Could not extend reading views', error);
  }

  function resetFocusFilters() {
    state.filters.search = '';
    state.filters.dateWindow = 'all';
    state.filters.journalQuery = '';
    state.filters.journals = [];
    state.filters.preferredOnly = false;
    state.filters.type = 'all';
    state.filters.year = 'all';
    state.filters.abstractOnly = false;
    state.filters.fullTextOnly = false;
    state.filters.topics = [];
    state.view = 'latest';
    renderLimit = 60;
  }

  function syncFilterControls() {
    setControlsFromState();
    populateSelects();
    renderTopicFilters();
    const preferred = document.getElementById('preferredOnly');
    if (preferred) preferred.checked = Boolean(state.filters.preferredOnly);
    const journalInput = document.getElementById('journalFilter');
    if (journalInput) {
      journalInput.value = '';
      journalInput.dispatchEvent(new Event('input', { bubbles:true }));
    }
  }

  function focusJournal(name) {
    resetFocusFilters();
    state.filters.journals = [name];
    saveState();
    syncFilterControls();
    render();
    document.querySelector('.feed-heading')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function focusType(type) {
    resetFocusFilters();
    state.filters.type = type;
    saveState();
    syncFilterControls();
    render();
    document.querySelector('.feed-heading')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function focusPreferred() {
    resetFocusFilters();
    state.filters.preferredOnly = true;
    saveState();
    syncFilterControls();
    render();
    document.querySelector('.feed-heading')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function formatSavedAt(value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `Saved ${new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)}`;
  }

  // Research explanation modal.
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'research-modal-backdrop';
  modalBackdrop.hidden = true;
  modalBackdrop.innerHTML = '<div class="research-modal" role="dialog" aria-modal="true" aria-labelledby="researchModalTitle"><button class="research-modal-close" type="button" aria-label="Close">×</button><p class="mini-label">Link to our research</p><h3 id="researchModalTitle"></h3><div class="research-modal-summary"></div><div class="research-modal-body"></div></div>';
  document.body.appendChild(modalBackdrop);
  const closeModal = () => { modalBackdrop.hidden = true; document.body.style.overflow = ''; };
  modalBackdrop.querySelector('.research-modal-close').addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modalBackdrop.hidden) closeModal(); });

  function openResearchModal(article) {
    const links = article.research_links || [];
    const labels = links.map(link => link.label).filter(Boolean);
    const summary = article.research_teaser || (labels.length ? `This paper overlaps with ${labels.slice(0,2).join(' and ')}.` : 'Relevant to the broader Fontan evidence base.');
    const bullets = [];
    links.forEach(link => {
      const matched = (link.matched_terms || []).slice(0,6);
      bullets.push(`<li><strong>${esc(link.label || 'Research link')}</strong><br>${highlightText(link.detail || link.teaser || 'This domain overlaps with the current research programme.')} ${matched.length ? `<div class="research-matched">${matched.map(term => `<span>${esc(term)}</span>`).join('')}</div>` : ''}</li>`);
    });
    if (links.length > 1) {
      bullets.push(`<li><strong>Cross-domain value</strong><br>This paper touches more than one prespecified research axis (${esc(labels.join(', '))}), which may be useful when interpreting mechanisms rather than viewing a single endpoint in isolation.</li>`);
    }
    if (!bullets.length) {
      bullets.push('<li><strong>Broader relevance</strong><br>No direct prespecified SAFER-Fontan mechanistic axis was triggered automatically. The paper may still be useful for clinical context, surveillance, background or hypothesis generation.</li>');
    }
    modalBackdrop.querySelector('#researchModalTitle').textContent = article.title || 'Research relevance';
    modalBackdrop.querySelector('.research-modal-summary').innerHTML = highlightText(summary);
    modalBackdrop.querySelector('.research-modal-body').innerHTML = `<ul>${bullets.join('')}</ul>`;
    modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function enhanceCard(card) {
    if (card.dataset.v4Enhanced === '1') return;
    const article = articles.find(item => item.id === card.dataset.id);
    if (!article) return;
    card.dataset.v4Enhanced = '1';

    const journal = card.querySelector('.journal-name');
    if (journal) {
      journal.classList.add('filter-link');
      journal.title = `Show only ${displayJournal(article)}`;
      journal.setAttribute('role', 'button');
      journal.tabIndex = 0;
      const go = () => focusJournal(displayJournal(article));
      journal.addEventListener('click', event => { event.preventDefault(); go(); });
      journal.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } });
    }

    const typeTag = card.querySelector('.tag.type');
    if (typeTag) {
      typeTag.classList.add('filter-link');
      typeTag.title = `Show only ${article.article_type || 'this article type'}`;
      typeTag.setAttribute('role', 'button');
      typeTag.tabIndex = 0;
      const go = () => focusType(article.article_type || 'Other');
      typeTag.addEventListener('click', go);
      typeTag.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } });
    }

    const preferredTag = card.querySelector('.tag.preferred');
    if (preferredTag) {
      preferredTag.classList.add('filter-link');
      preferredTag.title = 'Show papers from all preferred journals';
      preferredTag.setAttribute('role', 'button');
      preferredTag.tabIndex = 0;
      preferredTag.addEventListener('click', focusPreferred);
      preferredTag.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusPreferred(); } });
    }

    const metaLines = card.querySelectorAll('.meta-line');
    const authorSpan = metaLines[1]?.querySelector('span:first-child');
    if (authorSpan && Array.isArray(article.authors) && article.authors.length) {
      const shortText = authorSpan.textContent;
      const fullText = article.authors.join(', ');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'author-expander';
      button.textContent = shortText;
      button.title = article.authors.length > 4 ? 'Show all authors' : 'Author list';
      if (article.authors.length > 4) {
        button.addEventListener('click', () => {
          const expanded = button.dataset.expanded === '1';
          button.dataset.expanded = expanded ? '0' : '1';
          button.textContent = expanded ? shortText : fullText;
          button.title = expanded ? 'Show all authors' : 'Collapse author list';
        });
      }
      authorSpan.replaceWith(button);
    }

    const teaser = card.querySelector('.research-teaser');
    const links = article.research_links || [];
    if (teaser && links.length) {
      const labels = links.slice(0,2).map(link => link.label).filter(Boolean);
      const lead = labels.length ? `Most relevant to ${labels.join(' and ')}. ` : '';
      teaser.innerHTML = highlightText(`${lead}${article.research_teaser || ''}`.trim());
    }

    const oldResearchButton = card.querySelector('[data-action="research"]');
    if (oldResearchButton) {
      const replacement = oldResearchButton.cloneNode(true);
      replacement.removeAttribute('data-action');
      replacement.textContent = 'Why this matters';
      replacement.addEventListener('click', () => openResearchModal(article));
      oldResearchButton.replaceWith(replacement);
    }

    const saveButton = card.querySelector('[data-action="save"]');
    if (saveButton && state.saved?.[article.id] && !saveButton.closest('.save-stack')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'save-stack';
      saveButton.parentNode.insertBefore(wrapper, saveButton);
      wrapper.appendChild(saveButton);
      const stamp = document.createElement('span');
      stamp.className = 'saved-at';
      stamp.textContent = formatSavedAt(state.saved[article.id]);
      wrapper.appendChild(stamp);
    }

    // Europe PMC-only records do not have a PubMed destination; keep the button label honest.
    if (article.source === 'Europe PMC' && !article.pmid) {
      const firstLink = card.querySelector('.link-buttons .article-link');
      if (firstLink) firstLink.textContent = 'Europe PMC ↗';
    }
  }

  function enhanceAllCards() {
    document.querySelectorAll('.paper-card').forEach(enhanceCard);
    const notesBadge = document.querySelector('[data-view="notes"] .tab-badge');
    if (notesBadge) notesBadge.textContent = Object.values(state.notes || {}).filter(value => String(value || '').trim()).length;
  }

  const feed = document.getElementById('feed');
  if (feed) {
    const observer = new MutationObserver(() => enhanceAllCards());
    observer.observe(feed, { childList:true, subtree:true });
  }

  // Track note modification time for the dedicated Notes view.
  document.addEventListener('change', event => {
    const textarea = event.target.closest?.('textarea[data-note]');
    if (!textarea) return;
    const id = textarea.dataset.note;
    if (textarea.value.trim()) state.noteUpdatedAt[id] = new Date().toISOString();
    else delete state.noteUpdatedAt[id];
    saveState();
    enhanceAllCards();
  });

  // Keep the Saved timestamp visible immediately after saving.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-action="save"]');
    if (!button) return;
    setTimeout(enhanceAllCards, 0);
  });

  // Safe manual refresh route: the public site never embeds a GitHub write token.
  const updateNote = document.querySelector('.update-note');
  if (updateNote && !document.getElementById('manualSourceRefresh')) {
    const refresh = document.createElement('button');
    refresh.id = 'manualSourceRefresh';
    refresh.className = 'manual-refresh';
    refresh.type = 'button';
    refresh.textContent = '↻ Refresh sources';
    refresh.title = 'Open the Update Fontan Digest workflow; choose Run workflow to force an immediate source refresh.';
    refresh.addEventListener('click', () => window.open('https://github.com/jefvandeneynde/Fontan-digest/actions/workflows/update-fontan-digest.yml', '_blank', 'noopener,noreferrer'));
    updateNote.appendChild(refresh);
  }

  // Make sure reset also clears the new preferred-only flag.
  ['clearFilters', 'emptyReset'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      state.filters.preferredOnly = false;
      const input = document.getElementById('preferredOnly');
      if (input) input.checked = false;
      saveState();
    });
  });

  // Apply the enhancements to the first rendered batch and again once data are loaded.
  enhanceAllCards();
  let tries = 0;
  const wait = setInterval(() => {
    tries += 1;
    if (typeof articles !== 'undefined' && articles.length) {
      clearInterval(wait);
      enhanceAllCards();
      render();
    } else if (tries > 100) clearInterval(wait);
  }, 100);
});
