---
title: SEEK Project Structure
description: Directory layout and key subsystems of the SEEK codebase.
categories: [Reference, Architecture]
---

SEEK is a Rails application. The source lives at `/home/sowen/development/ruby/seek`. This page maps the directory layout to the concepts behind it.

## Top-level layout

```
seek/
├── app/                   # Rails MVC + jobs, serializers, validators
├── config/                # Routes, initializers, YAML configs
├── db/                    # Schema, migrations
├── lib/seek/              # Core domain logic (non-Rails modules)
├── spec/                  # RSpec tests
├── test/                  # Minitest tests (older suite)
├── docker/                # Docker entrypoints and env files
├── solr/                  # Solr config for full-text search
└── filestore/             # Uploaded file storage (on disk)
```

## app/

### models/

The content models are grouped into two broad mixins:

| Mixin | Models |
|---|---|
| `acts_as_asset` | `DataFile`, `Document`, `FileTemplate`, `Model`, `Placeholder`, `Presentation`, `Publication`, `Sop`, `Template`, `Workflow`, `Collection` |
| `acts_as_isa` | `Investigation`, `Study`, `Assay` |

Other key models:

| Model | Purpose |
|---|---|
| `Sample` / `SampleType` / `SampleAttribute` | Structured sample metadata with typed attributes and controlled vocabularies |
| `ExtendedMetadata` / `ExtendedMetadataType` / `ExtendedMetadataAttribute` | Polymorphic extra metadata attachable to most resource types |
| `Project` / `Programme` / `Institution` | Organisational hierarchy |
| `Person` / `User` | Authentication and identity (separate models — `User` handles login, `Person` holds profile) |
| `ContentBlob` | Stores file uploads and remote URLs; polymorphically attached to assets |
| `Snapshot` | Immutable DOI-able point-in-time copy of an asset |
| `Policy` / `Permission` | Fine-grained access control (see [Permissions](#permissions)) |
| `Strain` / `Organism` / `HumanDisease` | Biological annotation models |
| `ObservationUnit` | PPEO-aligned experimental unit linking ISA and samples |
| `Workflow` / `WorkflowClass` | CWL/Snakemake/etc. workflow support, integrates with WorkflowHub |

`app/models/git/` contains the git-versioning models (`Git::Repository`, `Git::Version`, `Git::Blob`, `Git::Annotation`, etc.) — see [Git Versioning Backend](git-backend).

### controllers/

Standard Rails resource controllers. Shared behaviour lives in `app/controllers/concerns/`:

- `Seek::ActsAsAsset::Controller` — download, upload, versioning actions common to all assets
- `FairSignposting` — adds `Link` headers for RDF content negotiation
- `CommonSweepers` — cache sweeping

### jobs/

Delayed Job background jobs. Notable ones:

| Job | Trigger |
|---|---|
| `RdfGenerationJob` | After any asset save |
| `ReindexingJob` | After any searchable model save |
| `SampleDataExtractionJob` | After a spreadsheet upload |
| `FairDataStationImportJob` | After a turtle upload |
| `RemoteGitFetchJob` | Scheduled / manual git repository sync |
| `RegularMaintenanceJob` | Cron-style housekeeping |

### serializers/

JSON:API serializers (via `active_model_serializers`). One serializer per resource type, used by the REST API.

## lib/seek/

The main domain logic lives here as plain Ruby modules, mixed into models or called from jobs/controllers.

### Core mixins

| Module | Purpose |
|---|---|
| `Seek::ActsAsAsset` | Shared behaviour for all file-backed assets: content blobs, versioning, DOIs, download handling |
| `Seek::ActsAsIsa` | Shared behaviour for Investigation/Study/Assay: ISA relationships, project association |
| `Seek::ExplicitVersioning` | Original version-per-record versioning (pre-git) |
| `Seek::Rdf::RdfGeneration` | Builds and pushes RDF triples — see [RDF Generation](rdf-generation) |

### Subsystem directories

| Directory | What's inside |
|---|---|
| `lib/seek/permissions/` | Authorization logic: policy evaluation, auth lookup table management, state-based visibility |
| `lib/seek/search/` | Sunspot/Solr integration: indexing helpers, common fields |
| `lib/seek/samples/` | Sample attribute type system: extraction from spreadsheets, attribute handlers, metadata updater |
| `lib/seek/rdf/` | RDF generation, CSV mappings, Virtuoso repository, file storage |
| `lib/seek/roles/` | Role system: `Seek::Roles::Scope`, `Seek::Roles::Target`, per-project/programme/admin roles |
| `lib/seek/fair_data_station/` | Turtle import pipeline for FAIR Data Station uploads |
| `lib/seek/extended_metadata_type/` | JSON upload parsing and validation for Extended Metadata types |
| `lib/seek/isa/` | ISA template system and graph helpers |
| `lib/seek/workflow_extractors/` | Parser adapters for CWL, Snakemake, Galaxy, Nextflow, etc. |
| `lib/seek/bio_schema/` | Schema.org / Bioschemas metadata generation |
| `lib/git/` | Git versioning backend: `Git::Repository`, converter, Rugged wrapper |

## config/

| File / Directory | Purpose |
|---|---|
| `routes.rb` | Standard Rails routes; assets and ISA resources follow REST conventions |
| `initializers/` | MIME types, Sunspot, Delayed Job, feature flags |
| `virtuoso_settings.example.yml` | Virtuoso triple store connection — copy to `virtuoso_settings.yml` |
| `sunspot.yml` | Solr connection settings |
| `schedule.rb` | Whenever gem cron schedule for maintenance jobs |
| `ontologies/` | JERM and other ontology RDF files |
| `default_data/` | Seed YAML files for controlled vocab, sample attribute types, etc. |

## Permissions

SEEK uses a two-layer access control system:

1. **Policy / Permission records** — each asset has a `Policy` with a default sharing level (`no_access`, `visible`, `accessible`, `editable`, `managing`) and zero or more `Permission` overrides scoped to a specific `Person`, `Project`, `Institution`, or `WorkGroup`.

2. **Auth lookup table** — `AuthLookup` is a denormalised table updated by `AuthLookupUpdateJob` whenever a policy or membership changes. Controllers query it for fast permission checks rather than evaluating the full policy graph on every request.

`lib/seek/permissions/`

## Search

Full-text search uses [Sunspot](https://github.com/sunspot/sunspot) against Apache Solr. Models call `searchable { ... }` to declare indexed fields. `ReindexingJob` keeps the index up to date on every save.

Config: `config/sunspot.yml`, `solr/`

## Testing

| Directory | Framework | Coverage |
|---|---|---|
| `spec/` | RSpec | Unit and integration tests; most new tests go here |
| `test/` | Minitest | Older functional/integration tests |
| `test/functional/` | Minitest | Controller tests for most resource types |

Run the full suite with `bundle exec rake test` or `bundle exec rspec`.
