# Decoupling Roadmap

This is the implementation roadmap for converting the portfolio into a highly decoupled, plug-and-play static application without changing its visual language or CMS data model unnecessarily.

## Current implementation checkpoint

As of October 28, 2026 (PHT), the active source of truth is `LemuelMagbitang/lm-portfolio-testing`, branch `projects-runtime-cutover`. The latest validated implementation checkpoint, excluding these roadmap-only documentation commits, is [`daa919a7944081e566d04b82ec835fa517b31562`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/daa919a7944081e566d04b82ec835fa517b31562), `test(lightbox): measure compact auto motion by transforms`, committed at 10:42:39 AM PHT.

Both required GitHub Actions workflows have completed successfully on this exact SHA: [Validate portfolio #40622542702](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40622542702) completed at 10:46:59 AM PHT, and [Pages build/deployment #40622542618](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40622542618) completed at 10:43:31 AM PHT. The validation job and the Pages build, deploy, and status-report jobs are green. This is automated validation, not physical-device sign-off.

The October 28 Lightbox refinement updates the recommendation to “Switch to desktop for the full effect.” and sizes only mobile holographic media items to 75% of their media-container width, centered to reserve a parallax safety margin. Mobile foil/material layers remain disabled while transform-only automatic parallax and tap-to-flip are retained; desktop foil and sizing remain unchanged. The latest browser smoke test measures transform-variable changes and checks bounded motion rather than depending on the previous viewport-coordinate measurement.

The earlier footer-readiness and public-HTML cache-key architecture guards remain part of the validated baseline. Keep Hero Mux playback/source-selection logic stable unless a reproducible regression is found. The smoke suite uses a standards-shaped Mux mock and does not certify real-stream health. Backups `backup/projects-runtime-cutover-2026-10-16`, `backup/projects-runtime-cutover-2026-10-18`, and `backup/projects-runtime-cutover-2026-10-18-pre-ui-polish` remain recovery context. Do not modify `main` or the deployed legacy repository without explicit promotion authorization.

Phase 3A (UI Foundation), 3B (Dynamic Project Cards), and 3C (Lightbox UX) are implemented milestones. **Phase 3D — Content-independent Responsive UX — is the current closing stage.** Continue targeted runtime, performance, lifecycle, and accessibility hardening as supporting audits, while prioritizing the remaining responsive and real-device verification gates.

The About route skips the Projects card, Gallery, and Lightbox controller/media-renderer modules. The About page shares the project-manifest loading promise; the browser suite guards against multiple `data/projects.json` requests. The recorded local Chromium JavaScript-response body totals are an initial measurement, not production-compressed transfer sizes. Repeat performance captures on the deployed testing URL across multiple cold sessions.

CI green establishes the tested contracts, not all user-visible behavior. Outstanding manual or environment-dependent gates include the real CMS foil save/reload round-trip, reproducing the intermittent thumbnail focus outline, physical-device 3D Focus/Back and Contact-swipe behavior, fresh-browser Curated View verification, mobile holographic edge clearance/flip responsiveness, and cold-session performance comparison. Keep broad Lightbox CSS ownership extraction paused until the targeted visual gates are complete.

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
- The CMS has a **Curated Views** editor and the public hash-route runtime is now enabled on `projects-runtime-cutover`. A hash slug is resolved from `data/curated-views.json` before project cards mount; the ordered result uses the shared Projects/Gallery/Lightbox pipeline, keeps Main Portfolio references authoritative, and scopes curated-only records to the view that owns them. The route was implemented in commit [`5f9f480`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/5f9f48074a34b7fef7ea03b89011b6a52d715c74) at 2026-10-11 15:43:07 UTC. The screenshots captured at 15:19 UTC preceded that implementation. On `775674d`, the dedicated Curated View route passed browser smoke scenario #22; the complete site-validation workflow and Pages build/deploy both succeeded. Keep the architecture guard that prevents public-runtime imports and page script/preload references to `admin/*.js`. A fresh live-browser check remains the final user-visible verification.
- Runtime cache-busting is intentionally feature-local rather than globally synchronized. Version values recorded in older sections are historical checkpoints, not current values; inspect the active module imports and HTML script/preload references before changing a cache key. Keep affected module, test-harness, preload, and public-page references aligned across `index.html`, `about/index.html`, `404.html`, and `success/index.html` without invalidating unrelated modules.

### Current focus

Phase 3D is the active closing stage. The October 26 thumbnail/artwork reveal and reduced-motion behavior remain in the regression baseline; grouped Lightbox items retain readiness-bound arrival. The October 28 mobile holographic changes must preserve 75%-width centered artwork on mobile, disabled foil/material layers on mobile, bounded transform-only automatic parallax, and tap-to-flip, without changing desktop foil rendering or sizing.

The immediate audit order is: (1) responsive inspection of the holographic Lightbox across mobile/tablet/desktop breakpoints; (2) repeated open/close/navigation lifecycle tests for stale media state, listeners, timers, and animation references; (3) continue focused accessibility, performance, cache-key, and runtime-loading checks; (4) record a verified checkpoint after workflows finish. Verify the existing mobile navigation selected-state → menu-exit → navigation sequence rather than reimplementing it without a reproduced issue.

Keep the Hero Mux implementation stable while the user reports it is working. Use clean sessions on the deployed testing URL for performance comparisons; distinguish those results from the local mock-based browser smoke. Physical-device checks are still required for final responsive sign-off.


The deployment gate remains separate from architectural completion: each public-page runtime commit must pass the GitHub Actions validation/Chromium gate before it is considered a safe cutover candidate for the eventual replacement of the legacy deployed site.

### October 28, 2026 — Earlier runtime checkpoint (superseded by the mobile Lightbox refinement below)

- The active branch checkpoint is [`302cd673`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/302cd673d6be1d19fe9a1621eebe8a135ab0c61d). The final footer layout smoke test now waits for the app's existing loading gate to reach `ready` before checking mounted slides and geometry. This aligns the test with asynchronous feature initialization and preserves the original assertions; it does not weaken the footer contract.
- [Validate portfolio #40554278036](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40554278036) completed successfully. Static/data/path/security/architecture and Mux contract tests passed, and the Browser smoke test finished with “Works and About booted without uncaught browser errors.” [Pages build/deployment #40554277196](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40554277196) also passed on the same SHA.
- The user reports the site is working fine for now. Do not add more Mux retries or change the Hero playback source without a reproduced regression. Current recovery remains bounded; the smoke suite uses a mocked Mux custom element, so it tests integration contracts rather than availability or decodability of the real HLS stream.
- **Test Project is intentional:** the user confirmed that the `test-project` record in `data/projects.json` must remain as a QA fixture. Its Lottie sample, OBJ/3D model, and Mux video are deliberately co-located in one Lightbox project to continue testing visual presentation and interaction/UX. Do not remove, hide, or “clean up” this record or its test media without an explicit change in direction.
- At that earlier checkpoint, the architecture guard checked canonical cache keys on public HTML scripts and modulepreloads in addition to JS imports/test modules. Validation and Pages deployment passed on [`2778ac1`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/2778ac124e02d1c141eee9d54192f484fb271c75); that SHA has since been superseded.
- **Historical next gate:** complete the targeted Phase 3D responsive and physical-device checks. The current follow-up and latest green CI checkpoint are recorded below. Keep broad Lightbox CSS extraction paused until the documented fresh-browser, CMS foil round-trip, thumbnail-focus, Curated View, and device checks are completed. Keep `main` and the deployed legacy repository untouched without explicit promotion authorization.

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
- **About/CMS:** software-logo lookup has contained fallbacks and the Curated Views CMS boundary is active. Public Curated View hash routing is implemented and enabled on `projects-runtime-cutover`; the resolver contract and direct-link browser smoke scenario are covered by CI. The remaining gate is a fresh user-side reload of the deployed testing URL, not further resolver implementation.

The earlier foil/material comparison plan remains a historical checkpoint; it is not permission to proceed directly to CSS extraction. The current gate is **physical-device and fresh-browser verification**: (1) reload `https://lemuelmagbitang.github.io/lm-portfolio-testing/#test-portfolio` in a fresh browser session, (2) check the new mobile Contact tab swipe on a real phone, and (3) verify grouped Lightbox layouts, foil tilt/flip and Inspect/Back, focused 3D viewing, and mobile YouTube first-tap behavior against the committed recording. Keep Lightbox/foil CSS ownership extraction paused until these checks are complete. Continue targeted, evidence-backed hardening; do not initiate a broad portfolio redesign.

### October 12, 2026 — loading gate and media warm-up

- The existing branded loading screen now disables background interaction, locks touch/wheel/keyboard scrolling, and restores the previous inline scroll styles and inert states at readiness handoff.
- The startup gate now waits for the full local project-media preload pool: project images, local videos, Lottie data, 3D model binaries/module graph, foil artwork layers, and project backgrounds. About-page photo/software-logo candidates are awaited on About itself. Individual media jobs keep their own timeouts; YouTube iframe/player boot remains non-blocking and is skipped on constrained connections.
- Added a browser smoke assertion for the active loading lock. Validation initially found the shared CSS cache key was not aligned in `404.html` and `success/index.html`; both entrypoints are now aligned to the same stylesheet version as Works/About.

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

### October 11, 2026 — Scroll-stable Inspect, smoother navigation, and optional hero messages

- **Inspector scroll stability:** foil Inspect captures the current Lightbox scroll position, preserves a layout placeholder for the selected card and hint, and restores that same scroll position after portal/open/close layout work. The focused 3D media entry is temporarily portaled into a body-level `.lightbox-3d-focus-overlay`, while a same-size placeholder preserves its gallery slot and the original modal keeps its natural scroll geometry. On exit, the viewer returns to its slot; if the model's passive aspect ratio changes content height and reduces the scroll range, an invisible trailing spacer retains the exact saved offset rather than allowing the modal to clamp. No explicit scroll reset is used on entry.
- **Foil Inspect controls:** the live FRONT/BACK and CLICK / MOVE hint is moved from the artwork surface into the top of the Inspect footer, directly above the artwork caption/description. The Back control now uses the same Font Awesome arrow icon and shared model-viewer-back button styling as focused 3D.
- **Smooth navigation and reduced motion:** same-page Contact and Works/logo navigation issue a single smooth-scroll request rather than direct scrollTop resets or repeated per-frame scroll commands. Initial hash navigation waits for composition/layout to settle before scrolling once. CSS scrolling, JavaScript navigation, and interaction transitions respect prefers-reduced-motion.
- **Mobile contact switcher:** Start a Project / Leave a Review retains its sliding tab indicator. Panel changes now animate opacity/vertical position and interpolate the contact grid's height, with an API-availability fallback so smaller/older browsers still switch panels normally.
- **Hero-message settings:** Settings & Toggles now includes showHeroMessage (default true) and showFooterMessage (default false). The hero and footer each render the label, message, and attribution inside a translucent dark panel. The hero section's content-driven sizing class follows showHeroMessage, so disabling the message returns to the animation-only hero composition; responsive panel padding remains intact on mobile. The footer toggle inserts the same message above the social row on Works and About; footer/panel height remains content-driven and expands for longer copy.
- **Focused motion polish:** added narrowly scoped hover/pressed transitions to navigation, filters, buttons, socials, and contact tabs. No broad transition-all rule was introduced, and the 3D viewer's interaction implementation was otherwise left unchanged.
- **Cache/contract maintenance:** current public cache identities are shared CSS 20261011-11, Lightbox feature CSS 20261011-03, and the public script/bootstrap/composition chain 20261011-09. The Hero feature entry is 20261011-03; Lightbox entry/renderer identities remain 20261011-08 / 20261011-06; CMS admin.js uses 20261011-01. Architecture/runtime/settings/CMS validators and browser smoke now check the new cache graph, settings, footer hint order, and scroll-position preservation during foil and 3D inspection.
- **Verification status (Oct 11):** source checkpoint `3e18efeebd9838af3104fc3c3d3c9aacf6516161` passed the [Validate portfolio workflow](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38119647704) and [Pages build/deployment](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38119647507). All 31 browser smoke scenarios passed alongside the data, settings, architecture, lifecycle, and syntax contracts. The mobile gallery assertion measures CSS grid tracks/layout offsets rather than animation-affected visual bounds; the native-swipe test settles the foil to center before checking scroll behavior. This is validation of the test-repository branch, not a production promotion.
- **Next gate:** do a real-phone visual pass against the test-branch preview: toggle hero and footer messages independently; check longer message wrapping and panel sizing; test foil tilt/flip/Back and 3D Back/Escape without scroll jumps; verify Start a Project / Leave a Review transitions and reduced-motion behavior. Fix only observed regressions. Keep production/legacy deployment repositories untouched; no broad redesign is planned.



### October 11, 2026 — Clear hero artwork and independent footer-message presentation

- **Hero toggle:** when `showHeroMessage` is false, remove the Works hero gradient overlay and restore active-slide opacity to 1. The About portrait/bio hero retains its intentional overlay.
- **Footer styling:** the optional footer quote now follows the hero message's left-aligned translucent-panel language, responsive padding, and label/text/credit order. Extra spacing separates it from the social icons and copyright.
- **Distinct content:** hero and footer select separate entries from the shared normalized message bank when multiple entries exist. They randomize on refresh, avoid repeating their own immediately previous entry when alternatives exist, and rotate using normalized `heroTiming.autoRotateMs`.
- **Conditional footer backdrop:** footer artwork loop/fade appear only while `showFooterMessage` is enabled; otherwise the footer returns to its plain base background.
- **Settings/cache contracts:** preserve `fadeMs` and `autoRotateMs`, default message rotation to 9 seconds, and bump public CSS/Hero/bootstrap/composition/entrypoint cache identities.
- **Next gate:** validate full-color hero art with the message off, footer alignment and spacing on desktop/mobile, distinct quotes when both toggles are enabled, and footer backdrop on/off behavior. Do not change the deployed legacy repository.


### October 11, 2026 — Match footer message to the hero layer system

- **Layer contract:** artwork/media loop stays at the base; the quote is one grouped layer whose own panel is translucent black (`rgba(0,0,0,.42)), with the message label, statement, and attribution inside it. Text stays above the panel; panel tint does not blur the artwork below it.
- **No frosted-glass treatment:** removed `backdrop-filter: blur(3px)` from the shared hero quote and removed the footer's duplicate blur/style overrides.
- **Shared visual component:** the optional footer quote now also carries `.hero-quote`, so the exact hero panel, typography, responsive padding, and text hierarchy are reused. The footer-specific exception is only a bottom margin of `clamp(36px,5vw,64px)` before the independent social/copyright group.
- **Regression guards:** the browser smoke suite checks no blur on the hero quote in desktop/mobile contexts and verifies that the footer quote shares the hero class and maintains the social-row gap. Static validation enforces the shared class and no-blur CSS contract.
- **Next gate:** confirm the visual result on desktop and phone; keep the looping background, panel layer, and footer social/copyright group separate. Production remains untouched.


### October 11–12, 2026 — Curated View route and deployment verification

- The CMS save that produced test portfolio was committed to data/curated-views.json at 2026-10-11 15:14:23 UTC. The public route implementation followed at 15:43:07 UTC (5f9f480), after the user’s 23:19 PHT screenshots; therefore those screenshots do not demonstrate a failure of the subsequently implemented route.
- Commit 775674d remains the verified Curated View routing baseline. The subsequent focused UI refinement (4bf8372) removed the eyebrow, added a borderless back-arrow exit, kept the heading side by side at small widths, hid mobile filter pager dots, and aligned the public CSS/runtime cache identities. Presentation regression checks were added in 98c8e32 and 2c64187. The validation run #38156007136 and Pages build/deploy run #38156006742 passed on 2c64187, including the 390px mobile presentation test.
- The route now has automated branch/deployment verification. The remaining check is a fresh user-side browser reload of https://lemuelmagbitang.github.io/lm-portfolio-testing/#test-portfolio to confirm the visible published result and exclude a stale local/browser cache. Do not rewrite the resolver unless that check reveals a current failure.

### October 12, 2026 — Curated View small-screen regression hardening

- The UI refinement is now part of `projects-runtime-cutover`: `.curated-view-exit` is borderless and includes an accessible decorative left-arrow icon; the redundant `UNLISTED PORTFOLIO` eyebrow was removed; mobile heading and exit remain in a single row; and mobile `.filter-page-controls` are forced hidden even if JavaScript removes the `hidden` attribute.
- Shared stylesheet version `20261012-01` is aligned across Works, About, 404 and Success pages. The public entry/bootstrap/page-composition identity is aligned at `20261012-01`; no production repository was changed.
- Static presentation guards and a 390×844 browser regression cover the new contract. This checkpoint adds a second 320×568 smoke case to catch narrow-screen wrapping/overlap in the heading and exit link, including a forced-visible pager fixture. Confirm the latest CI result before accepting the 320px behavior.
- Once the full browser smoke gate is green, resume CSS ownership extraction only after the real-device Lightbox/foil QA gate described above; do not use this targeted UI pass as evidence that unrelated Lightbox visuals have been physically device-tested.


### October 12, 2026 — Curated View CI closure and audit update

- **Verified branch checkpoint:** `96d7c1d10e4590c9df1d3cc57eb85ea5e55fa518` passed [site validation and browser smoke run #38157420466](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38157420466) and [Pages build/deployment #38157420479](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38157420479). The browser smoke suite completed all 36 scenarios; Curated View scenarios #22 (1280×900), #23 (390×844), and #24 (320×568) passed, as did the Admin smoke case #36.
- **User-side review:** the user confirmed the current Curated View presentation looks acceptable. No route rewrite or redesign is warranted based on the current evidence.
- **Non-blocking tooling warning:** Node `DEP0040` appears immediately after the GitHub Actions `setup-node` step initializes Node 24 and again during job cleanup. The validation and browser smoke steps still pass. The exact dependency source has not been isolated, so do not modify portfolio runtime code merely to suppress this warning.
- **Next gate:** complete the physical-device check for grouped Lightbox layouts, foil tilt/flip and Inspect/Back behavior, focused 3D viewing, and mobile YouTube first-tap behavior against the existing recording. Keep Lightbox/foil CSS ownership extraction paused until this visual/device pass; continue with targeted, evidence-backed hardening rather than a broad redesign. The legacy deployed repository remains out of scope.


### October 12, 2026 — Swipeable mobile Contact tabs

- **Interaction:** the mobile `.contact-mobile-tabs` rail now responds to horizontal touch swipes: left selects Leave a Review; right selects Start a Project. The existing segmented pill indicator updates through the same tab-state function as clicks and keyboard navigation.
- **Gesture safety:** a swipe must move at least 36px horizontally and be more horizontal than vertical movement. The rail uses `touch-action: pan-y` so ordinary vertical page scrolling remains native. Cancelled and vertical-dominant gestures do not change the active tab, and the click generated after a swipe is consumed so it cannot undo the tab selection.
- **Accessibility and lifecycle:** the existing tab/tabpanel ARIA semantics, arrow/Home/End keyboard support, panel transitions, and reduced-motion handling remain the shared behavior. Swipe listeners and the click-suppression timer are disposed during feature cleanup.
- **Cache identities:** shared public CSS is `20261012-02` across Works, About, 404 and Success; the runtime entry/bootstrap/page-composition chain is aligned at `20261012-02` on Works and About; the Forms feature import is `20261012-01`.
- **Verified:** [site validation and all 36 browser smoke scenarios passed in run #38161258929](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38161258929), including the form/accessibility unit contract and both swipe directions in the mobile browser scenario. [Pages build/deployment #38161258972](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38161258972) succeeded. Automated browser checks do not replace a real-device touch-feel check.
- **Next:** confirm the swipe feels natural on a physical phone; treat any feedback as a separate, targeted UI change. The unrelated Lightbox/foil/3D physical-device QA gate remains open.


### October 12, 2026 — Latest branch audit and verification reconciliation

- **Active source of truth:** `LemuelMagbitang/lm-portfolio-testing`, branch `projects-runtime-cutover`. The pre-documentation runtime checkpoint was `91810cb130afcf94ea36fffecf2fb5976a282a5c` (`Docs: record mobile Contact swipe behavior and verification`), committed 2026-10-11 17:52:45 UTC / 2026-10-12 01:52:45 PHT. It has since been superseded by documentation-only commits; the current branch HEAD is `cf874bbe65d7e1f850c550d8f6a8cdc6bc27ad56` (`Docs: record successful roadmap CI and next audit target`).
- **Verification of the current documentation HEAD:** [Validate portfolio run #2706](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38200028816) completed successfully, and [Pages build/deployment #2829](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38200028572) completed successfully with build, status report, and deploy jobs green. The earlier runtime checkpoint's successful runs #2705 and #2828 remain useful historical evidence for the runtime commit, but they are not the runs for the current HEAD.
- **Code review:** `js/features/forms/index.js` uses pointer events only for primary touch input at mobile widths, requires at least 36px horizontal movement and horizontal dominance, preserves native vertical scrolling through `touch-action: pan-y`, consumes the post-swipe synthetic click, and removes listeners/timer during cleanup. Existing keyboard and ARIA tab semantics remain shared with click behavior.
- **Audit finding fixed in this document:** older roadmap text incorrectly said public Curated View routing was disabled and repeated the earlier foil/CSS-extraction step as the immediate next stage. The current roadmap now reflects the implemented resolver and the actual outstanding device/browser verification gate.
- **Still unverified:** physical-device Contact swipe feel, fresh user-side Curated View reload, and real-device grouped Lightbox/foil/3D/mobile YouTube behavior. Green CI confirms the automated suite and Pages deployment, not those physical-device checks.
- **Scope guard:** no public runtime code was changed in this audit; production `LemuelMagbitang/lemuelmagbitang.github.io` remains out of scope. CSS extraction stays paused until the stated QA gate is cleared.


### October 12, 2026 — Post-commit CI confirmation

- **Roadmap commit validation:** [Validate portfolio run #2706](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38200028816) completed successfully for the documentation reconciliation commit. The job completed all architecture/data/path checks, Curated View resolver and CMS lifecycle contracts, contact fallback checks, runtime composition checks, JavaScript syntax checks, and the Chromium browser smoke test.
- **Pages pipeline:** [Pages build/deployment #2829](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38200028572) completed successfully; build, status report, and deploy jobs are green.
- **New review note:** the Contact tab's height/opacity animations can overlap if a user switches tabs repeatedly before the prior animation finishes. This is a candidate for a targeted regression test, not yet a confirmed user-visible defect; do not change the interaction until the race is reproduced or a test demonstrates incorrect cleanup/state.
- **Next:** run the fresh browser and physical-device QA checklist. If a rapid-switch animation race is reproduced, add a focused test and cancel/settle superseded animations within the Forms feature lifecycle. Keep CSS extraction and production promotion paused.


### October 12, 2026 — Contact navigation drag interaction and follow-up CI audit

- **Interaction update:** the mobile Contact tab rail now uses press-and-drag selection rather than the previous completed-swipe gesture. While a primary touch remains down, moving across the rail activates the tab under the finger; ordinary taps remain supported, vertical-dominant movement is left to page scrolling, and the synthetic click after a drag is suppressed.
- **Regression coverage:** `tools/validate-forms.mjs` now covers drag-to-select in both directions, active-indicator state, vertical movement, cancelled gestures, normal taps, and cleanup. The CI step **Validate contact form fallbacks** passed for commit `2b026f36f9edaee0bbdc5ed91f457aa9b28ea8af`.
- **Cache alignment:** the Forms module, bootstrap/composition chain, and public Works/About entrypoints have updated cache identities so browsers can fetch the new interaction code.
- **CI audit finding:** Pages build/deployment succeeded for commit `2b026f36f9edaee0bbdc5ed91f457aa9b28ea8af`, but the overall validation workflow failed in the unrelated mobile Show More browser scenario at `tools/smoke-browser.mjs` around line 3378. The failure was the expanded gallery appearing collapsed after a viewport resize. All preceding validation steps, including the Contact form contract, passed. This is not evidence that the Contact drag change failed, but it does leave the full validation gate red and the Show More behavior must be isolated before this checkpoint is called green.
- **Next:** reproduce the Show More resize failure and determine whether it is a runtime race or a timing-sensitive smoke assertion; do not weaken the assertion without evidence. After that, complete physical-phone checks for Contact drag feel and the existing Lightbox/foil/3D/YouTube checklist. The legacy deployed repository remains out of scope; do not promote production.


### October 12, 2026 — Startup loading gate hardening and asset-readiness audit

- The branded startup overlay now locks document scrolling, touch/wheel gestures, scroll keys, and background interaction until the handoff; a browser smoke scenario checks both the locked and restored states.
- The Lightbox media warm-up now waits for all scheduled local project media, thumbnails, project backgrounds, model binaries, Lottie data, and holographic layers. Third-party YouTube player boot remains deliberately non-blocking because it is external and expensive to initialize.
- The About page now awaits its visible hero/footer animation features, profile/software content, gallery composition, and local About asset warm-up before removing the loading gate. Font readiness is also awaited on both page types.
- Validation and Pages deployment passed on the prior loading-gate commit. The additional About startup readiness change is being validated now; this is not a claim of physical-device verification. Loading the complete local media set may extend startup on slow networks, and individual media preload timeouts remain the fallback for unavailable assets.



### October 13, 2026 — About image decode readiness

- The prior loading-gate commit's browser smoke validation and Pages deployment both passed.
- Tightened About asset warm-up so successfully loaded images also request decode completion before the preload promise resolves, aligning the About-image preloader with the Lightbox image path. Decode failures still fall back to the successful load event, and the existing 4.5-second per-image timeout remains the escape hatch.
- Added lifecycle/source-contract assertions for the decode wait and advanced the startup module cache version to `20261013-02` across Works/About entrypoints, bootstrap, and the About feature import.
- This does not claim video bytes are fully downloaded, Lottie animations are pre-rendered, or 3D models are already GPU-ready. Physical-device checks remain open.



### October 13, 2026 — Bound external Lottie startup wait

- The About image-decode commit deployed successfully, but its full validation run failed on the browser smoke test's six-second startup readiness deadline. The failing smoke was `/?holographic-smoke=1`; source/lifecycle/syntax checks passed.
- Root cause identified: the external Lottie player is loaded from two CDNs with an 8-second per-source script timeout. The portfolio catalog has Lottie media, so making that external player a hard startup dependency could hold the branded gate longer than the browser startup contract.
- Changed the player warm-up to a 2.5-second bounded wait. The Lottie animation JSON remains in the normal local media warm-up; if the custom-element script takes longer, startup proceeds and the pending request may still define the element later.
- Added a lifecycle/source-contract assertion for the bounded wait and advanced entrypoint/bootstrap cache identity to `20261013-03`.
- Re-run the complete validation/browser smoke before treating this follow-up as verified. Pages deployment alone is insufficient.



### October 13, 2026 — Bound 3D and streamed-response waits

- The loading-gate browser smoke had timed out before handoff after the Lottie player became a hard startup dependency. Its wait is now bounded at 2.5 seconds; the pending CDN request can complete in the background.
- The project catalog also contains an OBJ model, and its startup-critical 3D module graph imports Three.js from the CDN. That module preload previously had no timeout. It is now bounded at 3.5 seconds so a stalled third-party module graph cannot hold startup indefinitely.
- Fixed a separate timeout gap in model/asset prefetching: the timeout previously covered `fetch()` only, not `response.arrayBuffer()`. The complete response-body read is now inside the existing nine-second timeout and abort cleanup.
- Added lifecycle/source-contract assertions for both protections and advanced the app cache key to `20261013-04`.
- Re-run the complete validation/browser smoke before treating the combined startup changes as green. A Pages deployment by itself is not sufficient.



### October 13, 2026 — Bound the secondary media wait

- The current content manifest contains 68 local project-media entries totaling about 34.5 MiB: 64 images (~30.3 MiB), two videos (~2.0 MiB), one Lottie JSON (~0.28 MiB), and one OBJ model (~1.86 MiB), before foil layers and project backgrounds.
- Waiting for every secondary asset is not a sustainable startup contract on save-data/2G connections. The preloader now starts the full secondary queue immediately, waits up to four seconds for it on ordinary networks, and does not wait for the secondary tier on constrained networks. The remaining jobs continue in the background; critical project media, backgrounds, and model warm-up stay in the gate.
- Added lifecycle/source-contract coverage for the bounded wait and aligned the Lightbox runtime/test cache keys to `20261013-02`; advanced bootstrap, entrypoints, and composition cache identity to `20261013-05`.
- This is a deliberate startup/responsiveness trade-off: assets that finish within the grace period are ready at handoff; slower secondary assets may finish afterward. Re-run browser smoke and deployment checks for this change.


### October 13, 2026 — Abort stalled Lottie dimension preloads

- The Lottie JSON dimension helper already used a timeout at the preload boundary and retained per-URL request deduplication, but its timeout callback was a no-op. If the network request or response parsing stalled, the caller could time out while the underlying fetch remained active and the pending request stayed reusable until it settled.
- The timeout now aborts the URL's active AbortController. The fetch's existing finally path then clears its pending-request and controller map entries, allowing a later attempt to start cleanly.
- Added a lifecycle/source-contract assertion for timeout cancellation. Updated the Lightbox renderer/entry canonical keys to 20261013-03 and aligned bootstrap, entrypoint, and Works/About composition cache identities to 20261013-06.
- Validate the complete browser suite and Pages pipeline before treating the change as verified. This is preloader request cleanup only; it does not change the visual loading screen or its exit behavior.


### October 13, 2026 — Respect Save-Data for secondary media warm-up

- The prior policy detected Save-Data and 2G connections only to avoid waiting for secondary media before startup handoff; it still launched the full secondary-media queue at concurrency one in the background. This could download project artwork and foil textures that the visitor had not opened, despite an explicit data-saving preference.
- Secondary media and non-blocking YouTube warm-ups are now skipped on constrained connections. The already-defined critical first-media, project-background, model, and viewer-module tier remains unchanged; assets still load normally when the user opens a project. Ordinary connections retain six secondary workers and the existing four-second grace period.
- Added a lifecycle/source-contract assertion for the skip behavior and aligned Lightbox renderer/entry keys to 20261013-04 and the Works/About bootstrap/entrypoint/composition chain to 20261013-07.
- This only changes background network warm-up policy for Save-Data/2G; it does not alter the loading screen's visual design or its readiness/exit contract. Full browser smoke and Pages CI must pass before considering it verified.

### October 13, 2026 — media asset hygiene audit

- CI now inventories files under `assets/`, summarizes formats and payload sizes, and reports raster assets that have not yet been converted to WebP. Existing PNG/JPEG assets remain a non-blocking migration backlog so a future bulk conversion does not unexpectedly break the site or block all deployments.
- New or oversized assets are surfaced by path and size; unrecognized asset extensions are flagged for review. An `.avif` file referenced as video is treated as a configuration error because AVIF is an image format rather than a standard HTML video container. For video delivery, use a compatible `.mp4` or `.webm` container; AV1 is a video codec and can be used within a supported container where the browser/device target allows it.
- The audit is informational for legacy images and size candidates. It does not rewrite or delete media, change the loader UI, or alter artwork references.

### October 13, 2026 — CMS/public foil contract and media audit checkpoint

- The public Lightbox smoke requires all ten saved Funko foil finishes to preserve their expected per-artwork style IDs and have ten distinct computed spectrum profiles.
- The CMS presentation validator checks all eleven supported style identifiers across the CMS style list, public media normalization, and stylesheet profiles. This is a contract check; it does not claim the CMS selection/save/reload workflow has been verified by a real user.
- The latest validated head is `88ad934cf22d536eea3494bfe4096a7058fcd651`. Validation, browser smoke, build, status reporting, and Pages deployment passed. An intermediate validator attempt failed because of regular-expression escaping and was corrected in `88ad934`.
- The asset audit inventoried 96 files totaling 39.38 MiB. It reported 88 existing raster files for a non-blocking WebP review backlog and three raster images at or above 1 MiB: `assets/projects/gog-render-challenge/card-layout.png` (3.92 MiB), `assets/projects/retail-spatial-layouts/repeluxe00.png` (3.17 MiB), and `assets/projects/graphic-design/concept-magazine.jpg` (1.23 MiB). All three are referenced by the current CMS project manifest.
- Do not bulk-convert or remove the source files. Begin selective optimization with dimension/alpha inspection and a visual comparison, especially for the GOG card artwork because it has holographic texture and mask settings. Preserve transparency, orientation, captions, foil effects, and source compatibility; change the JSON reference only after the derivative is verified.
- **Next gate:** run a real CMS style change → save → reload check, then verify live rendering. Separately reproduce the post-refresh thumbnail-outline issue and test mobile 3D focus/Back behavior on a physical device. Keep broad CSS ownership extraction paused until those targeted visual gates are complete.


## October 13, 2026 — WebP asset migration completed

- Converted 86 existing static PNG/JPEG assets to WebP and rewrote runtime/test source paths.
- Kept the site favicon in PNG and the primary Open Graph social-sharing image in JPEG for compatibility.
- Eligible raster payload changed from 34.85 MiB to 22.94 MiB (11.92 MiB / 34.2% reduction).
- The migration report lists dimensions and per-file sizes at docs/WEBP-ASSET-MIGRATION-REPORT.md.
- CMS PNG/JPEG uploads convert to WebP before GitHub upload. SVG/vector, animated GIF, existing WebP, videos, 3D sources, favicon and primary/versioned Open Graph images remain in their original formats.

### October 13, 2026 — CMS JPEG smoke and asset-audit follow-up

- The browser smoke test for CMS JPEG-to-WebP upload initially failed on the refreshed preview's cache-key assertion, not on encoding or dimensions: the CMS intentionally truncates Git blob SHAs to 12 characters in asset URLs. The test now checks the same 12-character contract.
- Full validation passed on `0d9f823595143714b7eec663d4986db15cde0358` (workflow run [#38411482014](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38411482014)); the Pages deployment also passed ([#38411481931](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38411481931)).
- The asset auditor now separates the favicon PNG and Open Graph JPEG, which are deliberately preserved for compatibility, from any remaining raster-conversion backlog.
- **Quality caveat:** CMS PNG/JPEG uploads are converted through the browser Canvas WebP encoder. PNG uses quality `1.0`, but Canvas does not expose an explicit lossless-WebP mode. The smoke test verifies WebP signature and pixel dimensions; it does not prove pixel-identical/lossless output. Do not describe the CMS PNG path as lossless or auto-recompress artwork without visual review.
- **Next gate:** selectively review the 30 JPEG-derived WebPs that became larger than their originals, using historical source files and visual comparisons before replacing any output. Preserve artwork detail, transparent edges, and holographic masks. The CMS foil save/reload round-trip, the thumbnail-outline-after-refresh issue, and physical-device mobile 3D/back-control QA remain open.

### October 13, 2026 — CMS Media Library full preview verified

- Media Library thumbnails now open a type-aware full preview for images, Lottie JSON, supported video containers, and supported 3D formats. The dialog shows the filename and repository path; images use contain scaling, videos retain native playback controls, Lottie uses the shared player adapter, and 3D models use the existing interactive viewer.
- The dialog supports Escape, backdrop, and close-button dismissal; returns focus to the thumbnail; locks page scrolling while open; and cleans up video/3D resources on close.
- Browser smoke coverage now exercises image fit, Lottie surface creation, video controls/inline playback, and a ready 3D canvas.
- Validation passed on `55beac5bc309ebea71e9ffe6d4b229518de3a317` (workflow [#38415775492](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38415775492)); the Pages deployment passed ([#38415775622](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38415775622)). The CMS entrypoint cache keys and the static validator expectations were updated together.
- **Next gate:** visually review and selectively optimize the 30 JPEG-derived WebP files whose output is larger than the source. Use historical originals and compare artwork detail/transparency/foil masks before replacing anything. The CMS foil save/reload round-trip, occasional missing thumbnail outline after refresh, and physical-device mobile 3D/Back/focus QA remain open.

### October 13, 2026 — CMS Media Library file-size display added

- The full asset preview now displays a readable file size using the existing GitHub tree entry `size` value; the header includes both a scaled unit (bytes/KiB/MiB/GiB) and the exact byte count for larger files. Missing size metadata is reported as unavailable rather than showing a fabricated zero.
- The implementation needs no additional API request and supports images, Lottie JSON, video, 3D models, and unsupported file types shown in the generic preview state. Exact byte counts are also exposed on the size line's title.
- The browser smoke now asserts that a known 12-byte fixture displays `12 bytes`; the CMS static contract checks the formatter, header binding, and styling. CMS HTML cache keys were advanced together to `20261013-02`.
- **Next optimization gate:** inspect the 30 JPEG-derived WebPs that grew beyond their original files, starting with the largest growth candidates in `docs/WEBP-ASSET-BY-ASSET-SIZE-REPORT.csv`. Recover historical originals, compare candidate encodes visually, and retain a derivative only when it preserves detail, transparency, orientation, and foil masks while delivering a real size benefit. Do not blanket-recompress the artwork.


### October 13, 2026 — R/W/E follow-up audit

- Re-read the active branch reference before this audit: `projects-runtime-cutover` points to `1d5be29a1a13fb92ea3ed7e80f1b6acab8c0300e`. The full validation/browser-smoke run [#38417599820](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38417599820) and Pages deployment [#38417599063](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38417599063) are both green on the same SHA.
- The immediately preceding full-validation attempt failed only because the static validator over-escaped its function-name matcher; the assertion was corrected to an exact source substring check and the subsequent full validation passed. No unresolved CI failure remains at this checkpoint.
- Reconciled the opening checkpoint with the shipped CMS full-preview/file-size work and current CI result. No public runtime behavior was changed by this documentation audit.
- **Selective WebP review update:** restored fifteen oversized WebP derivatives to their exact original JPEG bytes after visual comparison, recovering 868,541 bytes (848.2 KiB) while matching the original visible presentation. The asset auditor and one-time conversion utility explicitly preserve these JPEGs. The initial conversion CSV remains historical; 15 larger-than-source WebP outputs remain to inspect. Next candidate: `assets/projects/product-packaging/shampoo00.jpg` (+37,547 bytes / 36.7 KiB). Do not bulk-recompress artwork. Real CMS foil save/reload, occasional thumbnail-outline loss after refresh, and physical-device mobile 3D/back/focus QA remain user-side QA gates.


### October 13, 2026 — Selective WebP size-regression rollback

- Replaced five larger WebP files with the original JPEG blobs recovered from pre-migration commit `9db228e38fa7acd0eb18df7503ff011bbe40e5ef`; `data/projects.json` now points to the original `.jpg` paths.
- The five pairs were visually compared. At the displayed comparison size, the WebP derivatives showed no meaningful visual advantage over their originals, while totaling 2,403,486 bytes versus 1,978,326 bytes for the historical JPEGs.
- Expected reduction from this targeted rollback is 425,160 bytes (415.2 KiB). The current migrated set is estimated at 23,627,612 bytes (22.533 MiB), down 12,918,224 bytes (12.320 MiB / 35.35%) from its original 36,545,836 bytes. The asset audit classifies the five JPEGs as deliberate preserved originals rather than pending conversion candidates.
- The one-time converter now has an explicit keep-original set for these paths, so a future run will not re-encode the same oversized derivatives into larger WebPs. The CSV continues to document the original conversion rather than current file extension state.
- **Next:** wait for the full validation/browser smoke and Pages deployment on this commit. Then continue with `assets/projects/ephiphany-3d-illustration/florilegium.jpg` (+60,547 bytes / 59.1 KiB) as the next size-regression comparison. Keep user-side verification open for CMS foil save/reload, the thumbnail outline after refresh, and mobile 3D/back/focus behavior.


### October 13, 2026 — Second selective WebP size-regression rollback

- Five additional oversize derivatives were visually compared with historical originals and replaced by the exact original JPEG blobs; `data/projects.json` now references each `.jpg` file.
- This batch replaces 2,075,784 bytes of WebP with 1,803,243 bytes of original JPEG, saving 272,541 bytes (266.2 KiB) without re-encoding the art.
- Across both batches, ten originals now replace their oversized derivatives, saving 697,701 bytes (681.3 KiB). The current migrated set is 23,355,071 bytes (22.273 MiB), down 13,190,765 bytes (12.580 MiB / 36.09%) from the original 36,545,836 bytes. Twenty of the initial thirty larger-than-source WebP cases remain.
- The converter's preserved-original allowlist and asset auditor both include the full ten-file list. The CSV remains an audit of initial conversion outputs rather than current paths.
- **Next:** validate this second batch, then assess `assets/projects/ephiphany-3d-illustration/the-half-of-us.jpg` (+44,887 bytes / 43.8 KiB). User-side QA gates remain CMS foil save/reload, the thumbnail outline after refresh, and mobile 3D/back/focus behavior.


### October 13, 2026 — Third selective WebP size-regression rollback

- Five more referenced assets were visually compared with historical originals and restored from their exact JPEG blobs; `data/projects.json` now points at those original source paths. The unreferenced `resonance-of-being.webp` remains untouched rather than being introduced as a new public media reference.
- This batch replaces 1,213,376 bytes of WebP with 1,042,536 bytes of original JPEG, saving 170,840 bytes (166.8 KiB), with no additional lossy conversion.
- Across all three batches, fifteen original JPEGs now replace larger WebPs, saving 868,541 bytes (848.2 KiB). The migrated asset set is 23,184,231 bytes (22.110 MiB), down 13,361,605 bytes (12.743 MiB / 36.56%) from the original 36,545,836 bytes. Fifteen of the initial thirty larger-than-source WebP cases remain.
- The converter's preserved-original allowlist and asset auditor now preserve all fifteen reviewed originals. The per-file CSV remains an audit of first-pass conversion output sizes.
- **Next:** validate this batch and continue with `assets/projects/product-packaging/shampoo00.jpg` (+37,547 bytes / 36.7 KiB). User-side QA gates remain CMS foil save/reload, the thumbnail outline after refresh, and mobile 3D/back/focus behavior.

### October 14, 2026 — Fourth selective WebP size-regression rollback

- Compared four current WebP derivatives with exact historical JPEG blobs from pre-migration commit `9db228e38fa7acd0eb18df7503ff011bbe40e5ef`. At the same displayed size, there was no meaningful visual advantage to retaining the larger WebP versions. `data/projects.json` now references the original JPEGs; the converter and media-audit allowlists preserve these files without re-encoding.
- Restored the four original files byte-for-byte:
  - `assets/projects/product-packaging/shampoo00.jpg`: 184,073 bytes vs. 221,620-byte WebP; saves 37,547 bytes.
  - `assets/projects/product-packaging/aureus00.jpg`: 187,955 bytes vs. 218,874-byte WebP; saves 30,919 bytes.
  - `assets/projects/aol/continuity.jpg`: 377,148 bytes vs. 405,408-byte WebP; saves 28,260 bytes.
  - `assets/projects/ephiphany-3d-illustration/tender-reverence.jpg`: 81,168 bytes vs. 108,564-byte WebP; saves 27,396 bytes.
- This batch removes 954,466 bytes of WebP and restores 830,344 bytes of original JPEG, saving 124,122 bytes (121.2 KiB) without another lossy encode. Across nineteen reviewed originals, targeted rollbacks now save 992,663 bytes (969.4 KiB). The current asset payload is 23,060,109 bytes (21.992 MiB), down 13,485,727 bytes (12.861 MiB / 36.90%) from 36,545,836 bytes before migration. Eleven of the initial thirty larger-than-source WebP cases remain.
- `docs/WEBP-ASSET-BY-ASSET-SIZE-REPORT.csv` remains a historical record of the initial conversion; current restoration totals are maintained in the migration report.
- **Next candidate:** `assets/projects/product-packaging/wine-box.jpg` (+24,969 bytes / 24.4 KiB). Compare it with the current derivative before making another substitution. CMS foil save/reload, the occasional thumbnail outline disappearing after refresh, and physical-device mobile 3D/back/focus behavior remain open QA gates.

### October 14, 2026 — Fifth selective WebP size-regression rollback

- Side-by-side review found no meaningful display-size advantage in four more oversized WebP derivatives. Each was replaced with the exact original JPEG blob from pre-migration commit `9db228e38fa7acd0eb18df7503ff011bbe40e5ef`; `data/projects.json`, the converter preserve list, and the media audit preserve list were updated together.
- Restored `assets/projects/product-packaging/wine-box.jpg` (137,629 bytes vs. 162,598-byte WebP; saves 24,969 bytes), `assets/projects/graphic-design/wine-poster.jpg` (303,778 vs. 327,354; saves 23,576), `assets/projects/ephiphany-3d-illustration/melodies-of-innerself.jpg` (65,051 vs. 88,514; saves 23,463), and `assets/projects/graphic-design/commercial-renders.jpg` (539,338 vs. 560,378; saves 21,040).
- This batch removes 1,138,844 bytes of WebP and restores 1,045,796 bytes of original JPEG, saving 93,048 bytes (90.9 KiB) without re-encoding. Across twenty-three reviewed originals, the targeted rollbacks save 1,085,711 bytes (1,060.3 KiB). Current asset payload: 22,967,061 bytes (21.903 MiB), down 13,578,775 bytes (12.950 MiB / 37.16%) from the original 36,545,836 bytes. Seven initial larger-than-source WebP outputs remain to assess; the CSV remains a record of the initial migration.
- The preceding batch's full validation/browser smoke and Pages deployment passed on `6d9462b3d86668ddbde536a01128cd74c8b9cb38` (validation run [#38427768251](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38427768251), Pages run [#38427766883](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38427766883)). This commit will run those gates again.
- **Next referenced candidate:** `assets/projects/ephiphany-3d-illustration/aqua-vitae.jpg` (+13,919 bytes / 13.6 KiB). Leave unreferenced files such as `resonance-of-being.webp` untouched unless project-data usage is deliberately changed. CMS foil save/reload, the occasional thumbnail outline disappearing after refresh, and physical-device mobile 3D/back/focus behavior remain open QA gates.

### October 14, 2026 — Media-audit syntax regression corrected

- The validation run on `09b5e34b8a577f3f7561c0b93c0e7245ff582ae7` caught a missing closing tuple delimiter in the newly extended preserved-JPEG allowlist. The source was corrected before continuing the asset review; this was a tooling syntax issue, not an image-path or rendering failure.
- Pages deployment passed for that commit, but the asset-audit syntax failure stopped the validation sequence before architecture/CMS/browser-smoke checks. Those gates must pass on this corrective commit before more image changes are made.
- **Next:** verify the asset audit, full browser smoke, and Pages deployment on the fix; then continue with referenced WebP size regressions only if CI is green.

### October 14, 2026 — Sixth selective WebP size-regression rollback

- After the audit syntax correction, full validation/browser smoke and Pages deployment passed on `2aced6cbdebf5a5fa2a17794d5213e459b00f794` (validation [#38429085920](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38429085920); Pages [#38429085566](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38429085566)).
- Side-by-side comparisons at matched display size found no meaningful visual advantage in three additional oversized derivatives. `data/projects.json` now uses their exact historical JPEG blobs from `9db228e38fa7acd0eb18df7503ff011bbe40e5ef`; the converter and media-audit allowlists preserve those originals.
- Restored `assets/projects/ephiphany-3d-illustration/aqua-vitae.jpg` (40,071 bytes vs. 53,990-byte WebP; saves 13,919 bytes), `assets/projects/retail-spatial-layouts/lss03.jpg` (107,019 vs. 114,662; saves 7,643), and `assets/projects/haeru/haeru-logo-construct.jpg` (69,570 vs. 72,148; saves 2,578).
- This batch replaces 240,800 bytes of WebP with 216,660 bytes of original JPEG, saving **24,140 bytes (23.6 KiB)**. Across twenty-six reviewed originals, targeted rollbacks now save **1,109,851 bytes (1,083.8 KiB)**. Current migrated asset payload is **22,942,921 bytes (21.880 MiB)**, down **13,602,915 bytes (12.973 MiB / 37.22%)** from the original 36,545,836 bytes. Four initial larger-than-source cases remain in the historical size table; the project-referenced 28-byte outlier is deliberately left as WebP because switching it would add path churn for negligible savings.
- The CSV remains the byte comparison from the first conversion, not a claim that every initial WebP remains in use. This new batch must pass the full validation and Pages deployment before further writes.
- **Next:** review whether any remaining non-project asset paths merit work, then close the optimization pass if the remaining differences are not material. CMS foil save/reload, the occasional thumbnail outline disappearing after refresh, and physical-device mobile 3D/back/focus behavior remain open user-side QA gates.

### October 14, 2026 — Seventh selective WebP size-regression rollback

- The previous batch's full validation/browser smoke passed on `93694571799444722fc961f3529c4e5f26ab61e8` (validation [#38429715322](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38429715322); Pages [#38429714460](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38429714460)).
- The About page used the larger `assets/projects/site/profile.webp` in both its high-priority image preload and the visible profile image; `data/about.json` also points to that derivative. Visual comparison against the historical JPEG found no meaningful difference at the same display size. The preload, static About markup, About data, converter preserve list, and asset-audit map now all use/preserve `profile.jpg`.
- Restored the exact original JPEG (56,418 bytes vs. 65,398-byte WebP), saving **8,980 bytes** without re-encoding. Across twenty-seven reviewed originals, targeted rollbacks now save **1,118,831 bytes (1,092.6 KiB)**. The current migrated asset payload is **22,933,941 bytes (21.871 MiB)**, down **13,611,895 bytes (12.982 MiB / 37.25%)** from the original 36,545,836 bytes.
- Three initial source-larger WebP rows remain in the historical conversion table. The only remaining project-referenced one is just 28 bytes larger than its original; leave it unchanged rather than churn references for negligible savings. Unreferenced asset candidates remain untouched pending a deliberate use-case review.
- **Next:** validate About-page source/preload and the full browser smoke plus Pages deploy on this commit. If green, shift from material image savings to the open CMS round-trip and real-device QA rather than re-encoding borderline assets.

### October 14, 2026 — Show Less smoke-test timing corrected

- Validation on `a7d83e32efa86c63e4014e76b0624f30ef3a9e09` passed the static checks and site-data audit, and Pages deployment passed; browser smoke caught the mobile Show Less style assertion sampling mid-transition. At failure, the button was `expanded: true`, while background/color/backdrop-filter still carried interpolated CSS transition values. The same run confirmed the new About `profile.jpg` request returned HTTP 200.
- The app's intentional 280 ms material transition remains unchanged. The smoke test now waits (up to 2 seconds) for the actual expanded contract—solid white background, black text, and no backdrop blur—before asserting it. This removes dependence on an arbitrary fixed wait while still failing if the final style is wrong.
- Re-run full validation/browser smoke and Pages deployment before continuing asset or performance edits.


### October 15, 2026 — Phase reconciliation and runtime performance audit

- **Verified source checkpoint:** `f12523dd9b08813cb7324ada96724368fe45df8a` passed full validation (run #38765047326) and Pages build/deployment (run #38765045528). All 36 Chromium smoke scenarios passed. This remains a test-branch verification, not promotion to `main` or the deployed legacy repository.
- **Phase status:** migration Stages 0–5 are complete; Stage 6 (CSS ownership) and Stage 7 (CMS application boundary) remain in progress. Phase 3A's contracts are achieved but CSS consolidation remains. Phases 3B and 3C are active hardening work; Phase 3D still needs the full responsive/physical-device pass. Stage 8 removal follows the feature validation gates.
- **Architecture snapshot:** `js/script.js` is an 18-line entrypoint; `js/app/bootstrap.js` owns startup, error containment, and the loading gate; `js/app/page-composition.js` coordinates settings, data, features, preloads, and teardown. The public runtime has 38 native ES modules under `js/` (about 383 KiB of source text across those modules before transfer compression). The CMS remains a separate application surface.
- **Optimization snapshot:** `js/features/lightbox/media-renderer.js` is about 99 KB / 2,194 lines, and the shared `css/style.css` is about 212 KB / 5,689 lines; the Lightbox feature stylesheet is separate but still small. These source sizes identify audit targets, not measured network-transfer costs. Runtime protections are already present for bounded preloads, constrained-network secondary work, mobile foil canvas/draw rate, low-power 3D render profiles, and no-op resize suppression.
- **Cache alignment fix:** the homepage's model-viewer modulepreload now uses the same query version as the dynamic import in page composition. `tools/validate-site.mjs` checks this relationship so a future version mismatch fails validation instead of silently creating separate module URLs.
- **Next:** baseline About/Works network loading and startup timing, then make route-aware feature loading the next contained optimization candidate. Keep CMS foil save/reload, thumbnail focus, Curated View fresh-session, and physical-device Lightbox/3D checks as explicit remaining gates. Do not promote the branch until the architecture, validation, and QA gates are reviewed together.


### October 16, 2026 — Route-aware loading and shared artwork data

- **Verified code checkpoint:** `00a358bff632ffdedfd71e8e360d4e3d8268dbf3` passed [Validate portfolio #38770581892](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38770581892) and [Pages build/deployment #38770583009](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38770583009). All 36 Chromium smoke scenarios passed.
- **Route-aware module loading:** `Projects`, `Gallery`, and `Lightbox` module graphs load only on pages with `#portfolioGrid`. An About-route browser request contract prevents accidental import regressions. The shared project normalizer is intentionally still loaded because Hero/Footer use it to derive artwork sources.
- **Shared project data:** page composition now starts one project JSON request/normalization promise whenever the page contains the Work grid or Hero/Footer artwork. The resolved model list is passed to the About Hero and Footer instead of allowing each feature to independently fetch and normalize `data/projects.json`. About smoke asserts no more than one request for that file.
- **First route-profile baseline (390×844 fresh Chromium contexts, one CI run):** About reached DOMContentLoaded at 122 ms and the loading gate at 506 ms (384 ms after DCL), with 23 same-origin JavaScript files and 149,117 encoded JS body bytes. Works reached DCL at 123 ms and the loading gate at 608 ms (485 ms after DCL), with 37 JavaScript files and 395,139 encoded JS body bytes. About therefore requested 14 fewer JS files and approximately **246,022 fewer JavaScript response-body bytes (240.3 KiB)** in this local sample. The resource reports' encoded and decoded body totals are equal, so the local smoke server did not compress responses. Treat this as an initial route-graph baseline, not production bandwidth, repeated-run statistics, or physical-device performance. Whole-origin byte totals were also captured but are not used as the main comparison because route assertions issue additional first-party data reads.
- **Next:** repeat the About/Works capture in multiple clean sessions, and compare it with the GitHub Pages testing URL for compression/cache behavior. Keep the live CMS foil save/reload, thumbnail focus-outline, Curated View fresh-session, and physical-device 3D/Back/Contact-swipe QA open. Keep the deployed legacy repository and `main` out of scope until explicit promotion authorization.


### October 16, 2026 — Bound hidden YouTube player resources

- The October 16 backup branch was verified against the pre-audit snapshot before continuing writes. The active branch remains `projects-runtime-cutover`; production and `main` remain out of scope.
- Video preload teardown now pauses the video, clears source references, calls `load()`, removes the node, and settles pending preload work. Failed holographic WebGL initialization also deletes partial allocations, requests context loss where supported, and clears the canvas backing store.
- The follow-up optimization bounds hidden YouTube warm-up to two unique URLs and retains at most two successful iframe cache entries. Eviction removes only iframes still inside the hidden preload root; active Lightbox players are not forcibly removed. Unwarmed embeds load on demand, with native player interaction remaining untouched.
- Runtime cache versions are advanced together through the public entrypoints, bootstrap, page composition, Lightbox module import, and architecture/runtime validator fixtures. The current HEAD passed the full site validation, syntax checks, lifecycle contract, and all 36 browser smoke scenarios; the Pages build/deployment succeeded.
- The CMS foil-style test changed the test artwork to `aurora`, confirmed the serialized save payload, reloaded the CMS fixture, and confirmed the selection persisted. This is automated fixture coverage, not a manual live-repository CMS sign-off.
- Latest local Chromium route sample (390×844, one session): About used 23 JavaScript files and 149,117 encoded JS body bytes; Works used 37 files and 397,075 bytes. About reached DOMContentLoaded at 130 ms / loading gate at 453 ms; Works reached DOMContentLoaded at 155 ms / loading gate at 449 ms. The local server did not compress responses, and this is not production/CDN transfer or memory profiling.
- **Still open:** repeat About/Works profiling against GitHub Pages across multiple clean sessions; reproduce the intermittent thumbnail focus-outline behavior before changing its CSS; fresh-session Curated View verification; and physical-device 3D Focus/Back, Contact swipe, and YouTube first-tap checks. Keep production and `main` untouched until explicit promotion approval.


### October 16, 2026 — YouTube preload teardown hardening

- The Lightbox media renderer now uses named YouTube iframe load/error handlers and an exactly-once settlement function. Failure, timeout, and renderer teardown detach both listeners, clear the iframe source, remove the node, clear only its matching cache entry, and settle the awaiting preload; successful hidden frames still flow through the two-entry cache and visible players are not evicted.
- The renderer module cache identity advanced to `media-renderer.js?v=20261016-03`; the Lightbox entry uses `index.js?v=20261016-08`. The public bootstrap/script/page-composition references and validator fixtures were updated together.
- Verified on runtime commit [`100458dd`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/100458dd51d7159b3818e439e5056ebae26abdda): full validation including all 36 Chromium smoke scenarios passed, and GitHub Pages build/deployment succeeded. The extra lifecycle assertions ensure cleanup stays part of the test contract.
- This reduces orphaned iframe/resource work under preload failure or teardown; it is **not** evidence of a measured JavaScript heap-leak fix. No before/after heap snapshot has been taken.
- **Next:** repeat About/Works performance captures on the deployed testing URL across multiple clean sessions; keep the thumbnail focus-outline reproduction, fresh Curated View pass, live CMS foil save/reload, and physical-device Lightbox/3D/Contact checks open. Do not promote to `main` or the legacy production repository without explicit approval.


### October 16, 2026 — Stabilize first-load 3D viewer dependency resolution

- The Works page previously declared `js/infrastructure/three/model-viewer.js` as a modulepreload before its import map. Because that module imports the bare specifiers `three` and `three/addons/`, this was an ordering hazard at the start of the module graph.
- The import map now appears before all modulepreloads, and both the HTML preload and the page-composition dynamic import use `model-viewer.js?v=20261016-01` instead of the old `20261015-01` identity. Advancing the URL prevents reuse of a stale failed module-map entry for the prior identity.
- `tools/validate-site.mjs` now enforces the import-map-before-viewer-preload contract as well as keeping the preload and dynamic-import cache keys identical.
- Verified on [`115c883`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/115c883787b0285fb50d2cbccb28520c45624734): [Validate portfolio #38837938689](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38837938689) passed with all 36 Chromium smoke scenarios, and [Pages build/deployment #38837938304](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38837938304) passed.
- This is a targeted fix for first-load dependency resolution, consistent with the desktop-only symptom. Automated smoke passing does not establish that every desktop graphics driver/CDN timing case is eliminated; confirm a clean desktop first-load on the deployed testing URL. If the fallback recurs, retain the browser-console error and failed model URL to distinguish dependency loading from a WebGL/model-asset failure.
- **Next:** run the Works page from a clean desktop browser session and open a 3D project without refreshing; then repeat the same check on mobile to protect the existing render profile. Keep production and `main` untouched.



### October 16, 2026 — YouTube iframe readiness and form autofill follow-up

- YouTube pause and player-setup messages now wait for the iframe's own `load` event to mark it ready. The same marker is set for hidden preloads and directly opened Lightbox frames; this avoids sending a strict-origin message while the frame can still be showing the portfolio origin during navigation.
- The project-inquiry name and email fields now expose `autocomplete="name"` and `autocomplete="email"`. The review Name/Handle field uses `autocomplete="nickname"`.
- The site validator now checks those three autofill hints and enforces the loaded-frame guard in both YouTube message paths. The Chromium smoke fixture asserts the load marker before accepting the YouTube player handoff as initialized.
- Root Works, About, bootstrap, script, and page-composition cache keys were synchronized to `20261016-09`; Lightbox's entry key is `20261016-09` and its nested media renderer key is `20261016-04`. A source-level spot-check confirmed the versions match and all three form fields expose the expected token.
- The browser's `youtubei/v1/log_event` request failing with `ERR_BLOCKED_BY_CLIENT` is consistent with client-side request filtering and is not, by itself, evidence that video playback failed. QuillBot's `chrome-extension://invalid/` error is extension-originated rather than a first-party site asset.
- **Verification:** [Validate portfolio #38842217058](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38842217058) passed, including the full browser smoke step, and [Pages build/deployment #38842217040](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/38842217040) passed on branch tip [`702c9e3`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/702c9e3df2861770b9c1f911b9d301b25c61368d). This verifies CI behavior, not a physical-device check. Production and `main` remain untouched.


### October 16, 2026 — Synchronize test harness cache contracts

- The follow-up CI failure was not a runtime or form-autocomplete failure: `validate-site.mjs` passed, and the Pages deployment check passed. Architecture validation uses explicit canonical cache keys for nested modules and separate test harnesses, which had not been advanced alongside the Lightbox source imports.
- Updated the architecture validator's Lightbox entry/media-renderer expectations to `20261016-09`/`20261016-04`, and aligned `tools/validate-project-runtime.mjs` with the same Lightbox entry key. Both the architecture validator and all remaining contract/syntax checks passed on the next completed run.
- **Next:** continue with fresh-session testing of the published testing site, especially desktop first-load 3D and the YouTube iframe warning. Keep production and `main` untouched.


### October 17, 2026 — Phase 3D navbar-anchored Lightbox controls

- The public navbar remains transparent with direct Designs, About Me, and Contacts pills; this iteration leaves its accepted styling and menu behavior unchanged.
- Added a shared Lightbox edge token based on the page gutter and the current 1400px container. On desktop, the close circle matches the 42px navbar-pill height and aligns with the right edge of the last link; previous/next mirror the navbar's left/right page edges. This follows the rightmost link, not a hard-coded count of three links.
- On mobile, the 52px close target is centered in both axes over the 38px hamburger; previous/next controls now use the same horizontal page-edge anchors and 52px square hit targets.
- Added browser-smoke assertions at 1280×900, 1600×900, and 390×844 to protect the control geometry. The 1600px case exercises the capped-container branch of the shared edge token; the 1280px case covers the regular page-gutter branch. The Lightbox feature stylesheet cache identity is `20261017-02`. The first geometry run exposed the base stylesheet's more-specific desktop arrow offsets and the logo-driven vertical center; feature selectors now match the original arrow specificity, and the close targets use the measured 45px nav-row geometry.
- **Verification gate:** run the full validation/browser-smoke workflow and Pages build/deployment on this commit. Then visually confirm at desktop, narrow tablet, and a physical phone, including safe-area behavior and arrow reachability. Do not promote to `main` or the deployed production repository.


### October 17, 2026 — Phase 3D mobile navigation selection feedback

- Mobile nav-link activation now runs as a deliberate three-stage interaction: the tapped pill transitions to white/black selected styling and completes its lift/settle animation; the full-screen menu then exits; only after the exit does the existing link click replay so native page navigation and the same-page Designs/Contacts contracts remain intact.
- The selected-state wait observes Web Animations API animations and transitions where available, has a bounded CSS-timing fallback, and honors `prefers-reduced-motion: reduce` by allowing an instantaneous selected state one painted frame before immediate close. A selection-in-progress guard prevents double-taps or the hamburger from interrupting the handoff. The mobile menu's close timer and existing Escape/outside-tap flows remain the same.
- Added a browser regression that records the About Me pill's selected styling while the menu is still open, then verifies navigation to About follows. Bumped the shared stylesheet cache identity to `20261017-10` across all public HTML entry points, and advanced the public script/bootstrap/composition/navigation module query versions to `20261017-03` together so browsers request the latest interaction logic, including the one-destination-at-a-time selected pill state.
- **Verification gate:** validate selection-first sequencing, same-page Contacts scrolling, active Designs behavior, reduced-motion navigation, and the full Chromium smoke/Pages workflows. Do not promote to `main` or the deployed production repository.

### October 18, 2026 — Network-failure smoke gate and continuation audit

- **Source checkpoint audited:** `99a2007655d7c14ab558022c11fe5fbde02b4a86` (`test(smoke): fail on broken same-origin network requests`), committed at 2026-10-18 08:12:44 UTC / 16:12:44 PHT. This commit adds browser-smoke failures for same-origin HTTP 404s and same-origin request failures, excluding known intentional cancellation codes (`ERR_ABORTED`, `NS_BINDING_ABORTED`, and `ERR_CANCELED`). The site validator checks that these network assertions remain present.
- **Navigation audit:** Phase 3D's mobile selection-first behavior is already implemented in `js/features/navigation/index.js`. The browser smoke suite specifically records the About Me pill's selected styling while the menu remains open, then verifies the route to About. Do not duplicate this implementation without a reproduced defect.
- **Verification status:** the connected commit-status query returned no status rows, and the available workflow lookup did not expose push-triggered run results for this checkpoint. This is **unverified CI**, not a pass or a failure. The `Validate portfolio` workflow is configured to run on pushes to `projects-runtime-cutover`; confirm the exact-head run before declaring the checkpoint green.
- **Recovery point:** created `backup/projects-runtime-cutover-2026-10-18` at checkpoint `99a2007655d7c14ab558022c11fe5fbde02b4a86` before continuing the audit. The retained `backup/projects-runtime-cutover-2026-10-16` branch is 340 commits behind the active branch with no divergence; keep it as historical recovery context.
- **Next gate:** verify full validation and browser-smoke results for the current branch head. If green, continue with fresh-session About/Works performance captures and the open manual QA gates: live CMS foil save/reload, thumbnail focus outline after refresh, fresh-session Curated View, and physical-device Lightbox/3D Focus/Back, Contact swipe, and mobile YouTube first-tap checks. Keep CSS ownership extraction paused until the relevant visual/device gates are cleared. Do not promote to `main` or the legacy production repository without explicit approval.

### October 18, 2026 — CMS-managed interaction feedback and UI polish

- Removed the Works hero's dedicated bottom-edge gradient pseudo-layer. Existing slide transitions remain; only the unwanted fade between hero artwork and content was removed.
- Navigation pill labels explicitly use border-box sizing and centered text, backed by geometry assertions across desktop states and the open mobile menu. The adaptive logo foreground controller remains; restrained hover/press motion respects reduced-motion preferences.
- The filter strip stays centered inside shared page gutters and the maximum content width on desktop, tablet, and mobile. Existing mobile scrolling, snapping, edge spacers, and Gallery state ownership remain intact; project-card presentation is unchanged.
- Added optional CMS-managed navigation/selection feedback. The master setting defaults off; WAV cues are editable through Media Library paths; CMS has independent sound/haptic switches, capped volume, and click-to-preview controls. When enabled, cues respond only to trusted clicks, sounds are fetched on demand, unsupported haptics/playback failures are non-fatal, and visitors can disable feedback locally in the footer. The module is dynamically imported only when CMS settings enable an effect.
- The media audit recognizes common audio formats. Settings tests cover default-off state, safe asset paths, capped volume, trusted-click gating, and local opt-out. Browser smoke expects no feedback preference control when effects are off.
- **Verification state:** combined-status lookup has not supplied CI results for the latest source commits. Do not call the change verified until current-head Validate portfolio and browser smoke pass. Physical-device checks are still necessary for actual audio/vibration support. The provided reference site could not be fetched through the available browser tool, so no layout, branding, content, or code was copied.
- **Next gate:** run full validation/browser smoke. If green, visually inspect hero edge and filters, test logo motion/reduced motion, then enable feedback in CMS on the test branch and verify previews, visitor opt-out, and supported-device haptics. Keep routing structure, gallery design, `main`, and production untouched.


### October 18, 2026 — Hero contrast and compact filter rail follow-up

- The logo audit found a false-contrast path: inactive hero slides remained candidates during crossfades, and the opaque hero-container background could be mistaken for the visible media. The sampler now filters inactive/transparent media, checks active slides before their structural background, avoids sampling the logo itself, and uses light/dark hysteresis to reduce flicker.
- When image/video/canvas pixels cannot be sampled (including canvas security restrictions), the logo switches to white over a localized translucent, blurred capsule. The capsule only appears when needed, has no pointer hit area, and is removed after a reliable backdrop sample returns.
- On Works, generic top page padding and filter top margin no longer compound: the filter strip starts at the hero edge, with a 48px rail and 44px targets. Mobile retains horizontal momentum/scroll snapping; a 22px alpha mask fades the rail edges without capturing taps.
- Extended Chromium smoke coverage checks hero/filter gap, filter dimensions and text centering at desktop/tablet/mobile sizes, horizontal scroll/touch behavior, active-vs-inactive slide contrast, and the unmeasurable-media capsule. Static validators enforce the same layout/runtime contracts.
- **Verification gate:** cache keys are synchronized for the changed public stylesheet/runtime graph. Run the full Validate portfolio workflow and Pages build/deployment on this commit before calling it verified. A physical phone/tablet check remains useful for real video transitions, motion, and safe-area behavior. The legacy production repository and main remain untouched.


## 2026-10-18 — Adaptive logo animation follow-up

- The fixed logo now re-samples active hero artwork while it sits over the hero surface, including still images that zoom or cross-fade. Previously, periodic contrast checks were limited to video/canvas/Lottie, so image animations could outlive the sampled foreground choice.
- Sampling pauses while the document is hidden and remains event-driven for ordinary page images to keep the additional work bounded.
- Runtime cache references advanced to `20261018-14`; the validation contract now guards this behavior.

### October 26, 2026 — Gallery adaptive contrast and bounded event sampling

- Fixed-control contrast sampling now prefers visible media at the actual logo/hamburger backdrop point before accepting an opaque card or wrapper background. This lets gallery thumbnails override their card canvas when the media is what is visually behind the fixed control. The previous hard-coded Contact foreground branch was removed.
- Animated surfaces are treated as dynamic when the sampled backdrop belongs to the active hero, video/canvas/Lottie/Mux media, or a foil-enabled project thumbnail. Changes are coalesced through the existing animation-frame scheduler, and the interval stays active only while a sampled surface needs periodic refreshing.
- The follow-up performance audit removed the document-wide `pointermove` listener. That listener could rerun two backdrop hit-tests and media discovery on every pointer movement across unrelated content. Scroll, resize, media lifecycle events, `pointerover`, and bounded dynamic-media polling remain.
- The site validator now enforces the absence of document-wide pointermove contrast sampling and the presence of pointer-entry refresh. Runtime cache keys were advanced together: navigation `20261026-04`, app/bootstrap/page composition `20261026-13`; the CSS cache key remains unchanged because no styles changed.
- Verified at source checkpoint [`5e0f692`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/5e0f6921735d3ad3411ca7312be2e2e8a7085c86): [Validate portfolio #40302617999](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40302617999) passed, including Chromium browser smoke, and [Pages build/deployment #40302616630](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40302616630) passed.
- **Still open:** test the published testing URL in a fresh browser and on a physical phone/tablet, especially real Mux video, cross-origin media, scroll transitions over gallery/Contact/footer, and mobile controls. Automated smoke does not replace this visual/device pass. Keep `main` and the deployed legacy repository untouched.
- **Next:** complete the manual contrast/responsive pass, then repeat About/Works startup/network captures in multiple clean sessions and compare against the published testing URL. Keep the live CMS foil round-trip, thumbnail focus-outline reproduction, fresh-session Curated View check, and physical-device Lightbox/3D/Back/Contact-swipe checks open.

### October 26, 2026 — Mux hero no-source recovery

- The reported Mux hero state was `readyState: 0`, `networkState: 3`, and no native `MediaError.code`. The prior retry path only retried network failures when it could read `media.error.code === 2`, so this specific state could remain logged without automatic recovery.
- `js/features/hero/index.js` now inspects the Mux host, an accessible open-shadow-root video, and `error` event details before reporting playback state. For Mux elements only, a no-code `networkState: 3` condition now schedules one bounded retry; native media network code `2` keeps its existing one-retry limit. Reconnect/gesture recovery uses the same detail helper. A retry attempt does not substitute the legacy reel; MP4 fallback still requires an explicit CMS `fallbackSrc`.
- The warning now records the underlying media element name, ready/network states, native/event error code and message where available, plus whether a retry was scheduled. This should make a future real-stream failure easier to classify without guessing from the host's null `media.error` alone.
- Added a browser regression that injects `networkState: 3` with no error code into the Mux mock and verifies one retry resets/starts playback; the fixture resets its own retry counter and includes a failure-state payload to avoid false failures from earlier startup activity.
- Runtime cache identities were synchronized: Hero entry `20261026-10`, bootstrap/page-composition chain `20261026-14`. Verified source checkpoint [`7affb85`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/7affb85024f7ad568f39870e2fe736abb81f2284): [Validate portfolio #40308856969](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40308856969) and [Pages build/deployment #40308856499](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40308856499) both passed.
- **Still open:** I could not retrieve the configured Mux thumbnail or HLS endpoint through the inspection tools. Test the live hero in a fresh browser and check Network for the `.m3u8` manifest and media segment statuses if it still fails. If it does, capture the updated `[Hero Mux]` warning payload plus the failed request status; that will distinguish authorization/unavailable playback from an HLS/network-loading issue. Do not promote this branch to `main` or the legacy production repository without explicit authorization.

### October 26, 2026 — Project thumbnail and grouped artwork reveal refinement

- The existing project-card reveal now starts at `scale(.985)` relative to the configured thumbnail zoom rather than `1.035×`, so successful media eases forward into its resting size instead of shrinking after it appears. Opacity and blur still resolve together over the existing 360ms easing; layout remains owned by the card's reserved aspect-ratio frame.
- Reduced-motion users bypass thumbnail reveal transitions and loading blur, and a loading thumbnail is kept at its configured zoom/rotation instead of sitting at the temporary underscale. Failed images/animations/models continue using their explicit fallback and the error selector disables the success transition.
- The existing Lightbox reveal remains bound to media readiness (including image decode and renderer-ready signals) and applies to each `.lightbox-media-item`/`.lightbox-artwork` independently. The group animation keeps the current modest stagger (35ms increments to a 135ms cap), while compact mobile layout still omits scale so full-bleed/portrait media doesn't change its frame geometry.
- Browser-smoke coverage now measures the loading thumbnail transform to confirm it starts under 1×, checks that reduced-motion state uses natural-size unblurred media with no transition duration, and verifies the first three items in a real multi-item holographic artwork group only run the success reveal after each item becomes ready. The grouped test checks animation identity, bounded delay, error fallback, and multiple successful items.
- CSS cache identity is `20261026-11` across Works, About, 404, and success pages. Verified at checkpoint [`f57cebff`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/f57cebff80822496d46dab55e2608729fcdd272e): [Validate portfolio #40339962028](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40339962028) and [Pages build/deployment #40339961819](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40339961819) passed.
- **Still open:** automated smoke is not visual sign-off on physical devices. Verify slow and cached project-thumbnail loads, multi-artwork grouped Lightbox reveals, hover/foil interaction after reveal, and reduced-motion output on a real phone/tablet and a fresh browser session. Keep `main` and the deployed legacy repository untouched.

### October 26, 2026 — Thumbnail reveal CI timing follow-up

- The `bce836a` run failed only in browser smoke scenario `project-thumbnail-presentation` (#46), at the wait for five `data-state="loading"` fallback layers. The failing check timed out at 2.5 seconds. Static/site-data checks, architecture checks, syntax checks, and the Pages deployment passed. This was a smoke-fixture readiness failure, not a production validator failure.
- The added fifth fixture was a 3D project thumbnail mounted through the visibility-lazy model preview path. Subsequent test follow-ups explicitly scroll it into view before asserting its loading veil and bring it back into view after mobile reflow before checking ready state. The current fixture deliberately delays mock model mounting by 2.4 seconds.
- The remaining 2.5-second assertion had only ~100ms beyond that intentional delay. Commit [`48ec1dc`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/48ec1dc28dcb3133e31d15ec8f7c8206c6c3b8b1) increases that one smoke timeout to 4.5 seconds, without changing runtime animation timing. [Validate portfolio #40344248828](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40344248828) passed including all 46 browser-smoke scenarios, and [Pages build/deployment #40344249748](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40344249748) passed on the same SHA.
- This regression is considered resolved in automated CI. Keep real-device/fresh-browser QA open for visual smoothness, reduced-motion handling, and grouped artwork behavior; do not promote to `main` or the deployed legacy repository without explicit authorization.


### October 27, 2026 — Same-source asset preview handoff

- Added a shared installer for tiny preview frames already captured from the exact asset being displayed. It never fetches a CMS thumbnail or mounts another renderer, and it leaves the current loading surface unchanged when no matching cached frame is available.
- Project thumbnails and Lightbox images/local videos may use a safely captured low-quality frame as the outgoing loading surface before it fades over the ready asset. Existing CSS keeps the preview strongly softened and stabilizes the reserved artwork geometry, avoiding jumps near the viewport top or bottom.
- Lottie, 3D, and Mux only use the installer if their renderer exposes a safe drawable frame. Mux loading uses a playback-specific cache key and excludes a poster that matches the project's CMS thumbnail before assigning the player poster. Poster identity comparison is shared at module scope so the Mux renderer does not depend on a fallback-local helper. Cold 3D loads retain the existing viewer/loading behavior; cross-origin, unsupported, tainted, and non-drawable surfaces keep their existing neutral/type-specific placeholder or media-specific poster. A different project's CMS thumbnail is never promoted into a loading preview.
- Browser smoke coverage now checks that the shared helper installs only a cached same-source frame and preserves the original loader on cache miss. The Lightbox, page-composition, bootstrap, public script/preload cache keys, and canonical architecture/runtime validator maps were synchronized so the nested media renderer cannot be hidden behind a stale module. Existing reduced-motion and compact Lightbox geometry contracts remain in force.
- Automated CI does not replace a fresh-session visual pass: verify first-load and repeat-load transitions, image/video source changes, grouped Lightbox artwork, reduced motion, and 3D loading on a physical phone/tablet. Keep `main` and the deployed legacy repository untouched.


### October 27, 2026 — Viewport-aware asset reveal refinement

- The active baseline for this change was `1904f245c80cd817b8a8f533093803ebd5885fe3`, whose [Validate portfolio run #40376874954](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40376874954) and [Pages build/deployment run #40376874552](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40376874552) both passed.
- Reuses the existing bounded `asset-preview.js` mechanism: only a tiny frame already captured from the exact rendered asset can be used as a loading preview. No secondary fetch, new renderer, project CMS thumbnail substitution, or forced preview generation is introduced.
- Project-card images that finish decoding before entering the viewport retain their reserved geometry and stay softly hidden until first entry. The existing opacity/scale/blur transition then brings the ready image into focus. The viewport observer begins the entry when the card is at least 24px inside the top/bottom edges; reduced-motion users and browsers without IntersectionObserver retain the normal no-animation fallback.
- Lightbox artwork uses the same 24px inset reveal band for smooth entry at the top and bottom of a scroll container. This is a one-time readiness reveal; it does not repeatedly fade artwork as the visitor scrolls back and forth, and it does not alter mobile aspect-ratio geometry.
- Existing loading states remain authoritative if a safe matching preview is unavailable. In particular, cold/large 3D models retain the current lightweight loader until a renderer provides a safely drawable frame; tainted/cross-origin, unsupported and failed sources keep their existing fallback behavior.
- Added Chromium coverage for a fast image becoming ready below the viewport, staying in its pending reveal state, then smoothly reaching natural scale and sharpness after scroll entry. Static validation also guards both observer thresholds, reduced-motion behavior and module/cache-version alignment.
- **Manual gate remains open:** CI validates the code path, not perceived motion on physical hardware. On a fresh session, inspect top/bottom viewport entry, fast and slow image/video loading, Lightbox open/close and grouped artwork, reduced motion, and initial heavy 3D rendering on a phone/tablet. Keep `main` and the deployed legacy repository untouched.


### October 28, 2026 — Mobile holographic Lightbox refinement and verified checkpoint

- At 10:30:41 AM PHT, [`fde4ed4`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/fde4ed451fae77e27114cab43a235a30f7c2c6b1) set holographic Lightbox media items to 75% width and centered them on screens up to 767px; it also replaced the verbose device recommendation with “Best viewed on desktop for full effect.”
- At 10:32:17 AM PHT, [`87333fd`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/87333fdd9f624f555485077a006b9c83e7ee196a) preserved the mobile-control guard while moving the sizing rule into its safe cascade location. At 10:34:23 AM PHT, [`2a16d9e`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/2a16d9e3c28d75235647d588049872fbf5718974) strengthened the mobile overrides so style-specific foil rules cannot reactivate material layers.
- At 10:37:21 AM PHT, [`a39c6a3`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/a39c6a36ef0d78f74d113ec93e9646579abd11b1) aligned validation with mobile foil suppression. At 10:39:03 AM PHT, [`916913c`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/916913cbd48d006c2c865a9b4590ef347228e461) aligned smoke-test bounds with the expanded parallax range. At 10:42:39 AM PHT, [`daa919a`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/daa919a7944081e566d04b82ec835fa517b31562) switched the auto-motion assertion to bounded transform-variable deltas.
- Both [Validate portfolio #40622542702](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40622542702) and [Pages build/deployment #40622542618](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40622542618) passed on the current HEAD. This establishes a green automated checkpoint but does not replace real-device checks.
- **Next step:** complete targeted mobile/tablet/desktop responsive checks and repeated Lightbox lifecycle testing, then continue clean-session performance comparisons on the deployed testing URL. No changes to `main` or the deployed legacy repository are authorized by this checkpoint.


### October 28, 2026 — Remove unused bundled Hero MP4 and correct artwork-group centering

- The user confirmed the bundled local Hero MP4 is no longer needed and may be removed with its now-empty `banner/` directory. Removed the video and its directory placeholder after replacing every exact tracked-file reference that blocked CMS deletion. The static-video CMS form now uses a generic example path; media-reference test fixtures use a synthetic path; validation no longer requires the retired bundled fallback. General source-provided native-video fallback behavior remains supported.
- The grouped Lightbox artwork centering issue was traced to `css/features/lightbox.css` adding horizontal padding to a `width:100%` grid wrapper without `box-sizing:border-box`. The wrapper now keeps its outer width within its parent and is centered with `margin-inline:auto`.
- Browser smoke coverage now checks grouped artwork wrapper width, border-box sizing, and center offset before the Inspector interaction test, so the padding/overflow regression is caught automatically.
- This checkpoint removes a 5,016,396-byte (about 4.78 MiB) bundled video. It does not delete or alter hosted Mux sources, other project media, or user content. Physical-device layout confirmation remains separate from automated CI.
- **Next step:** inspect the updated validation and Pages workflow results, then check the affected artwork group at mobile/tablet/desktop sizes and confirm the intended Mux poster/fallback behavior in a clean session.


### October 28, 2026 — Center holographic front and back artwork faces

- Follow-up to the artwork-group layout fix: the user clarified that the group wrapper itself is centered; the visible holographic card artwork/front and reverse faces were the elements drifting off-center.
- The Lightbox inner layer applies pointer-driven `--holo-shift-x/y` translation for parallax. The feature stylesheet now counter-translates each face plane by those same offsets, preserving face alignment with the centered holographic layout slot while retaining the existing face flip, tilt and foil effects.
- Browser smoke now injects a known asymmetric `18px / -11px` shift and measures both front and back face centers against the card center. It fails if either face drifts more than 1.5px.
- The feature stylesheet cache identity advances to `20261028-06`. This change is isolated to the active `projects-runtime-cutover` branch; the legacy production repository and `main` are untouched.
- **Next step:** complete validation and Pages deployment, then visually verify both sides during hover/tap flip at desktop, tablet and mobile sizes.


### October 28, 2026 — Flipped-state face alignment coverage

- The face-positioning audit included the wrapper flip transform: the visible reverse face needs the opposite compensation sign after the card's outer flip rotates 180 degrees. Added flipped-state overrides for both face planes so they remain centered while the card is reversed as well as at rest.
- Extended browser smoke from a single rest-state check to a controlled `18px / -11px` parallax test in both unflipped and flipped states. It verifies all four face-center offsets stay within 1.5px and restores interaction state after measurement.
- Updated the Lightbox stylesheet cache identity to `20261028-07`. Automated validation and Pages deployment remain the next gate.


### October 28, 2026 — Correct flipped holographic face vertical compensation

- The first flipped-state browser regression run exposed a real remaining alignment defect: with an injected `18px / -11px` shift, both faces stayed centered unflipped, but moved approximately `-22.2px` vertically when flipped. The two `-11px` vertical translations were being applied in the same direction because a 180° rotation around the Y axis reverses horizontal direction, not vertical direction.
- Corrected both flipped front/back face transforms to keep the inverted horizontal compensation while negating the vertical parallax offset. Advanced the feature stylesheet cache identity to `20261028-08`.
- This change is limited to `css/features/lightbox.css`, its public stylesheet cache reference in `index.html`, and this roadmap entry. It does not change the face flip interaction or the legacy production site.
- **Next step:** rerun the full validation/browser-smoke workflow and check the Pages deployment result. If the centering test passes, perform the targeted desktop/tablet/mobile hover-or-tap and front/back flip visual checks.


### October 28, 2026 — Equal-width responsive holographic artwork sections

- The grouped Lightbox renderer can choose horizontal or overlapping layered presentation for all-holographic `cards` groups. Those modes give outer items natural widths or negative inline margins, so the section boundaries are not evenly distributed and the artwork slot can appear off-center.
- Added a feature-owned responsive CSS Grid override for groups containing holographic artwork. Each item receives an equal-width section; the outer fan/overlap transform is removed for these group slots, while the artwork's established sizing constraints and the inner front/back, parallax, and foil layers remain unchanged.
- The artwork stage is centered horizontally and vertically inside its assigned cell. The grid auto-fits equal-width columns with a 320px minimum track to preserve the existing artwork footprint where space allows, and collapses to a single column on mobile.
- Extended the browser smoke layout measurement to verify equal item widths, evenly spaced column starts, artwork-stage centering, and responsive column counts at 1280px, 820px, and 390px viewports. The Lightbox feature stylesheet cache key advances to `20261028-10`.
- **Next step:** confirm the updated validation/browser-smoke workflow and Pages deployment pass, then visually verify the grouped holographic artwork at desktop, tablet, and mobile sizes.


### October 28, 2026 — CMS-driven responsive artwork group layouts

- Reviewed the legacy `main` branch as a read-only visual/interaction reference. Its older monolithic Lightbox predates the current CMS artwork-group runtime, so active `mediaGroups.layout` remains the configuration source for the four grouped presentation modes.
- Replaced the holographic recommendation with “Switch to desktop for the full effect.”
- Added explicit CMS modes: Grid / Tiling (`grid`), Horizontal Stack (`stack`), Horizontal Card Stack (`cards`), and Sticker Card Layout (`sticker`). Existing stored values `grid`, `stack`, and `cards` remain valid.
- All modes use equal layout tracks and consistent CSS Grid auto-layout. Horizontal Stack wraps equal-width tiles at row boundaries. Horizontal Card Stack uses controlled overlap on desktop/tablet and falls back to a clean grid on narrow viewports. Sticker Card Layout uses stable per-artwork seeded offsets and rotations; rotations are bounded to ±45 degrees and reduced on mobile.
- The artwork stage is centered within its tile. The existing front/back holographic face transforms, parallax compensation, foil layers, reveal lifecycle, keyboard activation, and Inspector handoff remain separate from outer layout styling.
- Updated the CMS selectors, project normalizer, runtime cache keys, smoke assertions, and CMS presentation contract to cover all four layouts and mobile fallbacks.
- **Next step:** pass the validation and Pages gates, then inspect all four modes at desktop, tablet, and mobile sizes. The production repository and legacy `main` remain untouched.


### October 28, 2026 — Responsive grouped artwork sizing audit

- Found a small-screen sizing conflict in the grouped holographic artwork slot: a narrow `44vw` width cap was paired with a fixed height. That could violate the media ratio and produce unnecessarily tall or narrow empty space.
- Changed grouped holographic stage sizing to derive width from its preserved `--lightbox-artwork-ratio` and a responsive height budget. Mobile uses a tighter height budget but allows the artwork to use up to 75vw / 280px where the grid cell permits.
- Extended the browser smoke metrics to assert ratio preservation within a 6% tolerance alongside equal cell widths, consistent row spacing, and centered artwork at desktop, tablet, 390px, and 320px widths.
- **Next step:** rerun full site validation and Pages deployment; then visually inspect the grouped portrait, square, and landscape artwork sizes on real phone/tablet screens.


### October 28, 2026 — Compact card-stack and sticker layouts

- Tightened the Horizontal Card Stack's outer padding and row spacing, reduced card rotation/scale offsets, and added a restrained backing edge so the stack reads as a denser set of connected cards rather than oversized, loosely spaced tiles.
- Tightened Sticker Card Layout's minimum grid track, row/column gaps, and container padding. A narrow light sticker rim, soft edge shadow, and smaller artwork stage make each piece feel more like a physical sticker while preserving its seeded playful rotation.
- Gave both layouts dedicated aspect-ratio-aware artwork size budgets at desktop/tablet and mobile breakpoints. The mobile rules preserve the single-column fallback for stacked cards and a two-column sticker grid where space allows.
- Extended the CMS presentation validator and browser smoke test to enforce compact stage dimensions in addition to the existing equal-track, centering, responsive fallback, and artwork-ratio checks. Advanced the Lightbox feature stylesheet cache key to `20261028-13`.
- **Next step:** complete the active-branch validation/browser smoke and Pages workflows, then visually inspect the two compositions against the incident clip at desktop, tablet, and small-phone widths. No change is needed to unrelated gallery, navigation, or Inspector behavior.


### October 28, 2026 — Match sticker framing to the cut-out artwork

- Frame review of the attached Works incident video confirmed that these sticker assets already have a white die-cut outline. A pale rectangular surface border behind each transparent cut-out made the compact layout read too much like a sheet of mini cards.
- Removed the rectangular background, border, radius, and box shadow from the sticker artwork stage while retaining its aspect-aware compact dimensions. Added a restrained alpha-shaped drop shadow to the holographic surface so the asset's own silhouette supplies the physical-sticker edge.
- Added CMS validator and browser smoke assertions to protect the transparent stage, zero padding/border, and silhouette shadow without changing the horizontal card stack backing edge or unrelated lightbox behavior.
- Advanced the feature CSS cache key to `20261028-14`.
- **Next step:** run validation and Pages again; then visually confirm the cut-out shadow reads well against the dark Lightbox background at desktop and on a small phone.


### October 28, 2026 — Figma-aligned card stack and sticker collage

- Compared the current Lightbox layouts with the supplied current-state screenshots and Figma reference. The previous horizontal card stack behaved like a three-column grid of translucent panels; the reference instead uses a close horizontal fan with five pieces across and a centered continuation row. The existing sticker layout also left excessive gaps and did not overlap on phones.
- Horizontal Card Stack now uses five columns on desktop, four on tablet, and three on mobile. Items remain in source order and wrap naturally to later rows; the renderer centers the final incomplete row without hardcoded per-artwork positions.
- Sticker Card Layout now uses three columns on desktop/tablet and two columns on mobile, with gentle seeded rotation and staggered offsets. The visible cut-out art overlaps while its grid hit areas remain separate; mouse hover, keyboard focus, and tapped/activated pieces move to the front.
- Added a selected-entry class before the Inspector handoff, dynamic grid-row centering, responsive track-count checks, final-row centering assertions, and a tighter -6° to +6° sticker rotation guard. The feature CSS cache identity advances to `20261028-15`.
- **Next step:** confirm the new browser smoke and Pages workflows, then perform the final visual/touch check on the active test preview. Production and `main` remain untouched.
