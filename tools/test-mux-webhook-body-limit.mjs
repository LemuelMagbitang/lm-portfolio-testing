import assert from "node:assert/strict";
import { readRequestBodyLimited } from "../supabase/functions/_shared/request-body.ts";

const normalBody = "Mux webhook payload 🌱";
const normalBytes = new TextEncoder().encode(normalBody).byteLength;
const normal = await readRequestBodyLimited({
  headers: new Headers(),
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(normalBody));
      controller.close();
    }
  })
}, normalBytes);
assert.deepEqual(normal, { ok: true, body: normalBody, bytes: normalBytes });

let streamStarted = false;
const declaredTooLarge = await readRequestBodyLimited({
  headers: new Headers({ "content-length": "4097" }),
  body: new ReadableStream({
    start(controller) {
      streamStarted = true;
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    }
  })
}, 4096);
assert.equal(declaredTooLarge.ok, false);
assert.equal(declaredTooLarge.bytes, 4097);
assert.equal(streamStarted, false, "declared oversized bodies should be rejected before reading the stream");

let cancelled = false;
const streamedTooLarge = await readRequestBodyLimited({
  headers: new Headers(),
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("1234"));
      controller.enqueue(new TextEncoder().encode("5678"));
    },
    cancel() {
      cancelled = true;
    }
  })
}, 6);
assert.equal(streamedTooLarge.ok, false);
assert.equal(streamedTooLarge.body, "");
assert.equal(streamedTooLarge.bytes, 8);
assert.equal(cancelled, true, "streamed oversized bodies should be cancelled as soon as the byte limit is crossed");

console.log("Mux webhook request-body size limit contract passed.");
