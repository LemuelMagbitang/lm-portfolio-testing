# Curated Views

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

## Data model direction

The Curated View record should contain stable view identity plus an ordered list of project entries. Entries should distinguish ownership explicitly rather than duplicating main project records.

Conceptual shape:

```json
{
  "id": "anime-illustration",
  "name": "Anime Illustration",
  "slug": "anime-illustration",
  "projects": [
    { "source": "main", "projectId": "friends-gacha" },
    {
      "source": "curated",
      "project": {
        "id": "anime-illustration-character-study",
        "title": "Character Study",
        "subtitle": "...",
        "filters": [],
        "media": []
      }
    }
  ]
}
```

The exact persisted schema remains subject to the implementation audit. The important contract is that main references stay references and curated-only projects remain owned by the view.

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
