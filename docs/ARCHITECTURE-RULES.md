# Portfolio Architecture Rules

## Purpose

This repository is a static portfolio application with a browser CMS. The architecture is intentionally modular so visual redesigns can be introduced without rewriting content, media handling, or unrelated features.

## Core rule

**A feature owns its behavior. A layer owns its responsibility. No module reaches sideways into another feature's internals.**

The desired dependency direction is:

```text
pages / bootstrap
        |
        v
feature composition
        |
        +----> feature modules
        |          |
        |          v
        |      shared contracts
        |          |
        v          v
      adapters / infrastructure
```

Shared modules must remain small and stable. A feature must not import another feature's private helpers.

## Module boundaries

### Core

`js/core/` contains browser-agnostic or low-level site primitives:

- URL/path resolution
- DOM helpers
- event utilities
- error handling
- feature flags/configuration
- lifecycle primitives

Core must not know about gallery, lightbox, hero, CMS screens, or portfolio content.

### Data

`js/data/` contains content-loading and data normalization concerns.

It may know how to retrieve and validate portfolio JSON, but it must not render UI.

### Features

`js/features/` contains independently replaceable product features:

- gallery
- lightbox
- hero
- model viewer
- media background
- contact/reviews
- navigation

A feature may depend on Core and Data contracts, but not on another feature's implementation details.

### Infrastructure

`js/infrastructure/` contains external/vendor integrations:

- GitHub API client
- Web3Forms
- YouTube handling
- Lottie/Three.js loaders
- browser storage

Vendor-specific code belongs here so it can be replaced without changing feature logic.

### CMS

`admin/` is a separate application surface. CMS code must not be imported by the public site.

CMS code should communicate with repository infrastructure through explicit API/storage functions and should not contain public-site rendering logic.

## Plug-and-play contract

A feature is considered replaceable when all of the following are true:

1. It has one clear public entry point.
2. Its public entry point accepts a small options object.
3. It owns its DOM/event lifecycle.
4. It cleans up listeners, observers, timers, animation frames, and external resources it creates.
5. It does not mutate unrelated feature DOM.
6. It does not read another feature's private variables.
7. It does not depend on page-specific global variables when an explicit option can be passed.
8. It can be disabled without causing the rest of the page to fail.
9. Its external/vendor dependencies are isolated behind adapters.
10. Its data shape is defined separately from its presentation.

## Bootstrap rule

`js/script.js` is the composition root only.

It may:

- discover the current page
- load configuration
- load feature modules
- wire feature dependencies
- handle top-level failure containment

It must not become a home for gallery algorithms, lightbox rendering, CMS data transformation, vendor API calls, or large collections of UI helpers.

## State ownership

Every mutable state value has one owner.

Examples:

- gallery filtering state belongs to Gallery
- lightbox index/media state belongs to Lightbox
- hero timing state belongs to Hero
- CMS connection state belongs to CMS
- reduced-motion preference belongs to Core

Other modules communicate through function arguments, return values, or explicit events—not by reaching into another module's state.

## DOM ownership

A module may own a DOM subtree or clearly named elements passed to it. It must not perform broad document-wide mutation unless that behavior is explicitly part of its contract.

Prefer:

```js
createGallery({ root, data, onOpen })
```

over:

```js
// hidden dependency on arbitrary page globals
initGallery();
```

## Data ownership

CMS JSON is content, not application state.

The data layer normalizes CMS content into stable runtime models. UI features consume those models and must not depend on incidental CMS field names when a normalized model can be provided.

## Dependency inversion

External systems are volatile dependencies. Keep them at the edge.

```text
Feature -> contract -> adapter -> vendor
```

Never:

```text
Feature -> GitHub REST API
Feature -> Three.js internals
Feature -> Web3Forms
```

## CSS architecture

CSS follows the same ownership rule as JavaScript.

- Base tokens and global primitives belong in `css/style.css`.
- A component owns its component styles.
- Do not create redesign-specific override layers to fight existing selectors.
- Avoid `!important` as a layout strategy.
- Responsive rules belong with the component they modify.
- State classes should represent semantic state (`is-open`, `is-active`, `is-loading`), not implementation history (`phase-2`, `new-fix`, `mobile-v2`).

## Safe redesign protocol

A UI redesign should change presentation and feature contracts, not data contracts, unless a data change is explicitly required.

Before modifying a feature:

1. identify its public entry point;
2. identify its owned DOM;
3. identify its state;
4. identify its external dependencies;
5. identify its cleanup path;
6. modify the feature in isolation;
7. run validation;
8. test desktop, mobile, reduced motion, keyboard, and failure states.

## Security boundaries

The browser CMS necessarily has repository-write capability because this is a static GitHub Pages architecture. Keep that credential narrowly scoped.

The public application must never receive CMS credentials.

Do not move secrets into public JavaScript, HTML, JSON, or CSS.

## Architecture quality gate

A change should be rejected when it introduces:

- a new global mutable variable used across features;
- a feature importing another feature's private implementation;
- a second implementation of an existing shared primitive;
- page-specific path hacks;
- CSS override stacks created to compensate for previous CSS;
- direct vendor calls from unrelated feature modules;
- cleanup omissions for listeners, observers, timers, animation frames, or WebGL resources;
- CMS credential handling outside the CMS/infrastructure boundary.
