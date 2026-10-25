# Mux video integration

This repository remains a static site with its existing GitHub-backed JSON CMS. GitHub Pages cannot safely hold Mux API credentials or receive webhooks, so this integration uses Supabase Postgres and Edge Functions. Work is isolated to projects-runtime-cutover. Do not edit lm-portfolio-testing main or the deployed legacy website until promotion is explicitly authorized.

## Current behavior
- data/hero-loop.json remains the hero fallback until Supabase is configured and a ready Mux asset is published.
- admin/videos.html is a Video Library page linked from the current CMS; it does not replace the GitHub JSON editor.
- New uploads create a video row and asset-version row before requesting a Mux Direct Upload.
- The internal asset-version UUID is sent to Mux as external_id for new CMS uploads.
- Existing Mux Dashboard uploads can be browsed by title and imported without manually copying Asset IDs or Playback IDs. Import normalizes Mux's Unix-second `created_at` value to an ISO timestamp before storing `uploaded_at` in Postgres.
- The Video Library is a Mux-powered media workspace for browsing, previewing, renaming, publishing/unpublishing, and managing video versions. Website placement is configured in the relevant CMS content/settings workflow, not on a library asset card.
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
7. Deploy functions (if local npm registry DNS/bundling fails, try Supabase's API bundler):
   npx supabase functions deploy mux-admin --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy mux-webhook --project-ref YOUR_PROJECT_REF --use-api
   npx supabase functions deploy mux-public --project-ref YOUR_PROJECT_REF --use-api

Use exact origins: scheme and hostname only. Never commit Mux tokens, webhook secret, or Supabase service-role key into public files, this document, GitHub issues, screenshots or chat.

## Public website config
After the Supabase project exists, set data/video-platform.json on the active branch with:
- supabaseUrl: the project URL
- supabaseAnonKey: the public anon/publishable key
- creatorId: lemuel-magbitang

The active testing branch may contain the configured project URL and publishable key. These are browser-visible values. Public browser access to database tables is revoked; the public Edge Function returns only published metadata. Never put Mux token secrets, webhook signing secrets, or the Supabase service-role key in this file.

The deployed website at https://lemuelmagbitang.github.io and the legacy main branch remain reference-only. Once the active branch is intentionally promoted, configure the approved production origin and public config on the deployment source.


## CORS and administrator authorization for the current GitHub Pages test

The current Video Library test page is served from:
https://lemuelmagbitang.github.io/lm-portfolio-testing/admin/videos.html

Its browser **origin** is only **https://lemuelmagbitang.github.io**. The repository path /lm-portfolio-testing is not part of the origin. Set these Supabase secrets for the current test origin:
- CMS_ALLOWED_ORIGINS=https://lemuelmagbitang.github.io
- MUX_UPLOAD_CORS_ORIGIN=https://lemuelmagbitang.github.io
- CMS_ADMIN_USER_IDS=YOUR_SUPABASE_AUTH_USER_UUID

Use the actual Auth user UID from Supabase Authentication -> Users, not the email. For multiple approved browser origins, CMS_ALLOWED_ORIGINS accepts comma-separated origins. Avoid a trailing slash; the function normalizes it, but the canonical format is scheme + hostname + optional port only. MUX_UPLOAD_CORS_ORIGIN is a single origin and must match the page from which Mux Direct Upload is initiated.

The current GitHub Pages test and the intended root portfolio will both use the https://lemuelmagbitang.github.io origin; only the page path changes. Do not add the Codespaces host unless you will actually open the CMS there. When testing from a forwarded Codespaces port, copy the exact forwarded origin from the browser address bar and use it in CMS_ALLOWED_ORIGINS; set MUX_UPLOAD_CORS_ORIGIN to that origin only while uploading from that page.

Admin authorization is separate from CORS:
- HTTP 401 means no valid CMS bearer session (or the function gateway is still verifying JWTs).
- HTTP 403 means the signed-in Supabase Auth UID is not in CMS_ADMIN_USER_IDS.
- HTTP 404 usually means the function or route is not deployed to the configured project.
- HTTP 500 means inspect Edge Function logs and verify server secrets/database access.
- HTTP 502 with code mux_auth_failed means Mux rejected the server-side MUX_TOKEN_ID/MUX_TOKEN_SECRET pair. Set both from the same Mux Access Token in the same environment, ensure it has Mux Video Read permission, and replace both Supabase secrets if either value may be wrong or lost. Never share the secret in chat.
- HTTP 502 with code mux_asset_not_found means the asset ID may be mistyped or belongs to a different Mux environment than the server token.

## Mux webhook
In Mux Dashboard create a webhook at:
https://YOUR_PROJECT_REF.supabase.co/functions/v1/mux-webhook
Store its signing secret as MUX_WEBHOOK_SECRET. Subscribe to video.upload.asset_created, video.upload.errored, video.upload.timed_out, video.upload.cancelled, video.asset.ready, video.asset.errored, and video.asset.deleted. Handler checks mux-signature against the raw body with HMAC-SHA256 and five-minute timestamp tolerance, then deduplicates using the event ID. Lifecycle updates also store the Mux event creation timestamp per asset and ignore older state events, preventing delayed delivery from regressing ready, errored, or deleted state.

## Use the Video Library
1. Open admin/videos.html from a local HTTP server or active branch preview.
2. Enter Supabase URL/public key and sign in with the allowlisted Auth account.
3. Upload a video to Mux or choose an existing, unlinked Mux upload by title in the **Import from Mux** tab. Do not copy Asset IDs or Playback IDs manually.
4. For an already-hosted MP4, register its stable site-relative path or HTTPS URL.
5. Wait for processing webhook to mark ready, then publish the version.

## IDs
- video_assets.id: internal UUID for one uploaded version.
- Mux external_id: internal version UUID for new CMS uploads; existing external metadata is preserved on import.
- Mux asset ID: asset management/import.
- Mux playback ID: playback and thumbnails.
Changing the title or slug does not require a new Mux asset. Replacing media creates a new asset version; publish it only after ready. Never use a filename as a permanent identifier.

## Use Mux media from the CMS

The Mux library uses the same browsing pattern as the CMS media picker. Published, ready videos can be selected by title; IDs remain behind the scenes.

1. Open **Mux Media Library** from the CMS navigation. Use **Upload video** to send a file directly to Mux, or **Import from Mux** to register an existing Mux upload. The library provides search, status/source filters, grid/list views, poster previews, playback inspection, metadata editing, publish/unpublish, and version history.
2. Wait until a new asset is **Ready**, then select **Publish ready version** in its details panel. You can change its title/slug/description and publish state without copying any Mux identifiers. Unpublishing removes it from public feeds but retains stored asset versions.
3. In **Projects → Media (lightbox gallery)**, add or edit a media item, choose **Mux video (streamed)**, then click **Browse Mux library**. Search by title, preview the video, and choose **Use selected video**. The CMS stores the playback reference and poster; the actual player is created only when the project lightbox opens.
4. For the project **Thumbnail type**, choose **Mux video (streamed)** and click **Browse Mux library**. Project cards use the poster only—never a full Mux stream—so the gallery does not mount video players for every card.
5. In **Hero Loop Animation**, set a slide's type to **Mux video (streamed)**, then choose **Browse Mux library**. Save to GitHub as usual. Explicitly selected slides take priority; the older placement-based public feed is retained only as a backward-compatible fallback for existing content.
6. In **Footer Animation**, switch the source to **Manual**, select **Mux video (streamed)**, and browse the shared library. The renderer plays only the active Mux slide; if the Mux Player script is unavailable, it falls back to the selected poster.
7. When a video is published while the CMS is already open, refresh the picker to reload the published catalog. Only ready assets with public playback are shown.

The CMS media library continues to handle files stored in the repository. Use Mux when the source should remain hosted and streamed remotely; this does not upload a second copy of the video into GitHub.

Mux is a hosted service, not a lifetime archive. Availability depends on account standing, billing/plan limits, the asset not being deleted, and the applicable service terms. Mux's current Free plan lists up to 10 stored videos and 100,000 monthly delivery minutes; its Pay-as-you-go plan lists no storage limit, but storage is billed per video minute per month and delivery beyond included allowances is usage-based. See [current Mux pricing](https://www.mux.com/pricing). Mux also states that it does not keep the original upload in its exact form, so keep an independent backup of original master video files: [Mux streaming guide](https://www.mux.com/docs/core/stream-video-files).

## Public hero integration
The hero loads the public Mux feed only when configured. An explicitly selected Mux hero slide uses the lazily loaded Mux Player and plays muted without exposing player controls. If the player module or stream errors, the hero falls back to the checked-in `assets/projects/site/banner/hero-reel.mp4` file (unless a slide provides its own `fallbackSrc`); the Mux thumbnail remains available as a poster during startup. The public placement feed remains a compatibility fallback for older content. Reduced-motion handling and lifecycle cleanup remain in force.

## Validation checklist
- Non-allowlisted users receive 401/403 from admin API.
- Record exists before upload; CORS origin matches the browser uploader origin.
- asset_created saves asset ID; ready saves playback ID, duration and aspect ratio.
- Duplicate events are safe; invalid signatures are rejected.
- Errored/timed-out/deleted assets cannot be published.
- Public feed returns only published, ready public-playback assets.
- Blank config and API/player failures preserve legacy MP4 hero.
- Test mobile autoplay, reduced motion, media errors, captions/lightbox cleanup and offline behavior.

The code/schema has been deployed to the configured Supabase project, but live upload/import success still depends on correct server secrets, the exact CMS origin, the administrator UID allowlist, and the registered Mux webhook.
