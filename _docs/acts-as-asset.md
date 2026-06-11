---
title: acts_as_asset
description: The concern that gives downloadable content models their shared behaviour — versioning, file storage, DOI minting, ISA navigation, search, and publishing.
categories: [Architecture, Reference]
---

`acts_as_asset` is the class macro for downloadable content models in SEEK. It is called in `DataFile`, `Sop`, `Model`, `Workflow`, `Presentation`, `Document`, `Publication`, `Sample`, `SampleType`, `Placeholder`, `Template`, `FileTemplate`, and `Collection`.

For the counterpart used by the ISA hierarchy (Investigation, Study, Assay), see [acts_as_isa](../acts-as-isa/).

## Source

`lib/seek/acts_as_asset.rb`. When called, it includes the following:

```ruby
include Seek::Taggable
acts_as_authorized
acts_as_uniquely_identifiable
acts_as_favouritable
acts_as_discussable
grouped_pagination
auto_strip_attributes :title
has_extended_metadata
has_external_identifier

include Seek::Stats::ActivityCounts
include Seek::ActsAsAsset::ISA::Associations
include Seek::ActsAsAsset::Folders::Associations
include Seek::ActsAsAsset::Relationships::Associations
include Seek::ActsAsAsset::Searching
include Seek::Data::SpreadsheetExplorerRepresentation
include Seek::Search::BackgroundReindexing
include Seek::Subscribable
```

Many of these modules are shared with [acts_as_isa](../acts-as-isa/). The key additions unique to assets are versioning, content blob wiring, ISA upward navigation, DOI minting, and download-oriented publishing.

## Versioning

Most asset models declare `explicit_versioning` alongside `acts_as_asset`. This generates a nested `Model::Version` class backed by a `{model}_versions` table. The parent record holds the current state; version rows are immutable snapshots.

See [Explicit Versioning](../explicit-versioning/) for the full details — version lifecycle, ContentBlob scoping, per-version visibility, DOI minting, and how to add a new versioned model.

`Workflow` is the exception — it uses `git_versioning` instead. See [Git Versioning Backend](../git-backend/).

## ContentBlob Connection

Each versioned asset has a `has_one :content_blob` association scoped to the current version:

```ruby
has_one :content_blob,
  ->(r) { where('content_blobs.asset_version = ? AND deleted = ?', r.version, false) },
  as: :asset, foreign_key: :asset_id
```

The `Model` type is the only exception — it uses `has_many :content_blobs` because a single model version can include multiple files.

`acts_as_asset` adds helper methods via `Seek::ActsAsAsset::ContentBlobs`:

```ruby
asset.all_content_blobs          # array of all blobs across all versions
asset.single_content_blob        # nil if multiple blobs
asset.content_blob_search_terms  # text content for Solr (capped at 920K terms)
asset.mark_deleted_content_blobs # soft-deletes blobs on asset destroy
```

Blobs are never hard-deleted — they are marked `deleted: true` to preserve checksums for duplicate detection. See [Content Blobs and File Storage](../content-blobs/) for full details.

## ISA Navigation

`Seek::ActsAsAsset::ISA::Associations` lets assets navigate up the ISA hierarchy:

```ruby
asset.assay_assets    # join records (AssayAsset)
asset.assays          # all linked Assays
asset.studies         # via assays (distinct)
asset.investigations  # via studies (distinct)
```

Assets are linked to Assays via `AssayAsset`. The `assay_assets_attributes=` setter handles bulk-assigning assay links, with a guard that prevents `Model` records from being linked to non-modelling assays. See [ISA Data Model](../isa-data-model/) for the full picture.

## Project Folders

`Seek::ActsAsAsset::Folders::Associations` adds:

```ruby
has_many :project_folder_assets  # polymorphic
after_create :add_new_to_folder  # auto-adds to each project's "New Items" folder
```

## Relationships and Attributions

`Seek::ActsAsAsset::Relationships::Associations` wires up:

```ruby
has_many :relationships          # generic Relationship records
has_many :attributions           # ATTRIBUTED_TO predicate only
has_one  :source_link            # SOURCE type AssetLink
has_many :publications           # through publication_relationships
include  Seek::Creators          # has_many :creators via assets_creators
include  Seek::Collectable       # has_many :collections
```

Instance methods:

```ruby
asset.attributions_objects   # resources this asset is attributed to
asset.related_people         # union of creators and contributor
asset.managers_names         # names of users with MANAGING permission
```

## Search Indexing

`Seek::ActsAsAsset::Searching` declares Solr fields beyond the common set:

- `creators` — creator names
- `other_creators` — free-text unregistered contributors
- `content_blob` — full text extracted from files (PDFs, spreadsheets, plain text)
- `assay_type_titles`, `technology_type_titles` — ontology labels from linked assays
- `git_content` — text content from git-versioned files

`BackgroundReindexing` enqueues a `ReindexingJob` after every save. See [Solr Search Indexing](../solr-search-indexing/) and [Background Jobs](../background-jobs/).

## DOI Minting

DOIs are minted at the **version** level via `acts_as_doi_mintable`, declared inside the `explicit_versioning` block. See [Explicit Versioning](../explicit-versioning/) for constraints, the minting process, and retraction.

## Publishing Workflow

Publishing sets the asset's policy to public (`ACCESSIBLE`). The workflow is the same as for ISA models but assets are more commonly published as standalone items.

```ruby
asset.can_publish?(user)
asset.publish!           # sets policy to public, creates ResourcePublishLog
asset.is_published?
asset.is_waiting_approval?
asset.reject(comment)
```

If the asset's project has an Asset Gatekeeper, calling `publish!` creates a pending approval request instead of immediately making the asset public. See [Authorization and Policy System](../authorization/).

## Authorization

`acts_as_authorized` provides `can_view?`, `can_download?`, `can_edit?`, `can_manage?`, and `can_delete?`. Assets add one layer on top: `is_downloadable_asset?` combines the authorization check with a content check:

```ruby
asset.is_downloadable?        # true if content_blob or content_blobs is defined
asset.is_downloadable_asset?  # true if is_asset? AND is_downloadable?
asset.contains_downloadable_items?  # true if has blobs or is git-versioned
```

A model can override `download_disabled?` to prevent downloads in specific states (e.g. an OpenBIS-linked asset that exceeds a size limit).

## Class-Level Methods

```ruby
DataFile.user_creatable?   # Seek::Config.data_files_enabled
DataFile.can_create?       # User.logged_in_and_member?
DataFile.is_asset?         # => true
DataFile.get_all_as_json(user)  # all authorized assets as JSON
```

## How It Differs from `acts_as_isa`

| Capability | acts_as_asset | acts_as_isa |
|---|---|---|
| Authorization (`can_view?` etc.) | ✓ | ✓ |
| Tagging, subscriptions, RDF, UUID | ✓ | ✓ |
| Extended metadata | ✓ | ✓ |
| ISA upward navigation (assays → investigations) | ✓ | — |
| File versioning (`explicit_versioning`) | ✓ | — |
| ContentBlob / file storage | ✓ | — |
| DOI minting | ✓ (on versions) | — (snapshots only) |
| Project folders | ✓ | — |
| Snapshots (RO-Bundle) | — | ✓ |
| ISA hierarchy ownership (has_many :studies etc.) | — | ✓ |

## Notable Per-Model Variations

Most models follow the standard pattern. A few differ:

- **`Publication`** — not downloadable (no content blob); links assets to it rather than the other way round.
- **`Model`** — `has_many :content_blobs` (multiple files per version); Models may only be linked to Modelling Analysis assays.
- **`Workflow`** — uses `git_versioning` instead of `explicit_versioning`; has execution link and Life Monitor integration.
- **`Sample`** — not publishable in the standard sense; metadata stored as JSON in `json_metadata`; linked to `SampleType` as its schema.
- **`Collection`** — no content blob; acts as a curated list of other assets via `CollectionItem`.

## Key Files

| File | Purpose |
|---|---|
| `lib/seek/acts_as_asset.rb` | Entry point — the `acts_as_asset` macro |
| `lib/seek/acts_as_asset/content_blobs.rb` | ContentBlob helpers |
| `lib/seek/acts_as_asset/isa.rb` | ISA upward navigation associations |
| `lib/seek/acts_as_asset/folders.rb` | Project folder auto-placement |
| `lib/seek/acts_as_asset/relationships.rb` | Attributions, creators, publications |
| `lib/seek/acts_as_asset/searching.rb` | Asset-specific Solr fields |
| `lib/seek/explicit_versioning.rb` | Versioning framework |
| `lib/seek/doi/acts_as_doi_mintable.rb` | DOI minting on versions |
| `lib/seek/doi/acts_as_doi_parent.rb` | DOI parent-level helpers |
| `lib/seek/creators.rb` | Creator tracking via assets_creators |
| `lib/seek/collectable.rb` | Collection membership |
