---
title: Background Jobs
description: SEEK's Delayed::Job-based background processing system — queues, job classes, scheduling, and worker management.
categories: [Architecture, Reference]
---

SEEK uses [Delayed::Job](https://github.com/collectiveidea/delayed_job) with an ActiveRecord backend. Jobs are stored in the `delayed_jobs` database table and processed by a pool of worker processes, one per named queue. ActiveJob provides the common interface.

## Configuration

Key settings in `config/initializers/delayed_job_config.rb`:

| Setting | Value | Effect |
|---|---|---|
| `max_attempts` | 1 | No automatic retries — a job that raises an exception fails immediately |
| `max_run_time` | 1 day | Hard timeout before a locked job is considered dead |
| `destroy_failed_jobs` | false | Failed jobs are kept in the database for inspection |
| `sleep_delay` | 3s (production) | How long a worker sleeps between polls when the queue is empty |

## Named Queues

Queue names are defined in `QueueNames` (`app/jobs/queue_names.rb`):

| Constant | Name | Purpose |
|---|---|---|
| `DEFAULT` | `default` | General-purpose fallback |
| `MAILERS` | `mailers` | Email delivery |
| `AUTH_LOOKUP` | `authlookup` | Authorization table rebuilds |
| `INDEXING` | `indexing` | Solr reindexing |
| `REMOTE_CONTENT` | `remotecontent` | Remote file and git fetching |
| `SAMPLES` | `samples` | Sample extraction, persistence, and template generation |
| `DATAFILES` | `datafiles` | Data file unzipping |
| `TEMPLATES` | `templates` | ISA template extraction |

Workers are only started for queues whose feature is enabled. `MAILERS` and `DEFAULT` are always active. The others depend on configuration:

| Queue | Required config |
|---|---|
| `AUTH_LOOKUP` | `Seek::Config.auth_lookup_enabled` |
| `INDEXING` | `Seek::Config.solr_enabled` |
| `REMOTE_CONTENT` | `Seek::Config.cache_remote_files` |
| `SAMPLES` | `Seek::Config.samples_enabled` |
| `DATAFILES` | `Seek::Config.data_files_enabled` |
| `TEMPLATES` | `Seek::Config.isa_json_compliance_enabled` |

## Job Class Hierarchy

### `ApplicationJob`

All jobs inherit from `ApplicationJob`, which inherits from `ActiveJob::Base`. It provides:

- **Default queue:** `QueueNames::DEFAULT`
- **Default priority:** 2
- **Timeout:** wraps `perform` in `Timeout.timeout(timelimit)` — default 15 minutes, overridable per job
- **Error handling:** `rescue_from(Exception)` catches all exceptions and forwards them to `Seek::Errors::ExceptionForwarder`. Re-raises in test mode. Silently ignores `ActiveRecord::RecordNotFound` deserialisation errors (the target record was deleted before the job ran).
- **Follow-on jobs:** after each `perform`, checks `follow_on_job?` — if true, re-enqueues itself. Used for continuous draining of queue tables.

### `TaskJob`

For long-running operations that need visible progress tracking. Maintains a `Task` record with states `QUEUED → ACTIVE → DONE / FAILED`. Each subclass must implement `task` returning the associated `Task` instance. On failure, the task is marked `FAILED` and the error message and backtrace are stored.

Used by: `SampleDataExtractionJob`, `UnzipDataFileJob`, `RemoteGitFetchJob`, `FairDataStationImportJob`, and others.

### `BatchJob`

For processing collections of items. Subclasses implement `gather_items` and `perform_job(item)`. Per-item exceptions are caught and reported without aborting the batch. Combine with `follow_on_job?` for continuous processing.

Used by: `ReindexingJob`, `AuthLookupUpdateJob`, `RdfGenerationJob`, `OpenbisSyncJob`.

### `EmailJob`

Base for all email jobs. Ensures `Seek::Config.smtp_propagate` is called before delivery so SMTP settings are up to date.

## Job Priority

Lower numbers run first. The scale used in SEEK:

| Priority | Used by |
|---|---|
| 0 | `UserAuthLookupUpdateJob` — highest urgency |
| 1 | Auth lookup updates, subscriptions, sample type updates, template jobs |
| 2 | Default (`ApplicationJob`) |
| 3 | Maintenance, OpenBIS sync, announcements, email digests |

## Resource Queues

Several high-volume job types use an intermediary database queue table rather than enqueueing one Delayed::Job per item. Items are accumulated in the table, then a single batch job drains them.

The pattern is defined in `ResourceQueue` (`app/models/concerns/resource_queue.rb`):

```ruby
AuthLookupUpdateQueue.enqueue(items)  # accumulate
# AuthLookupUpdateJob drains BATCHSIZE items per run, then follows on

ReindexingQueue.enqueue(items)        # accumulate
# ReindexingJob drains 100 items per run

RdfGenerationQueue.enqueue(items)     # accumulate
# RdfGenerationJob drains 10 items per run
```

Enqueueing is idempotent — if an item is already in the queue table, duplicate entries are not created. A single `Delayed::Job` entry is also created (or reused) to ensure a worker picks up the queue.

## How Jobs Are Enqueued

### Direct via `perform_later`

```ruby
RemoteContentFetchingJob.perform_later(content_blob)
LifeMonitorSubmissionJob.perform_later(workflow_version)
```

### Via `queue_job` with optional priority and delay

```ruby
SampleDataExtractionJob.new(data_file, sample_type).queue_job
SampleDataExtractionJob.new(data_file, sample_type).queue_job(priority, 30.seconds)
```

### Via callbacks on models

Most jobs are triggered automatically by model callbacks:

- Item created/updated → `ReindexingQueue.enqueue`, `RdfGenerationQueue.enqueue`, `AuthLookupUpdateQueue.enqueue`
- `ContentBlob` created with a URL → `RemoteContentFetchingJob.perform_later`
- `ActivityLog` created → `ImmediateSubscriptionEmailJob.perform_later` (10-second delay)
- Workflow version saved → `LifeMonitorSubmissionJob.perform_later`
- User destroyed → `AuthLookupDeleteJob.perform_later`

### Via the scheduler

Periodic jobs are defined in `config/schedule.rb` using the `whenever` gem, which generates crontab entries:

| Frequency | Job |
|---|---|
| Every 10 min | `ApplicationJob.queue_timed_jobs` — OpenBIS cache refresh, project leaving checks |
| Every 4 hours | `RegularMaintenanceJob` — cleans dangling blobs, expired sessions, stale users |
| Every 8 hours | `AuthLookupMaintenanceJob` — consistency check on auth lookup tables |
| Daily (12:10 AM) | BioSchema data dump generation |
| Daily | `PeriodicSubscriptionEmailJob` for `daily` frequency |
| Weekly | `PeriodicSubscriptionEmailJob` for `weekly` frequency |
| Daily (1 AM) | `LifeMonitorStatusJob` — workflow test status check |

A configurable `Seek::Config.regular_job_offset` (minutes) shifts all periodic jobs to avoid simultaneous spikes.

## Worker Management

Workers are managed via rake tasks:

```bash
bundle exec rake seek:workers:start    # start one worker per active queue
bundle exec rake seek:workers:stop     # stop all workers
bundle exec rake seek:workers:restart  # restart all workers
bundle exec rake seek:workers:status   # show running workers
```

Each worker is a daemonised process watching a single named queue. PID files are written to `tmp/pids/delayed_job.N.pid`. The SEEK admin panel also exposes a "Restart Workers" action.

In Docker deployments, `docker-compose.yml` starts workers as a separate service and waits 120 seconds for them to initialise before declaring readiness.

## Failure Handling

**No automatic retries.** `max_attempts = 1` means a failed job is immediately marked failed and stays in the `delayed_jobs` table with:
- `failed_at` timestamp
- `last_error` containing the exception class, message, and backtrace

The only job with retry logic is `RemoteGitContentFetchingJob`, which uses ActiveJob's `retry_on`:

```ruby
retry_on Seek::DownloadHandling::BadResponseCodeException, wait: 1.minute, attempts: 3
```

Failed jobs can be inspected by querying `delayed_jobs` where `failed_at IS NOT NULL`. The admin panel has a "Clear Failed Jobs" action that deletes all failed records.

All exceptions are forwarded to `Seek::Errors::ExceptionForwarder` (which can be configured to send emails or post to an error tracker).

## Key Jobs

### Solr reindexing

`ReindexingJob` (queue: `indexing`) drains `ReindexingQueue` in batches of 100, calls `solr_index` on each, then commits. It follows on as long as items remain in the queue.

`ReindexAllJob` performs a full reindex of an entire model type (2-hour timeout). Triggered from the admin panel or manually.

### Auth lookup updates

`AuthLookupUpdateJob` (queue: `authlookup`, priority 1) drains `AuthLookupUpdateQueue`. For each item it either calls `update_lookup_table_for_all_users` (for an asset) or spawns `UserAuthLookupUpdateJob` instances for every active user and asset type.

`UserAuthLookupUpdateJob` (priority 0) processes 8,000 assets per run for a single (user, type) combination, recursing with an offset until all are covered.

`AuthLookupMaintenanceJob` runs every 8 hours and checks lookup table consistency, queueing repairs for any gaps it finds.

See [Authorization and Policy System](../authorization/) for why this table exists.

### RDF generation

`RdfGenerationJob` drains `RdfGenerationQueue` in batches of 10. For each item it either writes an RDF file to `{filestore_path}/rdf/` or updates the configured triple store. When `refresh_dependents` is set, related items are also queued. See [RDF Generation](../rdf-generation/) for details.

### Remote content fetching

`RemoteContentFetchingJob` (queue: `remotecontent`) calls `content_blob.retrieve`, which downloads the remote file and stores it locally. Triggered automatically when a `ContentBlob` with a URL is created.

`RemoteGitFetchJob` clones or fetches a full remote git repository. `RemoteGitContentFetchingJob` fetches individual files within a git version, with 3 retries on bad HTTP responses.

### Sample extraction

`SampleDataExtractionJob` (queue: `samples`, 30-minute timeout) parses a data file against a `SampleType` and extracts sample rows.

`SampleDataPersistJob` (60-minute timeout) saves the extracted samples to the database. These two jobs form a two-phase extract-then-persist pipeline to keep interactive response times fast.

### Subscriptions and email

`SetSubscriptionsForItemJob` auto-subscribes project members when a new item is created.

`ImmediateSubscriptionEmailJob` fires 10 seconds after an `ActivityLog` is created — the delay ensures subscriptions have been set up by `SetSubscriptionsForItemJob` first.

`PeriodicSubscriptionEmailJob` sends digest emails for `daily`, `weekly`, and `monthly` subscribers by querying recent `ActivityLog` records.

`SendAnnouncementEmailsJob` broadcasts a site announcement in batches of 50, recursing with an offset until all `NotifieeInfo` subscribers have been notified.

### Maintenance

`RegularMaintenanceJob` runs every 4 hours and performs housekeeping:
- Deletes dangling `ContentBlob` files (8-hour grace period)
- Hard-deletes soft-deleted blobs (24-hour grace period)
- Cleans up orphaned git repositories
- Resends activation emails (up to 3 attempts total)
- Removes unregistered users after 1 week

## Running Jobs in Development

### Running a single job immediately

Call `perform_now` to run a job synchronously in the foreground, bypassing the queue entirely:

```ruby
MyJob.perform_now(record)
# or on an instance:
MyJob.new(record).perform_now
```

This is useful in the Rails console to trigger and observe a job without waiting for a worker.

### Running all queued jobs once (`jobs:workoff`)

Starts a worker that processes all currently queued jobs across all queues, then exits:

```bash
bundle exec rake jobs:workoff
```

Useful after seeding or running a script that enqueues work — run it once to drain the queue.

### Running a persistent worker (`jobs:work`)

Starts a foreground worker that watches all queues and runs continuously until stopped:

```bash
bundle exec rake jobs:work
```

You can restrict it to a specific queue:

```bash
bundle exec rake jobs:work QUEUE=indexing
```

Both tasks accept `MIN_PRIORITY`, `MAX_PRIORITY`, `SLEEP_DELAY`, and `READ_AHEAD` environment variables. Use `jobs:work` instead of `seek:workers:start` when you want visible log output during development.

### Clearing the queue

```bash
bundle exec rake jobs:clear   # delete all pending jobs
```

## Adding a New Job

1. Create `app/jobs/my_job.rb` inheriting from the appropriate base:

```ruby
class MyJob < ApplicationJob
  queue_as QueueNames::DEFAULT
  queue_with_priority 2

  def perform(my_model)
    # do work
  end

  def timelimit
    30.minutes  # override if more than 15 minutes needed
  end
end
```

2. Use `TaskJob` if the operation needs progress tracking in the UI.
3. Use `BatchJob` if processing a collection with per-item error isolation.
4. Use a `ResourceQueue` model if items need deduplication before processing.
5. Enqueue with `MyJob.perform_later(record)` or `MyJob.new(record).queue_job`.

## Testing

SEEK test helpers include `ActiveJob::TestHelper`. Common patterns:

```ruby
# Assert a job was enqueued without running it
assert_enqueued_with(job: MyJob) do
  some_action_that_triggers_the_job
end

# Assert count of enqueued jobs
assert_enqueued_jobs(3, only: MyJob) do
  some_action
end

# Run enqueued jobs synchronously
perform_enqueued_jobs(only: MyJob) do
  some_action
end

# Config-gated jobs
with_config_value(:solr_enabled, true) do
  assert_enqueued_with(job: ReindexingJob) { item.save }
end
```

Jobs should generally be tested by calling `perform_now` or `new(...).perform` directly in unit tests, with `assert_enqueued_with` reserved for integration tests that verify the correct trigger.

## Key Files

| File | Purpose |
|---|---|
| `app/jobs/` | All 40+ job classes |
| `app/jobs/queue_names.rb` | Queue name constants |
| `app/jobs/application_job.rb` | Base class — timeout, error handling, follow-on |
| `app/jobs/task_job.rb` | Base for progress-tracked jobs |
| `app/jobs/batch_job.rb` | Base for collection-processing jobs |
| `app/models/concerns/resource_queue.rb` | Deduplicating queue table concern |
| `config/initializers/delayed_job_config.rb` | Delayed::Job settings |
| `config/schedule.rb` | `whenever` cron schedule |
| `lib/seek/workers.rb` | Worker start/stop logic |
| `lib/tasks/seek_workers.rake` | Worker management rake tasks |
