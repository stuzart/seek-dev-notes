---
title: ISA Data Model
description: The Investigation, Study, and Assay hierarchy that forms the core scientific structure of SEEK.
categories: [Architecture, Reference]
---

ISA stands for **Investigation, Study, Assay** — a standard for describing biological experiments. SEEK uses this hierarchy as its primary organising structure for research data. Every piece of scientific content in SEEK ultimately sits within this tree.

For the Rails behaviour that makes these models work — authorization, search indexing, subscriptions, and so on — see [acts_as_isa](../acts-as-isa/).

## The Hierarchy

```
Programme
└── Project (one or more per Investigation)
    └── Investigation
        └── Study
            ├── ObservationUnit (optional)
            │   └── Sample
            └── Assay
                └── AssayAsset → DataFile, Sop, Model, Sample, Document
```

An `Investigation` belongs to one or more `Projects`. A `Study` belongs to one `Investigation`. An `Assay` belongs to one `Study`. Projects inherit from their `Programme`.

## Models

### Investigation

The top-level container for a research project.

**Key columns:**

| Column | Purpose |
|---|---|
| `title` | Required, max 255 chars |
| `description` | Optional, max 65,535 chars |
| `contributor_id` | Person who created it |
| `policy_id` | Access control policy |
| `uuid` | Unique public identifier |
| `position` | Display ordering |
| `is_isa_json_compliant` | Boolean flag for ISA-JSON export eligibility |
| `external_identifier` | Link to external system identifier |

**Key associations:**

```ruby
has_many :studies
has_many :assays, through: :studies
has_and_belongs_to_many :projects   # via investigations_projects join table
has_many :programmes, through: :projects
belongs_to :assignee, class_name: 'Person'
```

An Investigation can span multiple Projects. All child Studies and Assays inherit the parent's project membership — they do not hold project associations themselves.

**Deletion rule:** cannot be destroyed while it has Studies.

### Study

Groups a set of Assays within an Investigation.

**Key columns:**

| Column | Purpose |
|---|---|
| `investigation_id` | FK to parent Investigation |
| `experimentalists` | Free-text field for non-SEEK collaborators |
| `begin_date` | Start date of the study |
| `position` | Display ordering within the Investigation |

**Key associations:**

```ruby
belongs_to :investigation
has_many :projects, through: :investigation
has_many :assays
has_many :observation_units
has_and_belongs_to_many :sops                 # study-level protocols
has_and_belongs_to_many :sample_types         # required for ISA-JSON compliance
```

Studies also expose pass-through associations for navigating into child data:

```ruby
has_many :assay_data_files, through: :assays
has_many :assay_samples, through: :assays
has_many :assay_sops, through: :assays
```

**Deletion rule:** cannot be destroyed while it has Assays or associated Samples linked through its SampleTypes.

### Assay

The leaf node of the ISA hierarchy. An Assay represents a specific experimental or modelling analysis and is the point where data assets are attached.

**Key columns:**

| Column | Purpose |
|---|---|
| `study_id` | FK to parent Study |
| `assay_class_id` | EXP, MODEL, or STREAM |
| `assay_type_uri` | Ontology URI identifying the assay type (required) |
| `technology_type_uri` | Ontology URI for the technology used (required for experimental, absent for modelling) |
| `sample_type_id` | Linked SampleType (required for ISA-JSON compliance) |
| `assay_stream_id` | FK to parent Assay if this is part of an assay stream |
| `position` | Display ordering within the Study |

**Deletion rule:** cannot be destroyed while it has linked assets, publications, or associated Samples.

### ObservationUnit

Sits alongside Assays within a Study and represents a physical or conceptual unit being observed (e.g. a patient, a well plate). Samples belong to ObservationUnits.

```ruby
belongs_to :study
has_many :samples
has_many :related_assays, through: :samples
has_many :data_files, through: :observation_unit_assets
```

ObservationUnit also calls `acts_as_isa` and gains all the same behaviour as the three main ISA models.

## Assay Classes

`AssayClass` is a small lookup table with three fixed keys:

| Key | Meaning |
|---|---|
| `EXP` | Experimental Assay — wet-lab measurement, requires a technology type |
| `MODEL` | Modelling Analysis — computational model, no technology type |
| `STREAM` | Assay Stream — container grouping a sequence of linked assays |

```ruby
assay.is_experimental?  # assay_class.key == 'EXP'
assay.is_modelling?     # assay_class.key == 'MODEL'
assay.is_assay_stream?  # assay_class.key == 'STREAM'
```

Models may only be linked to Modelling Analysis assays — `AssayAsset` validates this.

## Linking Assets to Assays

`AssayAsset` is the join table between Assays and their data assets.

**Key columns:**

| Column | Purpose |
|---|---|
| `assay_id` | FK to Assay |
| `asset_id` + `asset_type` | Polymorphic FK to the asset |
| `version` | Snapshot of the asset version at time of linking |
| `direction` | `INCOMING=1`, `OUTGOING=2`, `NODIRECTION=0` |
| `relationship_type_id` | Optional semantic type of the relationship |

**Asset types that can be linked:**

| Association | Source type |
|---|---|
| `data_files` | `DataFile` |
| `sops` | `Sop` |
| `models` | `Model` |
| `documents` | `Document` |
| `samples` | `Sample` |
| `placeholders` | `Placeholder` |

Publications are linked directly on the Assay (not via AssayAsset).

**Direction** is relevant for DataFiles and Samples in experimental workflows — it records whether a file/sample was input to (`INCOMING`) or output from (`OUTGOING`) the assay.

**Relationship types** (`RelationshipType`) add semantic meaning to model links:

| Key | Meaning |
|---|---|
| `VALIDATION` | Model was used to validate the assay |
| `CONSTRUCTION` | Model was used to construct the assay |
| `SIMULATION` | Model was used to simulate the assay |

Scoped accessors on Assay:

```ruby
assay.incoming           # assets with direction INCOMING
assay.outgoing           # assets with direction OUTGOING
assay.validation_assets  # models linked via VALIDATION
assay.construction_assets
assay.simulation_assets
```

### Associating an asset

```ruby
assay.associate(data_file, direction: AssayAsset::Direction::INCOMING)
assay.associate(model, relationship: RelationshipType.find_by(key: 'SIMULATION'))
```

## Biological Context

Assays can be annotated with biological context via two join models:

**Organisms** — via `AssayOrganism`:

```ruby
assay.associate_organism(organism, strain_id, culture_growth_type, tissue_and_cell_type_id)
```

Each `AssayOrganism` record links an Assay to an `Organism` and optionally to a `Strain`, `CultureGrowthType`, and `TissueAndCellType`.

**Human diseases** — via `AssayHumanDisease`:

```ruby
assay.associate_human_disease(human_disease)
```

## Assay Type Ontologies

`assay_type_uri` and `technology_type_uri` are ontology URIs. SEEK ships with read-only ontology term trees for both. Users can also propose custom terms via `SuggestedAssayType` and `SuggestedTechnologyType`, which wrap a URI and label and can be submitted to the ontology maintainers.

## ISA-JSON Compliance

SEEK supports export to the [ISA-JSON](https://isa-specs.readthedocs.io/en/latest/isajson.html) standard. Compliance is tracked at each level:

- **Investigation:** `is_isa_json_compliant` is a stored boolean column set explicitly by the user or import process.
- **Study:** compliant if its Investigation is compliant AND it has at least one linked SampleType.
- **Assay:** compliant if its Investigation is compliant AND it has a linked SampleType (or is an Assay Stream).

```ruby
investigation.is_isa_json_compliant?
study.is_isa_json_compliant?
assay.is_isa_json_compliant?
```

The `IsaExporter` (`lib/isa_exporter.rb`) requires full compliance before generating an ISA-JSON file.

## Snapshots

All three ISA models include `acts_as_snapshottable`. A snapshot packages the ISA item and its related assets into a Research Object zip (`.ro.zip`) file, frozen at a point in time.

```ruby
snapshot = investigation.create_snapshot
snapshot.snapshot_number  # auto-incremented per resource
snapshot.doi              # mintable via DataCite
```

Snapshots can also be deposited to Zenodo. They are stored as `ContentBlob` records attached to the `Snapshot` model.

## Clone with Associations

All three models support `clone_with_associations`, which creates an unsaved duplicate with a deep-copied policy and copied associations:

```ruby
new_investigation = investigation.clone_with_associations
# => copies policy, project_ids, publications; does not copy Studies
```

Assay cloning also copies assay_assets (complex types only), organisms, and human diseases.

## Validations

**Investigation:**
- `title` required
- at least one `project` required

**Study:**
- `title` required
- `investigation` required, must be project-valid

**Assay:**
- `title` required
- `assay_class` required
- `assay_type_uri` required, validated by `AssayTypeUriValidator`
- `technology_type_uri` must be absent for modelling assays
- `study` required, must be project-valid
- Samples' ObservationUnits must belong to the same Study as the Assay

## Key Files

| File | Purpose |
|---|---|
| `app/models/investigation.rb` | Investigation model |
| `app/models/study.rb` | Study model |
| `app/models/assay.rb` | Assay model |
| `app/models/observation_unit.rb` | ObservationUnit model |
| `app/models/assay_asset.rb` | Asset–Assay join table |
| `app/models/assay_class.rb` | EXP / MODEL / STREAM lookup |
| `app/models/assay_organism.rb` | Assay–Organism join |
| `app/models/assay_human_disease.rb` | Assay–HumanDisease join |
| `app/models/snapshot.rb` | Frozen RO-Bundle snapshot |
| `lib/isa_exporter.rb` | ISA-JSON export |
| `lib/seek/acts_as_isa.rb` | Shared behaviour mixin |
