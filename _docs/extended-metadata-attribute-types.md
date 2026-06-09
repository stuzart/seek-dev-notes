---
title: Extended Metadata Attribute Types
description: Reference for all supported attribute data types, their options, and how they are stored.
categories: [Extended Metadata, Reference]
---

Every `ExtendedMetadataAttribute` has a `sample_attribute_type` that controls what values are accepted, how they are validated, and how they render in the UI.

Attribute types are shared with the Sample system. The base types are defined in `lib/seek/samples/base_type.rb`.

## Primitive types

| Type title | Base type | Stored as | Notes |
|---|---|---|---|
| `String` | `String` | JSON string | Single-line text |
| `Text` | `Text` | JSON string | Multi-line text |
| `Integer` | `Integer` | JSON number | |
| `Float` | `Float` | JSON number | |
| `Boolean` | `Boolean` | JSON boolean | |
| `Date` | `Date` | JSON string `"YYYY-MM-DD"` | |
| `DateTime` | `DateTime` | JSON string ISO 8601 | |

## Seek resource link types

These store a reference to another SEEK object. The value serialised in `json_metadata` is the resource's integer ID.

| Type title | Links to |
|---|---|
| `Seek Strain` | `Strain` |
| `Seek Sample` | `Sample` |
| `Seek Sample (multiple)` | `Sample` — array of IDs |
| `Seek Data file` | `DataFile` |
| `Seek SOP` | `Sop` |

## Controlled vocabulary types

Both types require `sample_controlled_vocab_id` to point to a `SampleControlledVocab` record.

| Type title | Stored as | Multi? |
|---|---|---|
| `Controlled Vocabulary` | JSON string (term URI or label) | No |
| `Controlled Vocabulary List` | JSON array of strings | Yes |

Setting `allow_cv_free_text: true` on the attribute lets users enter a value that is not in the vocabulary without a validation error.

## Linked (nested) types

These embed another `ExtendedMetadataType` inline. The linked type **must** have `supported_type: "ExtendedMetadata"`.

| Type title | `linked_extended_metadata_type_id` | Stored as |
|---|---|---|
| `Linked Extended Metadata` | required | JSON object |
| `Linked Extended Metadata (multiple)` | required | JSON array of objects |

See [Extended Metadata Architecture](../extended-metadata-architecture/) for a diagram of nesting.

## Attribute options reference

| Option | Column | Applies to | Description |
|---|---|---|---|
| `required` | `required` | All | Value must be present; blank fails validation |
| `label` | `label` | All | Human-readable label in the UI. Defaults to humanised `title` |
| `description` | `description` | All | Help text shown below the field |
| `pos` | `pos` | All | Integer display order within the type |
| `pid` | `pid` | All | Persistent identifier, e.g. an ontology URI (`http://purl.obolibrary.org/…`) |
| `allow_cv_free_text` | `allow_cv_free_text` | CV, CV List | Allow values not in the vocabulary |
| `sample_controlled_vocab_id` | FK | CV, CV List | Which vocabulary to use |
| `linked_extended_metadata_type_id` | FK | Linked, Linked Multi | Nested type definition |

## Looking up types in code

```ruby
# All attribute types
SampleAttributeType.all.pluck(:title)

# Find a specific type
string_type = SampleAttributeType.find_by(title: 'String')
cv_type      = SampleAttributeType.find_by(title: 'Controlled Vocabulary')
linked_type  = SampleAttributeType.find_by(title: 'Linked Extended Metadata')

# Check base type
string_type.base_type  # => "String"
```

## JSON field names in the JSON schema for upload

When defining an `ExtendedMetadataType` via JSON file upload, the `type` field in each attribute uses the human-readable type titles above:

```json
{ "title": "name",       "type": "String" }
{ "title": "count",      "type": "Integer" }
{ "title": "status",     "type": "Controlled Vocabulary",            "ID": 5 }
{ "title": "tags",       "type": "Controlled Vocabulary List",       "ID": 5 }
{ "title": "operator",   "type": "Linked Extended Metadata",         "ID": 12 }
{ "title": "replicates", "type": "Linked Extended Metadata (multiple)", "ID": 12 }
```

The `ID` field provides the `sample_controlled_vocab_id` or `linked_extended_metadata_type_id` depending on the type.

Schema source: `lib/seek/extended_metadata_type/extended_metadata_type_schema.json`
Extractor: `lib/seek/extended_metadata_type/extended_metadata_type_extractor.rb`
