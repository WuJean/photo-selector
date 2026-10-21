// Private R2 delivery. Authorization is checked before every read (including cache hits).
const encoder = new TextEncoder();
async function verify(ticket, secret, key) {
  try {
    const [body, signature] = ticket.split(".");
    const decode = (s) =>
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      );
    const signingKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        signingKey,
        decode(signature),
        encoder.encode(body),
      ))
    )
      return false;
    const payload = JSON.parse(new TextDecoder().decode(decode(body)));
    return (
      payload.key === key &&
      payload.exp > Date.now() &&
      payload.exp < Date.now() + 360000
    );
  } catch {
    return false;
  }
}
async function constantEqual(a, b) {
  if (!a || !b) return false;
  const hash = async (s) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = new Headers({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const origin = request.headers.get("Origin");
    // Redirected same-origin fetches carry an opaque Origin; the signed ticket still authorizes them.
    const allowed = new Set([
      env.APP_ORIGIN,
      ...(env.ALLOWED_ORIGINS || "").split(","),
      "null",
    ]);
    if (origin && allowed.has(origin)) {
      cors.set("Access-Control-Allow-Origin", origin);
      cors.set("Access-Control-Allow-Credentials", "true");
      cors.set("Vary", "Origin");
    }
    const answer = (body, status = 200) =>
      new Response(body, { status, headers: cors });
    if (!env.MEDIA_SECRET) return answer("Storage unavailable", 503);
    if (origin && !allowed.has(origin)) return answer("Forbidden", 403);
    const key = url.pathname.slice(1);
    if (
      !/^[a-zA-Z0-9_/-]+\/[a-f0-9]{64}\.webp$/.test(key) ||
      key.includes("..")
    )
      return answer("Not found", 404);
    if (["PUT", "DELETE"].includes(request.method)) {
      if (
        !(await constantEqual(
          request.headers.get("Authorization"),
          `Bearer ${env.MEDIA_SECRET}`,
        ))
      )
        return answer("Forbidden", 403);
      if (request.method === "DELETE") {
        await env.PHOTOS.delete(key);
        return answer("ok");
      }
      const length = Number(request.headers.get("Content-Length"));
      if (
        !length ||
        length > 4 * 1024 * 1024 ||
        request.headers.get("Content-Type") !== "image/webp"
      )
        return answer("Invalid image", 400);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength !== length) return answer("Invalid length", 400);
      const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = Array.from(sha, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      );
      if (!key.endsWith(`/${hash}.webp`))
        return answer("Checksum mismatch", 400);
      await env.PHOTOS.put(key, bytes, {
        httpMetadata: { contentType: "image/webp" },
        sha256: sha,
      });
      return answer(JSON.stringify({ size: length, hash }));
    }
    if (request.method !== "GET") return answer("Method not allowed", 405);
    const ticket = url.searchParams.get("ticket") || "";
    if (!env.MEDIA_SECRET || !(await verify(ticket, env.MEDIA_SECRET, key)))
      return answer("Forbidden", 403);
    try {
      const auth = await fetch(`${env.APP_ORIGIN}/api/media-edge/authorize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MEDIA_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticket, key }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!auth.ok || !(await auth.json()).allowed)
        return answer("Forbidden", 403);
      // Tokens and user cookies never enter the shared cache key.
      const cacheKey = new Request(`${url.origin}/_cache/${key}`);
      let result = await caches.default.match(cacheKey);
      if (!result) {
        const object = await env.PHOTOS.get(key);
        if (!object) return answer("Not found", 404);
        result = new Response(object.body, {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=86400",
            ETag: object.httpEtag,
          },
        });
        ctx.waitUntil(caches.default.put(cacheKey, result.clone()));
      }
      cors.set("Content-Type", "image/webp");
      return new Response(result.body, { headers: cors });
    } catch (error) {
      if (
        await constantEqual(
          request.headers.get("Authorization"),
          `Bearer ${env.MEDIA_SECRET}`,
        )
      )
        return answer(JSON.stringify({ error: error.message }), 503);
      return answer("Image temporarily unavailable", 503);
    }
  },
};
