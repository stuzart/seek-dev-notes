# Documentation TODO

Topics identified as missing but valuable for SEEK developers.

## High priority

- [x] **Authorization & Policy system** — `PolicyBasedAuthorization`, `Permission`, `Policy` model; access control underpins almost every controller action
- [x] **ISA data model** — Investigation → Study → Assay hierarchy; core scientific structure of SEEK
- [x] **acts_as_asset** — the concern that gives assets common behaviour (versioning, tagging, policy, creators, etc.)
- [x] **Explicit versioning** — `explicit_versioning` framework, version records, ContentBlob scoping, visibility, DOI minting
- [x] **acts_as_isa** — the concern that links assets into the ISA hierarchy (Investigations, Studies, Assays)

## Useful reference

- [x] **JSON API** — REST API structure, serializers, API token authentication, adding new endpoints
- [x] **Content Blobs & file storage** — how uploaded files are stored, remote content fetching, `ContentBlob` model lifecycle
- [x] **Background jobs** — queues, how to add a new job, Delayed::Job setup, named queues

## Lower priority

- [ ] **BioSchema / Schema.org markup** — how SEEK generates structured metadata for search engines
- [ ] **Testing setup** — running the test suite, fixtures vs factories, Solr test configuration

## Completed

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
