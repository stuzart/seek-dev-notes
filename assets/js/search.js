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
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), m => `<mark>${m}</mark>`);
  }

  function search(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return docs
      .filter(doc =>
        (doc.title && doc.title.toLowerCase().includes(q)) ||
        (doc.description && doc.description.toLowerCase().includes(q)) ||
        (doc.content && doc.content.toLowerCase().includes(q)) ||
        (doc.category && doc.category.toLowerCase().includes(q))
      )
      .slice(0, 8)
      .map(doc => {
        let snippet = '';
        if (doc.content) {
          const idx = doc.content.toLowerCase().indexOf(q);
          if (idx !== -1) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(doc.content.length, idx + 120);
            snippet = (start > 0 ? '…' : '') + doc.content.slice(start, end) + (end < doc.content.length ? '…' : '');
          }
        }
        return { ...doc, snippet };
      });
  }

  function render(results, query) {
    if (!results.length) {
      resultsBox.innerHTML = '<div class="no-results">No results found.</div>';
    } else {
      resultsBox.innerHTML = results.map(r => `
        <a href="${r.url}" class="search-result-item">
          <div class="result-title">${highlight(r.title, query)}</div>
          ${r.category ? `<div class="result-category">${r.category}</div>` : ''}
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
