# Decoupling Roadmap

This is the implementation roadmap for converting the portfolio into a highly decoupled, plug-and-play static application without changing its visual language or CMS data model unnecessarily.

## Current implementation checkpoint

As of October 5, 2026, the projects-runtime-cutover branch has completed the composition/data-boundary cutover and the core feature extraction. It is currently in **Phase 3B/3C hardening** while the CMS application boundary continues to be tightened. This work intentionally preserves the existing visual language rather than redesigning it.

- `js/script.js` is a 19-line browser entrypoint; startup and page wiring live in `js/app/bootstrap.js` and `js/app/page-composition.js`.
- Projects, Gallery, Hero, Lightbox, Navigation, Reviews, About, Forms, and Settings have explicit feature entry points.
- CMS JSON is normalized before it reaches public presentation features; project media capabilities and thumbnail orientation are part of the runtime project model.
- Vendor-specific concerns are isolated behind infrastructure adapters for Three.js, Lottie, YouTube parsing, media backgrounds, site paths, reduced motion, and CMS loading.
- The obsolete `cms-data.js` and `site-runtime.js` facades and the old monolithic `gallery.js`, `hero.js`, and `lightbox.js` runtime implementations have been removed from the active architecture.
- Gallery owns filter state and exposes the active-project contract; Lightbox consumes that contract instead of maintaining a second gallery/filter model.
- Shared feature lifecycle cleanup now centralizes listener, timer, and animation disposal without making features share mutable state.
- Gallery presentation owns responsive density, row-aware Show More/Show Less reveal, collapsed viewport geometry, and reset behavior rather than Gallery state owning CSS/layout decisions.
- Lightbox now handles progressive media loading, image/video/YouTube/Lottie/3D rendering, playback handoff, orientation, focus restoration, swipe navigation, and scoped artwork backgrounds.
- The browser smoke suite covers the ES-module boot path, Works/About, mobile navigation, filters/ALL, Show More state across pageshow/resize/Lightbox close, local-video pause handoff, YouTube handoff/cache reuse, intrinsic video ratios, Shorts framing, 3D focus mode, software logos, and CMS editor fixtures.
- Latest verified CI is green at `a2df35d6dd276340ff0c23407a44a9708e2e1939` (`Sync About runtime cache after model preload contract clarification`, October 5, 2026 22:47 PHT). The `Validate portfolio` job passed site/data/path validation, architecture boundaries, project data contracts, Projects runtime, Gallery presentation, lifecycle, all JavaScript/CMS/smoke syntax checks, and Chromium browser smoke. The Pages build and deployment run for the same commit also succeeded. An earlier YouTube-footprint smoke run on `be63fae28150746ba474deb8e026b5bd4410b55f` failed; the current head is the subsequent green validation state.
- The CMS now has a **Curated Views** editor. It can create unlisted view records, reference Main Portfolio projects, create view-owned projects, reorder entries, and preserve ownership boundaries. Public Curated View hash routing is intentionally **not** enabled yet.
- Runtime cache-busting is intentionally feature-local rather than globally synchronized. The latest composition/page cache key is `20261005-28`; feature modules carry their own query versions. Any source change must bump every affected public import/preload reference so GitHub Pages cannot serve a stale module.

### Current focus

Phase 3B/3C is now about hardening the behavior that users actually exercise: Show More state stability, media playback lifecycle, intrinsic media sizing, Lightbox layering/contrast, 3D/Lottie isolation, public navigation, and remaining About/CMS edge cases. Curated Views is being hardened as a CMS boundary without coupling it into the public Gallery until its runtime contract is ready.

The deployment gate remains separate from architectural completion: each public-page runtime commit must pass the GitHub Actions validation/Chromium gate before it is considered a safe cutover candidate for the eventual replacement of the legacy deployed site.

### R/W/E audit checkpoint — October 5, 2026

The current implementation is no longer in structural migration. The remaining risk is concentrated in runtime edge cases and presentation ownership, not in the basic decoupling model.

- **Architecture:** validated at the current head; legacy root controllers are removed and the browser entrypoint remains thin.
- **Gallery:** the state contract is correct in code and covered by browser regressions for resize, pageshow, scrolling, collapse/expand, and Lightbox return. The remaining requirement is real-device confirmation that no browser-specific layout restoration regression remains.
- **Lightbox/media:** image, local video, YouTube, Lottie, and 3D paths are structurally separated. Playback handoff and intrinsic sizing are covered by smoke tests. Mobile YouTube first-tap behavior remains a real-device QA item because third-party iframe behavior cannot be fully certified by a mocked Chromium test.
- **3D/Lottie:** artwork backgrounds are scoped to the artwork surface; 3D focus uses an explicit stacking model and a dedicated Back control. The remaining work is visual/interaction QA across actual devices and model assets.
- **CSS:** the ownership layer is substantially established, but the stylesheet still contains historical duplicate/override regions. Consolidation is a polish/hardening task, not a prerequisite for the current runtime contract.
- **About/CMS:** software-logo lookup has contained fallbacks and the Curated Views CMS boundary is active. Public Curated View routing remains intentionally disabled until its resolver contract is complete.

The immediate next engineering stage is **runtime hardening + cross-device verification**, followed by the full content-independent responsive pass. Final visual polish should begin only after those gates are stable.
## Current architecture shape and target direction

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

The tree above is the current architectural shape at the branch checkpoint, not a requirement that every historical target filename exist verbatim. The dependency boundaries are more important than folder names. Where the implementation uses a different concrete module name (for example `project-normalizer.js` or `infrastructure/cms`), the boundary is considered satisfied by ownership rather than by filename.

## Migration strategy

### Stage 0 — completed

- Preserve the current visual baseline.
- Preserve the CMS JSON contract.
- Add architecture documentation.
- Add an architecture dependency validator.
- Add the validator to CI.
- Create a recovery branch before structural migration.

### Stage 1 — composition root — completed

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

### Stage 2 — data boundary — completed

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

### Stage 3 — infrastructure adapters — completed

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

### Stage 4 — feature ownership — completed

Each feature receives:

- explicit root element(s)
- normalized input data
- configuration
- callbacks/events
- lifecycle cleanup

A feature must not search the whole page for unrelated elements as an implicit dependency.

### Stage 5 — state isolation — completed

Remove shared mutable state from the global/root controller.

Each feature owns its own state. Cross-feature communication uses explicit events or callbacks.

### Stage 6 — CSS ownership — in progress

Replace historical override layers with component-owned styles.

The objective is not more CSS files. The objective is that a component's responsive, interactive, and visual states live together and can be replaced without fighting unrelated selectors.

### Stage 7 — CMS application boundary — in progress

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

### Phase 3A — UI foundation / presentation hardening — contract achieved; CSS consolidation remains

Before changing the portfolio's visual language, stabilize the contracts that future presentation work will sit on:

1. Gallery state must not own grid/layout decisions.
2. Project cards and Lightbox must consume normalized project data rather than scraping each other's DOM.
3. Shared lifecycle cleanup must be deterministic.
4. Project media capabilities must be part of the stable model, not inferred repeatedly by UI components.
5. CSS duplication and override layers should be reduced before introducing a new presentation system.

### Phase 3B — dynamic project cards — active hardening phase

Once the presentation boundary is stable, make cards media-capability aware while keeping the CMS/project data contract unchanged.

### Phase 3C — lightbox media viewer — active hardening phase

Treat the Lightbox as a media-viewer product surface with independent presentation, navigation, orientation, and media capability handling.

### Phase 3D — content-independent responsive UX — pending full validation pass

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
