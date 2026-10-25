# Mux video integration

This repository remains a static site with its existing GitHub-backed JSON CMS. GitHub Pages cannot safely hold Mux API credentials or receive webhooks, so this integration uses Supabase Postgres and Edge Functions. Work is isolated to projects-runtime-cutover. Do not edit lm-portfolio-testing main or the deployed legacy website until promotion is explicitly authorized.

## Current behavior
- data/hero-loop.json remains the hero fallback until Supabase is configured and a ready Mux asset is published.
- admin/videos.html is a Video Library page linked from the current CMS; it does not replace the GitHub JSON editor.
- New uploads create a video row and asset-version row before requesting a Mux Direct Upload.
- The internal asset-version UUID is sent to Mux as external_id for new CMS uploads.
- Existing Mux Dashboard uploads can be imported by Mux asset ID without uploading the file twice.
- Existing hosted static MP4 paths can be registered; old project media is not migrated automatically.

## Provision Supabase
1. Create a Supabase project and an administrator user in Supabase Auth.
2. Get the project URL and public anon/publishable key. These are browser-safe, unlike service-role keys.
3. Install Supabase CLI, then run: npx supabase login
4. Link project: npx supabase link --project-ref YOUR_PROJECT_REF
5. Apply schema: npx supabase db push
6. Set the administrator's Auth user UUID and server secrets:
   - npx supabase secrets set MUX_TOKEN_ID=YOUR_MUX_TOKEN_ID
   - npx supabase secrets set MUX_TOKEN_SECRET=YOUR_MUX_TOKEN_SECRET
   - npx supabase secrets set MUX_WEBHOOK_SECRET=YOUR_MUX_WEBHOOK_SIGNING_SECRET
   - npx supabase secrets set CMS_ADMIN_USER_IDS=YOUR_SUPABASE_AUTH_USER_UUID
   - npx supabase secrets set CMS_ALLOWED_ORIGINS=https://YOUR_APPROVED_SITE_ORIGIN
   - npx supabase secrets set MUX_UPLOAD_CORS_ORIGIN=https://YOUR_APPROVED_CMS_ORIGIN
   - npx supabase secrets set MUX_CREATOR_ID=lemuel-magbitang
7. Deploy functions with:
   npx supabase functions deploy mux-admin
   npx supabase functions deploy mux-webhook
   npx supabase functions deploy mux-public

Use exact origins: scheme and hostname only. Never commit Mux tokens, webhook secret, or Supabase service-role key into public files, this document, GitHub issues, screenshots or chat.

## Public website config
After the Supabase project exists, set data/video-platform.json on the active branch with:
- supabaseUrl: the project URL
- supabaseAnonKey: the public anon/publishable key
- creatorId: lemuel-magbitang

These values are blank intentionally until the project is provisioned. Public browser access to database tables is revoked; the public Edge Function returns only published metadata. The public key can be visible, but server secrets cannot.

The deployed website at https://lemuelmagbitang.github.io and the legacy main branch remain reference-only. Once the active branch is intentionally promoted, configure the approved production origin and public config on the deployment source.

## Mux webhook
In Mux Dashboard create a webhook at:
https://YOUR_PROJECT_REF.supabase.co/functions/v1/mux-webhook
Store its signing secret as MUX_WEBHOOK_SECRET. Subscribe to video.upload.asset_created, video.upload.errored, video.upload.timed_out, video.upload.cancelled, video.asset.ready, video.asset.errored, and video.asset.deleted. Handler checks mux-signature against the raw body with HMAC-SHA256 and five-minute timestamp tolerance, then deduplicates using the event ID. Lifecycle updates also store the Mux event creation timestamp per asset and ignore older state events, preventing delayed delivery from regressing ready, errored, or deleted state.

## Use the Video Library
1. Open admin/videos.html from a local HTTP server or active branch preview.
2. Enter Supabase URL/public key and sign in with the allowlisted Auth account.
3. Create a record and upload an MP4, or import an existing Mux asset by asset ID.
4. For an already-hosted MP4, register its stable site-relative path or HTTPS URL.
5. Wait for processing webhook to mark ready, then publish the version.

## IDs
- video_assets.id: internal UUID for one uploaded version.
- Mux external_id: internal version UUID for new CMS uploads; existing external metadata is preserved on import.
- Mux asset ID: asset management/import.
- Mux playback ID: playback and thumbnails.
Changing the title or slug does not require a new Mux asset. Replacing media creates a new asset version; publish it only after ready. Never use a filename as a permanent identifier.

## Public hero integration
The hero calls the public Mux feed only if configured. A ready published Mux video uses the lazily loaded Mux Player; if config/feed/player fails, data/hero-loop.json remains the fallback. The hero stays muted/inline and preserves existing reduced-motion and lifecycle behavior.

## Validation checklist
- Non-allowlisted users receive 401/403 from admin API.
- Record exists before upload; CORS origin matches the browser uploader origin.
- asset_created saves asset ID; ready saves playback ID, duration and aspect ratio.
- Duplicate events are safe; invalid signatures are rejected.
- Errored/timed-out/deleted assets cannot be published.
- Public feed returns only published, ready public-playback assets.
- Blank config and API/player failures preserve legacy MP4 hero.
- Test mobile autoplay, reduced motion, media errors, captions/lightbox cleanup and offline behavior.

This is a code/schema scaffold. Supabase project creation, secrets, and webhook registration remain account-level setup steps.
