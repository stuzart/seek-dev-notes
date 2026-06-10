---
title: Configuration Settings
description: How Seek::Config works, what every admin UI setting does, and the settings only accessible via code or environment variables.
categories: [Configuration, Reference]
---

# Configuration Settings

SEEK's configuration is centralised in `Seek::Config` (`lib/seek/config.rb`). Settings are stored in the `Settings` database table at runtime, with defaults declared in `lib/seek/config_setting_attributes.yml`. The admin UI (`/admin`) exposes the majority of settings across five pages.

---

## How Seek::Config Works

`Seek::Config` is a module composed of four inner modules:

**`Wiring`** — the storage layer. Every setting is backed by a `Settings` database record keyed by name. `Seek::Config.get_value(name)` fetches from the DB (or the `Settings.defaults` hash if no record exists). `Seek::Config.set_value(name, value)` writes to the DB. Individual settings are declared with:

- `default(name, value)` — registers a default; the DB record is only created when the value is explicitly set
- `fixed(name, value)` — hardcodes a value that cannot be changed at runtime
- `setting(name, options)` — generates a getter/setter method pair, with an optional `:to_i` or `:to_f` type conversion

**`Fallbacks`** — methods named `{setting}_fallback` return a computed value when the stored value is `nil`. For example, `instance_admins_name_fallback` returns `instance_name` so the admin name inherits the instance name unless explicitly overridden.

**`Propagators`** — methods named `{setting}_propagate` run side-effects after a setting changes. For example, `smtp_propagate` reconfigures `ActionMailer::Base.smtp_settings`, and `google_analytics_enabled_propagate` updates the GA tracker object.

**`CustomAccessors`** — computed helpers that combine multiple stored settings or derive paths. Examples: `asset_filestore_path`, `omniauth_providers` (builds the full OmniAuth provider list from individual `omniauth_*_enabled` flags), `sorting_for(controller)`, `results_per_page_for(controller)`.

Settings are cached per-request in `RequestStore` when `Thread.current[:use_settings_cache]` is set, with a one-week Rails cache backing store for slower-changing values.

Encrypted settings (SMTP password, OAuth secrets, LDAP password, DataCite/Zenodo/NeLS/LifeMonitor credentials) are stored via `attr_encrypted` in the `Settings` table's `encrypted_value` column.

---

## Admin UI Pages

The admin panel lives at `/admin`. The **Configuration** section links to five settings pages.

---

### Enable/Disable Features (`/admin/features_enabled`)

The largest settings page — controls which SEEK services, resource types, and integrations are active.

#### SEEK Services

| Setting | Default | Description |
|---|---|---|
| `solr_enabled` | false | Enables Solr full-text search. Requires a running Solr instance. See [Solr Search Indexing](../solr-search-indexing/). |
| `filtering_enabled` | true | Enables faceted filtering on index pages. |
| `max_filters` | 5 | Maximum number of active filters shown at once. |
| `pdf_conversion_enabled` | true | Enables server-side PDF conversion of uploaded documents (requires LibreOffice). |
| `fair_signposting_enabled` | false | Adds FAIR Signposting `Link` headers to resource responses. |
| `external_search_adaptors` | `{}` | Per-adaptor hash enabling external search sources alongside Solr. |

#### Email

| Setting | Default | Description |
|---|---|---|
| `email_enabled` | false | Master switch for all outgoing email. |
| `noreply_sender` | `no-reply@sysmo-db.org` | From address for system emails. |
| `support_email_address` | — | Address shown to users for support requests. |
| `smtp` (address) | — | SMTP server hostname. |
| `smtp` (port) | — | SMTP server port. |
| `smtp` (domain) | — | HELO domain. |
| `smtp` (authentication) | — | Auth method (`plain`, `login`, `cram_md5`). |
| `smtp` (enable_starttls_auto) | — | Enable STARTTLS if server supports it. |
| `smtp` (user_name) | — | SMTP auth username (encrypted). |
| `smtp` (password) | — | SMTP auth password (encrypted). |
| `exception_notification_enabled` | false | Emails a list of recipients when a 500 error occurs. |
| `exception_notification_recipients` | — | Space/comma-separated email addresses for error notifications. |
| `error_grouping_enabled` | true | Suppresses duplicate error emails within a time window. |
| `error_grouping_timeout` | 2 minutes | Quiet period after an error before the same error is emailed again. |
| `error_grouping_log_base` | 2 | Logarithmic base for escalating error frequency thresholds. |

#### Authentication

| Setting | Default | Description |
|---|---|---|
| `omniauth_enabled` | false | Master switch for SSO/OmniAuth providers. |
| `standard_login_enabled` | true | Shows the username/password login form. Can be disabled when using SSO exclusively. |
| `omniauth_user_create` | true | Automatically creates a SEEK account on first SSO login. |
| `omniauth_user_activate` | true | Auto-activates new accounts created via SSO (bypasses email confirmation). |
| `omniauth_ldap_enabled` | false | Enables LDAP authentication. |
| `omniauth_ldap_host` | `localhost` | LDAP server hostname. |
| `omniauth_ldap_port` | 389 | LDAP server port. |
| `omniauth_ldap_method` | `plain` | Connection method (`plain`, `ssl`, `tls`). |
| `omniauth_ldap_base` | — | LDAP search base DN. |
| `omniauth_ldap_uid` | `samaccountname` | LDAP attribute used as the username. |
| `omniauth_ldap_bind_dn` | — | DN used for the bind query. |
| `omniauth_ldap_password` | — | Bind password (encrypted). |
| `omniauth_elixir_aai_enabled` | false | Enables ELIXIR AAI (Life Science Login) SSO. |
| `omniauth_elixir_aai_client_id` | — | ELIXIR AAI OAuth client ID. |
| `omniauth_elixir_aai_secret` | — | ELIXIR AAI OAuth secret (encrypted). |
| `omniauth_elixir_aai_legacy_mode` | false | Use legacy ELIXIR AAI endpoints. |
| `omniauth_github_enabled` | false | Enables GitHub OAuth login. |
| `omniauth_github_client_id` | — | GitHub OAuth app client ID. |
| `omniauth_github_secret` | — | GitHub OAuth app secret (encrypted). |
| `omniauth_oidc_enabled` | false | Enables a generic OpenID Connect provider. |
| `omniauth_oidc_name` | `OpenID Connect Provider` | Display name shown on the login button. |
| `omniauth_oidc_image` | — | Avatar image for the OIDC provider login button. |
| `omniauth_oidc_issuer` | — | OIDC issuer URL. |
| `omniauth_oidc_client_id` | — | OIDC client ID. |
| `omniauth_oidc_secret` | — | OIDC client secret (encrypted). |

#### Resource Types

Each toggle hides or shows the corresponding resource type throughout the UI — nav links, creation forms, and search results.

| Setting | Default |
|---|---|
| `data_files_enabled` | true |
| `documents_enabled` | true |
| `events_enabled` | true |
| `isa_enabled` | true |
| `models_enabled` | true |
| `organisms_enabled` | true |
| `presentations_enabled` | true |
| `publications_enabled` | true |
| `samples_enabled` | true |
| `sops_enabled` | true |
| `workflows_enabled` | false |
| `collections_enabled` | true |
| `file_templates_enabled` | false |
| `placeholders_enabled` | false |
| `observation_units_enabled` | false |

#### Programmes

| Setting | Default | Description |
|---|---|---|
| `programmes_enabled` | false | Enables Programmes as a top-level resource grouping Projects. |
| `programme_user_creation_enabled` | false | Allows non-admin users to create their own Programmes. |
| `programmes_open_for_projects_enabled` | false | Allows Project admins to request joining an existing Programme. |
| `auto_activate_programmes` | false | Automatically activates new Programmes without admin approval. |
| `auto_activate_site_managed_projects` | false | Automatically activates Projects under the managed Programme. |
| `managed_programme_id` | — | ID of the designated "site-managed" Programme. |
| `project_admin_sample_type_restriction` | false | Restricts Sample Type creation to Project admins. |

#### SEEK Features

| Setting | Default | Description |
|---|---|---|
| `internal_help_enabled` | false | Enables built-in help pages. When false, links point to `external_help_url`. |
| `external_help_url` | `https://docs.seek4science.org/help/user-guide/` | URL for external help documentation. |
| `project_single_page_enabled` | false | Enables a single-page view for Projects. |
| `project_single_page_folders_enabled` | false | Enables folder organisation within the Project single page. |
| `isa_json_compliance_enabled` | false | Enables ISA-JSON compliance templates. |
| `fair_data_station_enabled` | false | Enables FAIR Data Station integration. |
| `openbis_enabled` | false | Enables OpenBIS integration. |
| `ga4gh_trs_api_enabled` | false | Exposes a GA4GH Tool Registry Service API for Workflows. |
| `require_cookie_consent` | false | Shows a cookie consent banner before setting any non-essential cookies. |

#### Analytics

| Setting | Default | Description |
|---|---|---|
| `google_analytics_enabled` | false | Enables Google Analytics tracking. |
| `google_analytics_tracker_id` | `000-000` | Google Analytics UA or GA4 tracking ID. |
| `google_analytics_tracking_notice` | true | Shows a notice to users that Google Analytics is active. |
| `piwik_analytics_enabled` | false | Enables Matomo (Piwik) analytics. |
| `piwik_analytics_id_site` | 1 | Matomo site ID. |
| `piwik_analytics_url` | `localhost/piwik/` | Matomo instance URL. |
| `piwik_analytics_tracking_notice` | true | Shows a Matomo tracking notice to users. |
| `custom_analytics_snippet_enabled` | false | Enables a custom analytics JavaScript snippet. |
| `custom_analytics_name` | `Custom name` | Display name shown in the tracking notice. |
| `custom_analytics_snippet` | — | Raw HTML/JavaScript injected into the page head. |
| `custom_analytics_tracking_notice` | true | Shows a tracking notice when the custom snippet is active. |

#### Integrations

| Setting | Default | Description |
|---|---|---|
| `jws_enabled` | true | Enables JWS Online model simulation. |
| `jws_online_root` | `https://jws2.sysmo-db.org/` | JWS Online base URL. |
| `copasi_enabled` | true | Enables COPASI model simulation link. |
| `morpheus_enabled` | true | Enables Morpheus model simulation link. |
| `doi_minting_enabled` | false | Enables DOI minting via DataCite for snapshots. |
| `doi_prefix` | — | DataCite DOI prefix (e.g. `10.5072`). |
| `doi_suffix` | `seek` | Suffix component appended to the prefix. |
| `time_lock_doi_for` | 0 | Days after creation before a DOI can be minted. |
| `datacite_username` | — | DataCite account username. |
| `datacite_password` | — | DataCite account password (encrypted). |
| `datacite_url` | `https://mds.datacite.org/` | DataCite MDS API URL. |
| `zenodo_publishing_enabled` | false | Enables publishing snapshots to Zenodo. |
| `zenodo_api_url` | `https://zenodo.org/api` | Zenodo API base URL. |
| `zenodo_oauth_url` | `https://zenodo.org/oauth` | Zenodo OAuth base URL. |
| `zenodo_client_id` | — | Zenodo OAuth application client ID. |
| `zenodo_client_secret` | — | Zenodo OAuth application client secret (encrypted). |
| `nels_enabled` | false | Enables NeLS (Norwegian e-Infrastructure for Life Sciences) integration. |
| `nels_api_url` | `https://test-fe.cbu.uib.no/nels-api` | NeLS API URL. |
| `nels_oauth_url` | `https://test-fe.cbu.uib.no/oauth2` | NeLS OAuth URL. |
| `nels_permalink_base` | `https://test-fe.cbu.uib.no/nels/…` | NeLS permalink base. |
| `nels_client_id` | — | NeLS OAuth client ID. |
| `nels_client_secret` | — | NeLS OAuth client secret. |
| `life_monitor_enabled` | false | Enables LifeMonitor workflow monitoring integration. |
| `life_monitor_url` | `https://api.lifemonitor.eu/` | LifeMonitor API URL. |
| `life_monitor_ui_url` | `https://app.lifemonitor.eu/` | LifeMonitor web UI URL. |
| `life_monitor_client_id` | — | LifeMonitor OAuth client ID. |
| `life_monitor_client_secret` | — | LifeMonitor OAuth client secret. |
| `bio_tools_enabled` | false | Enables bio.tools integration for Workflows. |

---

### Branding and Customization (`/admin/rebrand`)

| Setting | Default | Description |
|---|---|---|
| `instance_name` | `FAIRDOM-SEEK` | Displayed name of this SEEK installation. |
| `instance_description` | — | Short description shown in the page metadata. |
| `instance_keywords` | — | Keywords for the page `<meta>` tag. |
| `instance_link` | `https://fairdomseek.org` | URL the instance name links to. |
| `issue_tracker` | `https://fair-dom.org/issues` | URL for the issue tracker link in the footer. |
| `instance_admins_name` | `FAIRDOM` | Name of the organisation running this instance. |
| `instance_admins_link` | `http://www.fair-dom.org` | URL for the admins organisation. |
| `header_image_enabled` | true | Shows a custom logo image in the header. |
| `header_image_title` | `FAIRDOM` | Alt text / title for the header image. |
| `header_image_avatar_id` | — | ID of the uploaded Avatar record used as the header logo. |
| `copyright_addendum_enabled` | false | Appends custom copyright text to the footer. |
| `copyright_addendum_content` | — | HTML content added to the footer copyright area. |
| `imprint_enabled` | false | Shows an imprint/legal notice link in the footer. |
| `imprint_description` | — | HTML content for the imprint page. |
| `terms_enabled` | false | Shows a Terms of Use link and page. |
| `terms_page` | — | HTML content for the Terms of Use page. |
| `privacy_enabled` | false | Shows a Privacy Policy link and page. |
| `privacy_page` | — | HTML content for the Privacy Policy page. |
| `funding_link` | — | URL shown as a funding acknowledgement link in the footer. |
| `about_page_enabled` | false | Shows an About link in the navigation. |
| `about_page` | — | HTML content for the About page. |
| `about_instance_link_enabled` | false | Shows a link to `instance_link` on the About page. |
| `about_instance_admins_link_enabled` | false | Shows a link to `instance_admins_link` on the About page. |
| `cite_link` | — | URL shown as a "How to cite SEEK" link. |
| `contact_link` | — | URL or mailto for the Contact link in the footer. |

---

### Settings (`/admin/settings`)

General, file-handling, policy, and registration settings.

#### General

| Setting | Default | Description |
|---|---|---|
| `site_base_host` | `http://localhost:3000` | The public base URL of this installation. Used when constructing absolute URLs (e.g. in emails and RDF). |
| `pubmed_api_email` | — | Email address passed to the NCBI PubMed API. Required by NCBI for rate-limited access. |
| `bioportal_api_key` | — | API key for BioPortal ontology lookups. |
| `allow_publications_fulltext` | false | Allows full text of publications to be stored and displayed. |
| `allow_edit_of_registered_publ` | false | Allows editing of publications that have a PubMed ID or DOI. |
| `hide_details_enabled` | false | Hides extended metadata from users who are not members of the owning project. |
| `allow_private_address_access` | false | Allows SEEK to fetch content from private/local IP addresses (e.g. intranet URLs). Off by default for security. |
| `session_store_timeout` | 1 hour | How long before an inactive session expires. |

#### File Handling

| Setting | Default | Description |
|---|---|---|
| `show_as_external_link_enabled` | false | Allows assets to be registered as external URLs rather than uploaded files. |
| `block_file_uploads` | false | Disables all file uploads. Assets can only be linked externally when this is on. |
| `cache_remote_files` | true | Downloads and caches content from remote URLs for preview/search indexing. |
| `max_cachable_size` | 20 MB | Maximum file size that will be downloaded and cached. |
| `hard_max_cachable_size` | 100 MB | Absolute upper limit — files larger than this are never cached regardless of other settings. |

#### Sandbox

| Setting | Default | Description |
|---|---|---|
| `sandbox_instance_url` | — | URL of a sandbox/demo installation to link to from the login page. |
| `sandbox_instance_name` | — | Display name for the sandbox link. |

#### Policy and Licensing

| Setting | Default | Description |
|---|---|---|
| `default_all_visitors_access_type` | Private | Default access level for "all visitors" on newly created assets. |
| `default_associated_projects_access_type` | Accessible | Default access level for members of associated projects. |
| `max_all_visitors_access_type` | Accessible | The maximum access level a user can grant to "all visitors". Prevents public assets being fully editable by anyone. |
| `default_license` | `CC-BY-4.0` | Pre-selected license when uploading a new asset. |
| `recommended_data_licenses` | CC-BY-4.0, CC0-1.0, … | List of licenses shown in the data license picker. |
| `recommended_software_licenses` | Apache-2.0, GPL-3.0, … | List of licenses shown in the software license picker. |
| `metadata_license` | `CC-BY-4.0` | License applied to metadata (title, description, etc.) of all assets. |
| `permissions_popup` | Always | When the sharing permissions dialog appears: Always / On change / Never. |
| `auth_lookup_update_batch_size` | 10 | Number of records processed per batch when rebuilding the auth lookup table. |

#### Registration

| Setting | Default | Description |
|---|---|---|
| `registration_disabled` | false | Disables new user registration. Existing users can still log in. |
| `registration_disabled_description` | _(message)_ | Text shown to visitors when registration is disabled. |
| `activation_required_enabled` | false | New accounts must be activated by an admin before they can log in. |
| `orcid_required` | false | Requires users to link an ORCID iD before their account is active. |
| `recaptcha_enabled` | false | Adds a CAPTCHA to the registration form. |
| `recaptcha_public_key` | — | reCAPTCHA site key. |
| `recaptcha_private_key` | — | reCAPTCHA secret key. |

---

### Homepage Settings (`/admin/home_settings`)

| Setting | Default | Description |
|---|---|---|
| `home_description` | _(placeholder text)_ | Text shown in the welcome/description area of the homepage. |
| `home_description_position` | `side` | Where the description appears: `side` (right column) or `middle` (full width). |
| `show_announcements` | true | Shows the latest site announcement on the homepage. |
| `news_enabled` | false | Enables the news feed panel on the homepage. |
| `news_feed_urls` | — | Comma-separated RSS/Atom feed URLs for the news panel. |
| `news_number_of_entries` | 10 | Number of news items to display. |
| `tag_cloud_enabled` | true | Shows the tag cloud on the homepage. |
| `tag_threshold` | 1 | Minimum number of uses before a tag appears in the cloud. |
| `max_visible_tags` | 20 | Maximum number of tags shown in the cloud. |
| `workflow_class_list_enabled` | false | Shows a list of Workflow types on the homepage. |
| `home_show_features` | true | Shows the "Features" panel on the homepage. |
| `home_show_quickstart` | true | Shows the quick-start / getting-started panel. |
| `home_show_my_items` | true | Shows the logged-in user's recent items panel. |
| `home_show_who_uses` | true | Shows the "Who uses SEEK" panel. |
| `home_explore_projects` | true | Shows the "Explore Projects" panel. |
| `home_show_integrations` | true | Shows the integrations/tools panel. |
| `home_carousel` | — | Configures image carousel items (image, title, author, URL, description). |

---

### Paging/Sorting Settings (`/admin/pagination`)

| Setting | Default | Description |
|---|---|---|
| `results_per_page_default` | 7 | Default number of results per page on index listings. |
| `results_per_page_default_condensed` | 14 | Results per page in condensed/card view mode. |
| `related_items_limit` | 5 | Maximum related items shown in the sidebar of a resource page. |
| `search_results_limit` | 5 | Maximum results shown per type in the search dropdown. |
| `results_per_page[{controller}]` | — | Per-resource-type override for results per page (Programmes, Projects, People, Investigations, Studies, Assays, Data Files, Models, SOPs, Publications, Documents, Presentations, Events, File Templates, Placeholders). |
| `sorting[{controller}]` | — | Per-resource-type default sort column (same controller list as above). |

---

## Other Settings

Settings that exist in `Seek::Config` but are not exposed in the admin UI.

### Fixed Settings

These are hardcoded via `fixed()` and cannot be overridden at runtime:

| Setting | Value | Notes |
|---|---|---|
| `application_name` | `FAIRDOM-SEEK` | The canonical application name used in metadata and headers. |
| `main_layout` | `application` | The Rails layout template. |
| `css_prepended` / `css_appended` | `''` | Hooks for injecting custom CSS — empty and fixed by default; override in an initializer for white-label deployments. |

### Programmatic / Initializer Settings

Set via a Rails initializer (e.g. `config/initializers/seek_local.rb`) rather than the admin UI. This is how Docker enables Solr — see `docker/seek_local_search_enabled.rb`:

```ruby
Seek::Config.default :solr_enabled, true
```

Any setting can be overridden this way. Common uses:
- `solr_enabled` — set by the Docker entrypoint
- `javascript_prepended` / `javascript_appended` — injecting custom JS into every page
- Ontology paths (`assay_type_ontology_file`, etc.) — pointing at custom ontology files

### Advanced / Rarely-Changed Settings

Exist in `config_setting_attributes.yml` but have no UI field:

| Setting | Default | Description |
|---|---|---|
| `auth_lookup_enabled` | true | Enables the auth lookup table for faster permission checks. Disabling forces live authorization on every request. |
| `tagging_enabled` | true | Enables tagging across all assets. |
| `modelling_analysis_enabled` | true | Enables Modelling Analysis assay type. |
| `human_diseases_enabled` | false | Enables Human Diseases as a linkable concept on assets. |
| `jerm_enabled` | false | Enables JERM (Just Enough Results Model) harvesting. |
| `sycamore_enabled` | false | Enables Sycamore integration. |
| `isa_json_compliance_enabled` | false | ISA-JSON compliance mode for templates. |
| `experimental_features_enabled` | false | Enables in-development features not yet ready for general use. |
| `admin_impersonation_enabled` | false | Allows admins to log in as another user. When enabled, an Impersonate section appears on the admin index page. |
| `profile_select_by_default` | true | Pre-selects the user's own profile when creating assets. |
| `observed_variables_enabled` | false | Enables Observed Variables on Assays. |
| `observed_variable_sets_enabled` | false | Enables Observed Variable Sets. |
| `type_managers_enabled` | true | Enables designated Type Managers. |
| `type_managers` | `admins` | Who can manage Sample Types: `admins` or `project_admins`. |
| `programme_user_creation_enabled` | false | Allows non-admin users to create Programmes (also in features UI but often set here for managed instances). |
| `reindex_all_batch_size` | 50 | Batch size for `rake seek:reindex_all`. See [Solr Search Indexing](../solr-search-indexing/). |
| `default_citation_style` | `apa` | Citation style used when rendering publication references. |
| `cv_dropdown_limit` | 100 | Maximum items shown in controlled vocabulary dropdowns before switching to search. |
| `max_extractable_spreadsheet_size` | 10 MB | Maximum spreadsheet size for data extraction. |
| `max_indexable_text_size` | 100 MB | Maximum file size for Solr text indexing. |
| `project_browser_enabled` | false | Enables the experimental project browser view. |
| `project_news_enabled` / `community_news_enabled` | false | Additional news feed panels (project-scoped and community-scoped). Configured separately from the main `news_enabled` flag. |

### Per-Project Settings

Defined in `lib/seek/project_setting_attributes.yml` — stored per project, not globally:

| Setting | Description |
|---|---|
| `nels_enabled` | Enables NeLS integration for a specific project (in addition to the global flag). |
| `site_username` / `site_password` | Credentials for a project's linked external site (encrypted). |

### Environment Variables (Docker)

These configure the runtime environment and are not stored in the database:

| Variable | Used by |
|---|---|
| `RAILS_ENV` | Rails environment |
| `SOLR_HOST` / `SOLR_PORT` | Docker entrypoint — `SOLR_PORT` being set triggers `enable_search` which installs the Solr initializer |
| `RAILS_RELATIVE_URL_ROOT` | Sub-path deployment (e.g. `/seek`) |
| `MYSQL_HOST` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | Database connection (from `docker/db.env`) |
| `NO_ENTRYPOINT_WORKERS` | Skip starting workers in the main container |
| `QUIET_SUPERCRONIC` | Suppress Supercronic cron log output |
| `RAILS_LOG_LEVEL` | Log verbosity (`debug`, `info`, `warn`, `error`, `fatal`) |
