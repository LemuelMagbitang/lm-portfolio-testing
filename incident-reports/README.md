# Portfolio incident reports

This is the shared evidence folder for QA and interaction incidents across the portfolio. Keep reports for different features in this folder rather than creating feature-specific reporting folders.

## File naming

Use the incident date, a short stable incident slug, and an explicit evidence type:

- `YYYY-MM-DD_<incident-slug>_screenshot.png`
- `YYYY-MM-DD_<incident-slug>_screen-recording.mp4`

Use the same incident slug for a screenshot and recording that describe the same behavior. Keep concise reproduction steps and expected-versus-actual behavior in the related issue or commit message. Remove large recordings when they are no longer needed.

## Current report

- `Screenshot 2026-10-11 231918.png` — the public URL `https://lemuelmagbitang.github.io/lm-portfolio-testing/#test-portfolio` displayed the Main Portfolio instead of the saved Curated View.
- `Screenshot 2026-10-11 231937.png` — the CMS Curated Views editor showing `test portfolio`, the `#test-portfolio` slug, and three saved project entries.

These two screenshots are the current evidence for the Curated View route incident. The older Inspector screenshot referenced in the previous README text (`2026-10-11_foil-inspect-keyboard-exit_screenshot.png`) is not present at that path in the active branch, so no current evidence image was deleted.