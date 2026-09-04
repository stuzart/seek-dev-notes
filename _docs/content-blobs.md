---
title: Content Blobs and File Storage
description: How SEEK stores, retrieves, and processes uploaded and remotely-referenced files via the ContentBlob model.
categories: [Assets & Content, Architecture, Reference]
---

`ContentBlob` is the central model for file data in SEEK. Every uploaded file, remote URL reference, or in-memory data attachment is represented by a `ContentBlob` record. It handles storage on disk, checksums, MIME type detection, remote fetching, format conversion, and streaming downloads.

## Database Schema

Key columns on the `content_blobs` table:

| Column | Type | Purpose |
|---|---|---|
| `uuid` | string | Unique identifier — also the filename on disk |
| `original_filename` | string | The filename as uploaded by the user |
| `content_type` | string | MIME type, detected on save |
| `url` | text | Remote URL (present instead of, or alongside, a local file) |
| `file_size` | bigint | Size in bytes |
| `md5sum` | string | MD5 checksum, computed on save |
| `sha1sum` | string | SHA1 checksum, computed on save |
| `asset_id` | integer | Polymorphic FK to the owning asset |
| `asset_type` | string | Asset class name (e.g. `"DataFile"`) |
| `asset_version` | integer | Which version of the asset this blob belongs to |
| `is_webpage` | boolean | True if the URL points to a web page rather than a file |
| `external_link` | boolean | Shown as a link out rather than a download |
| `make_local_copy` | boolean | Force a local cache even if the file exceeds the default size limit |
| `deleted` | boolean | Soft-delete flag |

A blob requires either `original_filename` (local file) or `url` (remote), but not both.

## File Storage on Disk

All storage lives under a single configurable root: `Seek::Config.filestore_path`. It defaults to `tmp/filestore` relative to `Rails.root` for development but should be set to an absolute path on a persistent volume in production — the setting accepts any absolute path, including network mounts.

The full directory tree beneath it:

```
{filestore_path}/
├── assets/                   ← uploaded file content
│   └── {uuid}.dat
├── converted-assets/         ← PDF and text conversions
│   ├── {uuid}.pdf
│   └── {uuid}.txt
├── rdf/                      ← generated RDF/Turtle files (see RDF docs)
├── git/                      ← bare git repositories for versioned workflows
├── avatars/                  ← user and project avatar images
├── model_images/             ← model diagram images
├── rebranding/               ← custom logos and branding assets
└── tmp/
    ├── image_assets/
    │   └── {size}/           ← resized image cache
    │       └── {id}.png
    └── git/                  ← temporary git working directories
```

Files are always named `{uuid}.dat`. Converted variants use the same UUID with a different extension (`{uuid}.pdf`, `{uuid}.txt`). The UUID is generated when the `ContentBlob` record is first created.

```ruby
blob.filepath         # => "{filestore_path}/assets/{uuid}.dat"
blob.filepath('pdf')  # => "{filestore_path}/converted-assets/{uuid}.pdf"
```

## Providing Data

There are three ways to attach data to a `ContentBlob` before saving:

### 1. File upload (`tmp_io_object`)

The most common path. The controller assigns an uploaded file (an `ActionDispatch::Http::UploadedFile` or any IO object) to `blob.tmp_io_object`. On `before_save`, it is streamed to disk in 1 MB chunks:

```ruby
blob.tmp_io_object = params[:file]
blob.save  # streams to {filestore_path}/assets/{uuid}.dat
```

### 2. In-memory data (`data=`)

For programmatically-constructed content (e.g. generated RO-Crate metadata):

```ruby
blob.data = "some string or binary"
blob.save  # written directly to disk
```

### 3. Remote URL

Assign a URL instead of file data. The blob stores only the URL; actual content is fetched on demand or cached in the background:

```ruby
blob.url = "https://example.com/dataset.csv"
blob.original_filename = "dataset.csv"
blob.save
```

## Remote Content

### Fetching and caching

When a blob has a URL, SEEK can cache the file locally. After creation, `RemoteContentFetchingJob` fires if:

- `Seek::Config.cache_remote_files` is true
- The file does not exceed `Seek::Config.max_cachable_size`
- Or `blob.make_local_copy` is true (bypasses size limit)

The job calls `blob.retrieve`, which runs the appropriate handler and stores the result as a local file.

To force an immediate fetch (e.g. in tests):

```ruby
blob.retrieve
```

### Remote content handlers

`ContentBlob.remote_content_handler_for(url)` returns the right handler for a URL:

| URL pattern | Handler |
|---|---|
| `ftp://` | `FTPHandler` — uses `Net::FTP` |
| `http(s)://` | `HTTPHandler` — uses `RestClient` for metadata, `HTTPStreamer` for content |
| GitHub URLs | `GithubHTTPHandler` — rewrites to `raw.githubusercontent.com` |
| Galaxy workflow URLs | `GalaxyHTTPHandler` — detects Galaxy instance workflow URLs |

All handlers expose an `info` method returning `{ code:, file_size:, content_type:, file_name: }` and a `fetch` method returning a `Tempfile`.

### Streaming without caching

If a remote file has not been cached, downloads are proxied through SEEK using chunked streaming:

```ruby
# Controller streams directly to the client
self.response_body = Enumerator.new do |yielder|
  streamer.stream { |chunk| yielder << chunk }
end
```

Files larger than `Seek::Config.hard_max_cachable_size` are always streamed this way and never cached.

## MIME Type Detection

`content_type` is set automatically on `before_create` via the `ContentTypeDetection` module. It checks the URL's `Content-Type` header (remote) or the file's magic bytes (local) using the `mimemagic` gem.

The module also provides boolean helpers used throughout the codebase:

```ruby
blob.is_text?          # plain text, CSV, TSV, XML, JSON, Python, Markdown…
blob.is_excel?         # xls, xlsx, xlsm
blob.is_pdf?
blob.is_image?
blob.is_image_viewable?    # PNG, JPG, GIF, BMP, SVG
blob.is_pdf_viewable?      # formats that can be converted to PDF for in-browser view
blob.is_zip?
blob.is_jupyter_notebook?  # .ipynb
blob.is_markdown?
blob.is_sbml?          # checks file content for <sbml tag
blob.is_copasi?        # checks for <copasi tag
```

## Checksums

MD5 and SHA1 checksums are computed automatically in a `before_save` callback and stored in `md5sum` / `sha1sum`. If a blob is saved without file content (e.g. URL-only), checksums are computed lazily the first time they are read:

```ruby
blob.md5sum   # triggers calculate_checksums + save if nil
blob.sha1sum
```

The MD5 sum is included as a `Content-MD5` response header on file downloads.

## Asset Linking

Assets attach to content blobs polymorphically. All asset types except `Model` use a single-blob association scoped to the current version:

```ruby
has_one :content_blob,
  ->(r) { where('content_blobs.asset_version = ? AND deleted = ?', r.version, false) },
  as: :asset, foreign_key: :asset_id
```

`Model` is the only asset type that uses `has_many :content_blobs`, because a single model version can include multiple files (e.g. a model file plus parameter files).

Each version of an asset has its own blob (or blobs). When a new version is created, new blobs are created for it. Old blobs are soft-deleted (`deleted = true`) when the asset is destroyed — they are never hard-deleted, preserving storage history.

## Format Conversion

SEEK converts files to PDF for browser preview and extracts text for full-text search. These require `libreconv` (wrapping LibreOffice) and `docsplit` to be installed on the server.

### PDF conversion

Converts Word, PowerPoint, and other Office formats to PDF:

```ruby
blob.convert_to_pdf   # writes {uuid}.pdf to converted-assets/
```

The resulting PDF is cached — conversion only happens once. `Seek::Config.pdf_conversion_enabled` must be true.

### Text extraction

Extracts plain text from PDFs for Solr indexing:

```ruby
blob.extract_text_from_pdf  # reads/writes {uuid}.txt
blob.pdf_contents_for_search  # returns array of text chunks
blob.text_contents_for_search # for plain text files
```

Text is split into chunks and filtered before being sent to Solr. See [Solr Search Indexing](../solr-search-indexing/) for how these are indexed.

### Spreadsheet conversion

Excel files can be converted to CSV or the internal spreadsheet XML format used by the SEEK data viewer:

```ruby
blob.to_csv(sheet: 1)         # CSV string for one sheet
blob.to_spreadsheet_xml       # XML representation of all sheets
```

This uses a JVM-based tool; `Seek::Config.jvm_memory_allocation` controls the heap size.

## File Downloads

`ContentBlobsController` handles all download and preview requests.

### Local files

Served via Rails `send_file`, which hands off to the web server:

```ruby
send_file blob.filepath,
  filename: blob.original_filename,
  type: blob.content_type,
  disposition: 'attachment'
```

For production deployments, enabling `X-Sendfile` (Apache) or `X-Accel-Redirect` (Nginx) in `config/environments/production.rb` delegates the actual byte transfer to the web server, freeing the Rails process immediately.

### Remote files not yet cached

Streamed through SEEK as a chunked response. The client receives the file transparently without needing to know the origin URL.

### Image resizing

Images can be served at a specific pixel width. Resized versions are cached under `{filestore_path}/tmp/image_assets/{size}/{id}.png`:

```ruby
blob.resize_image(900)             # resizes and caches
blob.full_cache_path(900)          # path to cached resized image
```

## Content Renderers

The `RendererFactory` selects the right renderer for in-browser preview:

| Renderer | Triggers on |
|---|---|
| `SlideshareRenderer` | Slideshare URLs |
| `YoutubeRenderer` | YouTube URLs |
| `MarkdownRenderer` | `.md` files |
| `NotebookRenderer` | `.ipynb` Jupyter notebooks |
| `PdfRenderer` | PDFs and PDF-convertable formats |
| `ImageRenderer` | Viewable image formats |
| `TextRenderer` | Plain text, CSV, XML, JSON… |
| `BlankRenderer` | Everything else |

```ruby
renderer = Seek::Renderers::RendererFactory.instance.renderer(blob)
renderer.render  # returns HTML fragment for embedding in the page
```

The factory picks the **first** renderer whose `can_render?` returns true, so the list is ordered most-specific first with `BlankRenderer` as the catch-all. The chosen class is memoized in a small in-process `MemoryStore` keyed on `blob.cache_key`.

### Inline previews on show pages

`AssetsHelper#rendered_asset_view(asset)` embeds the rendered preview in the asset's show page. SOPs, Documents, Data Files and File Templates all use it.

```ruby
def rendered_asset_view(asset)
  return '' unless asset.content_blob && asset.can_download?

  our_renderer = Seek::Renderers::RendererFactory.instance.renderer(asset.content_blob)
  if our_renderer.external_embed? && !cookie_consent.allow_embedding?
    content = "This embedded content is blocked due to your cookie settings"
  elsif !our_renderer.external_embed? && !asset.content_blob.file_exists?
    content = ''            # renderer needs the local file, but it is missing from the filestore
  else
    cache_key = "#{asset.cache_key}/#{asset.content_blob.cache_key}/v#{Seek::Renderers::BlobRenderer::CACHE_VERSION}"
    content = Rails.cache.fetch(cache_key, expires_in: 30.days) { our_renderer.render }
  end
  content.blank? ? '' : content_tag(:div, class: 'renderer') { content.html_safe }
end
```

Four guards, each for a distinct failure the preview must survive:

- **No blob, or no download permission** — nothing to show.
- **External embed blocked by cookie consent** — an explanatory message rather than a silent blank.
- **Local file missing from the filestore** — returns `''` rather than letting the renderer raise. A blob record can outlive its file.
- **`CACHE_VERSION`** is part of the cache key, so bumping it invalidates every stored fragment when renderer output changes.

Rendered output is cached for **30 days**. Some of these fragments (notebook HTML in particular) are large enough to overflow to the filesystem side of `Rails.cache` — see [Caching and Redis](../caching-and-redis/).

Inline `<pre>` previews are capped at `max-height: 40em` with `overflow: auto` (`div.renderer > pre`) so a large text or CSV file cannot stretch the page indefinitely.

### `TextRenderer` and large or invalid content

`TextRenderer` reads at most `MAX_RENDERABLE_SIZE` (**1 MB**) and appends a truncation notice (`renderers.truncated_content` in `en.yml`) when there is more:

```ruby
def text_content
  blob.rewind
  content = blob.read(MAX_RENDERABLE_SIZE + 1).to_s.dup.force_encoding(Encoding::UTF_8)
  truncated = content.bytesize > MAX_RENDERABLE_SIZE
  content = content.encode('UTF-8', invalid: :replace, undef: :replace)
  if content.bytesize > MAX_RENDERABLE_SIZE
    # replacing invalid bytes can grow the content, and the limit may fall within a character
    content = content.byteslice(0, MAX_RENDERABLE_SIZE).scrub('')
    truncated = true
  end
  [content, truncated]
end
```

Bytes that are not valid UTF-8 are replaced rather than raising — they would otherwise break string handling and the encoding of the response. Note the second size check: replacing invalid bytes can *grow* the content past the limit, and a byte-slice can land mid-character, hence the `scrub('')`. The same truncation applies to `render_standalone`, as a trailing plain-text note.

`SlideshareRenderer` returns an empty string rather than raising when the Slideshare API response cannot be parsed, so a third-party outage degrades to no preview rather than a 500.

The git blob view (`app/views/git/_blob.html.erb`) adds one more case: when a blob is `remote?` but not yet `fetched?` it shows "This file is held externally" instead of attempting to render content that is not there.

### Markdown and relative image links

`Seek::Markdown` (`lib/seek/markdown.rb`) renders markdown through an `HTMLPipeline` with two node filters:

- **`LinkNofollowFilter`** — adds `rel="nofollow"` to every `<a>`, preserving any existing `rel` values.
- **`RelativeLinkFilter`** — rewrites relative `<img src>` values against a `relative_root` passed in the pipeline context.

The second filter exists so that a README rendered as a git-versioned asset's description can show images committed alongside it. `app/views/workflows/show.html.erb` supplies the root as the workflow version's `git_raw` path, threaded through `render_markdown(markdown, relative_root:)` and `_item_description.html.erb`:

```ruby
def handle_element(img)
  return if img['src'].nil? || context[:relative_root].nil?

  src = img['src'].strip
  src_uri = Addressable::URI.parse(src)
  return if src_uri.absolute?

  src = src[1..] if src.start_with?('/')
  new_src = Addressable::URI.join(context[:relative_root], src).to_s

  # This stops anyone from attempting to show something from another record
  return unless new_src.include? context[:relative_root]

  img['src'] = new_src
end
```

Three things it deliberately does *not* do: absolute URLs are left alone, a missing `relative_root` is a no-op (so the filter is safe on markdown from anywhere), and the joined result must still contain the root — otherwise a `../`-laden path could escape into another record's files.

`Seek::Markdown.render` and `strip_markdown` both re-encode their input with `invalid: :replace, undef: :replace` first, so invalid byte sequences degrade instead of raising.

## External Integrations

### NeLS

Blobs from the [Norwegian e-Infrastructure for Life Sciences](https://nels.bioinfo.no/) are identified by URL prefix (`Seek::Config.nels_permalink_base`). Their content is fetched using a NeLS API access token rather than a standard HTTP handler.

### OpenBIS

Blobs linked to OpenBIS datasets are flagged via the asset's `openbis?` method. The file is not stored locally — it is always fetched from the OpenBIS instance.

## Key Configuration

| Setting | Default | Purpose |
|---|---|---|
| `Seek::Config.filestore_path` | `tmp/filestore` | Root storage directory |
| `Seek::Config.cache_remote_files` | `false` | Enable background caching of remote files |
| `Seek::Config.max_cachable_size` | 500 MB | Skip caching files larger than this |
| `Seek::Config.hard_max_cachable_size` | 2 GB | Never cache files larger than this |
| `Seek::Config.block_file_uploads` | `false` | Disable all file uploads site-wide |
| `Seek::Config.pdf_conversion_enabled` | depends | Requires LibreOffice |
| `Seek::Config.show_as_external_link_enabled` | `false` | Show uncached remote files as links rather than proxy downloads |

## Key Files

| File | Purpose |
|---|---|
| `app/models/content_blob.rb` | Core model |
| `lib/seek/content_type_detection.rb` | MIME type helpers |
| `lib/seek/content_extraction.rb` | PDF conversion and text extraction |
| `lib/seek/data/checksums.rb` | MD5/SHA1 calculation |
| `lib/seek/download_handling/http_handler.rb` | HTTP remote handler |
| `lib/seek/download_handling/http_streamer.rb` | Chunked streaming |
| `lib/seek/renderers/renderer_factory.rb` | Browser preview renderer selection |
| `app/controllers/content_blobs_controller.rb` | Download and preview actions |
| `app/jobs/remote_content_fetching_job.rb` | Background caching job |
| `lib/seek/acts_as_asset/content_blobs.rb` | Asset-to-blob association helpers |
