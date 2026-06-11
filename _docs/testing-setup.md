---
title: Testing Setup
description: How to run SEEK's test suite — framework, fixtures, factories, Solr, external service mocking, and CI configuration.
categories: [Reference]
---

## Framework

SEEK uses **Minitest** as its primary test framework. A small number of RSpec specs also exist under `spec/` (run separately).

Notable gems in the test group:

| Gem | Purpose |
|---|---|
| `minitest-reporters` | Colour output, fast-fail, slowest-test summary |
| `factory_bot_rails` | Factory-based test data |
| `webmock` | Blocks outbound HTTP; allows stubs |
| `vcr` | Records and replays real HTTP interactions |
| `sunspot_matchers` | Assertions on Solr search calls |
| `rspec-rails` | RSpec for `spec/` |

## Running Tests

```bash
# All Minitest suites
bundle exec rails test

# Individual suites
bundle exec rails test test/unit
bundle exec rails test test/functional
bundle exec rails test test/integration

# Single file or test
bundle exec rails test test/unit/assay_test.rb
bundle exec rails test test/unit/assay_test.rb -n test_title_is_required

# RSpec specs
bundle exec rspec spec
```

## Directory Structure

```
test/
├── unit/                        # Model tests (~159 files)
├── functional/                  # Controller tests (~70 files)
├── integration/                 # Full-stack tests
│   └── api/                    # JSON API tests (~33 files)
├── fixtures/                    # YAML fixture data (59 files)
│   └── files/                  # File uploads used in tests
├── factories/                   # FactoryBot factory definitions
├── test_helper.rb               # Main configuration
├── api_test_helper.rb           # JSON API test utilities
├── authenticated_test_helper.rb # login_as / logout helpers
├── mock_helper.rb               # External service mocks
└── vcr_cassettes/               # Recorded HTTP interactions
```

Naming conventions:
- `app/models/assay.rb` → `test/unit/assay_test.rb`
- `app/controllers/assays_controller.rb` → `test/functional/assays_controller_test.rb`

## Fixtures and Factories

SEEK uses both. Fixtures are loaded for every test; factories are the preferred approach for new tests.

### Fixtures

59 YAML files in `test/fixtures/`, loaded globally with `fixtures :all`. Access them by name:

```ruby
users(:quentin)
assays(:modelling_assay)
projects(:sysmo_project)
```

Version tables need explicit class mapping, already done in `test_helper.rb`:

```ruby
set_fixture_class sop_versions: Sop::Version
set_fixture_class model_versions: Model::Version
set_fixture_class data_file_versions: DataFile::Version
```

### FactoryBot

40+ factory files in `test/factories/`. Prefer factories over fixtures for new tests — they create isolated, self-describing records.

```ruby
# Basic creation
person = FactoryBot.create(:person)
data_file = FactoryBot.create(:data_file, title: 'My file')

# Common factory naming pattern
FactoryBot.create(:min_data_file)       # minimal valid record
FactoryBot.create(:max_data_file)       # fully populated
FactoryBot.create(:data_file_with_project_contributor)

# Traits
FactoryBot.create(:person, :with_avatar)
```

**Important:** `FactoryBot.create` automatically disables authorization checks. Records created this way bypass `Policy` enforcement — that is intentional for test setup. When writing setup code manually (outside FactoryBot), wrap operations that should not be subject to authorization in:

```ruby
disable_authorization_checks { resource.save! }
```

## Authentication in Tests

Include `AuthenticatedTestHelper` (already included via `test_helper.rb`):

```ruby
login_as(users(:quentin))   # session-based login
logout
authorize_as(users(:quentin))  # HTTP Basic auth header
```

For API tests, `ApiTestHelper` provides:

```ruby
user_login(users(:quentin))     # sets up API token auth
admin_login                     # logs in as admin
read_access_auth(token)         # OAuth read scope
write_access_auth(token)        # OAuth write scope
```

## Transactional Tests

Each test runs inside a database transaction that is rolled back on completion, returning the database to its post-fixture state without reloading fixtures. No explicit cleanup is needed.

`use_instantiated_fixtures = false` means fixture records are not assigned to instance variables — access them via the helper method instead (`users(:quentin)`, not `@quentin`).

## Solr / Search

A running Solr instance is **not required** to run the tests. Search is bypassed by stubbing the `solr_cache` method on individual model classes to return a controlled list of IDs:

```ruby
Document.stub(:solr_cache, ->(q) { Document.pluck(:id).last(3) }) do
  get :index, params: { q: 'genomics' }
  assert_response :success
end

# Multiple types at once
Document.stub(:solr_cache, ->(q) { docs.map(&:id) }) do
  Sop.stub(:solr_cache, ->(q) { sops.map(&:id) }) do
    # ...
  end
end
```

The lambda receives the query string and returns an array of IDs that the search is assumed to have found. This lets tests control exactly which records appear in search results without Solr running.

If you do want to run against a real Solr (e.g. for manual integration testing), the test config uses port **8981** (`config/sunspot.yml`).

## External HTTP — WebMock and VCR

All outbound HTTP is blocked by WebMock. Requests to localhost are allowed. Any test that exercises code making HTTP calls must either stub the request or use a VCR cassette.

### WebMock stubs

For simple cases, use `stub_request` directly or the convenience wrapper in `MockHelper`:

```ruby
datacite_mock        # stubs DataCite DOI minting
zenodo_mock          # stubs Zenodo deposit/publish
doi_citation_mock    # stubs CrossRef citation lookup
pubmed_mock          # stubs PubMed API
ror_mock             # stubs ROR organisation lookup
```

```ruby
class MyTest < ActiveSupport::TestCase
  include MockHelper

  test 'mints a DOI' do
    datacite_mock
    # ... test code
  end
end
```

### VCR cassettes

Tests that exercise code making real HTTP calls use VCR cassettes — recorded YAML files that capture the full request/response and replay it on subsequent runs. Cassettes live in `test/vcr_cassettes/`, organised by external service:

```
test/vcr_cassettes/
├── doi/          # DataCite, CrossRef
├── feedjira/     # RSS/Atom feed fetching
├── github/       # GitHub API
├── nels/         # NeLS API
├── ols/          # Ontology Lookup Service
├── ror/          # Research Organisation Registry
├── publications/ # PubMed, Europe PMC
├── workflows/    # WorkflowHub etc.
└── ...
```

Each cassette is a YAML file recording the HTTP method, URI, request headers/body, and the full response.

**Using a cassette in a test:**

```ruby
VCR.use_cassette('ror/fetch_by_id') do
  get :show, params: { id: institution.id }
  assert_response :success
end

# Cassettes can be nested for tests that make multiple different requests
VCR.use_cassette('feedjira/get_reddit_feed') do
  VCR.use_cassette('feedjira/get_fairdom_feed') do
    get :index
  end
end
```

**Record modes:**

| Mode | When | Behaviour |
|---|---|---|
| `:once` | Local development (default) | Records on first run; replays from that point on |
| `:none` | CI (`CI=true`) | Never records; raises if a cassette is missing |

**Recording a new cassette locally:**

1. Run the test. VCR makes the live request and records the interaction to a new YAML file.
2. Commit the cassette file alongside the test.

**SPARQL exclusion:** Requests matching `/sparql-auth/` are excluded from VCR and always run live. This is a known limitation — SPARQL responses are not yet consistent enough to record reliably.

## Temporary Config Values

Use `with_config_value` to override a `Seek::Config` setting for the duration of one test:

```ruby
with_config_value(:max_upload_size, 10.megabytes) do
  # test behaviour with overridden config
end

# Multiple values at once
with_config_values(doi_minting_enabled: true, instance_name: 'TestSEEK') do
  # ...
end
```

## File Uploads

Use `fixture_file_upload` with files from `test/fixtures/files/`:

```ruby
post :create, params: {
  data_file: { title: 'My file' },
  content_blobs: [{ data: fixture_file_upload('a_pdf_file.pdf', 'application/pdf') }]
}
```

## API Integration Tests

API tests live in `test/integration/api/` and include shared suites:

```ruby
class DataFileApiTest < ActionDispatch::IntegrationTest
  include ReadApiTestSuite    # index, show, filter, include param
  include WriteApiTestSuite   # create, update, delete, auth checks

  def setup
    @data_file = FactoryBot.create(:data_file)
  end
end
```

`ApiTestHelper` provides `validate_json` to assert responses conform to the OpenAPI spec, and `deep_comparison` for comparing complex nested JSON.

## GitHub Actions Workflows

Three workflows run in CI under `.github/workflows/`.

### `tests.yml` — main test suite

Runs on every push and pull request against **MySQL 8.4** (default), with one additional SQLite3 run of the unit suite.

**Services:** MySQL 8.4, PostgreSQL 14, Virtuoso 7.2 (RDF store).

**Matrix jobs:**

| Suite | Notes |
|---|---|
| `rails test test/unit` | Also runs on SQLite3 |
| `rails test test/functional` | MySQL only |
| `rails test test/integration` | MySQL + Virtuoso config applied |
| `rspec spec` | MySQL only |
| `rake assets:precompile` | Verifies asset pipeline compiles cleanly |
| `rake db:setup` | Verifies full setup from scratch |
| `rake db:migrate` | Verifies migrations apply cleanly from the previous commit's schema |
| `rake seek:upgrade` | Seeds the database then runs the upgrade task |

`fail-fast: false` — all jobs run to completion even if one fails.

**Migration testing:** The `db:migrate` job checks forward-migration compatibility. On push events, it checks out the previous commit's `db/schema.rb` and `db/migrate/`, loads that schema, then restores and runs the new migrations.

**Database setup steps (MySQL):**
```bash
cp test/config/database.github.mysql.yml config/database.yml
bundle exec rake db:create
echo "ALTER DATABASE seek_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" \
  | bundle exec rails dbconsole -p
bundle exec rake db:schema:load
```

Alternative configs for local use: `test/config/database.github.{mysql,postgres,sqlite3}.yml` — copy the relevant one to `config/database.yml`.

### `docker-image.yml` — Docker build and deploy smoke test

Runs on pull requests and pushes to a small set of named branches (`main`, `workflowhub`, and a few others). Builds the full Docker Compose stack (`docker-compose.yml` + `docker-compose.build.yml`), waits 2 minutes for workers to start, then runs `script/check_deployment.rb` to verify the app is responding correctly.

### `ansible-install.yml` — Ansible installer test

Runs only on pushes to the `ansible` and `full-test-suite` branches (or manually via `workflow_dispatch`). Tests the Ansible-based production installer on both Ubuntu 22.04 and Ubuntu 24.04. It patches the playbook for a local `localhost` connection, installs SEEK via Ansible, configures the database, then runs all three Minitest suites. `continue-on-error: true` on the matrix job means a separate `fail-on-any-os` job is used to correctly fail the workflow if any OS run fails.

## Common Gotchas

**Test order dependency.** `Minitest::Test.i_suck_and_my_tests_are_order_dependent!` is set globally. Failures in one test can affect subsequent ones if state leaks through fixtures or class-level variables.

**Admin person.** `setup :create_initial_person` runs before every test and creates an admin `Person`. This prevents certain authorization paths from hitting nil user checks — don't rely on there being no admin in the database.

**Authorization in factories.** Records built with FactoryBot bypass the policy system. If you write setup code manually (not using FactoryBot), wrap it in `disable_authorization_checks { }` so authorization errors don't interfere with test setup.

**Virtuoso for integration tests.** The `test/integration` suite requires the Virtuoso RDF store. CI provides it automatically; locally you need a running Virtuoso instance configured via `test/config/virtuoso_test_settings.yml`.

**Large test files.** Some controller test files are very large (e.g. `data_files_controller_test.rb` is ~185 KB). Run a specific test by name with `-n` when iterating on a single case.

## Key Files

| File | Purpose |
|---|---|
| `test/test_helper.rb` | Framework config, VCR, WebMock, fixture class mapping, shared helpers |
| `test/api_test_helper.rb` | JSON API assertions, OpenAPI validation, OAuth token helpers |
| `test/authenticated_test_helper.rb` | `login_as`, `logout`, `authorize_as` |
| `test/mock_helper.rb` | Stubs for DataCite, Zenodo, DOI, PubMed, ROR |
| `test/general_authorization_test_cases.rb` | Reusable authorization test patterns |
| `test/factories/` | FactoryBot factory definitions |
| `test/fixtures/` | YAML fixtures and upload files |
| `test/vcr_cassettes/` | Recorded HTTP interactions |
| `.github/workflows/tests.yml` | CI matrix and service definitions |
| `test/config/` | Per-database CI config files |
