---
title: JSON API
description: SEEK's JSON:API-compliant REST API — structure, serializers, authentication, request/response patterns, and how to add new endpoints.
categories: [Architecture, Reference]
---

SEEK exposes a [JSON:API](https://jsonapi.org) compliant REST API. All HTML controllers also serve JSON — there is no separate API namespace. The current API version is **0.3**, returned in every response's `meta` object.

## Request and Response Format

Requests and responses follow the JSON:API specification:

```
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json
```

### Response envelope

```json
{
  "data": {
    "id": "42",
    "type": "data_files",
    "attributes": {
      "title": "My dataset",
      "description": "...",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "relationships": {
      "projects": {
        "data": [{ "id": "1", "type": "projects" }]
      }
    },
    "links": { "self": "/data_files/42" }
  },
  "meta": {
    "base_url": "https://fairdomhub.org",
    "api_version": "0.3"
  }
}
```

List responses wrap `data` in an array and add `links` for pagination:

```json
{
  "data": [...],
  "meta": { "base_url": "...", "api_version": "0.3" },
  "links": {
    "self": "/data_files?page=1&per_page=25",
    "next": "/data_files?page=2&per_page=25"
  }
}
```

## Authentication

Three authentication schemes are supported.

### API Token (recommended for scripts)

Generate tokens at *My Profile → Actions → API Tokens*. Tokens are 40-character URL-safe Base64 strings; only a SHA256 hash is stored in the database.

```
Authorization: Token <api_token_value>
```

Failed lookups in production incur a 2-second delay to slow brute-force attempts.

**Key files:** `app/models/api_token.rb`, `User.from_api_token` in `app/models/user.rb`

### HTTP Basic Auth

```
Authorization: Basic base64(login:password)
```

Useful for quick scripting and development.

### OAuth2 (Doorkeeper)

For applications acting on behalf of users. Authorise at `/oauth/authorize`, exchange code for token at `/oauth/token`.

Scopes:
- `read` — view, download, list
- `write` — create, update, delete

OAuth clients cannot call non-API controller actions — they receive a `403` for HTML-only routes.

### Unauthenticated access

`GET` (list and show) endpoints work without authentication and return only publicly visible objects.

## Controllers

SEEK has no separate `api/` controller namespace. Each resource controller serves both HTML and JSON. API support is declared with:

```ruby
api_actions :index, :show, :create, :update, :destroy
```

This registers the allowed HTTP verbs for API access. A controller must also `respond_to :json` to serve JSON responses.

The base pipeline for a list (`index`) action, handled by `Seek::IndexPager`:

1. Parse `page`, `per_page`, `sort`, `filter` params
2. Fetch the base collection
3. Filter by authorization (current user's view permission)
4. Apply `filter` criteria
5. Apply `sort`
6. Paginate
7. Serialize with `SkeletonSerializer`

## Serializers

Serializers live in `app/serializers/` and use the `active_model_serializers` gem configured with the JSON:API adapter.

```ruby
# config/initializers/active_model_serializers.rb
ActiveModelSerializers.config.adapter = ActiveModelSerializers::Adapter::JsonApi
ActiveModelSerializers.config.key_transform = :unaltered
```

### Hierarchy

```
ActiveModel::Serializer
  └─ SimpleBaseSerializer      # id, title, type, timestamps
      └─ BaseSerializer        # + policy, tags, extended_attributes, submitter
          ├─ AvatarObjSerializer
          ├─ ContributedResourceSerializer   # + creators, projects, license, doi
          │   ├─ SnapshottableSerializer     # + versions, snapshots (ISA models)
          │   │   ├─ InvestigationSerializer
          │   │   ├─ StudySerializer
          │   │   └─ AssaySerializer
          │   ├─ DataFileSerializer
          │   ├─ WorkflowSerializer
          │   └─ ...
          └─ SkeletonSerializer  # lightweight — used for list responses only
```

### Declaring a serializer

```ruby
class DataFileSerializer < ContributedResourceSerializer
  attributes :title, :description, :license, :version

  has_many :projects
  has_many :people
  has_one  :sample_type

  attribute :content_blobs do
    object.content_blobs.map do |blob|
      { original_filename: blob.original_filename,
        url: blob.url,
        content_type: blob.content_type,
        size: blob.file_size,
        md5sum: blob.md5sum }
    end
  end

  attribute :tags, if: :show_tags? do
    serialize_annotations(object, 'tag')
  end
end
```

Conditional attributes use `if: :method_name` or `if: -> { ... }`. The serializer instance is in scope, so `object` returns the model being serialized and `current_user` is available via `scope`.

### List vs show serializers

For performance, list (`index`) responses use `SkeletonSerializer`, which only includes `id`, `type`, `title`, and `links`. Full serializers are used for `show`, `create`, `update`.

## Request Parameters

### Filtering

```
GET /data_files?filter[project_id]=1&filter[tag]=genomics
```

Available filter keys per resource are defined in `Seek::Filterer`. Common ones: `project_id`, `investigation_id`, `study_id`, `assay_id`, `tag`, `organism`, `creator_id`.

### Sorting

```
GET /data_files?sort=title           # ascending
GET /data_files?sort=-created_at     # descending
GET /data_files?sort=title,-updated_at  # multi-sort
```

### Pagination

```
GET /data_files?page=2&per_page=25
```

`page=all` returns every resource in one response (use with caution on large collections).

### Including relationships

```
GET /data_files/42?include=projects,people,assays
```

This triggers eager loading of the named associations and embeds them in the `included` top-level key of the response.

## Request Body — Parameter Conversion

Incoming JSON:API `POST`/`PATCH` bodies are converted from JSON:API format to Rails-style parameters by `Seek::Api::ParameterConverter` before reaching controller actions.

Input:
```json
{
  "data": {
    "type": "data_files",
    "attributes": {
      "title": "My File",
      "tags": ["genomics", "proteomics"]
    },
    "relationships": {
      "projects": { "data": [{ "id": "1", "type": "projects" }] }
    }
  }
}
```

After conversion:
```ruby
{ data_file: { title: "My File", tag_list: "genomics, proteomics",
               project_ids: ["1"] } }
```

Key conversions:
- `tags` array → `tag_list` string
- Relationship `data` arrays → `*_ids` arrays
- `policy` object → nested `policy_attributes` hash
- `content_blobs` array → `content_blobs_attributes`

### Validation rules

- `POST` must **not** include an `id`
- `PATCH` must include an `id` matching the URL and a `type` matching the resource

## Error Responses

Errors follow JSON:API format with a `source.pointer` indicating the offending field:

```json
{
  "errors": [
    {
      "source": { "pointer": "/data/attributes/title" },
      "detail": "can't be blank"
    },
    {
      "source": { "pointer": "/data/relationships/projects" },
      "detail": "must have at least one project"
    }
  ]
}
```

Common HTTP status codes:

| Status | When |
|---|---|
| `200 OK` | Successful GET or PATCH |
| `201 Created` | Successful POST |
| `204 No Content` | Successful DELETE |
| `400 Bad Request` | Malformed JSON or invalid params |
| `401 Unauthorized` | Invalid or missing credentials |
| `403 Forbidden` | Authenticated but not authorized |
| `404 Not Found` | Resource doesn't exist or isn't visible |
| `422 Unprocessable Entity` | Validation errors |

## OpenAPI Specification

The machine-readable API description lives in `public/api/definitions/`:

| File | Purpose |
|---|---|
| `openapi-v3.yml` | Source spec (uses `$ref` includes) |
| `openapi-v3-resolved.json` | Fully de-referenced copy (for clients) |
| `_paths.yml` | Path/operation definitions |
| `_schemas.yml` | Request/response schema definitions |
| `descriptions/` | Markdown descriptions for individual resources |

The resolved spec is what API documentation tools and conformance tests consume.

## Adding a New API Endpoint

### 1. Declare API actions in the controller

```ruby
class WidgetsController < ApplicationController
  include Seek::IndexPager
  include Seek::AssetsCommon

  api_actions :index, :show, :create, :update, :destroy
  respond_to :html, :json

  def show
    respond_to do |format|
      format.json { render json: @widget, include: params[:include] }
    end
  end

  def create
    @widget = Widget.new(widget_params)
    if @widget.save
      render json: @widget, status: :created
    else
      render json: json_api_errors(@widget), status: :unprocessable_entity
    end
  end

  private

  def widget_params
    params.require(:widget).permit(:title, :description, { project_ids: [] })
  end
end
```

### 2. Create a serializer

```ruby
# app/serializers/widget_serializer.rb
class WidgetSerializer < ContributedResourceSerializer
  attributes :title, :description

  has_many :projects
  has_many :people
end
```

For list responses, add a corresponding `WidgetSkeletonSerializer < SkeletonSerializer` if the default skeleton fields are insufficient.

### 3. Register routes

```ruby
# config/routes.rb
resources :widgets
```

### 4. Add a parameter converter entry

If the resource has non-standard attributes (tags, policies, blobs), add a converter rule in `lib/seek/api/parameter_converter.rb` to handle the mapping from JSON:API to Rails params.

### 5. Update the OpenAPI spec

Add path entries to `public/api/definitions/_paths.yml` and schema definitions to `_schemas.yml`. After editing, regenerate the resolved spec:

```bash
bundle exec rake api:spec:resolve
```

### 6. Write integration tests

Tests live in `test/integration/api/`. Include the shared test suites:

```ruby
class WidgetApiTest < ActionDispatch::IntegrationTest
  include ReadApiTestSuite
  include WriteApiTestSuite

  def setup
    @widget = FactoryBot.create(:widget)
  end
end
```

`ReadApiTestSuite` covers index/show/include/filter. `WriteApiTestSuite` covers create/update/delete, authorization checks, and validation error formatting.

## Notable Behaviours

**Content blobs on POST.** To create an asset with an uploaded file, POST with `content_blobs` containing a `original_filename` and `content_type`. A pre-signed upload URL is returned; the client PUTs the file bytes there, then the blob is associated.

**Versioned resources.** `show` responses for versioned assets (DataFile, Sop, Model, etc.) include a `versions` array with URLs and revision comments. Pass `?version=N` to retrieve a specific version.

**Policy in responses.** For resources the current user can manage, the response includes a `policy` object with the current access level and any per-project/per-person overrides. See [Authorization and Policy System](../authorization/).

**Extended metadata.** Resources with extended metadata return an `extended_attributes` object with `extended_metadata_type_id` and an `attribute_map` hash. See [Extended Metadata](../extended-metadata-architecture/).

**Timed access codes.** View and download actions accept a `?code=` parameter that grants time-limited access to a resource without authentication. Codes are generated via `asset.generate_auth_code`.

## Key Files

| File | Purpose |
|---|---|
| `app/serializers/base_serializer.rb` | Shared attributes: policy, tags, timestamps, extended metadata |
| `app/serializers/contributed_resource_serializer.rb` | Shared: creators, projects, license, DOI |
| `app/serializers/skeleton_serializer.rb` | Lightweight serializer for list responses |
| `app/models/api_token.rb` | API token model — generation and lookup |
| `lib/authenticated_system.rb` | `user_from_api_token`, `user_from_basic_auth`, `user_from_doorkeeper` |
| `lib/seek/index_pager.rb` | Index action — pagination, filtering, sorting |
| `lib/seek/filterer.rb` | Per-resource filter definitions |
| `lib/seek/api/parameter_converter.rb` | JSON:API → Rails param translation |
| `config/initializers/active_model_serializers.rb` | AMS adapter and version config |
| `public/api/definitions/openapi-v3.yml` | API specification source |
| `test/api_test_helper.rb` | Shared API test helpers and suites |
