# Portfolio design system

## Source of truth
The shared token layer is **css/tokens.css**, imported first by **css/style.css**. The CMS exposes it through **Site → Design System** without creating a duplicate configuration.

## Token roles
- Color: background, surface, primary/secondary/muted text, accent, focus, danger, success, warning, and borders.
- Typography: Inter, Satoshi, DM Sans, Outfit, a base type size, reusable type scale, and line-height tokens.
- Layout: page gutter, four-pixel spacing rhythm, shared card radius, and fixed/concentric geometry.
- Effects: glass tokens, standard motion durations, and shared elevation recipes.

## Safe editing
Use the Design System tab on the projects-runtime-cutover testing branch. Adjustments update a local component preview first. Save commits css/tokens.css through the existing atomic Git commit path with a stale-file check; arbitrary CSS and selectors are not accepted. Confirm the CMS save status and Pages deployment before reviewing the site.

## Accessibility and responsive behavior
Controls have native labels; navigation supports keyboard use and visible focus; the layout collapses to one column on narrow screens; reduced-motion preferences are respected. Preview swatches retain text labels rather than relying on color alone.
