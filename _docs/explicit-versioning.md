---
title: Explicit Versioning
description: How SEEK versions assets using the explicit_versioning framework — version records, ContentBlob snapshots, visibility, and DOI minting.
categories: [Architecture, Reference, Versioning]
---

Most downloadable assets in SEEK are versioned — each save that changes content creates a new immutable version record alongside the parent. This is handled by the `explicit_versioning` framework, distinct from the git-based versioning used by `Workflow`. See [Git Versioning Backend](../git-backend/) for the git approach.

## Which Models Use It

All models that call `acts_as_asset` and are versioned use `explicit_versioning`:

`DataFile`, `Sop`, `Model`, `Presentation`, `Document`, `FileTemplate`, `Template`

`Workflow` is the exception — it uses `git_versioning` instead.

## How It Works

Calling `explicit_versioning` on a model does two things:

1. Creates a nested `Model::Version` class backed by a `{model}_versions` database table (e.g. `data_file_versions`).
2. Wires up callbacks on the parent so that a new version row is created on the first save, and synced on every subsequent save.

```ruby
class DataFile < ApplicationRecord
  acts_as_asset

  explicit_versioning(version_column: 'version',
                      sync_ignore_columns: ['doi', 'file_template_id']) do
    acts_as_doi_mintable(proxy: :parent, type: 'Dataset')
    # anything in this block is class_eval'd on DataFile::Version
  end
end
```

### The Two Tables

| Table | Contains |
|---|---|
| `data_files` | Current state — the authoritative record for authorization, search, and associations |
| `data_file_versions` | One row per version, including a snapshot of all synced attributes |

The parent record's attributes are kept in sync with the latest version row. Columns listed in `sync_ignore_columns` are excluded from this sync — most commonly `doi`, so that minting a DOI on a specific version does not overwrite the parent.

### Version Lifecycle

```
First save
  → parent row created (version = 1)
  → DataFile::Version row created (version = 1)

Content changed, new version requested
  → parent version column incremented (version = 2)
  → new DataFile::Version row created (version = 2)
  → old version row (version = 1) left untouched

Attribute updated without new version
  → parent row updated
  → latest version row synced to match (except sync_ignore_columns)
```

## Version Accessors

```ruby
asset.version           # current version number (integer)
asset.versions          # all DataFile::Version records, ordered
asset.latest_version    # most recent version record
asset.find_version(2)   # specific version by number

version.parent          # back-reference to the DataFile
version.latest_version? # true if this is the most recent
version.previous_version
version.name            # "Version 2"
version.is_a_version?   # always true
```

## ContentBlobs and Versions

Each version is linked to its own `ContentBlob` via a scoped association that matches on `asset_version`:

```ruby
# On the parent (current version's blob)
has_one :content_blob,
  ->(r) { where('content_blobs.asset_version = ? AND deleted = ?', r.version, false) },
  as: :asset, foreign_key: :asset_id

# On the version
has_one :content_blob,
  ->(r) { where('content_blobs.asset_version = ? AND content_blobs.asset_type = ?',
                r.version, r.parent.class.name) },
  primary_key: :data_file_id, foreign_key: :asset_id
```

When a new version is created with new file content, a new `ContentBlob` is created with the incremented `asset_version`. When a new version is created without changing the file, the old blob is reused.

Blobs are never hard-deleted. When an asset is destroyed, its blobs are soft-deleted (`deleted = true`) to preserve checksums for duplicate detection. See [Content Blobs and File Storage](../content-blobs/).

`Model` is the only asset type that uses `has_many :content_blobs` per version, because a model version can include multiple files.

## Version Visibility

Each version has its own `visibility` column, independent of the parent asset's sharing policy:

| Value | Constant | Who can see this version |
|---|---|---|
| `0` | `private` | Resource managers only |
| `1` | `registered_users` | Any logged-in user |
| `2` | `public` | Everyone |

The parent policy governs whether the asset as a whole is accessible; version visibility is an additional per-version restriction applied on top.

```ruby
version.visibility          # integer
version.visible?(user)      # true / false
version.can_change_visibility?  # only non-latest versions without a DOI
```

Only non-latest versions can have their visibility changed. The latest version's visibility is always governed by the parent policy.

## DOI Minting

DOIs are minted at the version level, not on the parent. The `explicit_versioning` block declares:

```ruby
acts_as_doi_mintable(proxy: :parent, type: 'Dataset', general_type: 'Dataset')
```

And the parent model declares:

```ruby
acts_as_doi_parent(child_accessor: :versions)
```

### Constraints

- At least one creator must be set on the asset.
- `Seek::Config.doi_minting_enabled` must be true.
- The resource must be older than a configured minimum age.

### Minting process

1. DataCite metadata is assembled: title, description, creators, publication year, publisher (`Seek::Config.instance_name`), resource type.
2. Metadata is uploaded to the DataCite API.
3. A DOI is minted for the asset's public URL and stored in the version's `doi` column.
4. `RdfGenerationJob` is queued to update the linked data representation.

### After minting

The `doi` column is in `sync_ignore_columns`, so a DOI on a version is never overwritten by subsequent saves on the parent.

An asset whose versions have active DOIs cannot be deleted. The DOI must first be retracted:

```ruby
version.inactivate_doi   # marks DOI as inactive at DataCite
asset.retract_dois(reason)  # retracts all version DOIs
```

### Parent helpers

```ruby
asset.latest_citable_doi   # DOI of the most recent version that has one
asset.has_doi?             # true if any version has a DOI
asset.doi_identifiers      # array of all version DOIs
```

## Adding a New Versioned Model

1. Call `acts_as_asset` and then `explicit_versioning`:

```ruby
class MyAsset < ApplicationRecord
  acts_as_asset

  explicit_versioning(version_column: 'version',
                      sync_ignore_columns: ['doi']) do
    acts_as_doi_mintable(proxy: :parent, type: 'Dataset')

    has_one :content_blob,
      ->(r) { where('content_blobs.asset_version = ? AND content_blobs.asset_type = ?',
                    r.version, r.parent.class.name) },
      primary_key: :my_asset_id, foreign_key: :asset_id
  end

  has_one :content_blob,
    ->(r) { where('content_blobs.asset_version = ? AND deleted = ?', r.version, false) },
    as: :asset, foreign_key: :asset_id
end
```

2. Create a migration for the `my_assets_versions` table with the same columns as `my_assets` plus a `version` integer column.

3. Add `content_blobs` rows via the standard upload flow — the `asset_version` column is populated automatically.

## Key Files

| File | Purpose |
|---|---|
| `lib/seek/explicit_versioning.rb` | The versioning framework |
| `lib/seek/doi/acts_as_doi_mintable.rb` | DOI minting on versions |
| `lib/seek/doi/acts_as_doi_parent.rb` | DOI parent-level helpers |
| `lib/seek/acts_as_asset/content_blobs.rb` | ContentBlob helpers for versioned assets |
| `app/models/data_file.rb` | Reference implementation |
| `db/schema.rb` | Version table schemas (e.g. `data_file_versions`) |
