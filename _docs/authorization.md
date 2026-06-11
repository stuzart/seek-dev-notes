---
title: Authorization and Policy System
description: How SEEK controls who can view, download, edit, manage, and delete assets using a database-driven policy and permission model.
categories: [Architecture, Reference]
---

SEEK uses a layered authorization system built around database-stored policies. Every asset has a `Policy` record that defines default access, plus optional `Permission` records that grant individuals or groups specific rights. Authorization checks cascade through several layers before returning a yes or no.

## Access Types

All access in SEEK is expressed as an integer constant defined on `Policy`:

| Constant | Value | Grants |
|---|---|---|
| `Policy::NO_ACCESS` | 0 | Nothing — private to the contributor |
| `Policy::VISIBLE` | 1 | View metadata only (not downloadable) |
| `Policy::ACCESSIBLE` | 2 | View and download |
| `Policy::EDITING` | 3 | View, download, and edit |
| `Policy::MANAGING` | 4 | Full control — edit, delete, and manage permissions |
| `Policy::PUBLISHING` | 5 | Used by the gatekeeper publishing workflow |

Access types are **hierarchical**: a user with `MANAGING` automatically passes checks for view, download, and edit. The exception is `PUBLISHING`, which only applies to the publish action.

## Policy and Permission Models

### Policy (`app/models/policy.rb`)

Each asset `has_one :policy`. The policy's `access_type` sets the **default** access level for anyone not covered by a specific permission:

```ruby
Policy::NO_ACCESS   # Private — only the contributor can access
Policy::ACCESSIBLE  # Anyone (including anonymous) can view and download
```

Common factory methods:

```ruby
Policy.private_policy          # NO_ACCESS, no permissions
Policy.public_policy           # ACCESSIBLE, open to all
Policy.registered_users_accessible_policy  # ACCESSIBLE but requires login
Policy.projects_policy([p1, p2])  # NO_ACCESS default + ACCESSIBLE for project members
```

### Permission (`app/models/permission.rb`)

A permission grants a specific **contributor** a specific `access_type` on a policy. The contributor can be any of:

- `Person`
- `Project`
- `Institution`
- `WorkGroup`
- `Programme`
- `FavouriteGroup`

When the contributor is a group (e.g. a `Project`), the permission applies to all current members of that group.

### Permission Precedence

When a person belongs to multiple groups that each have a permission on the same asset, precedence determines which permission wins:

```
Person > FavouriteGroup > WorkGroup > Project > Programme > Institution
```

A `Person`-level permission always overrides any group-level permission, regardless of access type. This means you can grant a project `ACCESSIBLE` and then explicitly deny (or grant higher access to) a specific person.

## The Authorization Stack

`Authorization.is_authorized?(action, asset, user)` (`lib/seek/permissions/authorization.rb`) is the core check. It walks through these layers in order, returning `true` at the first match:

### 1. Contributor and Creator check

The **contributor** is the person who created the asset (set to `User.current_user.person` at creation). They always have `MANAGING`.

**Creators** are additional people listed as research contributors via `has_many :creators`. They receive `EDITING` — they can view, download, and edit, but cannot delete the asset or change its permissions.

```ruby
asset.contributor  # Person with full MANAGING access
asset.creators     # Array of Persons with EDITING access
```

### 2. Policy check

If the asset's `policy.access_type` is high enough for the requested action, access is granted to everyone — including anonymous users. If `sharing_scope` is `ALL_USERS`, the user must be logged in.

### 3. Permission check

SEEK looks for a `Permission` matching the user (directly or via any group they belong to). Permissions are sorted by precedence, and the first match is used. The permission's `access_type` is then checked against the required level for the action.

### 4. Role check

Two project roles can override normal permissions:

- **Asset Housekeeper** — grants `MANAGING` on any asset belonging to their project, even assets from before they were appointed. Intended for data curation.
- **Asset Gatekeeper** — grants the `publish` action on assets in their project, for approving publication.

## `can_*?` Methods

The `PolicyBasedAuthorization` concern (`lib/seek/permissions/policy_based_authorization.rb`) is included in all asset models via `acts_as_authorized`. It exposes:

```ruby
asset.can_view?(user)      # user may be nil (anonymous)
asset.can_download?(user)
asset.can_edit?(user)
asset.can_manage?(user)
asset.can_delete?(user)
asset.can_publish?(user)
```

Each of these performs two checks:

1. **`authorized_for_#{action}?`** — does the policy/permission stack say yes?
2. **`state_allows_#{action}?`** — does the current state of the object permit it?

State checks are model-specific overrides. For example, an Assay with linked samples cannot be deleted even if authorization permits it. Authorization and business state are kept separate.

## Auth Lookup Table

Policy checks are expensive when applied to large lists (index pages, search results). When `Seek::Config.auth_lookup_enabled` is true, SEEK maintains a pre-computed `#{type}_auth_lookup` table for each asset type:

```
user_id | asset_id | can_view | can_download | can_edit | can_manage | can_delete
```

One row per (user, asset) pair. The table is rebuilt asynchronously after any policy or permission change via `AuthLookupUpdateJob`. The `can_*?` methods read from this table when it is available and consistent, falling back to live computation otherwise.

## Controller Enforcement

`ApplicationController` runs `find_and_authorize_requested_item` as a before-action on most requests. This:

1. Loads the requested asset
2. Translates the controller action name to a privilege (`show` → `:view`, `destroy` → `:delete`, etc.) via `Seek::Permissions::Translator`
3. Calls `is_auth?(asset, privilege)` which calls `asset.can_#{privilege}?(current_user)`
4. Renders a 403 if access is denied

The full action-to-privilege map is in `lib/seek/permissions/translator.rb`. Notable mappings:

| Privilege | Controller actions |
|---|---|
| `:view` | `show`, `index`, `search`, `comment` |
| `:download` | `download`, `ro_crate`, `explore`, `launch` |
| `:edit` | `edit`, `update`, `new_version`, `create_version` |
| `:manage` | `manage`, `notify`, `upload_fulltext` |
| `:delete` | `destroy` |

## Model-Level Enforcement

`AuthorizationEnforcement` (`lib/seek/permissions/authorization_enforcement.rb`) adds before-save and before-destroy hooks that prevent unauthorized changes even if code bypasses the controller:

```ruby
before_save    :changes_authorized?   # requires can_edit? (or can_manage? for policy changes)
before_destroy :destroy_authorized?   # requires can_delete?
```

Models can tune this behaviour:

```ruby
requires_can_manage(:state)                # Changing :state needs manage, not just edit
does_not_require_can_edit(:uuid)           # :uuid changes are always allowed
enforce_authorization_on_association(:projects, :view)  # Linked projects must be viewable
```

To bypass enforcement in tests:

```ruby
disable_authorization_checks do
  asset.update!(title: "Test")
end
```

## FavouriteGroups

`FavouriteGroup` (`app/models/favourite_group.rb`) lets users create named groups of people and grant them bulk permissions. Each user also gets two system-managed groups:

- `__allowlist__` — people explicitly granted access even when the policy would deny them
- `__denylist__` — people explicitly denied access even when the policy would allow them

`FavouriteGroupMembership` stores the access type per member, which overrides the group permission's type.

## Code-Based Authorization

`CodeBasedAuthorization` (`lib/seek/permissions/code_based_authorization.rb`) supports temporary share links. An asset can have `SpecialAuthCode` records with an expiry time. Passing a valid code in the request grants view and download access regardless of policy:

```ruby
asset.auth_by_code?(params[:code])  # true if code is valid and not expired
```

## Publishing Workflow

Assets in some configurations require gatekeeper approval before becoming publicly accessible. `PublishingPermissions` (`lib/seek/permissions/publishing_permissions.rb`) adds:

```ruby
can_publish?(user)
requires_gatekeeper_approval?
gatekeeper_required?
waiting_approval?
```

When a gatekeeper is required, `publish!` does not fire immediately — instead a `ResourcePublishLog` record is created with a `waiting` state. The Asset Gatekeeper for the project can then approve or reject via the publishing workflow UI.

## Debugging Authorization

In the Rails console:

```ruby
user  = User.find(1)
asset = DataFile.find(42)

# Walk the authorization stack layer by layer
Authorization.authorized_as_creator?('view', asset, user)
Authorization.authorized_by_policy?('view', asset, user)
Authorization.authorized_by_permission?('view', asset, user)
Authorization.authorized_by_role?('view', asset, user)

# Top-level check
asset.can_view?(user)

# See who has access and at what level
asset.policy.summarize_permissions(asset.creators, [], asset.contributor)
```

## Key Files

| File | Purpose |
|---|---|
| `app/models/policy.rb` | Access type constants, policy factory methods |
| `app/models/permission.rb` | Per-contributor access rules, group expansion |
| `app/models/favourite_group.rb` | User-managed groups, allowlist/denylist |
| `lib/seek/permissions/authorization.rb` | Core `is_authorized?` logic |
| `lib/seek/permissions/policy_based_authorization.rb` | `can_*?` methods, auth lookup table |
| `lib/seek/permissions/authorization_enforcement.rb` | before-save/destroy hooks |
| `lib/seek/permissions/acts_as_authorized.rb` | Mixin included in all asset models |
| `lib/seek/permissions/translator.rb` | Controller action → privilege mapping |
| `lib/seek/permissions/publishing_permissions.rb` | Gatekeeper publish workflow |
| `lib/seek/permissions/code_based_authorization.rb` | Temporary share link codes |
| `app/controllers/application_controller.rb` | `find_and_authorize_requested_item` hook |
