// Fontan Digest V5 interaction refinements.
// Loaded after app.js so it can progressively enhance the existing static app.
window.addEventListener('load', () => {
  if (!state.filters) state.filters = {};
  if (!Array.isArray(state.filters.topics)) state.filters.topics = [];
  const hadSortDirection = ['asc','desc'].includes(state.sortDirection);

  const style = document.createElement('style');
  style.textContent = `
    #markVisibleSeen{display:none!important}
    .sort-control{display:flex;align-items:center;gap:6px}
    .sort-direction{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:white;color:#47606b;cursor:pointer;font-weight:900;font-size:1rem;line-height:1}
    .sort-direction:hover{border-color:#a9cdd1;color:var(--teal)}
    .action-stack{display:flex;flex-direction:column;align-items:center;gap:2px}
    .seen-at,.saved-at{font-size:.61rem;line-height:1.15;text-align:center;max-width:112px}
    .seen-at{color:#5f8176}.saved-at{color:#9a7a3d}
    .research-expanded{margin-top:10px;padding-top:10px;border-top:1px solid #d6ebe7}
    .research-expanded[hidden]{display:none!important}
    .research-bullets{margin:0;padding-left:1.15rem;display:grid;gap:10px;color:#35515d;font-size:.84rem}
    .research-bullets li{padding-left:.1rem}
    .research-bullets strong{display:block;color:#274b58;margin-bottom:2px}
    .radar-chip-button{appearance:none;font:inherit;cursor:pointer;text-align:left}
    .radar-chip-button:hover{border-color:#8fc6c4;color:#1e666c}
    .radar-chip-button.active{background:#dff3f2;border-color:#8fc6c4;color:#185b61;box-shadow:inset 0 0 0 1px rgba(8,126,139,.08)}
    .radar-chip-button.active:after{content:' ✓';font-weight:900;color:var(--teal)}
    @media(max-width:900px){
      .mobile-filter-row{align-items:center}
      .mobile-filter-row .sort-control{margin-left:auto;min-width:0}
      .mobile-filter-row .sort-control select{min-width:0;width:min(46vw,190px)}
      .desktop-sort .sort-control select{min-width:160px}
    }
  `;
  document.head.appendChild(style);

  // The old batch action is intentionally no longer part of the workflow.
  const markVisible = document.getElementById('markVisibleSeen');
  if (markVisible) markVisible.setAttribute('aria-hidden', 'true');

  function migrateSort() {
    const old = state.sort || 'newest';
    const mapping = {
      newest: ['published','desc'],
      oldest: ['published','asc'],
      'saved-time': ['saved','desc'],
      journal: ['journal','asc'],
      relevance: ['relevance','desc']
    };
    if (mapping[old]) {
      state.sort = mapping[old][0];
      if (!hadSortDirection) state.sortDirection = mapping[old][1];
    }
    if (!['published','seen','saved','journal','relevance'].includes(state.sort)) state.sort = 'published';
    if (!['asc','desc'].includes(state.sortDirection)) state.sortDirection = state.sort === 'journal' ? 'asc' : 'desc';
  }
  migrateSort();

  function sortOptionsHtml() {
    return [
      ['published','Date published'],
      ['seen','Date seen'],
      ['saved','Date saved'],
      ['journal','Journal'],
      ['relevance','Relevance']
    ].map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
  }

  function directionGlyph() {
    return state.sortDirection === 'asc' ? '↑' : '↓';
  }

  function directionTitle() {
    return state.sortDirection === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending';
  }

  function upgradeSortSelect(select) {
    if (!select) return;
    select.innerHTML = sortOptionsHtml();
    select.value = state.sort;
    let wrapper = select.closest('.sort-control');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'sort-control';
      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);
    }
    let direction = wrapper.querySelector('.sort-direction');
    if (!direction) {
      direction = document.createElement('button');
      direction.type = 'button';
      direction.className = 'sort-direction';
      wrapper.appendChild(direction);
      direction.addEventListener('click', () => {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        saveState();
        syncSortUi();
        renderFeed();
      });
    }
    direction.textContent = directionGlyph();
    direction.title = directionTitle();
    direction.setAttribute('aria-label', directionTitle());

    select.addEventListener('change', () => {
      state.sort = select.value;
      state.sortDirection = state.sort === 'journal' ? 'asc' : 'desc';
      saveState();
      syncSortUi();
      renderFeed();
    });
  }

  function syncSortUi() {
    [document.getElementById('sortSelect'), document.getElementById('sortSelectMobile')].forEach(select => {
      if (!select) return;
      select.value = state.sort;
      const direction = select.closest('.sort-control')?.querySelector('.sort-direction');
      if (direction) {
        direction.textContent = directionGlyph();
        direction.title = directionTitle();
        direction.setAttribute('aria-label', directionTitle());
      }
    });
  }

  upgradeSortSelect(document.getElementById('sortSelect'));
  upgradeSortSelect(document.getElementById('sortSelectMobile'));

  // One consistent sorter: five fields, with a single direction toggle.
  try {
    sortArticles = function(items) {
      const direction = state.sortDirection === 'asc' ? 1 : -1;
      const field = state.sort || 'published';
      const result = [...items];

      const timestampCompare = (aValue, bValue) => {
        const aMissing = !aValue;
        const bMissing = !bValue;
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        const aTime = Date.parse(aValue) || 0;
        const bTime = Date.parse(bValue) || 0;
        return (aTime - bTime) * direction;
      };

      result.sort((a,b) => {
        let primary = 0;
        if (field === 'seen') primary = timestampCompare(state.seen?.[a.id], state.seen?.[b.id]);
        else if (field === 'saved') primary = timestampCompare(state.saved?.[a.id], state.saved?.[b.id]);
        else if (field === 'journal') primary = displayJournal(a).localeCompare(displayJournal(b)) * direction;
        else if (field === 'relevance') primary = (personalRelevance(a) - personalRelevance(b)) * direction;
        else primary = String(a.published || '').localeCompare(String(b.published || '')) * direction;
        if (primary) return primary;
        return String(b.published || '').localeCompare(String(a.published || ''));
      });
      return result;
    };
  } catch (error) {
    console.warn('Could not replace sorter', error);
  }

  function formatActionTime(prefix, value) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return `${prefix} ${new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)}`;
  }

  function researchBullets(article) {
    const links = article.research_links || [];
    const bullets = links.map(link => `
      <li><strong>${esc(link.label || 'Research link')}</strong>${highlightText(link.detail || link.teaser || 'This domain overlaps with the current research programme.')}</li>`);
    if (links.length > 1) {
      const labels = links.map(link => link.label).filter(Boolean);
      bullets.push(`<li><strong>Cross-domain value</strong>This paper touches more than one prespecified research axis (${esc(labels.join(', '))}), which may be useful when interpreting mechanisms rather than viewing a single endpoint in isolation.</li>`);
    }
    if (!bullets.length) {
      bullets.push('<li><strong>Broader relevance</strong>No direct prespecified SAFER-Fontan research axis was triggered automatically. The paper may still be useful for clinical context, surveillance, background or hypothesis generation.</li>');
    }
    return `<ul class="research-bullets">${bullets.join('')}</ul>`;
  }

  function refineResearchLink(card, article) {
    const box = card.querySelector('.research-link');
    if (!box) return;
    const head = box.querySelector('.research-link-head');
    if (head) head.innerHTML = '↗ Link to our research';

    const teaser = box.querySelector('.research-teaser');
    if (teaser) teaser.innerHTML = highlightText(article.research_teaser || 'Relevant to the broader Fontan evidence base.');

    box.querySelector('.research-detail')?.remove();
    box.querySelector('.research-expanded')?.remove();

    const expanded = document.createElement('div');
    expanded.className = 'research-expanded';
    expanded.hidden = true;
    expanded.innerHTML = researchBullets(article);

    let button = [...box.querySelectorAll('button.toggle-detail')].find(btn => /why this matters|show brief link|collapse relevance/i.test(btn.textContent || ''));
    if (!button) {
      button = document.createElement('button');
      button.className = 'toggle-detail';
      button.type = 'button';
      box.appendChild(button);
    } else {
      const clean = button.cloneNode(false);
      button.replaceWith(clean);
      button = clean;
      button.className = 'toggle-detail';
      button.type = 'button';
    }
    button.textContent = 'Why this matters';
    box.insertBefore(expanded, button);
    button.addEventListener('click', () => {
      const opening = expanded.hidden;
      expanded.hidden = !opening;
      button.textContent = opening ? 'Collapse relevance' : 'Why this matters';
    });
  }

  function addActionTimestamp(card, article) {
    const seenButton = card.querySelector('[data-action="seen"]');
    if (seenButton && state.seen?.[article.id]) {
      let stack = seenButton.closest('.seen-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'action-stack seen-stack';
        seenButton.parentNode.insertBefore(stack, seenButton);
        stack.appendChild(seenButton);
      }
      let stamp = stack.querySelector('.seen-at');
      if (!stamp) {
        stamp = document.createElement('span');
        stamp.className = 'seen-at';
        stack.appendChild(stamp);
      }
      stamp.textContent = formatActionTime('Seen', state.seen[article.id]);
    }

    const saveButton = card.querySelector('[data-action="save"]');
    if (saveButton && state.saved?.[article.id]) {
      const existing = saveButton.closest('.save-stack,.action-stack');
      let stack = existing;
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'action-stack save-stack';
        saveButton.parentNode.insertBefore(stack, saveButton);
        stack.appendChild(saveButton);
      } else {
        stack.classList.add('action-stack','save-stack');
      }
      let stamp = stack.querySelector('.saved-at');
      if (!stamp) {
        stamp = document.createElement('span');
        stamp.className = 'saved-at';
        stack.appendChild(stamp);
      }
      stamp.textContent = formatActionTime('Saved', state.saved[article.id]);
    }
  }

  function refineCard(card) {
    if (card.dataset.v5Enhanced === '1') return;
    const article = articles.find(item => item.id === card.dataset.id);
    if (!article) return;
    addActionTimestamp(card, article);
    refineResearchLink(card, article);
    card.dataset.v5Enhanced = '1';
  }

  function refineAllCards() {
    document.querySelectorAll('.paper-card').forEach(refineCard);
  }

  const feed = document.getElementById('feed');
  if (feed) {
    const observer = new MutationObserver(() => refineAllCards());
    observer.observe(feed, {childList:true,subtree:true});
  }

  // Make the Research Radar thematic chips real topic filters.
  try {
    renderRadar = function() {
      const week = articles.filter(a => daysAgo(a.published) <= 7);
      const counts = new Map();
      const topicMap = new Map(effectiveTopics().filter(t => t.enabled).map(t => [t.id, t]));
      week.forEach(article => {
        const info = articleTopicInfo(article);
        info.ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
      });
      const themes = [...counts.entries()]
        .map(([id,count]) => ({id,count,topic:topicMap.get(id)}))
        .filter(item => item.topic)
        .sort((a,b) => b.count - a.count)
        .slice(0,5);
      const direct = week.filter(a => a.high_priority || personalRelevance(a) >= 55).length;
      const top = [...week].sort((a,b) => personalRelevance(b) - personalRelevance(a))[0];

      if (!week.length) {
        els.radarTitle.textContent = 'No newly indexed papers in the last 7 days';
        els.radarText.textContent = 'The archive is still available below. New online-first or indexed work may appear with the next source refresh.';
        els.radarThemes.innerHTML = '<span class="radar-chip">Archive remains searchable</span>';
        return;
      }

      els.radarTitle.textContent = `${week.length} new paper${week.length === 1 ? '' : 's'} this week`;
      els.radarText.textContent = direct
        ? `${direct} ${direct === 1 ? 'paper maps' : 'papers map'} strongly to current SAFER-Fontan research axes and your preferences.${top ? ` Highest current relevance: “${top.title}”.` : ''}`
        : 'New Fontan literature is available, although none crossed the current high-relevance threshold.';
      const selected = new Set(state.filters.topics || []);
      els.radarThemes.innerHTML = themes.length
        ? themes.map(({id,count,topic}) => `<button type="button" class="radar-chip radar-chip-button ${selected.has(id) ? 'active' : ''}" data-radar-topic="${esc(id)}"><strong>${count}</strong>${esc(topic.label)}</button>`).join('')
        : '<span class="radar-chip">General Fontan literature</span>';

      els.radarThemes.querySelectorAll('[data-radar-topic]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.radarTopic;
        const current = new Set(state.filters.topics || []);
        if (current.has(id)) current.delete(id); else current.add(id);
        state.filters.topics = [...current];
        renderLimit = 60;
        saveState();
        renderTopicFilters();
        renderRadar();
        renderFeed();
      }));
    };
  } catch (error) {
    console.warn('Could not make research radar interactive', error);
  }

  // Keep new fields part of cross-device state and keep UI aligned after cloud pulls.
  const originalSetControls = setControlsFromState;
  setControlsFromState = function() {
    originalSetControls();
    migrateSort();
    syncSortUi();
  };

  // Re-render once the main app has loaded its data, then enhance every subsequent batch.
  refineAllCards();
  renderRadar();
  syncSortUi();
  let attempts = 0;
  const wait = setInterval(() => {
    attempts += 1;
    if (typeof articles !== 'undefined' && articles.length) {
      clearInterval(wait);
      migrateSort();
      syncSortUi();
      render();
      refineAllCards();
    } else if (attempts > 100) clearInterval(wait);
  }, 100);
});
