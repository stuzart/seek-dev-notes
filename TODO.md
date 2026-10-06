# Documentation TODO

Topics identified as missing but valuable for SEEK developers.

Last reviewed against seek `main` on 2026-10-06 (SEEK 1.19.0-main).

## High priority

- [ ] **Roles and permissions** — admin, project admin, asset gatekeeper, PAL, programme admin; `Seek::Roles::Scope` and `Seek::Roles::Target`; gatekeeper publish workflow. *Recently active: role ordering on the project roles admin page changed (#2727), and the unused project coordinators code was removed.*
- [ ] **DOI minting** — `acts_as_doi_mintable`, `acts_as_doi_parent`, Zenodo/DataCite integration, version-level vs snapshot DOIs, retraction
- [ ] **Content rendering** — `RendererFactory` and the renderer chain (PDF, image, markdown, notebook, YouTube, iframe, Slideshare, text); `BlobRenderer` base class, `external_embed?` and cookie consent, `CACHE_VERSION`; adding a new file type. *The [Content Blobs](_docs/content-blobs.md) page now covers inline previews, `rendered_asset_view`, text truncation and the markdown relative-link filter, but the renderer chain itself still deserves its own page — this was the most active area on main over the last quarter (#2661, #2629, #2725).*

## Useful reference

- [ ] **Subscriptions and notifications** — `Subscribable`, the email job chain, project/programme subscription model
- [ ] **FAIR Data Station import** — turtle upload pipeline, `FairDataStationImportJob`, auto-creating extended metadata types from RDF predicates
- [ ] **Workflow support** — `Workflow`, `WorkflowClass`, extractor adapters (CWL, Snakemake, Galaxy, Nextflow), Life Monitor integration, GA4GH TRS endpoint
- [ ] **Templates and ISA JSON compliance** — `Template` / `TemplateAttribute`, how templates seed SampleTypes, `inherited_from_template_attribute?`, `is_isa_json_compliant?`, and the global template units work (#2622, #2489). Currently only touched on from the Samples page.
- [ ] **Activity logs and stats** — `ActivityLog`, stats subsystem, dashboard stats, `view_count` / `download_count` / `run_count`. *Now partly surfaced through the JSON API `meta.metrics` object (#2726).*
- [ ] **Asset pipeline** — Sprockets setup, page-scoped bundles (the COPASI/Plotly simulation bundle, #2703), JS minification during precompilation
- [ ] **Improved navigation** - better front page, maybe just a simple Table of Contents

## Lower priority

- [ ] **Annotations and tagging** — `Annotatable`, tag clouds, `RebuildTagCloudsJob`
- [ ] **ObservationUnit** — PPEO-aligned experimental unit, how it bridges ISA and samples
- [ ] **Search filtering and facets** — `FilteringHelper`, `Seek::Filtering`, available filters per type, the `obfuscate_filters` setting
- [ ] **Crawler and indexing controls** — `noindex` headers, canonical links for URLs carrying sharing/authorization codes (#2709), `rel="nofollow"` on filter and markdown links
- [ ] **Tips, tricks and gotchas** — non-obvious patterns, common pitfalls, and useful console/debug techniques for working in the SEEK codebase. Draft in `_needs-work/tips-and-tricks.md`.

## Completed

- [x] **Solid Queue migration** — [Background Jobs](_docs/background-jobs.md) rewritten for Solid Queue: `queue.yml` topology, `recurring.yml` schedule (replacing `whenever`), supervisor and `seek:workers:*` tasks, Mission Control dashboard at `/jobs`, failure semantics, and the Delayed::Job upgrade path (#2656, #2739)
- [x] **Caching and Redis** — `Seek::RedisConfig`, the `RedisWithFileOverflowStore` hybrid cache, settings cache, Redis sessions, `Rack::Attack` throttle store, `CacheOverflowCleanupJob`, monitoring
- [x] **Authorization & Policy system** — `PolicyBasedAuthorization`, `Permission`, `Policy` model; access control underpins almost every controller action
- [x] **ISA data model** — Investigation → Study → Assay hierarchy; core scientific structure of SEEK
- [x] **acts_as_asset** — the concern that gives assets common behaviour (versioning, tagging, policy, creators, etc.)
- [x] **Explicit versioning** — `explicit_versioning` framework, version records, ContentBlob scoping, visibility, DOI minting
- [x] **acts_as_isa** — the concern that links assets into the ISA hierarchy (Investigations, Studies, Assays)
- [x] **JSON API** — REST API structure, serializers, API token authentication, adding new endpoints
- [x] **Content Blobs & file storage** — how uploaded files are stored, remote content fetching, `ContentBlob` model lifecycle
- [x] **Background jobs** — queues, how to add a new job, Delayed::Job setup, named queues
- [x] **BioSchema / Schema.org markup** — how SEEK generates structured metadata for search engines
- [x] **Testing setup** — running the test suite, fixtures vs factories, Solr test configuration
- [x] **GitHub integration** — URL handling, workflow import from git repos, OAuth login, org scraper
- [x] **OAuth authentication** — OmniAuth providers (GitHub, ELIXIR AAI, OIDC, LDAP), Identity model, user provisioning, identity linking, configuration
- [x] Rails getting started guide
- [x] SEEK project structure
- [x] Solr search indexing
- [x] Docker setup
- [x] Configuration settings
- [x] Samples and SampleTypes
- [x] Extended Metadata (architecture, attribute types, creating types, in code)
- [x] Git versioning backend
- [x] RDF (endpoints, generation, Virtuoso)
- [x] RO-Crate support
