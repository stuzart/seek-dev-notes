# Documentation TODO

Topics identified as missing but valuable for SEEK developers.

## High priority

- [ ] **Authorization & Policy system** — `PolicyBasedAuthorization`, `Permission`, `Policy` model; access control underpins almost every controller action
- [ ] **ISA data model** — Investigation → Study → Assay hierarchy; core scientific structure of SEEK
- [ ] **acts_as_asset** — the concern that gives assets common behaviour (versioning, tagging, policy, creators, etc.)

## Useful reference

- [ ] **JSON API** — REST API structure, serializers, API token authentication, adding new endpoints
- [ ] **Content Blobs & file storage** — how uploaded files are stored, remote content fetching, `ContentBlob` model lifecycle
- [ ] **Background jobs** — queues, how to add a new job, Delayed::Job setup, named queues

## Lower priority

- [ ] **BioSchema / Schema.org markup** — how SEEK generates structured metadata for search engines
- [ ] **Testing setup** — running the test suite, fixtures vs factories, Solr test configuration

## Completed

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
