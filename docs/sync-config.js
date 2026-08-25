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
