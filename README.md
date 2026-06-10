# Seek Dev Notes

Internal developer documentation for [SEEK](https://github.com/seek4science/seek), built with Jekyll.

**[https://stuzart.github.io/seek-dev-notes](https://stuzart.github.io/seek-dev-notes)**

## Running locally

```bash
bundle install
bundle exec jekyll serve --livereload
```

The site is available at `http://localhost:4000`.

## Adding documentation

Create a Markdown file in `_docs/` with the following front matter:

```yaml
---
title: Your Title
description: One-sentence summary shown on the index and in search.
categories: [Category One, Category Two]
---
```

The page will appear automatically in the sidebar and index, grouped by category. No other configuration is needed.

Diagrams can be written as fenced `mermaid` code blocks and are rendered client-side.

## Deployment

Pushes to `master` trigger a GitHub Actions workflow that builds and deploys to GitHub Pages.
