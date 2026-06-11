---
title: acts_as_isa
description: The concern that gives Investigation, Study, Assay, and ObservationUnit their shared behaviour — authorization, search, subscriptions, RDF, and more.
categories: [Architecture, Reference]
---

`acts_as_isa` is the class macro that wires up all the shared behaviour for ISA models. It is called in `Investigation`, `Study`, `Assay`, and `ObservationUnit`. For the data structure and relationships between these models, see [ISA Data Model](../isa-data-model/).

## Source

`lib/seek/acts_as_isa.rb` — a short file that delegates almost everything to other modules:

```ruby
def acts_as_isa
  acts_as_favouritable
  acts_as_authorized
  acts_as_uniquely_identifiable
  acts_as_discussable
  has_extended_metadata
  has_external_identifier

  auto_strip_attributes :title

  validates :title, presence: true
  validates :title, length: { maximum: 255 }
  validates :description, length: { maximum: 65_535 }

  grouped_pagination

  include Seek::ActsAsISA::Relationships::Associations
  include Seek::ActsAsISA::InstanceMethods
  include Seek::Stats::ActivityCounts
  include Seek::Search::CommonFields, Seek::Search::BackgroundReindexing
  include Seek::Subscribable
  include Seek::Rdf::RdfGeneration
  include Seek::Taggable
  include Seek::ResearchObjects::Packaging
  has_many :programmes, -> { distinct }, through: :projects

  extend Seek::ActsAsISA::SingletonMethods
end
```

## What Each Module Provides

### `acts_as_authorized`

Wires up the policy and permission system. Adds `can_view?`, `can_edit?`, `can_manage?`, `can_delete?`, and the `policy` association with its before-save assignment. See [Authorization and Policy System](../authorization/) for full details.

### `acts_as_favouritable`

Allows users to bookmark/star an ISA item. Adds `has_many :favourites`.

### `acts_as_uniquely_identifiable`

Generates and manages a `uuid` for each record. Also wires up `external_identifier` support via `has_external_identifier`.

### `acts_as_discussable`

Links an ISA item to a discussion board. Adds `has_one :discussion_board`.

### `has_extended_metadata`

Allows custom metadata attributes to be attached via `ExtendedMetadataType`. See [Extended Metadata Architecture](../extended-metadata-architecture/).

### `Seek::ActsAsISA::Relationships::Associations`

Adds publication and creator associations common to all ISA models:

```ruby
has_many :relationships, as: :subject       # generic relationship records
has_many :publications, through: :publication_relationships
include Seek::Creators                       # has_many :creators via assets_creators
```

Also provides instance methods for traversing related items:

```ruby
item.related_publications  # directly related + those from child assays
item.related_people        # creators + contributor
item.related_sops
item.related_data_files
```

Each model overrides the `related_*_ids` methods to include the appropriate child relationships. For example, `Investigation#related_data_file_ids` unions `assay_data_file_ids` and `observations_unit_data_file_ids`.

### `Seek::Search::CommonFields` and `BackgroundReindexing`

Indexes into Solr via Sunspot. Common fields indexed across all ISA models:

- `title`, `description`
- `searchable_tags` — tag annotations
- `contributor` — primary contributor's name
- `projects`, `programmes` — titles of associated projects and programmes

Model-specific fields are declared **before** `acts_as_isa` is called (using `searchable(auto_index: false)`) to avoid being overridden by `CommonFields`.

`BackgroundReindexing` adds an `after_save` hook that enqueues a `ReindexingJob` whenever an attribute other than `updated_at` changes. See [Solr Search Indexing](../solr-search-indexing/) and [Background Jobs](../background-jobs/).

### `Seek::Subscribable`

Lets users subscribe to receive notifications when an ISA item is created or updated:

```ruby
item.subscribe(person)
item.subscribed?(person)
item.send_immediate_subscriptions(activity_log)  # fires ImmediateSubscriptionEmailJob
```

When a new item is created, `SetSubscriptionsForItemJob` automatically subscribes all project members who have opted in.

### `Seek::Rdf::RdfGeneration`

Generates RDF/Turtle for the item and queues `RdfGenerationJob` after each save. Writes files to `{filestore_path}/rdf/`. See [RDF Generation](../rdf-generation/).

### `Seek::Taggable`

Enables annotation-based tagging. Adds:

```ruby
has_annotation_type :tag
item.tags_as_text_array  # => ["proteomics", "mouse", ...]
item.searchable_tags      # used by CommonFields for Solr
```

### `Seek::ResearchObjects::Packaging`

Utility methods for including an ISA item's related assets in a Research Object archive. Used by `acts_as_snapshottable`.

### `Seek::Stats::ActivityCounts`

Tracks views, downloads, edits, and runs via the `ActivityLog` table. Provides `item.activity_counts`.

### `Seek::ActsAsISA::SingletonMethods`

Class-level methods:

```ruby
Investigation.user_creatable?  # Seek::Config.investigations_enabled
Study.user_creatable?          # Seek::Config.studies_enabled
Investigation.can_create?      # User.logged_in_and_member?
Investigation.is_isa?          # => true
```

## How It Differs from `acts_as_asset`

`acts_as_asset` is used by downloadable content models (`DataFile`, `Sop`, `Model`, `Document`, `Workflow`, etc.). `acts_as_isa` is used by the organizational hierarchy models. They are distinct — neither includes the other — but they share many of the same underlying modules:

| Capability | acts_as_isa | acts_as_asset |
|---|---|---|
| Authorization (`can_view?` etc.) | ✓ | ✓ |
| Policy | ✓ | ✓ |
| UUID | ✓ | ✓ |
| Creators | ✓ | ✓ |
| Tags | ✓ | ✓ |
| Solr indexing | ✓ | ✓ |
| Subscriptions | ✓ | ✓ |
| RDF generation | ✓ | ✓ |
| Extended metadata | ✓ | ✓ |
| File versioning / ContentBlob | — | ✓ |
| ISA navigation (up to Investigation) | — | ✓ (via `acts_as_asset/isa.rb`) |
| Snapshots | ✓ (via `acts_as_snapshottable`) | — |

Assets navigate up to the ISA hierarchy via `Seek::ActsAsAsset::ISA::Associations`:

```ruby
data_file.assays        # directly linked assays
data_file.studies       # via assays
data_file.investigations # via studies
```

## Project Membership

Only `Investigation` holds a direct project association (`has_and_belongs_to_many :projects`). Studies and Assays each override the `projects` method to delegate upward:

```ruby
# Study
def projects
  investigation&.projects || []
end

# Assay
def projects
  study&.projects || []
end
```

This means projects are inherited, not stored, on Studies and Assays. The `projects: true` validator on Study and Assay confirms that the parent relationship is valid (and therefore projects are reachable) at save time.

## Callbacks and Lifecycle

| Hook | Source | Effect |
|---|---|---|
| `before_save` | `acts_as_authorized` | Assigns temporary policy if none set |
| `before_save` | `acts_as_uniquely_identifiable` | Generates UUID if absent |
| `before_destroy` | `acts_as_authorized` | Checks `can_delete?` |
| `before_destroy` | `RdfGeneration` | Removes RDF files |
| `before_destroy` | model-level `state_allows_delete?` | Prevents deletion if children exist |
| `after_save` | `BackgroundReindexing` | Enqueues `ReindexingJob` |
| `after_save` | `RdfGeneration` | Enqueues `RdfGenerationJob` |
| `after_create` | `Subscribable` | Enqueues `SetSubscriptionsForItemJob` |

## Checking if a Model is an ISA Model

```ruby
Investigation.is_isa?     # => true
DataFile.is_isa?          # => false
my_object.is_isa?         # => true / false
```

## Publishing

All ISA models inherit publishing behaviour from `Seek::Permissions::PublishingPermissions` (via `acts_as_authorized`):

```ruby
item.can_publish?(user)
item.publish!           # sets policy to ACCESSIBLE, logs to ResourcePublishLog
item.is_published?
item.is_waiting_approval?
item.is_rejected?
```

If the associated project has a gatekeeper, `publish!` enters an approval workflow rather than publishing immediately. See [Authorization and Policy System](../authorization/) for gatekeeper details.

## Key Files

| File | Purpose |
|---|---|
| `lib/seek/acts_as_isa.rb` | Entry point — the `acts_as_isa` macro |
| `lib/seek/acts_as_isa/relationships.rb` | Publication/creator associations and related-item helpers |
| `lib/seek/acts_as_isa/tag_type.rb` | Tag annotation type definition |
| `lib/seek/acts_as_asset/isa.rb` | Reverse navigation — gives assets `assays`, `studies`, `investigations` |
| `lib/seek/permissions/policy_based_authorization.rb` | Authorization logic |
| `lib/seek/search/common_fields.rb` | Shared Solr fields |
| `lib/seek/subscribable.rb` | Notification subscriptions |
| `lib/seek/rdf/rdf_generation.rb` | RDF file/triple store generation |
| `lib/seek/research_objects/acts_as_snapshottable.rb` | Snapshot creation |
