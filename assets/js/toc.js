(function () {
  const docBody = document.querySelector('.doc-body');
  const tocNav = document.getElementById('toc-nav');
  if (!docBody || !tocNav) return;

  const headings = Array.from(docBody.querySelectorAll('h2, h3'));
  if (headings.length < 2) {
    const wrap = document.getElementById('toc-wrap');
    if (wrap) wrap.hidden = true;
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'toc-list';

  headings.forEach(h => {
    if (!h.id) {
      h.id = h.textContent.trim().toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
    }
    const li = document.createElement('li');
    li.className = 'toc-item toc-' + h.tagName.toLowerCase();
    const a = document.createElement('a');
    a.className = 'toc-link';
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    ul.appendChild(li);
  });

  tocNav.appendChild(ul);

  const links = tocNav.querySelectorAll('.toc-link');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const link = tocNav.querySelector(`a[href="#${entry.target.id}"]`);
      if (link) link.classList.toggle('active', entry.isIntersecting);
    });
  }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

  headings.forEach(h => observer.observe(h));

  links.forEach(link => {
    link.addEventListener('click', e => {
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
})();

(function () {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('highlight');
  const sectionId = params.get('section');
  if (!q) return;

  const content = document.querySelector('.doc-body');
  if (!content) return;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement && node.parentElement.tagName.toLowerCase();
      return (tag === 'script' || tag === 'style')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  });

  const hits = [];
  let node;
  while ((node = walker.nextNode())) {
    if (re.test(node.textContent)) hits.push(node);
    re.lastIndex = 0;
  }

  hits.forEach(node => {
    const parts = node.textContent.split(re);
    if (parts.length <= 1) return;
    const frag = document.createDocumentFragment();
    parts.forEach(part => {
      if (re.test(part)) {
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = part;
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
      re.lastIndex = 0;
    });
    node.parentNode.replaceChild(frag, node);
  });

  // Use rAF so scroll runs after layout, with no competing native anchor scroll
  requestAnimationFrame(() => {
    const first = content.querySelector('mark.search-highlight');
    const target = first || (sectionId && document.getElementById(sectionId));
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // Clean params from the URL without a page reload
  history.replaceState(null, '', window.location.pathname);
})();
