import { createClient } from "npm:@supabase/supabase-js@2";

export function serviceDb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service credentials are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function corsHeaders(request: Request, publicRead = false): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = (Deno.env.get("CMS_ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin"
  };
  if (publicRead) headers["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return { ok: false as const, status: 500, error: "Supabase authentication is not configured." };
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } }
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, status: 401, error: "Your CMS session has expired. Sign in again." };
  const allowlist = new Set((Deno.env.get("CMS_ADMIN_USER_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!allowlist.size || !allowlist.has(data.user.id)) return { ok: false as const, status: 403, error: "This account is not allowlisted as a CMS administrator." };
  return { ok: true as const, user: data.user, db: serviceDb() };
}
export async function muxRequest(path: string, method = "GET", body?: unknown) {
  const id = Deno.env.get("MUX_TOKEN_ID");
  const secret = Deno.env.get("MUX_TOKEN_SECRET");
  if (!id || !secret) throw new Error("Mux API credentials are not configured on the server.");
  const headers: Record<string, string> = { Authorization: "Basic " + btoa(id + ":" + secret), Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch("https://api.mux.com/video/v1" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.messages?.join("; ") || payload?.error?.message || payload?.message || "Mux API returned HTTP " + response.status);
  return payload?.data;
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
