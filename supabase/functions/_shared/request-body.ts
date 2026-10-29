export type LimitedBodyResult =
  | { ok: true; body: string; bytes: number }
  | { ok: false; body: ""; bytes: number };

/**
 * Reads a request body with a hard byte ceiling before buffering the complete
 * payload. Content-Length is an early rejection hint, not the enforcement
 * mechanism; streamed bytes are counted as they arrive as well.
 */
export async function readRequestBodyLimited(
  request: Request,
  maxBytes = 1_048_576
): Promise<LimitedBodyResult> {
  const limit = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : 1_048_576;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return { ok: false, body: "", bytes: declaredLength };
  }
  if (!request.body) return { ok: true, body: "", bytes: 0 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (_) {}
        return { ok: false, body: "", bytes: total };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(bytes), bytes: total };
}
