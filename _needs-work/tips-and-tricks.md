---
title: Tips, Tricks and Gotchas
description: Non-obvious patterns, common pitfalls, and useful console and debug techniques for working in the SEEK codebase.
categories: [Getting Started, Reference]
---

A collection of things that aren't obvious from reading the code, or that catch developers out more than once.

## Rails console

### Setting the current user

SEEK tracks the current user in thread-local storage (`Thread.current[:current_user]`), not in the request session. In the console or in jobs, `User.current_user` is `nil` by default, which means permission checks run as an anonymous visitor.

To run code as a specific user:

```ruby
User.with_current_user(User.find(1)) do
  df = DataFile.find(42)
  df.update!(title: 'Updated title')
end
```

`with_current_user` saves and restores the previous value, so it nests safely.

You can also assign it directly for a whole session:

```ruby
User.current_user = User.find(1)
```

### Bypassing authorization checks

`disable_authorization_checks` is available everywhere (it's mixed into `Object`). It sets a thread-local flag that causes all `can_view?` / `can_edit?` etc. calls to return `true`:

```ruby
disable_authorization_checks do
  df = DataFile.find(42)
  df.update!(title: 'Fixed title')
end
```

Useful in console, rake tasks, and seed scripts. The flag is thread-local (`Thread.current[:authorization_checks_disabled]`), so it does not affect other threads — but it does affect *everything* the current thread does inside the block, so keep the block as small as possible.

### Checking permissions

```ruby
df = DataFile.find(1)
user = User.find(2)

df.can_view?(user)      # checks auth lookup table first, falls back to full evaluation
df.can_edit?(user)
df.can_manage?(user)
df.can_download?(user)
df.can_delete?(user)
```

If `auth_lookup_enabled` is true (the default), these hit the `data_file_auth_lookup` table for speed. If that table is stale (e.g. after a policy change in the console), you may get wrong results — see [Auth lookup is stale after console changes](#auth-lookup-is-stale-after-console-changes) below.

### Navigating versions

`DataFile.find(1)` returns the parent record, which always reflects the current version. To access a specific version:

```ruby
df = DataFile.find(1)
df.version                 # current version number
df.versions                # all version records
df.latest_version          # the latest Version object
df.find_version(2)         # Version 2 of df
```

The `content_blob` association on a parent is scoped to the current version. To get a blob from an older version, go through the version record:

```ruby
df.find_version(2).content_blob
```

### Inspecting failed background jobs

`ApplicationJob` reports and swallows exceptions, so most failing SEEK jobs *finish* as far as Solid Queue is concerned — check the log first. Jobs that do fail (mailer deliveries, recurring `command:` entries, exhausted `retry_on`, crashed workers) can be inspected in the Mission Control dashboard at `/jobs`, or in the console:

```ruby
SolidQueue::FailedExecution.last.error          # exception_class, message, backtrace
SolidQueue::Job.failed.count                     # number of failures
SolidQueue::ClaimedExecution.count               # currently running
SolidQueue::Job.where(finished_at: nil).group(:queue_name).count  # backlog per queue
```

To re-queue a failed job:

```ruby
SolidQueue::Job.failed.last.retry
```

---

## Common gotchas

### Auth lookup is stale after console changes

If you change a `Policy` or a project membership in the console without going through the normal controller path, the auth lookup tables won't update automatically — they're updated by `AuthLookupUpdateJob`, which is only queued by `after_commit` hooks triggered in normal request handling.

After a console change, either use `disable_authorization_checks` for your checks, or rebuild the tables:

```bash
bundle exec rake seek:repopulate_auth_lookup_tables_sync  # synchronous rebuild
bundle exec rake seek:repopulate_auth_lookup_tables       # async via background jobs
```


### `FactoryBot.create` bypasses authorization checks

`test/factories.rb` wraps `FactoryBot.create` and `FactoryBot.build` in `disable_authorization_checks`. This means factories always succeed regardless of the current user or policy — handy for test setup, but it means factories aren't testing authorization behaviour.

### `Model` has `has_many :content_blobs`, not `has_one`

Every asset has `has_one :content_blob` except `Model`, which can have multiple files per version and uses `has_many :content_blobs`. Code that assumes `asset.content_blob` will return a single blob will raise `NoMethodError` on a `Model` record — use `asset.single_content_blob` (returns nil for multi-blob assets) or `asset.content_blobs`.

### `update_column` and `update_columns` bypass validations and all callbacks

Using `update_column` / `update_columns` skips validations and all callbacks, including:
- `after_commit :queue_rdf_generation` — RDF won't be regenerated
- `after_commit :queue_auth_lookup_update_job` — auth lookup won't update
- `after_save` reindexing — Solr won't see the change

This is sometimes exactly what you want for bulk fixes in the console. Just remember to manually queue the follow-up jobs if needed:

```ruby
item.queue_rdf_generation
AuthLookupUpdateQueue.enqueue(item)
item.class.solr_index_buffer << item.id   # or use the rake task
```

### `Seek::Config` changes may need a cache clear

Config values are cached per-request via `RequestStore`. In a Rails request this is transparent, but in the console or tasks, if you change a config value and then read it back in the same process, you may get the cached value:

```ruby
Seek::Config.site_base_host = 'https://example.org'
Seek::Util.clear_cached   # force the cache to be rebuilt on next read
```

The test helper `with_config_value` handles this automatically.

### `schema.rb` reflects your database, not just your migrations

`db/schema.rb` is auto-generated by Rails from your actual database structure after each migration. It reflects the state of whichever database your development environment is pointed at — not just what the migration files say. This means if your database has drifted (because you previously ran migrations from another branch, or made manual changes via MySQL), those differences will show up in `schema.rb` even if you haven't touched any migration files.

This catches people out most often when switching between branches that have different migrations. Running `db:migrate` on a feature branch modifies your database, and switching back to `main` and regenerating the schema will produce a `schema.rb` that includes those changes — leading to accidental commits of unrelated schema noise.

**Recommended practices:**

- Keep separate databases for `main` and your main release branch (e.g. `main_development` and `release_development` in `config/database.yml`).
- When working on a feature branch with new migrations, roll back before switching away: `bundle exec rake db:rollback STEP=N`.
- When committing a `schema.rb` change after a migration, diff it carefully and revert any changes unrelated to your migration — but always keep the updated `version` timestamp at the top. RubyMine's Commits panel (the vertical tab on the left) makes this easy with its per-hunk staging interface.

---

## Useful rake tasks

| Task | What it does |
|---|---|
| `seek:repopulate_auth_lookup_tables` | Queues background jobs to rebuild all auth lookup tables |
| `seek:repopulate_auth_lookup_tables_sync` | Rebuilds auth lookup tables synchronously (slow on large instances) |
| `seek:reindex_all` | Queues background jobs to reindex all models in Solr |
| `seek:clear_filestore_tmp` | Removes temp files from `filestore/tmp/` |
| `jobs:workoff` | Runs all ready jobs in the foreground, then exits — useful in development to avoid running a separate worker process (`QUEUES=a,b` to restrict) |
| `jobs:check` | Exits non-zero if any job has been due for longer than 300s (or the given argument) |

Run with `bundle exec rake <task>`. To see all available tasks with descriptions, run `bundle exec rake -T` (add a grep to filter: `bundle exec rake -T seek`).

---

## Test patterns

### Temporarily override a config value

```ruby
with_config_value(:solr_enabled, true) do
  # Solr is "enabled" inside this block
  get :index, params: { q: 'search term' }
end
# restored to original value
```

Multiple values at once:

```ruby
with_config_values(project_creation_enabled: false, email_enabled: false) do
  # ...
end
```

### Create test data that needs a project and contributor

Most asset factories include the `:with_project_contributor` trait, which wires up a `Person` and a `Project` automatically:

```ruby
df = FactoryBot.create(:data_file)           # has a contributor and project
df.contributor                               # a Person
df.projects                                  # [a Project]
```

To use a specific contributor:

```ruby
person = FactoryBot.create(:person)
df = FactoryBot.create(:data_file, contributor: person, projects: person.projects)
```

### Count database changes

```ruby
assert_difference('DataFile.count', 1) do
  post :create, params: { ... }
end

assert_no_difference('ContentBlob.count') do
  delete :destroy, params: { id: df.id }
end
```

### Log in as a fixture user or factory user

```ruby
login_as(:datafile_owner)          # fixture symbol (test/fixtures/users.yml)
login_as(FactoryBot.create(:user)) # factory user
login_as(person)                   # Person — resolves to person.user
```
