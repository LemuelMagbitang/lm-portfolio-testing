# Portfolio Architecture

## Public site

The public site is a static GitHub Pages application.

```
HTML
  |
  +-- js/script.js          bootstrap + shared page behavior
  +-- js/site-runtime.js    root paths + lazy external runtime libraries
  +-- js/cms-data.js        shared CMS JSON loading
  +-- js/gallery.js         filters + responsive gallery state
  +-- js/hero.js            hero media and transitions
  +-- js/lightbox.js        modal/media lifecycle
  +-- js/model-viewer.js    Three.js lifecycle and cleanup
  +-- js/media-background.js shared media background rendering
  |
  +-- data/*.json           CMS-managed content
  +-- assets/**              portfolio media
```

Feature modules should own one subsystem. `script.js` should remain an orchestration/bootstrap layer instead of becoming a second monolith.

## CMS

The CMS is a browser-based editor that writes content directly to GitHub.

Single-file saves use GitHub's Contents API with the current blob SHA, which prevents overwriting a newer version accidentally.

Cross-file saves use the Git Database API:

```
branch head
   -> blobs
   -> tree
   -> commit
   -> non-forced branch update
```

This is used where data must remain consistent across files, such as filter definitions plus project tags and hero-loop entries plus hero timing settings.

## Failure containment

The public bootstrap uses a top-level error boundary and isolates hero initialization. Feature code is loaded lazily where practical.

The 3D viewer:

- does not start an animation loop until activated;
- observes its container for resize;
- disposes geometries, textures, materials, controls, animation frames, observers, and the renderer on cleanup;
- refuses to mount into a detached or already-closed lightbox target.

## Validation

`tools/validate-site.mjs` is the repository's static safety net. It validates data relationships, local asset references, supported media, risky paths, token/private-key patterns, CMS storage contracts, architecture contracts, lightbox lifecycle contracts, and JavaScript syntax.

GitHub Actions runs this validator on pushes and pull requests.

## Branching model

Production should be treated as:

```
feature/* or security/*
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

The CMS may continue to support direct commits for convenience during development, but the repository owner should protect `main` and require the validation check before merging code changes.

