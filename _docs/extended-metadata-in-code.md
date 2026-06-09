---
title: Working with Extended Metadata in Code
description: How to define, read, write, and validate Extended Metadata from Ruby code and seed files.
categories: [Extended Metadata, Guide]
---

This guide covers the developer-side of Extended Metadata: defining types programmatically, reading and writing values, and adding support to a new resource type.

For the data model and relationships see [Extended Metadata Architecture](../extended-metadata-architecture/).
For the full list of attribute types see [Extended Metadata Attribute Types](../extended-metadata-attribute-types/).

## Defining a type in a seed file

The most common way to ship a built-in type is via `db/seeds/` or a related initialiser. Types created this way are idempotent if you guard with `find_or_create_by`.

```ruby
# Simple type with primitive attributes
emt = ExtendedMetadataType.find_or_create_by!(title: 'Experiment Details', supported_type: 'Study') do |t|
  t.enabled = true
end

string_type   = SampleAttributeType.find_by!(title: 'String')
integer_type  = SampleAttributeType.find_by!(title: 'Integer')
date_type     = SampleAttributeType.find_by!(title: 'Date')

emt.extended_metadata_attributes.find_or_create_by!(title: 'protocol_name') do |a|
  a.sample_attribute_type = string_type
  a.required              = true
  a.label                 = 'Protocol name'
  a.pid                   = 'http://purl.obolibrary.org/obo/OBI_0000272'
  a.pos                   = 1
end

emt.extended_metadata_attributes.find_or_create_by!(title: 'replicate_count') do |a|
  a.sample_attribute_type = integer_type
  a.required              = false
  a.pos                   = 2
end

emt.extended_metadata_attributes.find_or_create_by!(title: 'start_date') do |a|
  a.sample_attribute_type = date_type
  a.pos                   = 3
end
```

### Adding a controlled vocabulary attribute

```ruby
vocab = SampleControlledVocab.find_by!(title: 'Experiment Status')
cv_type = SampleAttributeType.find_by!(title: 'Controlled Vocabulary')

emt.extended_metadata_attributes.find_or_create_by!(title: 'status') do |a|
  a.sample_attribute_type    = cv_type
  a.sample_controlled_vocab  = vocab
  a.allow_cv_free_text       = false
  a.required                 = true
  a.pos                      = 4
end
```

### Adding a nested type

```ruby
# Define the nested type first (supported_type must be 'ExtendedMetadata')
person_type = ExtendedMetadataType.find_or_create_by!(title: 'Person', supported_type: 'ExtendedMetadata') do |t|
  t.enabled = true
end

person_type.extended_metadata_attributes.find_or_create_by!(title: 'first_name') do |a|
  a.sample_attribute_type = string_type
  a.required = true
  a.pos = 1
end
person_type.extended_metadata_attributes.find_or_create_by!(title: 'last_name') do |a|
  a.sample_attribute_type = string_type
  a.required = true
  a.pos = 2
end

# Reference it from the parent type
linked_type = SampleAttributeType.find_by!(title: 'Linked Extended Metadata')

emt.extended_metadata_attributes.find_or_create_by!(title: 'operator') do |a|
  a.sample_attribute_type            = linked_type
  a.linked_extended_metadata_type    = person_type
  a.required                         = false
  a.pos                              = 5
end

# For an array of nested objects use 'Linked Extended Metadata (multiple)'
multi_type = SampleAttributeType.find_by!(title: 'Linked Extended Metadata (multiple)')

emt.extended_metadata_attributes.find_or_create_by!(title: 'co_investigators') do |a|
  a.sample_attribute_type            = multi_type
  a.linked_extended_metadata_type    = person_type
  a.pos                              = 6
end
```

## Reading and writing values

Given a resource that has extended metadata:

```ruby
project = Project.find(42)
em = project.extended_metadata

# Read a value
em.get_attribute_value('protocol_name')   # => "Sample Prep v2"
em.data['protocol_name']                  # same thing

# Write a single value
em.set_attribute_value('replicate_count', 3)

# Bulk assign (replaces all values)
em.data = {
  protocol_name:   'New Protocol',
  replicate_count: 6,
  start_date:      '2024-06-01',
  operator: {
    first_name: 'Ada',
    last_name:  'Lovelace'
  }
}

em.save!
```

### Nested values

```ruby
# Single nested object
em.get_attribute_value('operator')
# => { 'first_name' => 'Ada', 'last_name' => 'Lovelace' }

# Array of nested objects
em.get_attribute_value('co_investigators')
# => [{ 'first_name' => 'Grace', 'last_name' => 'Hopper' }, ...]
```

### All values flattened (for search)

```ruby
em.data.extract_all_values
# => ["New Protocol", 6, "2024-06-01", "Ada", "Lovelace", ...]
```

## Creating an ExtendedMetadata record

Extended metadata is usually created alongside its parent resource via `accepts_nested_attributes_for`. To do it directly in code:

```ruby
em = ExtendedMetadata.new(
  item:                   project,
  extended_metadata_type: emt
)
em.data = { protocol_name: 'Test', replicate_count: 2 }
em.save!          # ExtendedMetadataValidator runs automatically
```

## Validation errors

`ExtendedMetadataValidator` runs recursively. Errors are added to the `ExtendedMetadata` record:

```ruby
em.valid?
em.errors.full_messages
# => ["Protocol name can't be blank", "Status is not included in the list"]
```

`app/validators/extended_metadata_validator.rb`

## Adding Extended Metadata support to a new resource

1. Include the concern in the model:

   ```ruby
   class Instrument < ApplicationRecord
     include HasExtendedMetadata
     # ...
   end
   ```

   `app/models/concerns/has_extended_metadata.rb`

2. Use `"Instrument"` as the `supported_type` when creating `ExtendedMetadataType` records for it.

3. Add form handling in the resource controller/views (follow the pattern in `ProjectsController` and its views).

## Disabling a type

Setting `enabled: false` prevents new `ExtendedMetadata` records from being created with that type. Existing records are unaffected and remain readable.

```ruby
emt.update!(enabled: false)
```

The validator blocks creates (not updates) against disabled types.

## Useful scopes and queries

```ruby
# All enabled top-level types (excludes nested types)
ExtendedMetadataType.where(enabled: true)
                    .where.not(supported_type: 'ExtendedMetadata')

# Types available for a specific resource
ExtendedMetadataType.where(supported_type: 'Project', enabled: true)

# Find all metadata for a resource
project.extended_metadata          # the associated record (has_one)
```

## Factory patterns (tests)

```ruby
# test/factories/extended_metadata_types.rb
emt   = FactoryBot.create(:simple_extended_metadata_type)
em    = FactoryBot.create(:extended_metadata, item: project, extended_metadata_type: emt)
```

See `test/factories/extended_metadata_types.rb` and `test/factories/extended_metadata.rb` for available factory traits.
