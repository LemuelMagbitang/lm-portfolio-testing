import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import type { Database } from "./database.types.ts";

let warnedLegacySecretKey = false;
let warnedLegacyPublishableKey = false;

function readDefaultKey(environmentName: string): string {
  const raw = Deno.env.get(environmentName);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.default === "string" ? parsed.default.trim() : "";
  } catch (_) {
    // Never log values from environment variables; they may contain credentials.
    console.warn("[Supabase] Could not parse the platform-managed " + environmentName + " key map.");
    return "";
  }
}

function readSecretApiKey(): string {
  const modern = readDefaultKey("SUPABASE_SECRET_KEYS");
  if (modern) return modern;

  const legacy = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (legacy && !warnedLegacySecretKey) {
    warnedLegacySecretKey = true;
    console.warn("[Supabase] Legacy service_role key fallback is active. Confirm SUPABASE_SECRET_KEYS is available before disabling legacy API keys.");
  }
  return legacy;
}

function readPublishableApiKey(): string {
  const modern = readDefaultKey("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) return modern;

  const legacy = String(Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  if (legacy && !warnedLegacyPublishableKey) {
    warnedLegacyPublishableKey = true;
    console.warn("[Supabase] Legacy anon key fallback is active. Confirm SUPABASE_PUBLISHABLE_KEYS is available before disabling legacy API keys.");
  }
  return legacy;
}

export function serviceDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = readSecretApiKey();
  if (!url || !key) throw new Error("Supabase URL or server-side secret API key is not configured.");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function normalizeOrigin(value: string): string {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    if (parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) return "";
    return parsed.origin;
  } catch (_) {
    return "";
  }
}

export function corsHeaders(request: Request, publicRead = false): Record<string, string> {
  const requestOrigin = normalizeOrigin(request.headers.get("origin") || "");
  // Normalize configured values so accidental trailing slashes do not break exact matching.
  const allowed = (Deno.env.get("CMS_ALLOWED_ORIGINS") || "")
    .split(",").map(normalizeOrigin).filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Vary": "Origin"
  };
  if (publicRead) headers["Access-Control-Allow-Origin"] = "*";
  else if (requestOrigin && allowed.includes(requestOrigin)) headers["Access-Control-Allow-Origin"] = requestOrigin;
  return headers;
}
export function jsonResponse(request: Request, body: unknown, status = 200, publicRead = false): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    ...corsHeaders(request, publicRead),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }});
}
export async function authorizeAdmin(request: Request) {
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false as const, status: 401, error: "Sign in to the video CMS first." };
  const url = Deno.env.get("SUPABASE_URL");
  const publishableKey = readPublishableApiKey();
  if (!url || !publishableKey) return { ok: false as const, status: 500, error: "Supabase authentication is not configured." };
  const authClient = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } }
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Your CMS session has expired. Sign in again." };
  const allowlist = new Set((Deno.env.get("CMS_ADMIN_USER_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!allowlist.size || !allowlist.has(data.user.id)) return { ok: false as const, status: 403, error: "This account is not allowlisted as a CMS administrator." };
  return { ok: true as const, user: data.user, db: serviceDb() };
}
export class MuxApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "MuxApiError";
  }
}

export async function muxRequest(path: string, method = "GET", body?: unknown, includeMetadata = false) {
  const id = Deno.env.get("MUX_TOKEN_ID");
  const secret = Deno.env.get("MUX_TOKEN_SECRET");
  if (!id || !secret) throw new Error("Mux API credentials are not configured on the server.");
  const requestMethod = String(method || "GET").toUpperCase();
  const timeoutMs = requestMethod === "GET" ? 12_000 : 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { Authorization: "Basic " + btoa(id + ":" + secret), Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  let payload: any = {};
  try {
    response = await fetch("https://api.mux.com/video/v1" + path, {
      method: requestMethod,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    try {
      payload = await response.json();
    } catch (error) {
      // Preserve aborts while still handling non-JSON error responses below.
      if (controller.signal.aborted) throw error;
      payload = {};
    }
  } catch (error) {
    if (error instanceof MuxApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MuxApiError(504, "Mux API request timed out after " + timeoutMs + " ms.");
    }
    // A failed POST may have reached Mux even when its response did not reach
    // us. Keep that distinction so the caller does not immediately duplicate
    // an upload that may still emit a webhook.
    throw new MuxApiError(503, "Could not confirm the Mux API response. Refresh the asset state before retrying.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new MuxApiError(response.status, payload?.error?.messages?.join("; ") || payload?.error?.message || payload?.message || "Mux API returned HTTP " + response.status);
  return includeMetadata ? payload : payload?.data;
}
export function safeSlug(value: unknown): string | null {
  const slug = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}
export function safeText(value: unknown, maximum = 512): string { return String(value || "").trim().slice(0, maximum); }
export function isSafePublicMp4Reference(value: unknown): boolean {
  const source = String(value || "").trim();
  if (!source || /^(?:data|blob|javascript):/i.test(source) || source.startsWith("//")) return false;
  if (/^https:/i.test(source)) { try { return new URL(source).protocol === "https:"; } catch (_) { return false; } }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return false;
  const path = source.replace(/^\/+/, "");
  return path.length > 0 && !path.split(/[\\/]/).some((part) => part === "..");
}
