---
title: Git Versioning Backend
description: Architecture and internals of SEEK's git-based versioning system for Workflows and other assets.
categories: [Architecture, Git]
---

# Git Backend Developer Documentation

FAIRDOM-SEEK uses a git-based versioning system for Workflows (and any future assets that opt in). Each resource gets a local bare git repository on disk, with git commits tracking file changes. Versions are references (branches or tags) into that repository, and metadata (annotations, visibility, DOI) is stored in database records alongside the git history.

---

## High-Level Architecture

```mermaid
graph TD
    WF[Workflow model]
    GV[Git::Version\ngit_versions table]
    GR[Git::Repository\ngit_repositories table]
    GA[Git::Annotation\ngit_annotations table]
    FS[Filesystem\nbare .git repo]
    REMOTE[Remote git URL\ne.g. GitHub]

    WF -->|has_one :local_git_repository| GR
    WF -->|has_many :git_versions| GV
    GV -->|belongs_to| GR
    GV -->|has_many| GA
    GR -->|uuid → path on disk| FS
    GR -->|optional remote field| REMOTE
    REMOTE -->|RemoteGitFetchJob clones/fetches| FS
```

---

## Core Classes

### `Git::Repository` (`app/models/git/repository.rb`)

Represents the git repository for a resource. One repository per resource (polymorphic `resource_type` / `resource_id`). Wraps a Rugged::Repository.

Key responsibilities:
- Tracks whether the repo has a remote URL (`remote` column)
- Exposes `local_path` → `{git_filestore_path}/{uuid}/.git`
- `git_base` → returns a `Rugged::Repository` instance
- `resolve_ref(ref)` → returns commit SHA for a branch or tag name
- `remote_refs` → returns metadata for all refs (for the "import from remote" UI)
- `fetch` / `queue_fetch` → triggers `RemoteGitFetchJob` for remote repos

### `Git::Version` (`app/models/git/version.rb`)

One row per version of the resource. Combines a git ref/commit with metadata. Includes `Git::Operations` for all file-level work.

Key columns:

| Column | Purpose |
|---|---|
| `ref` | Git reference, e.g. `refs/heads/main`, `refs/tags/v1.0` |
| `commit` | Resolved commit SHA (set on save) |
| `mutable` | `true` = editable; `false` = frozen |
| `visibility` | `:public`, `:registered_users`, or `:private` |
| `root_path` | Optional subdirectory within the repo to treat as root |
| `resource_attributes` | JSON snapshot of parent resource attributes at this version |
| `doi` | DOI minted for this version (frozen versions only) |

Key methods:
- `lock` — creates an immutable git tag and sets `mutable = false`
- `next_version` — creates a new mutable version branching from this one
- `add_file(path, io, message)`, `remove_file`, `move_file` — file operations via `Git::Operations`
- `get_blob(path)` / `get_tree(path)` — access files and directories
- `ro_crate?` — returns true if repo contains `ro-crate-metadata.json(ld)`

### `Git::Blob` (`app/models/git/blob.rb`)

Represents a single file within a git version. Wraps a Rugged blob. Handles both locally-committed content and external remote files (registered via `remote_source` annotation).

- `file_contents(as_text, fetch_remote)` — reads content; optionally fetches remote URLs
- `remote?` / `fetched?` — status of externally-referenced files
- `annotations` — returns annotation records for this path

### `Git::Tree` (`app/models/git/tree.rb`)

Represents a directory within a git version. Provides `blobs`, `trees`, `walk_blobs`, `walk_trees`, and `total_size`.

### `Git::Annotation` (`app/models/git/annotation.rb`)

Key/value metadata attached to a file path within a specific `Git::Version`. Used to mark special files.

Built-in annotation keys used for Workflows:

| Key | Purpose |
|---|---|
| `main_workflow` | Path of the primary workflow file |
| `diagram` | Path of the workflow diagram image |
| `abstract_cwl` | Path of the abstract CWL description |
| `remote_source` | External URL for a file (content fetched separately) |

---

## Module Breakdown

### `Git::Versioning` (`lib/seek/git/versioning.rb` / `lib/git/versioning.rb`)

Class-level DSL. Call `git_versioning(options) { ... }` in a model class to enable git versioning. This:
- Creates a nested `ModelName::Git::Version` class (e.g. `Workflow::Git::Version`)
- Adds `has_many :git_versions` and `has_one :local_git_repository` to the model
- Adds `git_version`, `latest_git_version`, `find_git_version`, `save_as_new_git_version` instance methods
- Accepts `sync_ignore_columns:` — attributes excluded from the JSON snapshot (e.g. `test_status` for Workflow)

### `Git::Operations` (`lib/git/operations.rb`)

Included into `Git::Version`. All file-manipulation and tree-navigation methods live here. Uses Rugged directly to create commits, write blobs, and build trees. Key internals:
- `perform_commit(tree_oid, message)` — low-level commit creation via Rugged
- `object(path)` — resolves a path within the repo to a Rugged object
- `in_dir` / `in_temp_dir` — checks out the version into a temporary directory for operations that need a working tree

### `Git::VersioningCompatibility` (`lib/git/versioning_compatibility.rb`)

Adapter that lets the rest of the codebase treat git-versioned and traditionally-versioned resources identically. Methods like `versions`, `version`, `latest_version` delegate to either `git_versions` or `standard_versions` based on `is_git_versioned?`.

### `Git::DoiCompatibility` (`lib/git/doi_compatibility.rb`)

Adapter that maps DOI minting onto the git versioning system so the existing DOI infrastructure works for frozen git versions.

### `Git::Converter` (`lib/git/converter.rb`)

One-way migration tool. Converts a resource that was using the traditional ContentBlob versioning system to the git backend. Creates a `Git::Version` for each existing version, importing file content and preserving metadata. Used when upgrading existing Workflow records.

---

## Lifecycle of a Workflow Version

```mermaid
sequenceDiagram
    participant User
    participant WorkflowController
    participant GitVersion as Git::Version
    participant GitRepo as Git::Repository
    participant Rugged
    participant FS as Filesystem

    User->>WorkflowController: Create workflow (upload files)
    WorkflowController->>GitRepo: create local_git_repository
    GitRepo->>FS: mkdir {uuid}/.git (bare init)
    WorkflowController->>GitVersion: create (mutable, ref=refs/heads/main)
    WorkflowController->>GitVersion: add_file(path, io, "Initial commit")
    GitVersion->>Rugged: write blob, build tree, commit
    Rugged->>FS: write objects to bare repo

    User->>WorkflowController: Edit version (add/replace file)
    WorkflowController->>GitVersion: add_file / remove_file / move_file
    GitVersion->>Rugged: new commit on branch
    Rugged->>FS: objects appended

    User->>WorkflowController: Freeze version
    WorkflowController->>GitVersion: lock()
    GitVersion->>Rugged: create immutable tag (refs/tags/...)
    GitVersion->>GitVersion: mutable = false

    User->>WorkflowController: New version (from frozen)
    WorkflowController->>GitVersion: next_version()
    GitVersion-->>GitVersion: new mutable Git::Version (new branch)
```

---

## Remote Repository Flow

```mermaid
sequenceDiagram
    participant User
    participant GitWizard as GitWorkflowWizard
    participant GitRepo as Git::Repository
    participant FetchJob as RemoteGitFetchJob
    participant FS as Filesystem
    participant GitVersion as Git::Version

    User->>GitWizard: Submit remote git URL + branch/tag
    GitWizard->>GitRepo: create with remote=URL
    GitRepo->>FetchJob: queue_fetch
    FetchJob->>FS: git clone --bare URL → {uuid}/.git
    GitRepo->>GitVersion: create (immutable, ref=selected ref)
    GitWizard->>GitWizard: parse RO-Crate metadata (if present)
    GitWizard->>GitVersion: annotate main_workflow, diagram, abstract_cwl
    FetchJob->>GitRepo: update last_fetch timestamp
```

Remote versions are always immutable (`mutable: false`) since they are snapshots of an external repo at a point in time.

---

## File Storage

```
{Seek::Config.git_filestore_path}/
└── {uuid}/
    └── .git/          ← bare git repository (Rugged operates directly here)
        ├── HEAD
        ├── objects/
        ├── refs/
        └── ...
```

The `uuid` is generated when the `Git::Repository` record is first created. The path is derived at runtime from `Seek::Config.git_filestore_path` (a configurable admin setting), so it can be on any mount.

---

## Database Schema

```mermaid
erDiagram
    git_repositories {
        int id PK
        string resource_type
        int resource_id
        string uuid
        text remote
        datetime last_fetch
    }

    git_versions {
        int id PK
        string resource_type
        int resource_id
        int git_repository_id FK
        int version
        string name
        string comment
        string ref
        string commit
        boolean mutable
        string root_path
        int visibility
        string doi
        int contributor_id FK
        mediumtext resource_attributes
    }

    git_annotations {
        int id PK
        int git_version_id FK
        int contributor_id FK
        string path
        string key
        string value
    }

    git_repositories ||--o{ git_versions : "has_many"
    git_versions ||--o{ git_annotations : "has_many"
```

---

## Authorization and Visibility

`Git::Version` has its own `visibility` field independent of the parent resource's policy:

- `:public` — anyone (including non-logged-in users)
- `:registered_users` — logged-in SEEK members
- `:private` — only resource managers

The parent resource's `PolicyBasedAuthorization` still gates overall access; version visibility is an additional layer applied per-version. Frozen versions with a minted DOI cannot have their visibility downgraded.

`GitController` enforces:
- Read operations: parent resource must be `downloadable?` by the current user
- Write/edit operations: parent resource must be `can_edit?` by the current user
- Frozen versions raise `Git::ImmutableVersionException` on any write attempt

---

## Background Jobs

| Job | Queue | Purpose |
|---|---|---|
| `RemoteGitFetchJob` | `REMOTE_CONTENT` | Clones or fetches a remote git URL into the local bare repo; updates `last_fetch` |
| `RemoteGitContentFetchingJob` | `REMOTE_CONTENT` | Downloads the actual byte content for files registered with a `remote_source` annotation; retries up to 3× |

---

## Enabling Git Versioning on a Model

Only `Workflow` currently uses git versioning, but the mechanism is generic. To enable it on another model:

```ruby
class MyAsset < ApplicationRecord
  git_versioning(sync_ignore_columns: ['some_transient_column']) do
    # optional: extend the generated MyAsset::Git::Version class here
  end
end
```

This single call wires up:
- `has_one :local_git_repository`
- `has_many :git_versions`
- All version-navigation helpers (`git_version`, `latest_git_version`, etc.)
- The compatibility shim so existing `versions`/`version` call sites keep working

---

## RO-Crate Integration

When a workflow is imported from a remote git URL (or uploaded as an RO-Crate zip), `GitWorkflowWizard` parses `ro-crate-metadata.json(ld)` to extract:
- The main workflow file path → stored as `main_workflow` annotation
- The diagram image path → `diagram` annotation
- The abstract CWL path → `abstract_cwl` annotation
- The programming language → used to set the `WorkflowClass` on the Workflow record

`Git::Version#ro_crate?` returns `true` if the version contains one of these metadata files, enabling the UI to show the RO-Crate structured view.

---

## Key Exception Classes

| Exception | When raised |
|---|---|
| `Git::ImmutableVersionException` | Any write operation on a frozen (`mutable: false`) version |
| `Git::PathNotFoundException` | `get_blob` / `get_tree` called with a path that doesn't exist in the commit |
| `Git::InvalidPathException` | Path contains illegal characters or traversal sequences |
