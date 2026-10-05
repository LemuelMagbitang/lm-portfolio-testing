# Portfolio Architecture

## Public site

The public site is a static GitHub Pages application with an explicit bootstrap/composition boundary:

```text
HTML
  |
  +-- js/script.js                 tiny ES-module entrypoint
  |      |
  |      v
  +-- js/app/bootstrap.js          startup, config, error containment
  |      |
  |      v
  +-- js/app/page-composition.js   page -> feature/infrastructure wiring
  |
  +-- js/core/config.js             normalized page configuration
  +-- js/data/*.js                  CMS -> stable runtime models
  +-- js/features/*                 independent page features
  +-- js/infrastructure/*           vendor/browser/service adapters
  +-- data/*.json                   CMS-managed content
  +-- assets/**                     portfolio media
```

The public runtime no longer depends on the retired `js/cms-data.js`, `js/site-runtime.js`, `js/gallery.js`, `js/hero.js`, `js/lightbox.js`, or `js/model-viewer.js` facades.

## Composition and feature boundaries

`js/app/page-composition.js` is the only place that wires the public feature graph. Features expose public entry points instead of importing each other's private implementation files.

Current feature entry points include Projects, Gallery, Hero, Lightbox, Navigation, Reviews, About, Forms, and Site Settings. Gallery presentation mechanics are separated into its own presentation boundary, and Projects exposes a stable card-to-normalized-project lookup for consumers such as Lightbox.

Gallery owns filter state and exposes the active-card contract consumed by Lightbox. Hero and Lightbox expose teardown methods, and the composition root calls them from `app.destroy()` so persistent listeners and timers can be released deterministically.

## Data boundary

CMS JSON is loaded through the CMS infrastructure adapter and normalized before feature code consumes it. Settings are normalized into stable runtime values such as:

```text
heroTiming.loopMode
heroTiming.transitionStyle
heroTiming.crossfadeMs
```

Feature code does not need to know whether content came from GitHub-backed JSON, local data, or another loader implementation.

## Infrastructure boundaries

Vendor and browser-specific capabilities are isolated behind adapters:

```text
Three.js            -> infrastructure/three
Lottie              -> infrastructure/lottie
Media backgrounds   -> infrastructure/media-background
YouTube parsing     -> infrastructure/youtube
Site/path resolution -> infrastructure/browser
CMS JSON loading    -> infrastructure/cms
```

This keeps replaceable infrastructure out of feature contracts.

## CMS

The CMS is a separate browser-based editor that writes content directly to GitHub.

Single-file saves use GitHub's Contents API with the current blob SHA, preventing accidental overwrites of newer content.

Cross-file saves use the Git Database API:

```text
branch head
   -> blobs
   -> tree
   -> commit
   -> non-forced branch update
```

The public site and CMS are separate application surfaces that share repository content; the public runtime does not import CMS implementation code.

## Curated View architecture

Curated Views are a separate presentation context layered over the existing project architecture. They are not additional main-gallery filters and do not require a second renderer or a second project schema.

A Curated View can contain either references to projects owned by the Main Portfolio or projects owned only by that Curated View. Main projects remain the source of truth when referenced; Curated-only projects reuse the same normalized project contract but are stored under Curated View ownership and never enter the Main Portfolio dataset unless explicitly promoted later.

The CMS will expose Curated Views as a separate tab using the existing compact expandable editor pattern. Adding an existing project selects from the Main Portfolio project registry. Creating a project inside a Curated View uses the same project-editor capabilities but persists the new project only within that view. Removing or deleting from a Curated View must never mutate a Main Portfolio project. See `docs/CURATED-VIEWS.md` for the ownership and navigation contract.

At runtime, Curated View resolution must happen before Gallery and Lightbox receive their project sets. The active hash identifies the presentation context, so refresh, Work navigation, About -> Work, logo navigation, and Lightbox navigation preserve the active Curated View. Curated View names must never be added to the main Gallery filter taxonomy.

## Failure containment

The public bootstrap has a top-level error boundary and contains Hero initialization so a hero-specific failure does not blank the rest of the page.

The 3D viewer is lazy and disposes its renderer, controls, observers, animation resources, and document listeners during cleanup. Shared feature lifecycle primitives are used where multiple long-lived feature resources need the same teardown contract. Lightbox also disposes mounted 3D shells before replacing its media container.


## Runtime stabilization contracts

The initial portfolio transition is a readiness gate, not a progress UI. Bootstrap keeps the original logo-only loading surface visible while application composition completes and the browser gets two paint opportunities to commit the finished DOM. The page uses `body[aria-busy]` during that handoff and clears it only after the application is ready.

Gallery expansion is user-owned UI state. Resize and BFCache `pageshow` events may recompute the clipping geometry, but they never toggle `isExpanded`. Only a Show More/Show Less click or an explicit filter change is allowed to change that state. The dedicated `#portfolioGridViewport` owns clipping; the grid itself keeps its natural height.

The Lightbox owns playback handoff. Native video uses the media play lifecycle; YouTube receives the user's gesture directly and uses its cross-origin playing-state message only for cross-player cleanup. Pointer/focus handlers do not intercept YouTube taps. All YouTube listeners are disposed with the current media container so navigation cannot accumulate global playback listeners.

Lightbox media styling has one scoped ownership layer. Orientation classes live on the actual media and its `.lightbox-artwork` surface, while captions remain outside the artwork surface. Lightbox navigation controls use normal compositing with transparent backgrounds/borders and a small brand-dark text-shadow edge, so their contrast stays readable without blend-mode surprises or a bright control box. Future responsive fixes should modify that ownership layer rather than reintroducing global `.yt-*` rules or duplicate media selectors.

The CMS remains a separate application boundary. Provider failures in enhancement-only software-logo discovery are contained locally so editing and saving content remain usable. Repository writes continue through the existing optimistic branch-head check and atomic multi-file commit path.

## Validation

`tools/validate-site.mjs` validates data relationships, local asset references, supported media, risky paths, CMS storage contracts, the ES-module bootstrap contract, feature lifecycle contracts, and JavaScript syntax.

GitHub Actions runs the site validator, architecture validator, project data contract, Projects runtime boundary validator, and syntax checks on pushes and pull requests. The validation workflow uses immutable action commit pins.

## Branching model

Production should be treated as:

```text
feature/*
    |
    v
pull request
    |
    v
validation
    |
    v
main
    |
    v
GitHub Pages
```

The `projects-runtime-cutover` branch is the current architecture work surface. It should not be treated as production-ready merely because Pages can publish it; the validation gate and browser QA must both pass before merging toward `main`.
