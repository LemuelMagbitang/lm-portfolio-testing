# Portfolio Design References

This document records external portfolio and studio sites to consult during design critique and UX review. They are reference points for evaluating hierarchy, storytelling, project discovery, and content structure—not templates to reproduce.

Last reviewed: October 28, 2026 (PHT).

## HuskyFox

- **Site:** https://huskyfox.com/
- **Projects index:** https://huskyfox.com/projects
- **Why it is useful:** HuskyFox presents work through a project-led index, with clear project titles, service/category labels, and short descriptions that explain the context of each brand project. The site's About and Contact sections also keep the studio's identity and next steps easy to find.
- **Patterns to evaluate:** Scannable project metadata; consistent titles and category labels; a strong image-to-description balance; navigation that makes work, studio background, and contact distinct.
- **Apply to this portfolio:** Check whether project cards communicate each project's discipline at a glance and whether the project grid remains easy to scan across desktop, tablet, and mobile. Preserve the existing filter model and visual identity.

## Deji Ajetomobi

- **Site:** https://dejiajetomobi.com/
- **Why it is useful:** The site gives a concise introduction to the designer, presents selected case studies, and makes professional experience and additional writing/engineering work discoverable. It connects a personal point of view with evidence of delivered work.
- **Patterns to evaluate:** Clear professional positioning; prioritization of selected case studies; a readable relationship between work, experience, and complementary interests; concise contextual writing around projects.
- **Apply to this portfolio:** Review how the About page and project descriptions communicate the combination of multimedia art, 3D, motion, graphic design, and interface work. Look for opportunities to clarify the intent and contribution behind selected projects without adding unnecessary complexity to the runtime or navigation.

## Evaluation guardrails

1. Keep this portfolio's existing visual language and current navigation/interaction model. Do not copy either reference's branding, layouts, assets, or wording.
2. Prefer specific improvements to readability, project comprehension, keyboard/touch usability, accessibility, responsive behavior, loading performance, and lifecycle safety over a broad redesign.
3. Preserve the existing filter contract, Curated Views behavior, Lightbox media support, holographic/foil interactions, and the intentional Test Project QA fixture.
4. Treat screenshots, manual device checks, and real-media checks as separate evidence from automated CI. A green mocked media test verifies integration contracts; it does not prove that a live third-party stream is healthy.

## Technical checkpoint at time of review

The active source of truth remains `LemuelMagbitang/lm-portfolio-testing` on `projects-runtime-cutover`. Code/test checkpoint reviewed: [`265a2a84`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/265a2a84f56be91d48505a954b1b1fd15cccfa56), which adds browser-smoke coverage for the Test Project's Mux Lightbox player contract. The validation workflow [#40558078937](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40558078937) and Pages build/deployment [#40558078224](https://github.com/LemuelMagbitang/lm-portfolio-testing/actions/runs/40558078224) both passed on that code/test checkpoint. The new reference documentation commit will trigger its own workflows; do not treat the older runs as validation for that later documentation SHA.
