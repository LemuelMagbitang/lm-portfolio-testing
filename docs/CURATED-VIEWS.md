# Curated Views

## Current implementation status

The Curated Views CMS editor is now enabled on the projects-runtime-cutover branch. Public Curated View hash routing/rendering is intentionally not enabled yet; the CMS and persistence contract are being hardened first.

## Purpose

Curated Views are saved, unlisted presentations of the same portfolio application. They do not create another website, another gallery system, or another copy of the main project database.

A Curated View is addressed by an automatically generated hash slug, for example:
- `/#3d`
- `/#anime-illustration`
- `/#motion`

The main portfolio remains the default when no Curated View hash is present.

## Project ownership

A Curated View may contain two kinds of projects:

1. **Main Portfolio reference** — an existing project created and managed in the main Projects CMS section.
2. **Curated-only project** — a complete project created from the Curated Views CMS section and owned only by that Curated View.

Both kinds must use the same normalized project contract, media types, thumbnail behavior, Lightbox behavior, and presentation capabilities. The distinction is ownership, not a second project format.

Conceptually:

```text
Main Portfolio
  └── project A ───────────────┐
                                ├── Curated View: #3d
Curated View: #3d               │
  ├── reference -> project A ──┘
  └── curated-only project B
```

A curated-only project must never be inserted into the main Projects dataset merely because it uses the same editor. It is visible only through the Curated View that owns it.

## Persisted data contract

The first persisted registry is `data/curated-views.json`, an array of view records. Each view has stable identity plus an ordered list of project entries. Entries distinguish ownership explicitly rather than duplicating Main Portfolio records.

The contract is:

```json
[
  {
    "id": "anime-illustration",
    "name": "Anime Illustration",
    "slug": "anime-illustration",
    "projects": [
      { "source": "main", "projectId": "friends-gacha" },
      {
        "source": "curated",
        "project": {
          "id": "character-study",
          "title": "Character Study",
          "subtitle": "...",
          "filters": [],
          "thumbnail": {},
          "media": []
        }
      }
    ]
  }
]
```

Contract rules:

- `id` and `slug` are stable URL identity and must match a lowercase hyphenated slug.
- View IDs and slugs are unique.
- `projects[]` order is the Curated View presentation order.
- `source: "main"` stores only a `projectId`; Main Portfolio remains the source of truth.
- `source: "curated"` stores a complete project object owned by that view.
- Curated-only project IDs must not collide with Main Portfolio project IDs and must be unique within their owning view.
- Curated-only projects must keep `filters: []`; they are not members of the Main Gallery filter taxonomy.
- Both project kinds use the same normalized project/media contract. The distinction is ownership, not rendering format.
- The validator checks local media/background references and supported media types for curated-owned projects.

The registry is intentionally initialized empty until an author creates a view. The CMS editor and persistence path are now implemented; the public runtime resolver remains a later phase. Main Portfolio behavior is unchanged.

## Shared project editor boundary

The CMS should use one project editor for both ownership scopes. The editor writes the same project contract in either context; the save policy decides whether Main Portfolio filters are required and whether the result is persisted to `data/projects.json` or embedded as a Curated View-owned project.

The current CMS now isolates two reusable editor operations:

- `validateProjectEditorModel(project, { requireFilters })`
- `serializeProjectEditorModel(project)`

Main Portfolio currently calls the validator with `requireFilters: true`. Curated Views can later call the same editor with filters disabled without creating a second project schema or serializer.

This is currently an editor/persistence boundary. The Curated Views CMS UI is enabled, while public Curated View runtime routing is intentionally deferred until its resolver contract is implemented.

## CMS behavior

The CMS gets a dedicated **Curated Views** tab. It uses the existing compact expandable card/editor pattern.

Creating a view should require only a name. The hash is generated automatically from a validated slug; the author does not type `#`.

Inside an expanded Curated View:

- **Add existing project** opens a picker backed by the main Projects dataset.
- **Create project** opens the same project editor capabilities used by the main Projects section, but saves the new project inside the current Curated View only.
- Existing-project removal removes only that view's reference.
- Curated-only project deletion removes only that view-owned project.
- No Curated View action may delete or mutate a main project.
- Project ordering belongs to the Curated View and must not reorder the main portfolio.
- Copy Link copies the generated unlisted URL.

The create/edit project UI should share the same project-editor building blocks rather than maintaining two divergent project schemas.

## Public runtime behavior

A Curated View is a navigation/presentation context, not a main Gallery filter.

When `/#slug` resolves to a valid Curated View:

- only projects in that view are rendered;
- the main Gallery filter taxonomy is not expanded with Curated View names;
- Lightbox navigation is limited to the active Curated View project set;
- refresh preserves the Curated View through the hash;
- logo/work navigation preserves the active Curated View context;
- About -> Work preserves the active Curated View context;
- removing a main project automatically invalidates/removes its references from affected views rather than leaving stale entries;
- direct navigation to the normal root remains the full main portfolio.

An unknown hash must not silently become a Curated View. It should continue to follow the existing main-filter/hash behavior or default safely according to the router contract.

## Unlisted is not access control

An Unlisted Curated View is discoverable by anyone who has the URL. It is not authentication, authorization, or confidential storage. The CMS should therefore describe it as **Unlisted**, not private.

## Safety invariants

1. Main project data is the source of truth for referenced projects.
2. Curated View edits cannot mutate main project content.
3. Curated-only projects cannot appear in the main gallery, filters, hero, or normal project counts unless explicitly promoted into the main portfolio later.
4. A Curated View must not create a second media/rendering implementation.
5. The main gallery/grid remains unchanged by the Curated View architecture.
6. Curated View state is resolved before Gallery and Lightbox consume their project sets.
7. Project IDs must remain collision-safe across main and curated-only scopes.
8. Deleting a Curated View must delete only its view-owned records and references, never main projects.
9. Deleting a main project must clean up references without deleting unrelated Curated Views.

## Future promotion

A curated-only project may eventually be promoted into the main portfolio without rebuilding its media/editor content. Promotion is optional future functionality, but keeping the same normalized project contract makes that migration possible.
