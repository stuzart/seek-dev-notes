---
title: BioSchema and Schema.org Markup
description: How SEEK generates Schema.org and BioSchemas JSON-LD structured metadata — decorators, HTML embedding, bulk data dumps, and adding markup to new types.
categories: [Architecture, Reference]
---

SEEK embeds [Schema.org](https://schema.org) and [BioSchemas](https://bioschemas.org) JSON-LD on every resource page and exposes it as a standalone `.jsonld` endpoint. This makes SEEK resources discoverable by search engines and harvestable by life-science data catalogues.

## Architecture

The system lives entirely in `lib/seek/bio_schema/`. It uses a decorator pattern: a thin `Serializer` class picks the right decorator for a resource and calls it to produce a JSON-LD hash.

```
resource.to_schema_ld
  └─ Serializer.new(resource)
      └─ Factory → ResourceDecorators::{Type}
          ├─ schema_type           # Schema.org @type string
          ├─ conformance           # BioSchemas profile URL
          ├─ json_representation   # full hash
          └─ schema_mappings DSL   # method → property bindings
```

## Supported Types

| SEEK model | Schema.org `@type` | BioSchemas profile |
|---|---|---|
| `DataFile` | `Dataset` | Dataset 1.0-RELEASE |
| `Workflow` | `SoftwareSourceCode`, `ComputationalWorkflow` | ComputationalWorkflow 1.0-RELEASE |
| `Sop` | `LabProtocol` | — |
| `Document` | `DigitalDocument` | — |
| `Presentation` | `PresentationDigitalDocument` | — |
| `Collection` | `Collection` | — |
| `Sample` | `Sample` | Sample 0.2-RELEASE-2018 |
| `Person` | `Person` | Person 0.3-DRAFT |
| `Project` | `Project` + `Organization` | — |
| `Institution` | `ResearchOrganization` | — |
| `Programme` | `FundingScheme` | — |
| `Event` | `Event` | Event 0.3-DRAFT |
| `Organism` | `Taxon` | Taxon 1.0-RELEASE |
| `HumanDisease` | `Taxon` | Taxon 1.0-RELEASE |
| `DataCatalogMockModel` | `DataCatalog` | DataCatalog 0.3-RELEASE-2019 |

Support is declared by including `Seek::BioSchema::Support` in the model:

```ruby
class DataFile < ApplicationRecord
  include Seek::BioSchema::Support
end
```

`resource.schema_org_supported?` returns true for any model that includes the mixin and has a registered decorator.

## Decorator Hierarchy

```
BaseDecorator
  └─ Thing                  # @id, name, url, description, image, keywords
      ├─ CreativeWork        # + version, license, creator, dateCreated, DOI…
      │   ├─ DataFile
      │   ├─ Sop
      │   ├─ Document
      │   ├─ Presentation
      │   ├─ Workflow
      │   └─ Collection
      ├─ Person
      ├─ Project
      ├─ Event
      ├─ Organism / HumanDisease
      ├─ Institution
      ├─ Programme
      ├─ Sample
      └─ DataCatalog
```

### Thing properties

Every type includes these via `Thing`:

| JSON-LD property | Source |
|---|---|
| `@id` | RDF URL for the resource |
| `name` | `title` |
| `description` | stripped HTML |
| `url` | canonical URL |
| `image` | avatar URL if present |
| `keywords` | tags as comma-separated string |

### CreativeWork additional properties

| JSON-LD property | Source |
|---|---|
| `version` | version number |
| `license` | URL from `Seek::License` |
| `creator` | all creators (People + unregistered names) |
| `contributor` | uploader/contributor |
| `producer` | linked projects |
| `dateCreated`, `dateModified` | ISO8601 timestamps |
| `encodingFormat` | MIME type of content blob |
| `citation` | linked publications |
| `identifier` | DOI URL if minted |
| `datePublished` | DOI mint date |
| `isBasedOn` | previous version |
| `isPartOf` | collections this item belongs to |

### Type-specific highlights

**Workflow** — `@type` is an array `["SoftwareSourceCode", "ComputationalWorkflow"]`. Adds `programmingLanguage`, `input`/`output` as `FormalParameter` objects (with their own conformance), `documentation` (linked SOPs/documents), and `creativeWorkStatus` (maturity level).

**Sample** — `additionalProperty` is an array of `PropertyValue` objects, one per sample attribute, with `name`, `value`, `unitText`, and optional `propertyID` from ontology terms.

**DataFile** — `distribution` is a `DataDownload` object with `contentSize`, `contentUrl`, and `encodingFormat`.

**Person** — `givenName`, `familyName`, `memberOf` (projects), `worksFor` (institutions), and `identifier` (ORCID).

**DataCatalog** — a pseudo-model (`DataCatalogMockModel`) representing the whole SEEK instance, rendered on the home page. Contains `provider`, `url`, and references to all Dataset-level data dumps.

## Property Mapping DSL

Decorators declare mappings from decorator methods to Schema.org property names:

```ruby
class DataFile < CreativeWork
  schema_mappings content_blobs: :distribution,
                  other_creators: :creator
end
```

`BioSchemaAttribute` converts each method's return value:
- Strings are HTML-stripped and truncated
- `Time`/`Date` objects are ISO8601-formatted
- Arrays with no entries return `nil` (omitted from output)
- Nested hashes are passed through as-is

For related objects, the `associated_items` helper builds `mini_definition` hashes containing `@type`, `@id`, and `name`, filtering out non-public records:

```ruby
associated_items producer: :projects,
                 member_of: :institutions
```

## BioSchemas Profile Conformance

When a decorator defines `conformance`, the output includes a `dct:conformsTo` entry:

```json
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "dct:conformsTo": {
    "@id": "https://bioschemas.org/profiles/Dataset/1.0-RELEASE"
  }
}
```

## HTML Embedding

The `schema_ld_script_block` helper in `app/helpers/rdf_helper.rb` is called from `app/views/layouts/application.html.erb` inside `<head>`:

```erb
<%= schema_ld_script_block %>
```

The helper determines what to render based on the current controller and action:
- `show` action — serializes the individual resource
- `index` action on `/` (home) — renders `DataCatalogMockModel` for the whole site
- `index` action on any resource — renders a `Dataset`-type summary for that resource type

Output:

```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Dataset","@id":"..."}
</script>
```

In production, serialization errors are silently swallowed; in development they raise so problems are visible immediately.

## Standalone JSON-LD Endpoint

Every supported resource controller responds to the `.jsonld` format:

```
GET /data_files/42.jsonld
GET /people/123.jsonld
GET /workflows/7.jsonld
```

`Content-Type: application/ld+json; charset=utf-8`

The MIME type is registered in `config/initializers/mime_types.rb`:

```ruby
Mime::Type.register "application/ld+json", :jsonld,
                    ['application/vnd.schemaorg.ld+json']
```

Controllers serve it via:

```ruby
format.jsonld { render body: @data_file.to_schema_ld }
```

## Bulk Data Dumps

`Seek::BioSchema::DataDump` generates per-type JSONLD dump files containing all public records. These are regenerated nightly via the `whenever` schedule:

```ruby
# config/schedule.rb
every 1.day, at: '12:10 am' do
  runner "Seek::BioSchema::DataDump.generate_dumps"
end
```

Each dump is stored in the filestore as `{resource_type}-bioschemas-dump.jsonld` and exposed as a `DataDownload` within the `DataCatalog` markup on the home page, allowing harvesters to retrieve all records in one request.

```ruby
DataFile.public_schema_ld_dump.exists?         # check freshness
DataFile.public_schema_ld_dump.date_modified   # last generated
DataFile.public_schema_ld_dump.bioschemas      # Enumerator of hashes
```

## Adding Markup to a New Resource Type

### 1. Include the support mixin

```ruby
class MyAsset < ApplicationRecord
  include Seek::BioSchema::Support
end
```

### 2. Create a decorator

```ruby
# lib/seek/bio_schema/resource_decorators/my_asset.rb
module Seek
  module BioSchema
    module ResourceDecorators
      class MyAsset < CreativeWork   # or Thing if not a content type
        schema_mappings my_method: :mySchemaProperty

        associated_items related_things: :related_things

        def schema_type
          'SoftwareApplication'   # Schema.org type
        end

        def conformance
          'https://bioschemas.org/profiles/MyProfile/1.0-RELEASE'
        end

        def my_method
          object.some_attribute
        end
      end
    end
  end
end
```

### 3. Register it as a supported type

In `lib/seek/bio_schema/serializer.rb`, add `MyAsset` to `SUPPORTED_TYPES`.

### 4. Add the controller endpoint

```ruby
format.jsonld { render body: @my_asset.to_schema_ld }
```

### 5. Verify

```ruby
asset = MyAsset.create!(...)
json = JSON.parse(asset.to_schema_ld)
puts json['@type']    # 'SoftwareApplication'
puts json['name']     # title
```

## Key Files

| File | Purpose |
|---|---|
| `lib/seek/bio_schema/serializer.rb` | Entry point; `SUPPORTED_TYPES` list |
| `lib/seek/bio_schema/support.rb` | Model mixin — `to_schema_ld`, `to_pretty_schema_ld` |
| `lib/seek/bio_schema/resource_decorators/base_decorator.rb` | Base class, `schema_mappings` DSL |
| `lib/seek/bio_schema/resource_decorators/thing.rb` | Core Thing properties |
| `lib/seek/bio_schema/resource_decorators/creative_work.rb` | CreativeWork properties |
| `lib/seek/bio_schema/resource_decorators/factory.rb` | Resolves decorator class from resource type |
| `lib/seek/bio_schema/bio_schema_attribute.rb` | Property-method binding and value sanitisation |
| `lib/seek/bio_schema/data_dump.rb` | Bulk JSONLD file generation |
| `lib/seek/bio_schema/data_catalog_mock_model.rb` | Virtual model for site-wide DataCatalog |
| `app/helpers/rdf_helper.rb` | `schema_ld_script_block` |
| `app/views/layouts/application.html.erb` | JSON-LD injection point in `<head>` |
| `config/initializers/mime_types.rb` | `.jsonld` MIME type registration |
| `config/schedule.rb` | Nightly data dump schedule |
