# Portfolio incident reports

This is the shared evidence folder for QA and interaction incidents across the portfolio. Keep reports for different features in this folder rather than creating feature-specific reporting folders.

## File naming

Use the incident date, a short stable incident slug, and an explicit evidence type:

- `YYYY-MM-DD_<incident-slug>_screenshot.png`
- `YYYY-MM-DD_<incident-slug>_screen-recording.mp4`

Use the same incident slug for a screenshot and recording that describe the same behavior. Keep concise reproduction steps and expected-versus-actual behavior in the related issue or commit message. Remove large recordings when they are no longer needed.

## Current report

- `2026-10-11_foil-inspect-keyboard-exit_screenshot.png` — holographic foil Inspect Mode keyboard exit and focus-outline regression.
