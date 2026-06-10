(function () {
  const input = document.getElementById('search-input');
  const resultsBox = document.getElementById('search-results');

  if (!input || !resultsBox) return;

  let docs = [];

  fetch(SEARCH_DATA_URL)
    .then(r => r.json())
    .then(data => { docs = data; })
    .catch(() => {});

  function highlight(text, query) {
    if (!query || !text) return text || '';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), m => `<mark>${m}</mark>`);
  }

  function snippet(text, query, context) {
    if (!text) return '';
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, context) + (text.length > context ? '…' : '');
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + 120);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  function bestSection(doc, q) {
    if (!doc.sections || !doc.sections.length) return null;
    let best = null, bestScore = 0;
    for (const s of doc.sections) {
      const headingHit = s.heading && s.heading.toLowerCase().includes(q) ? 2 : 0;
      const bodyHit = s.body && s.body.toLowerCase().includes(q) ? 1 : 0;
      const score = headingHit + bodyHit;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function search(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();

    return docs
      .filter(doc =>
        (doc.title && doc.title.toLowerCase().includes(q)) ||
        (doc.description && doc.description.toLowerCase().includes(q)) ||
        (doc.content && doc.content.toLowerCase().includes(q)) ||
        (doc.categories && doc.categories.some(c => c.toLowerCase().includes(q)))
      )
      .slice(0, 8)
      .map(doc => {
        const titleHit = doc.title && doc.title.toLowerCase().includes(q);
        const descHit = doc.description && doc.description.toLowerCase().includes(q);
        const section = bestSection(doc, q);

        // Use section anchor unless the title/description itself matched
        const useSection = section && !titleHit && !descHit;
        const anchor = useSection ? '#' + section.id : '';
        const url = doc.url + '?highlight=' + encodeURIComponent(query) + anchor;
        const sectionLabel = useSection ? section.heading : null;

        let snip = '';
        if (useSection) {
          snip = snippet(section.body, q, 120);
        } else if (descHit) {
          snip = snippet(doc.description, q, 120);
        } else if (doc.content) {
          snip = snippet(doc.content, q, 120);
        }

        return { title: doc.title, url, categories: doc.categories, section: sectionLabel, snippet: snip };
      });
  }

  function render(results, query) {
    if (!results.length) {
      resultsBox.innerHTML = '<div class="no-results">No results found.</div>';
    } else {
      resultsBox.innerHTML = results.map(r => `
        <a href="${r.url}" class="search-result-item">
          <div class="result-title">
            ${highlight(r.title, query)}${r.section ? ` <span class="result-section">› ${highlight(r.section, query)}</span>` : ''}
          </div>
          ${r.categories && r.categories.length ? `<div class="result-category">${r.categories.join(', ')}</div>` : ''}
          ${r.snippet ? `<div class="result-snippet">${highlight(r.snippet, query)}</div>` : ''}
        </a>
      `).join('');
    }
    resultsBox.hidden = false;
  }

  input.addEventListener('input', function () {
    const q = this.value.trim();
    if (!q || q.length < 2) {
      resultsBox.hidden = true;
      resultsBox.innerHTML = '';
      return;
    }
    render(search(q), q);
  });

  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) {
      resultsBox.hidden = true;
    }
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      resultsBox.hidden = true;
      input.blur();
    }
  });
})();
