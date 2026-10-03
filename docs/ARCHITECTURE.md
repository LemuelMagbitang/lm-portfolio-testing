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

Current feature entry points include Projects, Gallery, Hero, Lightbox, Navigation, Reviews, About, Forms, and Site Settings.

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

## Failure containment

The public bootstrap has a top-level error boundary and contains Hero initialization so a hero-specific failure does not blank the rest of the page.

The 3D viewer is lazy and disposes its renderer, controls, observers, animation resources, and document listeners during cleanup. Lightbox also disposes mounted 3D shells before replacing its media container.

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
