# CMS Boundary Guide

This is a practical guide for understanding the portfolio CMS architecture.

## What the CMS is doing today

The portfolio stores editable content in JSON files such as:

```text
data/
├── projects.json
├── settings.json
├── hero.json
├── reviews.json
├── filters.json
└── about.json
```

GitHub currently acts as the repository/storage layer for those files. The public website reads the JSON at runtime.

The CMS editor in `admin/` is a separate application that writes changes back to the repository.

## The important distinction

There are three different responsibilities:

```text
CMS UI
  = lets you edit content

Content provider / transport
  = retrieves or writes content

Content model
  = defines what the content means
```

They should not become one giant system.

## Example: projects

The intended flow is:

```text
CMS editor
   |
   v
projects.json
   |
   v
content provider
   |
   v
CMS loader
   |
   v
project normalizer
   |
   v
stable project model
   |
   +-------------------+
   |                   |
   v                   v
project cards       lightbox/gallery
```

The UI should consume the normalized project model rather than knowing how GitHub stores the JSON.

## Why normalization matters

CMS data is allowed to evolve. A future CMS may call a field `thumbnail`, use a different media representation, or return additional metadata.

The normalizer is the controlled translation point:

```text
external CMS shape
       |
       v
normalizer
       |
       v
application shape
```

This prevents CMS-specific decisions from spreading through the UI.

## What changing the CMS should look like

If GitHub is replaced later, the desired change is approximately:

```text
OLD
GitHub -> CMS loader -> normalized data -> UI

NEW
API / headless CMS -> CMS loader -> normalized data -> UI
```

The project card, gallery, and lightbox should not need to know which provider was selected.

## What should stay out of content data

Do not put presentation implementation details into project content merely because the UI currently needs them.

Good content data:

```json
{
  "title": "Example Project",
  "filters": ["3d-motion"],
  "thumbnail": { "type": "image", "src": "..." },
  "media": [ ... ]
}
```

Potentially fragile presentation coupling:

```json
{
  "mobileGridColumn": 2,
  "lightboxWidth": "92vw",
  "cardAnimation": "..."
}
```

The latter makes a visual redesign depend on content migration.

## Security boundary

The public website should only need the minimum capability required to read public content.

Repository-writing capabilities belong to the CMS/admin side, not to ordinary portfolio presentation code.

The current repository security model documents the browser-side limitations separately; this guide does not treat the current GitHub-backed CMS as a final security architecture.

## For Lem's workflow

When you ask for a major redesign, the desired process is:

```text
keep content
    |
keep data contract
    |
replace presentation
    |
validate behavior
```

When you ask to change the CMS:

```text
keep content meaning
    |
replace provider/transport
    |
keep normalized application data
    |
keep UI
```

This is why the CMS architecture is being separated now: it protects future UI/UX freedom rather than adding abstraction for its own sake.
