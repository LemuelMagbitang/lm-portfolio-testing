# Architecture Change Matrix

This document defines what should be able to change independently in the portfolio.

The goal is runtime reliability plus freedom to redesign the UI/UX. The folder structure itself is not the goal.

## Change boundaries

| Area | Should be able to change without rewriting | Should depend on |
| --- | --- | --- |
| Project content | Gallery, cards, lightbox | Project data contract |
| Project data provider | Project presentation | Normalized data contract |
| Project card UI | CMS, project data, lightbox internals | Project model + media capabilities |
| Gallery UI | CMS and project storage | Project/card public API |
| Lightbox UI | CMS and project storage | Active project/media contract |
| Mobile presentation | CMS/data model | Feature behavior + presentation layer |
| Desktop presentation | CMS/data model | Feature behavior + presentation layer |
| Gallery presentation | Gallery state, CMS, Lightbox internals | Gallery state contract + presentation API |
| Project media capability model | Project storage/provider | Normalized project contract |
| Lightbox project content | Card markup, CMS transport | Normalized project contract |
| Hero presentation | Project storage | Hero data contract |
| Reviews presentation | Reviews JSON shape | Review data contract |
| GitHub transport | Projects, gallery, lightbox | CMS/content-provider contract |
| Lottie integration | Project data and card contract | Media capability |
| YouTube integration | Project data and gallery behavior | Media capability |
| 3D viewer implementation | Project data and unrelated UI | 3D/media capability |

## The practical test

A proposed change is architecturally healthy when the affected boundary can be changed without modifying unrelated boundaries.

Examples:

- Replace a project grid with an editorial feed: project data should remain unchanged.
- Replace the lightbox with a full-screen viewer: CMS loading should remain unchanged.
- Change mobile card composition: CMS normalization should remain unchanged.
- Replace GitHub as the content provider: project presentation should remain unchanged.
- Replace a media vendor: project content should remain unchanged.

## What should not happen

Avoid dependencies such as:

```text
UI layout -> CMS JSON details
Lightbox -> GitHub API
Project data -> CSS class names
CMS transport -> gallery implementation
Mobile layout -> content-storage decisions
```

These dependencies make future redesigns expensive and fragile.

## Avoid over-decoupling

Do not create an abstraction merely because it is possible.

A boundary is justified when one of these is true:

1. The responsibility changes independently.
2. The implementation may reasonably be replaced.
3. Failure should be isolated from the rest of the site.
4. The boundary makes testing or validation materially easier.
5. The boundary protects the CMS/data model from presentation decisions.

If none apply, keep the implementation simple.

## Current migration strategy

The repository is intentionally in a transitional state. Legacy modules may remain temporarily while their replacement becomes the single authoritative implementation.

Migration rule:

```text
new boundary
  -> wire into runtime
  -> verify behavior
  -> remove duplicate legacy implementation
  -> enforce boundary with validation
```

Never maintain two authoritative implementations of the same feature longer than necessary.
