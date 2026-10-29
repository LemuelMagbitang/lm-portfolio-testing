import { serviceDb } from "../_shared/http.ts";
import { readRequestBodyLimited } from "../_shared/request-body.ts";

function hex(bytes: Uint8Array): string { return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const values = new Map<string, string>();
  for (const piece of header.split(",")) { const at = piece.indexOf("="); if (at >= 0) values.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim()); }
  const timestamp = values.get("t") || "";
  const signature = values.get("v1") || "";
  const numeric = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(numeric) || Math.abs(Date.now()/1000 - numeric) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + rawBody))));
  if (expected.length !== signature.length) return false;
  let mismatch = 0; for (let i=0;i<expected.length;i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return mismatch === 0;
}
function details(data: any): string {
  if (data?.errors) return JSON.stringify(data.errors).slice(0, 4000);
  if (data?.error) return String(data.error.message || data.error).slice(0, 4000);
  return "Mux reported an asset lifecycle error.";
}

async function unpublishActiveAssets(db: any, assetIds: string[]) {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return;
  const { error } = await db.from("videos")
    .update({ published: false, active_asset_id: null })
    .in("active_asset_id", ids);
  if (error) throw error;
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("MUX_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook is not configured", { status: 500 });
  const bodyResult = await readRequestBodyLimited(request, 1_048_576);
  if (!bodyResult.ok) return new Response("Webhook payload too large", { status: 413 });
  const raw = bodyResult.body;
  if (!await verifySignature(raw, request.headers.get("mux-signature"), secret)) return new Response("Invalid Mux signature", { status: 401 });
  let event: any;
  try { event = JSON.parse(raw); } catch (_) { return new Response("Invalid JSON", { status: 400 }); }
  if (!event?.id || !event?.type) return new Response("Invalid event", { status: 400 });
  const eventTimeMs = Date.parse(String(event.created_at || ""));
  if (!Number.isFinite(eventTimeMs)) return new Response("Invalid event timestamp", { status: 400 });
  const eventCreatedAt = new Date(eventTimeMs).toISOString();
  try {
    const db = serviceDb();
    const newerEventFilter = "last_mux_event_created_at.is.null,last_mux_event_created_at.lt." + eventCreatedAt;
    // Imported assets may not have seen a webhook yet. Never let an old
    // upload-created event replace a known ready, errored, or deleted state.
    const assetCreatedFilter = [
      "and(asset_status.is.null,last_mux_event_created_at.is.null)",
      "and(asset_status.is.null,last_mux_event_created_at.lt." + eventCreatedAt + ")",
      "and(asset_status.eq.preparing,last_mux_event_created_at.is.null)",
      "and(asset_status.eq.preparing,last_mux_event_created_at.lt." + eventCreatedAt + ")"
    ].join(",");
    const { data: old, error: oldError } = await db.from("mux_webhook_events").select("processed_at").eq("event_id", event.id).maybeSingle();
    if (oldError) throw oldError;
    if (old?.processed_at) return new Response("ok", { status: 200 });
    const { error: logError } = await db.from("mux_webhook_events").upsert({ event_id: event.id, event_type: event.type, payload: event, processing_error: null }, { onConflict: "event_id", ignoreDuplicates: true });
    if (logError) throw logError;
    const d = event.data || {};
    let updateError: any = null;
    if (event.type === "video.upload.asset_created") {
      // The upload-created webhook can beat the admin route's final database
      // write. Match by upload ID first, then by our stable external ID from
      // new_asset_settings so the event still lands on the correct asset row.
      const changes = {
        mux_upload_id: d.id, mux_asset_id: d.asset_id, uploaded_at: new Date().toISOString(),
        upload_state: "uploaded", asset_status: "preparing", processing_state: "ingesting",
        last_error: null, last_mux_event_created_at: eventCreatedAt
      };
      let result = await db.from("video_assets").update(changes)
        .eq("mux_upload_id", d.id).or(assetCreatedFilter).select("id");
      if (result.error) throw result.error;
      let affectedAssets = result.data || [];
      const externalId = String(d.new_asset_settings?.meta?.external_id || "").trim();
      if (!affectedAssets.length && externalId) {
        result = await db.from("video_assets").update(changes)
          .eq("external_id", externalId).or(assetCreatedFilter).select("id");
        if (result.error) throw result.error;
        affectedAssets = result.data || [];
      }
      // Unmatched events from other assets in the same Mux environment are
      // intentionally ignored; only this app's stable external ID is a fallback.
    } else if (event.type === "video.asset.ready") {
      let matches: any[] | null = null;
      for (const [field, value] of [["mux_asset_id", d.id], ["mux_upload_id", d.upload_id], ["external_id", d.meta?.external_id]] as any[]) {
        if (!value) continue;
        const result = await db.from("video_assets").select("id").eq(field, String(value)).limit(2);
        if (result.error) throw result.error;
        if (result.data?.length) { matches = result.data; break; }
      }
      if (matches?.length === 1) {
        const playbacks = Array.isArray(d.playback_ids) ? d.playback_ids : [];
        const playback = playbacks.find((p: any) => p.policy === "public") || playbacks[0] || null;
        const result = await db.from("video_assets").update({
          mux_asset_id: d.id, mux_playback_id: playback?.id || null, playback_policy: playback?.policy || null,
          asset_status: "ready", processing_state: "completed", duration_seconds: d.duration ?? null,
          aspect_ratio: d.aspect_ratio || null, resolution_tier: d.resolution_tier || null, last_error: null,
          last_mux_event_created_at: eventCreatedAt
        }).eq("id", matches[0].id).or(newerEventFilter);
        updateError = result.error;
      } else if (matches && matches.length > 1) throw new Error("Mux event matched multiple asset versions.");
    } else if (event.type === "video.asset.errored") {
      const changes = {
        mux_asset_id: d.id, asset_status: "errored", processing_state: "errored", upload_state: "failed",
        last_error: details(d), last_mux_event_created_at: eventCreatedAt
      };
      let result = await db.from("video_assets").update(changes).eq("mux_asset_id", d.id)
        .or(newerEventFilter).select("id");
      if (result.error) throw result.error;
      let affectedAssets = result.data || [];
      if (!affectedAssets.length && d.meta?.external_id) {
        result = await db.from("video_assets").update(changes).eq("external_id", String(d.meta.external_id))
          .or(newerEventFilter).select("id");
        if (result.error) throw result.error;
        affectedAssets = result.data || [];
      }
      if (!affectedAssets.length) {
        // A prior delivery may have changed the asset successfully but failed
        // during unpublishing. Recover that exact event's state on retry.
        let current = await db.from("video_assets").select("id")
          .eq("mux_asset_id", d.id).eq("asset_status", "errored")
          .eq("last_mux_event_created_at", eventCreatedAt).limit(2);
        if (current.error) throw current.error;
        affectedAssets = current.data || [];
        if (!affectedAssets.length && d.meta?.external_id) {
          current = await db.from("video_assets").select("id")
            .eq("external_id", String(d.meta.external_id)).eq("asset_status", "errored")
            .eq("last_mux_event_created_at", eventCreatedAt).limit(2);
          if (current.error) throw current.error;
          affectedAssets = current.data || [];
        }
      }
      await unpublishActiveAssets(db, affectedAssets.map((item: any) => item.id));
    } else if (event.type === "video.asset.deleted") {
      const result = await db.from("video_assets").update({
        asset_status: "deleted", mux_playback_id: null, last_mux_event_created_at: eventCreatedAt
      }).eq("mux_asset_id", d.id).or(newerEventFilter).select("id");
      if (result.error) throw result.error;
      let affectedAssets = result.data || [];
      if (!affectedAssets.length) {
        const current = await db.from("video_assets").select("id")
          .eq("mux_asset_id", d.id).eq("asset_status", "deleted")
          .eq("last_mux_event_created_at", eventCreatedAt).limit(2);
        if (current.error) throw current.error;
        affectedAssets = current.data || [];
      }
      await unpublishActiveAssets(db, affectedAssets.map((item: any) => item.id));
    } else if (["video.upload.errored","video.upload.timed_out","video.upload.cancelled"].includes(event.type)) {
      const state = event.type.endsWith("timed_out") ? "timed_out" : event.type.endsWith("cancelled") ? "cancelled" : "failed";
      const changes = {
        upload_state: state, asset_status: "errored", last_error: details(d),
        last_mux_event_created_at: eventCreatedAt
      };
      let result = await db.from("video_assets").update(changes)
        .eq("mux_upload_id", d.id).or(newerEventFilter).select("id");
      if (result.error) throw result.error;
      let affectedAssets = result.data || [];

      // The terminal upload webhook can beat the admin route's final write,
      // just like asset_created. Fall back only to our unique upload-attempt ID
      // so unrelated uploads in the same Mux environment remain ignored.
      const externalId = String(d.new_asset_settings?.meta?.external_id || d.meta?.external_id || "").trim();
      if (!affectedAssets.length && externalId) {
        result = await db.from("video_assets").update(changes)
          .eq("external_id", externalId).or(newerEventFilter).select("id");
        if (result.error) throw result.error;
        affectedAssets = result.data || [];
      }
    }
    if (updateError) throw updateError;
    const { error: doneError } = await db.from("mux_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("event_id", event.id);
    if (doneError) throw doneError;
    return new Response("ok", { status: 200 });
  } catch (error) {
    try { await serviceDb().from("mux_webhook_events").update({ processing_error: error instanceof Error ? error.message.slice(0,4000) : "Webhook processing failed." }).eq("event_id", event.id); } catch (_) {}
    return new Response("Webhook processing failed; retry delivery", { status: 500 });
  }
});
