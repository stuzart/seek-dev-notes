# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Serve locally with live reload
bundle exec jekyll serve --livereload

# Production build
bundle exec jekyll build

# Install dependencies
bundle install
```

The site runs at `http://localhost:4000` by default.

## Architecture

This is a Jekyll 4.3 static documentation site for developer notes about [SEEK](https://github.com/seek4science/seek) (`/home/sowen/development/ruby/seek`). It is distinct from the end-user documentation at `/home/sowen/development/www/seek-documentation`.

**Collections:** All documentation lives in `_docs/` as Markdown files. Jekyll outputs each to `/docs/:name/`. No subdirectories — flat structure, categorised via front matter.

**Front matter required on every doc:**
```yaml
---
title: Human-readable title
description: One-sentence summary (used on index cards and search)
categories: [Category One, Category Two]
---
```

**Layouts:**
- `_layouts/default.html` — outer shell: fixed header with search input, fixed left sidebar (240 px) with category-grouped nav, loads `search.js`, `toc.js`, and Mermaid via CDN ESM
- `_layouts/doc.html` — wraps content in `.doc-wrap` flex div with `<article class="doc">` and a sticky right `<aside id="toc-wrap">` for the table of contents

**Category nav in sidebar:** `_layouts/default.html` uses nested Liquid loops to collect unique categories (since `group_by` doesn't work on arrays), then iterates them to render grouped nav links. Adding a new category value in front matter is sufficient — no other configuration needed.

**Index page (`index.html`):** Renders doc cards grouped by category using the same nested-loop pattern.

**Search (`search.json` + `assets/js/search.js`):** `search.json` is a Liquid template that outputs a JSON array. `search.js` fetches it on first keystroke, filters in memory, and renders a dropdown. Categories are matched with `doc.categories.some(c => c.toLowerCase().includes(q))`.

**Table of contents (`assets/js/toc.js`):** Reads `h2`/`h3` from `.doc-body` after render, auto-generates IDs for headings that don't have them, builds the TOC list, and uses `IntersectionObserver` for active-link tracking. The TOC is hidden if fewer than 2 headings are present.

**Diagrams:** Mermaid is loaded via ESM CDN. Jekyll outputs fenced `mermaid` blocks as `<pre><code class="language-mermaid">` — `toc.js`/`default.html` JS replaces these with `<div class="mermaid">` before calling `mermaid.run()`.

**Responsive:** The TOC sidebar hides at `max-width: 1100px`. Main content max-width is 1100 px.
