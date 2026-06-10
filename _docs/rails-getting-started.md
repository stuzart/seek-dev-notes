---
title: Getting Started with Rails (for SEEK)
description: Practical orientation to Ruby on Rails for developers new to the SEEK codebase, with tips and links to external resources.
categories: [Getting Started]
---

SEEK is a Rails 8.1 application running on Ruby 3.3. If you're new to Rails, this page gives a practical orientation tailored to the patterns you'll actually encounter in SEEK, along with pointers to the best external resources.

## Key concepts to learn first

Rails follows **convention over configuration** — understanding the naming and structural conventions pays off quickly, because once you know them most of the codebase becomes predictable.

The concepts that matter most in SEEK:

- **MVC** — Models (`app/models/`), Controllers (`app/controllers/`), Views (`app/views/`). In SEEK, most domain logic lives in `lib/seek/` modules that are mixed into models rather than directly in `app/models/`.
- **ActiveRecord** — Rails' ORM. Models map to database tables; associations (`has_many`, `belongs_to`, `has_one`) define relationships. SEEK makes heavy use of polymorphic associations (e.g. `ContentBlob` attaches to any asset type).
- **Concerns and modules** — Shared model behaviour is extracted into modules and mixed in with `include`. In SEEK, `acts_as_asset` and `acts_as_isa` are the two key mixins; almost every model includes one of them.
- **Migrations** — Database schema changes live in `db/migrate/`. Run `bundle exec rake db:migrate` to apply them; the current schema is always in `db/schema.rb`.
- **Routes** — `config/routes.rb` maps URLs to controller actions. SEEK uses standard `resources :data_files` REST routes for most types.
- **Background jobs** — Async work uses `delayed_job` via `ActiveJob`. Jobs are in `app/jobs/`. Start workers with `bundle exec rake seek:workers:start`.
- **Before actions** — Controllers use `before_action` hooks extensively for authentication, authorization, and loading records. The most common SEEK pattern is `before_action :find_and_authorize_requested_item`.

## Running SEEK locally

```bash
# First-time setup
bundle install
bundle exec rake db:setup          # creates DB and seeds default data

# Start the app
bundle exec rails server           # http://localhost:3000

# Start background workers (required for file uploads, emails, RDF)
bundle exec rake seek:workers:start

# In development, run all queued jobs immediately rather than waiting for workers
bundle exec rake jobs:workoff
```

## Useful Rails console tricks

The Rails console (`bundle exec rails console`) is invaluable for exploring models and testing code without a full request cycle.

```ruby
# Find a record
df = DataFile.find(1)

# Inspect associations
df.assays
df.contributors
df.content_blobs

# Check permissions
df.can_view?(User.first)
df.policy

# Try a method you're unsure about
df.to_rdf.first(500)

# Reload code after editing a file (without restarting)
reload!
```

## Running tests

```bash
# Run a single test file
bundle exec rails test test/unit/data_file_test.rb

# Run a single test by name
bundle exec rails test test/unit/data_file_test.rb -n test_validates_title

# Run all unit tests
bundle exec rails test test/unit

# Run all functional (controller) tests
bundle exec rails test test/functional

# Run all integration tests
bundle exec rails test test/integration
```

In controller tests, use `login_as(person)` (from `AuthenticatedTestHelper`) to set the current user. Use `disable_authorization_checks { ... }` in test setup when you want to create records without needing a valid policy.

## SEEK-specific patterns to know

**`Seek::Config`** — runtime configuration stored in the DB, not in YAML files. Read settings with `Seek::Config.setting_name`. The full list is in `lib/seek/config_setting_attributes.yml`.

**Feature flags** — each resource type can be toggled on/off. `Seek::Config.data_files_enabled` controls whether DataFile is active. Controllers have a generated `before_action :data_files_enabled?` that returns 404 when disabled.

**`ApplicationRecord` inclusions** — `app/models/application_record.rb` mixes in nearly all cross-cutting concerns automatically (versioning, permissions, tagging, RDF, DOIs, etc.), so every model gets them without explicitly including them.

**Auth lookup table** — permission checks don't evaluate policy records on every request. An `auth_lookup` table is maintained by `AuthLookupUpdateJob` and used for fast queries. This means a policy change is only reflected after the job runs.

## External resources

### Official Rails guides
The [Rails Guides](https://guides.rubyonrails.org/) are the best reference — well-written and kept up to date. Most useful for SEEK work:

- [Active Record Basics](https://guides.rubyonrails.org/active_record_basics.html)
- [Active Record Associations](https://guides.rubyonrails.org/association_basics.html)
- [Active Record Querying](https://guides.rubyonrails.org/active_record_querying.html)
- [Active Record Migrations](https://guides.rubyonrails.org/active_record_migrations.html)
- [Action Controller Overview](https://guides.rubyonrails.org/action_controller_overview.html)
- [Rails Routing](https://guides.rubyonrails.org/routing.html)
- [Active Job Basics](https://guides.rubyonrails.org/active_job_basics.html)

### API reference
[api.rubyonrails.org](https://api.rubyonrails.org/) — searchable API docs. Useful when you know the class or method name but not the exact signature.

### Ruby itself
If you're new to Ruby as well as Rails, [Ruby in Twenty Minutes](https://www.ruby-lang.org/en/documentation/quickstart/) and the [Ruby documentation](https://ruby-doc.org/) are good starting points. SEEK uses Ruby 3.3 — most patterns you'll encounter are standard Ruby idioms (`Enumerable`, blocks, modules, symbols).

### Testing
- [Minitest docs](https://github.com/minitest/minitest) — SEEK's primary test framework
- [FactoryBot getting started](https://github.com/thoughtbot/factory_bot/blob/main/GETTING_STARTED.md) — factories are in `test/factories/`
- [Rails testing guide](https://guides.rubyonrails.org/testing.html)

### Delayed Job
SEEK uses the [delayed_job_active_record](https://github.com/collectiveidea/delayed_job_active_record) backend. Jobs failing in development appear in the `delayed_jobs` table with a `last_error` column.
