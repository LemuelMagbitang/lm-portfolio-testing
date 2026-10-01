# Security

## CMS credentials

The CMS is intentionally client-side: it talks directly to the GitHub REST API from the browser.

Use a **fine-grained GitHub personal access token** scoped to this repository only.

For normal CMS editing, grant:

- Repository access: only `LemuelMagbitang/lm-portfolio-testing`
- Repository permissions: **Contents: Read and write**
- Metadata is required by GitHub for repository access.
- **Checks: Read** is optional and only enables the CMS deployment-status polling.

Do not grant Administration, Actions, Secrets, Workflows, or other write permissions unless a future feature explicitly requires them.

The CMS keeps the credential in memory and session storage by default. The **Remember on this device** option explicitly opts into persistent browser storage. Do not enable it on shared or untrusted computers.

Never commit a GitHub token, SSH private key, or other credential into this repository.

## Current security boundary

The browser must hold a credential with permission to write this repository because the CMS currently uses the GitHub API directly. This is a deliberate architecture constraint of the static-site CMS.

For a higher-security production CMS in the future, replace browser-held write credentials with a server-side authentication boundary, such as a small authenticated backend using a GitHub App installation token.

## Release safety

All repository changes should pass `node tools/validate-site.mjs` before reaching the production branch.

Do not treat the validation workflow as sufficient by itself: the repository's `main` branch should be configured in GitHub to require the validation check before merge.

## Reporting

For suspected credential exposure, revoke the affected token immediately in GitHub and rotate it before investigating further.
