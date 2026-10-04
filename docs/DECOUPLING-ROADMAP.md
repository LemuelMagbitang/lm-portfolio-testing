# Decoupling Roadmap

This is the implementation roadmap for converting the portfolio into a highly decoupled, plug-and-play static application without changing its visual language or CMS data model unnecessarily.

## Current implementation checkpoint

As of October 4, 2026, the branch has completed the composition/data-boundary cutover and is in Phase 3A presentation hardening without intentionally changing the public visual baseline:

- `js/script.js` is a 19-line browser entrypoint.
- `js/app/bootstrap.js` owns startup/error containment and passes normalized application configuration into the composition root.
- `js/app/page-composition.js` is the explicit wiring layer for page features and infrastructure.
- Projects, Gallery, Hero, Lightbox, Navigation, Reviews, About, Forms, and Settings now have feature entry points.
- CMS project data and site settings are normalized before presentation.
- Three.js, media-background, YouTube parsing, Lottie loading, site paths, and reduced-motion are isolated behind infrastructure modules.
- The obsolete `cms-data.js` and `site-runtime.js` runtime facades have been removed.
- Gallery is the single owner of project-filter state; Lightbox consumes Gallery's active-project contract rather than maintaining a second filter model.
- Architecture and site validators were updated to enforce the new boundaries.
- The validation workflow now includes a real Chromium smoke test covering Works, About, Hero rendering/looping, CMS filters/ALL, and About resume/software content at desktop, phone, and tablet sizes.
- The browser smoke gate has passed on the current runtime cutover after fixing the public ES-module boot path, Hero initialization, CMS filter reconstruction, About CMS rendering, and the CMS 3D preview adapter path.
- Gallery state now consumes a separate presentation boundary for responsive density, row-aware reveal/collapse, and reset behavior.
- Shared feature lifecycle management now centralizes listener/timer/animation cleanup without introducing cross-feature state.
- Project normalization now exposes media capabilities and preserves thumbnail orientation as part of the stable application model.
- Lightbox now consumes normalized project models through the Projects public API instead of reading project-card markup.
- Lightbox startup no longer waits for the full-project media warm-up; media preloading runs as a background cache warm-up.
- Lightbox media loading is progressive: the first image/video/YouTube item is prioritized while later media is deferred.
- Lightbox navigation controls remain transparent and blend-based, with the rectangular focus/tap artifact removed.
- Gallery row-alignment now derives its column count from the actual grid geometry, avoiding incorrect Show More thresholds while previous-filter cards are still fading out.
- Cache-version references were refreshed for the changed public CSS/bootstrap/Gallery/Lightbox modules.
- The edited public modules were structurally syntax-checked after the latest changes.

Phase 3A has therefore started: the architecture is being shaped specifically to support major UI/UX changes without rewriting CMS data, project transport, or media infrastructure. The immediate work remains targeted hardening and presentation ownership, not a visual redesign by itself.

The deployment gate is intentionally separate from architectural completion: the public pages must load `js/script.js` as an ES module, each page must provide the import map required by optional vendor infrastructure, and the latest branch commits still require GitHub Actions/browser deployment verification before merge toward `main`.

## Target architecture

```text
js/
├── app/
│   ├── bootstrap.js              # composition root
│   └── page-composition.js       # page -> feature wiring
│
├── core/
│   ├── config.js                 # normalized site configuration
│   ├── dom.js                    # narrow DOM helpers
│   ├── events.js                 # local event contracts
│   ├── lifecycle.js              # cleanup/disposal primitives
│   └── errors.js                 # failure containment
│
├── data/
│   ├── cms-loader.js             # CMS content retrieval
│   ├── normalizers.js            # CMS -> runtime models
│   └── schemas.js                # runtime contracts
│
├── features/
│   ├── gallery/
│   │   ├── index.js
│   │   ├── state.js
│   │   ├── view.js
│   │   └── controller.js
│   ├── lightbox/
│   ├── hero/
│   ├── model-viewer/
│   ├── media-background/
│   ├── navigation/
│   └── contact/
│
└── infrastructure/
    ├── github/
    ├── browser-storage/
    ├── lottie/
    ├── three/
    ├── youtube/
    └── web3forms/
```

The exact split may change during implementation. The dependency boundaries are more important than the folder names.

## Migration strategy

### Stage 0 — completed

- Preserve the current visual baseline.
- Preserve the CMS JSON contract.
- Add architecture documentation.
- Add an architecture dependency validator.
- Add the validator to CI.
- Create a recovery branch before structural migration.

### Stage 1 — composition root

Reduce `js/script.js` to bootstrap/composition responsibilities only.

Move feature implementation out of the root controller without changing behavior.

The bootstrap should be able to express the page approximately as:

```js
const app = createPortfolioApp({
  runtime,
  data,
  features: {
    navigation,
    hero,
    gallery,
    lightbox,
    modelViewer,
    contact
  }
});

await app.start();
```

### Stage 2 — data boundary

Normalize CMS JSON before it reaches UI features.

Example:

```text
CMS JSON
   ↓
loader
   ↓
normalizer
   ↓
PortfolioProject[]
   ↓
feature modules
```

Features should not need to know whether content came from GitHub, a local fallback, or a future backend.

### Stage 3 — infrastructure adapters

Move vendor-specific code behind adapters.

Examples:

```text
Three.js      -> model-viewer adapter
Lottie        -> lottie adapter
GitHub API    -> repository adapter
Web3Forms     -> contact adapter
YouTube       -> video adapter
Storage API   -> browser-storage adapter
```

This permits replacement or removal of a vendor without changing the feature's public contract.

### Stage 4 — feature ownership

Each feature receives:

- explicit root element(s)
- normalized input data
- configuration
- callbacks/events
- lifecycle cleanup

A feature must not search the whole page for unrelated elements as an implicit dependency.

### Stage 5 — state isolation

Remove shared mutable state from the global/root controller.

Each feature owns its own state. Cross-feature communication uses explicit events or callbacks.

### Stage 6 — CSS ownership

Replace historical override layers with component-owned styles.

The objective is not more CSS files. The objective is that a component's responsive, interactive, and visual states live together and can be replaced without fighting unrelated selectors.

### Stage 7 — CMS application boundary

The public site must never import CMS implementation code.

The CMS should be decomposed separately into:

```text
admin/
├── app/
├── features/
│   ├── editor/
│   ├── media-library/
│   └── connection/
├── infrastructure/
│   ├── github-api/
│   └── storage/
└── core/
```

The CMS and public portfolio are two applications sharing repository content—not one application with two pages.

### Phase 3A — UI foundation / presentation hardening

Before changing the portfolio's visual language, stabilize the contracts that future presentation work will sit on:

1. Gallery state must not own grid/layout decisions.
2. Project cards and Lightbox must consume normalized project data rather than scraping each other's DOM.
3. Shared lifecycle cleanup must be deterministic.
4. Project media capabilities must be part of the stable model, not inferred repeatedly by UI components.
5. CSS duplication and override layers should be reduced before introducing a new presentation system.

### Phase 3B — dynamic project cards

Once the presentation boundary is stable, make cards media-capability aware while keeping the CMS/project data contract unchanged.

### Phase 3C — lightbox media viewer

Treat the Lightbox as a media-viewer product surface with independent presentation, navigation, orientation, and media capability handling.

### Phase 3D — content-independent responsive UX

Viewport behavior should be presentation configuration, not a storage or content concern.

### Stage 8 — removal

After each feature is migrated and validated:

1. remove the old implementation;
2. search for references to it;
3. run the site validator;
4. run the architecture validator;
5. run syntax checks;
6. perform browser/device QA;
7. remove obsolete compatibility code.

Do not keep old and new implementations permanently “just in case.” That creates two sources of truth.

## Definition of done

The architecture migration is complete when:

- `script.js` is a small composition root;
- each feature has one public entry point;
- feature state is private;
- CMS data is normalized before presentation;
- vendor APIs are isolated in infrastructure adapters;
- no feature imports another feature's private implementation;
- feature cleanup is deterministic;
- UI redesigns do not require changes to unrelated feature internals;
- the CMS is independently deployable as an application surface;
- CI rejects architecture-boundary violations;
- the production visual baseline remains intentionally unchanged until a UI change is requested.

## Non-goals

This migration must not:

- introduce a framework merely for architecture's sake;
- rewrite the visual design;
- replace the existing CMS data model without a demonstrated need;
- add abstractions that have no consumer;
- create dozens of tiny files with no meaningful ownership boundary;
- preserve deprecated Phase 2.1 redesign layers.
