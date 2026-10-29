# Portfolio incident reports

This is the shared evidence folder for QA and interaction incidents across the portfolio. Keep reports for different features in this folder rather than creating feature-specific reporting folders.

## File naming

Use the incident date, a short stable incident slug, and an explicit evidence type:

- `YYYY-MM-DD_<incident-slug>_screenshot.png`
- `YYYY-MM-DD_<incident-slug>_screen-recording.mp4`

Use the same incident slug for a screenshot and recording that describe the same behavior. Keep concise reproduction steps and expected-versus-actual behavior in the related issue or commit message. Remove large recordings when they are no longer needed.

## Curated View incident evidence

- `Screenshot 2026-10-11 231918.png` — the public URL `https://lemuelmagbitang.github.io/lm-portfolio-testing/#test-portfolio` showed the Main Portfolio instead of the saved Curated View.
- `Screenshot 2026-10-11 231937.png` — the CMS editor showing `test portfolio`, the `#test-portfolio` slug, and three saved project entries.

## Status and verification

The public-page screenshot was captured at approximately 23:19 PHT on October 11. The public hash-route implementation was committed later, at 23:43 PHT, in [`5f9f480`](https://github.com/LemuelMagbitang/lm-portfolio-testing/commit/5f9f48074a34b7fef7ea03b89011b6a52d715c74). On commit `775674d`, browser smoke scenario #22 passed for `/#test-portfolio`, the site-validation workflow succeeded, and the GitHub Pages build/deployment succeeded.

The screenshots are retained as historical regression evidence. The remaining user-facing check is to open the deployed Curated View after a fresh reload and confirm the expected heading and three projects appear. The older Inspector screenshot was removed from this branch in commit `5f9f480`; the `incident-reports` directory now retains only these two Curated View screenshots and this index.
