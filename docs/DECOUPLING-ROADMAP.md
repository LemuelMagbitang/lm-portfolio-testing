# Decoupling Roadmap

This is the implementation roadmap for converting the portfolio into a highly decoupled, plug-and-play static application without changing its visual language or CMS data model unnecessarily.

## Current implementation checkpoint

As of October 10, 2026, the `projects-runtime-cutover` branch has completed the composition/data-boundary cutover and core feature extraction. The active work remains **Phase 3B/3C runtime hardening**, with CSS ownership and the CMS application boundary still in progress. Keep the current portfolio design: there is **no broader redesign in scope**. Priorities are targeted visual bug/glitch fixes, structural decoupling, CMS/Lighbox polish, optimization, and cross-device verification.

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
- Latest verified foil implementation checkpoint: `61434caec2f1c6720246cfbd62c3f91c11348b80` (`Update foil validators for alpha clipping and tile maps`). The [Validate portfolio run #38051237773](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38051237773) and [Pages build/deploy run #38051237698](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38051237698) completed successfully; all four reported checks (`validate`, `build`, `deploy`, `report-build-status`) are green, including Chromium browser smoke tests. The user reference recording was subsequently committed to the same active branch in `22255e4df52ca68805d53e488e3f5144ec9cb134` at `foil-test-screenrecord/2026-10-10 18-55-17.mp4`; its [validation run #38052177916](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38052177916) and [Pages build/deploy run #38052177516](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38052177516) also completed successfully. Automated CI does not replace visual or real-device QA.
- The contact form fallback fix separates project-inquiry and review `mailto:` routing and validates routing/teardown in `tools/validate-forms.mjs`. Cache keys are part of the architecture contract and must remain aligned across public imports, test harnesses, and preload/script entry points.
- The CMS now has a **Curated Views** editor. It can create unlisted view records, reference Main Portfolio projects, create view-owned projects, reorder entries, and preserve ownership boundaries. Public Curated View hash routing is intentionally **not** enabled yet. The architecture validator now also guards this separation by rejecting public-runtime imports and public-page script/preload references to `admin/*.js`.
- Runtime cache-busting is intentionally feature-local rather than globally synchronized. The current foil renderer import is `?v=20261010-05`; the Lightbox media renderer and entry are `?v=20261010-09`; the shared stylesheet is `?v=20261010-09`; the public bootstrap/page composition chain is `20261010-11`. `index.html`, `about/index.html`, `404.html`, and `success/index.html` are aligned. Any future source change must bump all affected public import/preload references without unnecessarily invalidating unrelated modules.

### Current focus

Phase 3B/3C is now about hardening the behavior that users actually exercise: Show More state stability, media playback lifecycle, intrinsic media sizing, Lightbox layering/contrast, 3D/Lottie isolation, public navigation, and remaining About/CMS edge cases. Curated Views is being hardened as a CMS boundary without coupling it into the public Gallery until its runtime contract is ready.

The deployment gate remains separate from architectural completion: each public-page runtime commit must pass the GitHub Actions validation/Chromium gate before it is considered a safe cutover candidate for the eventual replacement of the legacy deployed site.

### R/W/E audit checkpoint — October 10, 2026

The current implementation is no longer in structural migration. Keep the existing design; the current effort is functional, structural, and performance hardening only.

- **Foil layers:** Cosmos bottom/middle/top maps are separate masked DOM layers; grain and glitter are independent layers with CMS toggles and backwards-compatible grain defaults. A low-power WebGL pass reads grayscale patterns as height fields to derive per-pixel normals and responds to the moving Lightbox light; CSS spectral, ribbon, and sheen overlays add complementary reflection. This is a stylized relief/reflection simulation, not a physically based material renderer.
- **CMS thumbnails:** collapsed project rows now mount Lottie/video near the viewport and have a static low-power 3D thumbnail path. Resource teardown is scoped to row visibility to reduce unnecessary playback/WebGL work.
- **Verification:** the `61434ca` foil/material update and the subsequent `22255e4` reference-recording commit both passed all four reported checks. New presentation assertions cover texture tiling, Cosmos top-map alpha clipping, matte-first high-brightness finish profiles, and tighter water-wave rings. The unresolved-image teardown regression remains covered. The user confirms the previously reported CMS Project-tab Lottie/3D thumbnail issues are fixed for now. Actual appearance at high strengths and real-device foil/Lightbox tilt and 3D still require visual/device QA.

- **Architecture:** validated at the current head; legacy root controllers are removed and the browser entrypoint remains thin.
- **Gallery:** the state contract is correct in code and covered by browser regressions for resize, pageshow, scrolling, collapse/expand, and Lightbox return. The remaining requirement is real-device confirmation that no browser-specific layout restoration regression remains.
- **Lightbox/media:** image, local video, YouTube, Lottie, and 3D paths are structurally separated. Playback handoff and intrinsic sizing are covered by smoke tests. Mobile YouTube first-tap behavior remains a real-device QA item because third-party iframe behavior cannot be fully certified by a mocked Chromium test.
- **3D/Lottie:** artwork backgrounds are scoped to the artwork surface; 3D focus uses an explicit stacking model and a dedicated Back control. The remaining work is visual/interaction QA across actual devices and model assets.
- **CSS:** `css/style.css` remains a large shared stylesheet (about 5,542 lines after the first extraction slice), and the core Lightbox/foil styles still live there. The latest grouped artwork/Inspector finishing layer has been moved to `css/features/lightbox.css`, loaded after the base stylesheet only on the Works page. This is a staged ownership boundary—not a full Lightbox CSS migration. A validator now protects link order and the extracted rule contract. Historical foil preset overrides elsewhere in the base stylesheet still need visual comparison against the committed reference recording; avoid broad selector reordering.
- **About/CMS:** software-logo lookup has contained fallbacks and the Curated Views CMS boundary is active. Public Curated View routing remains intentionally disabled until its resolver contract is complete.

The immediate next stage is **visual validation of matte-first foil and grouped Lightbox layouts, then CSS ownership extraction**. Cosmos maps, masks, custom texture, and relief shader now share an explicit 2×2 repeat scale with restrained specular energy. Grain/glitter and Cosmos maps now tile rather than stretch; the Cosmos top-map alpha is applied as a clip to related effects; beams and crosshatch are less white-heavy; cat-eye, pearlescent, and aurora use more restrained highlight blending; water waves use tighter concentric rings. The target remains roughly 75% matte material and 25% smooth reflective response. The recording is now committed at `foil-test-screenrecord/2026-10-10 18-55-17.mp4`. Compare the actual browser result at the reported strength values before more visual tuning, then verify foil tilt and 3D on physical touch devices. Keep prism, brushed, and shattered finishes unchanged unless a regression is observed. Do not initiate a broad portfolio redesign.

### October 5 runtime follow-up (historical checkpoint)

The latest hardening pass keeps Show Less snapping deterministic with a cancellable 1500ms document-scroll animation, waits for the initial Projects thumbnail tier before startup handoff, warms first-media YouTube projects for faster Lightbox entry, scales desktop YouTube artwork from the available viewport, tightens desktop local-video height, and uses image hit-testing suppression plus native-drag prevention for mobile artwork save protection.
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


### October 10, 2026 — Cosmos and artwork-group checkpoint

- Cosmos map imagery and alpha/luminance masks use a matched 2×2 tile scale; the normal-map shader samples the same repeated UVs. Specular white energy has been reduced to retain matte artwork color and a softer foil surface.
- CMS Project media supports optional `mediaGroups` records and `groupId` membership. Layout strategies are `grid`, `stack`, `cards`, and `flow`; projects without grouping metadata continue to render in the original linear Lightbox list.
- Grouped artwork can open in an accessible Inspect Mode, with explicit Back, Escape/backdrop dismissal, focus restoration, and a dark 68% overlay with 8px blur. Keyboard and real-device testing is still needed after CI.
- Cache identities for Lightbox entry/renderer are now `20261010-13` and shared CSS is `20261010-12`; the normalizer is `?v=20261010-03`, the project loader is `?v=20261010-03`, and Projects index/browser runtime are `?v=20261010-04`; the bootstrap/page-composition chain is `20261010-18`.


### Artwork group interaction refinement

- Retired the Flow layout and the permanent Inspect button from the CMS/public Lightbox contract. Only Grid/Tiling, Horizontal Stack, and Horizontal Card Layout remain selectable.
- Grouped galleries no longer have a decorative background or border and do not horizontally scroll. Per-artwork captions and foil front/back prompts are hidden until the visitor inspects an item.
- Horizontal choices now use a single responsive rule: all-foil groups render in a horizontal row when it fits and transition to a wrapping, overlapping card presentation when the row is too wide or the viewport is narrow. Groups with any non-foil items fall back to the clean grid.
- Desktop hover raises the card's stacking order and shadow without moving its hit target; mobile remains visually idle until a visitor taps a card to open full-screen Inspect. No in-artwork Inspect chip or press-and-hold gesture remains, and foil flipping is performed inside Inspect.


- Equal-height group artwork frames use a responsive shared height. Media uses `object-fit:contain` and the intrinsic aspect-ratio contract, so square and portrait artwork is not stretched. The mobile layered cards keep at least roughly three-quarters of a typical card visible rather than hiding the artwork behind the next card.


- Latest UI cache identities: public Lightbox entry/renderer `?v=20261010-14`, public stylesheet `?v=20261010-15`, CMS admin JavaScript `?v=20261010-12`, project normalizer `?v=20261010-04`, and bootstrap/page-composition chain `20261010-18`.


### October 10, 2026 — fullscreen Inspect and Cosmos visibility update

- Horizontal Stack and Horizontal Card Layout retain their current responsive row/layered behavior. The grouped-card Inspector now has a dedicated touch-friendly control, a fitted full-screen media stage, description and usage hints, a Back action, and an origin-to-viewport expansion / reverse transition. Artwork keeps its declared aspect ratio; reduced-motion preferences bypass the transition.
- Cosmos lower, middle, and upper CSS passes now use more visible resting opacity and independent blend choices so the material has depth without depending on device tilt to reveal the lower layers.
- Cache contract current at this change: Lightbox public entry and media renderer `?v=20261010-15`, shared public stylesheet `?v=20261010-16`, app bootstrap/page-composition chain `20261010-19`, CMS `admin.js?v=20261010-12`, project normalizer `?v=20261010-04`. The architecture validator's canonical module map must stay aligned with the public entry/renderer cache identities.
- CI audit for `cd5621d0c1f134bed4057f328e4a2b9e32dd41ec`: site-data/path/JavaScript validation, build, deploy, and build-status reporting passed; the architecture boundary step failed because its canonical Lightbox cache keys still expected `20261010-14`. This update aligns the guard with the intentional `20261010-15` module identity.


### October 10, 2026 — Inspect parity and Lightbox motion

- Grouped artwork no longer renders a floating Inspect chip or uses press-and-hold. Selecting a grouped artwork opens the same viewport-owned composition as focused 3D: centered media, supporting description and gesture instructions at the bottom, and a Back control below them. Configured media backgrounds are hidden while inspecting; foil flipping remains available inside Inspect.
- Group card lift is limited to hover-capable desktop pointers; touch layouts keep a calm resting presentation and open Inspect on tap. New media uses a restrained staggered, opacity-only entrance to preserve pointer hit targets during foil reflection, and a lightweight shimmer appears only while a 3D viewer reports `aria-busy=true`.
- The regular 3D media shell has no decorative border or drop shadow. Browser smoke accepts the absence of a 3D background layer when a CMS item has no background configured, while still checking its z-index when present.
- Cache identity targets: Lightbox entry/renderer `?v=20261010-16`, public stylesheet `?v=20261010-17`, and bootstrap/page-composition chain `20261010-20`; architecture and runtime-test expectations match these identities.


### October 10, 2026 — Inspect viewport fix

- The artwork Inspector is mounted at document level rather than inside the scrolling Lightbox media container, so its fixed viewport coordinates remain anchored to the device screen. Inspector selectors now target the portaled layer, and the root/body scroll is locked while it is open. The selected artwork remains centered, with description, gesture instruction, and Back control in the bottom stack.
- Cache identities: Lightbox entry and renderer `?v=20261010-17`, public stylesheet `?v=20261010-20`, and bootstrap/page-composition chain `20261010-21`.


### October 11, 2026 — Inspector portal and responsive render-profile regression closure

- **Verified green baseline:** commit `8ae5bf0e230f7229ed0b648815f8ceba78bdd35f` passed all four reported checks: `validate`, `build`, `deploy`, and `report-build-status`. The validation run was [#38071811972](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38071811972); the Pages build/deploy run was [#38071811896](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38071811896).
- **Inspector foil regression:** the document-level Inspector portals the selected media entry outside `#lightboxMediaContainer`. The old foil CSS was scoped to that container, so positioned foil surface/inner/face/layer rules stopped applying while the media was in Inspect. The shared rules now target both `:is(#lightboxMediaContainer,.lightbox-inspect-mode)`, and the CMS presentation validator plus site validator were updated to enforce the new scope. All four public HTML entry points use the bumped shared stylesheet cache identity `css/style.css?v=20261011-01`.
- **Interaction regression contract:** browser smoke verifies the portal retains the positioned and clickable foil layers, the artwork opens Inspect without flipping on the same gesture, foil flip works inside Inspect, and the Inspector is dismissed through its own Back control before the underlying Lightbox closes.
- **3D render-profile test synchronization:** the viewport resize smoke check now waits for viewport geometry and the corresponding `renderProfile`, `renderPixelRatio`, and `renderFrameCap` values together. This preserves the mobile-balanced and desktop-quality assertions while avoiding a read between CSS resize and the viewer's JavaScript resize handler.
- **Browser smoke result:** all 31 reported scenarios passed on desktop/mobile viewport contexts, including 390×844, 430×700, 768×900, 1024×900, and 1280×900; Works, About, and Admin checks all passed. The log ended with “LM. browser smoke test passed — Works and About booted without uncaught browser errors.”
- **Non-blocking runtime warning:** Node emitted `[DEP0040] The punycode module is deprecated` during test cleanup. It did not fail validation and should be handled only if/when the dependency chain can be identified safely.
- **Next verification gate:** compare the actual latest foil/Inspector presentation with `foil-test-screenrecord/2026-10-10 18-55-17.mp4`, then test foil tilt, grouped-artwork Inspect/back/flip, 3D behavior, and mobile YouTube first-tap on physical devices. Automated CI is green but does not replace visual/device QA. Continue CSS ownership extraction only after the current visual comparison, and do not promote changes to the deployed legacy repository without explicit instruction.

### October 11, 2026 — Grouped Inspect fit, caption, and layer-order follow-up

- **Verified green baseline:** commit `ccbfe4f0acd85c78f5cd697c8b4119fa64c45859` passed all four reported checks: `validate`, `build`, `deploy`, and `report-build-status`. Validation run [#38076612542](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38076612542) passed all 31 browser smoke scenarios; Pages build/deployment run [#38076612516](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38076612516) succeeded.
- **Artwork fit:** grouped artwork frames have additional responsive inner margins. The Inspect stage and frame no longer clip the tilted foil surface; the outer viewport remains the final clipping boundary, and media preserves its intrinsic proportions with `object-fit: contain`.
- **Explicit stacking contract:** the regular Lightbox/modal content remains at its existing layer, Lightbox navigation chrome remains above it, and grouped Inspect is now explicitly above the chrome (`#lightbox` 9999, `.lightbox-controls` 10001, `.lightbox-inspect-mode` 10002). The existing 3D-focus implementation was not changed.
- **Artwork-specific copy:** Inspect renders the selected media item's own caption exactly once. It no longer duplicates the caption in a second title field, and it never substitutes the parent project's description when artwork copy is absent.
- **Native foil affordance restored in Inspect:** the existing live hint is visible again, keeping its dynamic `FRONT • CLICK / MOVE` and `BACK • CLICK / MOVE` copy on desktop, with the existing `HOLD + MOVE` touch variant. This replaces the longer redundant footer instruction. The icon-only Back control retains an accessible label and the shared model-viewer Back button styling.
- **Cache/contract maintenance:** bumped the nested Lightbox renderer, feature, runtime, and public page cache identities together. The architecture and CMS presentation contracts plus browser smoke now assert the actual z-index ordering, non-clipping Inspect stage, single artwork caption, dynamic FRONT/BACK hint, and icon-only Back control.
- **Next QA gate:** visually check grouped grid/horizontal/layered presentations at portrait, square, and landscape artwork ratios on desktop and real mobile devices. Confirm the foil tilt never clips at the viewport edge, verify Inspect/Back/flip while navigating grouped artwork, and regression-check existing 3D inspection without modifying its implementation. Resume CSS ownership extraction after this visual/device pass.



### October 11, 2026 — First feature-owned Lightbox CSS slice

- Extracted the newest grouped-artwork/Inspect fit, safe-margin, foil-hint visibility, caption presentation, Back-button geometry and Inspector stacking overrides from the end of `css/style.css` into `css/features/lightbox.css`.
- The feature stylesheet loads after the shared base only on `index.html`, the page that owns the public Lightbox UI. All public pages use the bumped shared stylesheet identity `20261011-04`; the extracted feature stylesheet uses `20261011-01`.
- The extraction is intentionally narrow: underlying Lightbox layout, foil materials and historical preset rules remain in the shared stylesheet until each group can be moved with a clear owner and browser contract.
- `tools/validate-site.mjs` now checks that the feature stylesheet loads after the base, that the extracted fit/stacking/hint rules remain owned by the feature file, and that the moved override blocks are not reintroduced at the shared stylesheet's end.
- **Next gate:** finish static/browser validation on the new branch head; after it passes, compare the latest grouped grid/horizontal/layered Lightbox against the recorded visual baseline on desktop and real touch devices. Continue CSS extraction only after that visual pass.

### October 11, 2026 — Recursive path-audit coverage follow-up

- After `722d1c684fabc48a94716518d505c48a2ec0edde` corrected the stylesheet-order validator regex, follow-up commit `dbc382880895d6c39cc97f5a8b3d4bd2657107cd` expanded `scanSourceForBadPatterns()` in `tools/validate-site.mjs`.
- The path-regression scan now recursively includes all `.js`/`.mjs` files under `js/` and all `.css` files under `css/`, plus the Works, About, 404, success, Admin, and existing workflow entrypoints. This closes the blind spot created by keeping a fixed list of retired root-level runtime files.
- Targeted source-contract checks confirm the Lightbox feature stylesheet is loaded after the shared stylesheet, the feature-owned Inspector rules remain in `css/features/lightbox.css`, and public shared/runtime cache identities remain aligned.
- **Verification status:** the complete repository validation and Playwright smoke workflow has not been independently confirmed for `dbc3828`; the connected commit-status/workflow lookups did not provide a run result. Treat this as a committed audit improvement, not a green CI gate.
- **Next gate:** run the complete validation workflow and all browser smoke scenarios at the current branch head. If green, compare grouped grid/horizontal/layered artwork and foil tilt against `foil-test-screenrecord/2026-10-10 18-55-17.mp4`; then check Inspect/Back/flip, 3D inspection, and mobile YouTube first-tap on physical devices. Continue CSS extraction only after that visual/device pass. Do not promote to the deployed legacy repository without explicit instruction.

