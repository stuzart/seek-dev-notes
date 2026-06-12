---
title: RDF Endpoints & Content Negotiation
description: How to access RDF from SEEK resources via HTTP, content negotiation, FAIR signposting, and the SPARQL endpoint.
categories: [RDF, Reference]
---

SEEK exposes RDF for all supported resources via standard HTTP content negotiation. No separate URL is needed — the same resource URL serves HTML, JSON, Turtle, or JSON-LD depending on the `Accept` header.

## Supported formats

| Format | MIME type | Accept header |
|---|---|---|
| Turtle | `text/turtle` | `text/turtle`, `application/rdf`, `application/x-turtle` |
| JSON-LD | `application/ld+json` | `application/ld+json` |
| RDF/XML | `application/rdf+xml` | `application/rdf+xml` |
| JSON (API) | `application/json` | `application/json` |
| HTML | `text/html` | (default) |

MIME types are registered in `config/initializers/mime_types.rb`.

## Requesting RDF

Any resource URL can serve Turtle by sending an appropriate `Accept` header:

```bash
# Turtle
curl -H "Accept: text/turtle" https://seek.example.org/data_files/1

# JSON-LD
curl -H "Accept: application/ld+json" https://seek.example.org/data_files/1

# Using file extension (where supported by routes)
curl https://seek.example.org/data_files/1.rdf
```

The response includes a `Content-Type: text/turtle` header and the full Turtle representation of the resource.

## Example Turtle output

```turtle
@prefix jerm: <http://jermontology.org/ontology/JERMOntology#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

<https://seek.example.org/data_files/42>
    a jerm:Data ;
    owl:sameAs <https://seek.example.org/data_files/42> ;
    dcterms:title "My Dataset" ;
    dcterms:description "RNA-seq counts matrix" ;
    jerm:hasContributor <https://seek.example.org/people/7> ;
    jerm:isPartOf <https://seek.example.org/assays/3> ;
    dcterms:created "2024-03-01T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
```

## Controller integration

All RDF-capable controllers include a `format.rdf` block in their `respond_to`:

```ruby
respond_to do |format|
  format.html
  format.json
  format.rdf   { render template: 'rdf/show' }
  format.jsonld { render body: @resource.to_json_ld, content_type: 'application/ld+json' }
end
```

The `rdf/show.rdf.erb` template calls `resource_for_controller.to_rdf` and renders the Turtle string.

A `before_action :rdf_enabled?` filter returns `406 Not Acceptable` with a descriptive message if the model does not support RDF.

`app/helpers/rdf_helper.rb`, `app/views/rdf/show.rdf.erb`

## FAIR signposting

Every HTML response for an RDF-capable resource includes a `Link` header advertising the RDF representation — the [FAIR Signposting](https://signposting.org/FAIR/) pattern:

```http
Link: <https://seek.example.org/data_files/42>; rel="describedby"; type="application/rdf"
```

This allows crawlers and FAIR data tools to discover machine-readable representations without parsing HTML.

`app/controllers/concerns/fair_signposting.rb`

## SPARQL endpoint

When [Virtuoso is configured](../rdf-virtuoso/), SEEK exposes an interactive SPARQL interface at `/sparql`. Queries run against the public named graph.

`app/controllers/sparql_controller.rb`

### Querying programmatically

```ruby
repo   = Seek::Rdf::RdfRepository.instance
config = repo.get_configuration

client = SPARQL::Client.new(config.uri, graph: config.public_graph)

results = client.query(<<~SPARQL)
  PREFIX jerm: <http://jermontology.org/ontology/JERMOntology#>
  PREFIX dcterms: <http://purl.org/dc/terms/>

  SELECT ?resource ?title WHERE {
    ?resource a jerm:Data ;
              dcterms:title ?title .
  }
  LIMIT 20
SPARQL

results.each { |r| puts "#{r.resource} — #{r.title}" }
```

### Finding items related to a resource

```ruby
item = Sample.find(42)
uris = Seek::Rdf::RdfRepository.instance.uris_of_items_related_to(item)
```

This runs a SPARQL `SELECT` finding all subjects or objects linked to the item's URI in the private graph, returning an array of URI strings.

### Useful SPARQL patterns

**All data files with their assays:**

```sparql
PREFIX jerm: <http://jermontology.org/ontology/JERMOntology#>
PREFIX dcterms: <http://purl.org/dc/terms/>

SELECT ?df ?dfTitle ?assay ?assayTitle WHERE {
  ?df a jerm:Data ;
      dcterms:title ?dfTitle ;
      jerm:isPartOf ?assay .
  ?assay dcterms:title ?assayTitle .
}
```

**Resources contributed by a person:**

```sparql
PREFIX jerm: <http://jermontology.org/ontology/JERMOntology#>

SELECT ?resource ?type WHERE {
  ?resource jerm:hasContributor <https://seek.example.org/people/7> ;
            a ?type .
}
```

**Samples with an attribute value (via PID):**

```sparql
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?sample ?temp WHERE {
  ?sample <http://purl.obolibrary.org/obo/PATO_0000146> ?temp .
}
```

## RDF availability checks

```ruby
repo = Seek::Rdf::RdfRepository.instance

repo.configured?   # true if virtuoso_settings.yml present and not disabled
repo.available?    # true if an ASK query succeeds against the endpoint
```
