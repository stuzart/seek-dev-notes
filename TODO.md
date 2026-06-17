# Documentation TODO

Topics identified as missing but valuable for SEEK developers.

## High priority

- [ ] **Roles and permissions** — admin, project admin, asset gatekeeper, PAL, programme admin; `Seek::Roles::Scope` and `Seek::Roles::Target`; gatekeeper publish workflow
- [ ] **DOI minting** — `acts_as_doi_mintable`, `acts_as_doi_parent`, Zenodo/DataCite integration, version-level vs snapshot DOIs, retraction

## Useful reference

- [ ] **Subscriptions and notifications** — `Subscribable`, the email job chain, project/programme subscription model
- [ ] **FAIR Data Station import** — turtle upload pipeline, `FairDataStationImportJob`, auto-creating extended metadata types from RDF predicates
- [ ] **Workflow support** — `Workflow`, `WorkflowClass`, extractor adapters (CWL, Snakemake, Galaxy, Nextflow), Life Monitor integration, GA4GH TRS endpoint
- [ ] **Content rendering** — `RendererFactory` and the renderer chain (PDF, image, markdown, notebook, YouTube, iframe); adding a new file type
- [ ] **Improved navigation** - better front page, maybe just a simple Table of Contents

## Lower priority

- [ ] **Annotations and tagging** — `Annotatable`, tag clouds, `RebuildTagCloudsJob`
- [ ] **Activity logs and stats** — `ActivityLog`, stats subsystem, dashboard stats
- [ ] **ObservationUnit** — PPEO-aligned experimental unit, how it bridges ISA and samples
- [ ] **Tips, tricks and gotchas** — non-obvious patterns, common pitfalls, and useful console/debug techniques for working in the SEEK codebase

## Completed

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
