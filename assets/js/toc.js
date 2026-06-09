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
