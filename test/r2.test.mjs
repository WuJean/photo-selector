import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fixture } from "./support/library.mjs";
import { R2Media, registerR2, readR2Config } from "../server/r2.mjs";
import worker from "../cloudflare/media-worker.mjs";
const config = {
  url: "https://img.example.com",
  secret: "test-secret-".repeat(5),
};
const digest = (b) => createHash("sha256").update(b).digest("hex");
async function addPhoto(f) {
  const p = { id: "test-photo", name: "a.jpg", storage: "server" };
  f.store.put("photo", p);
  await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "#456789" },
  })
    .jpeg()
    .toFile(path.join(f.root, "originals", p.id + ".jpg"));
  return p;
}
test("R2 verifies receipts, bounds concurrency, resumes uploads, rejects revoked sessions and deletes only unreferenced derivatives", async () => {
  const f = await fixture();
  let running = 0,
    peak = 0,
    puts = 0,
    deletes = 0;
  const fetcher = async (url, options) => {
    if (options.method === "DELETE") {
      deletes++;
      return new Response("ok");
    }
    running++;
    peak = Math.max(peak, running);
    puts++;
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return Response.json({
      size: options.body.length,
      hash: digest(options.body),
    });
  };
  const m = new R2Media(f.store, config, { fetcher });
  f.app.locals.r2 = m;
  try {
    const p = await addPhoto(f),
      ref = { kind: "photo", id: p.id, size: "mobile" };
    await Promise.all(Array.from({ length: 12 }, () => m.upload(ref)));
    assert.equal(puts, 1);
    assert.equal(m.status().ready, 1);
    assert.ok(peak <= 2);
    const r = await f.request(`/photos/${p.id}/display/mobile?local=1`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /webp/);
    const redirect = await fetch(
      f.base + `/api/photos/${p.id}/display/mobile`,
      { headers: { cookie: f.cookie }, redirect: "manual" },
    );
    assert.equal(redirect.status, 302);
    const u = new URL(redirect.headers.get("location")),
      ticket = u.searchParams.get("ticket"),
      key = u.pathname.slice(1);
    assert.equal(m.authorized(ticket, key), true);
    assert.equal(m.authorized(ticket, key + "bad"), false);
    const restart = new R2Media(f.store, config, { fetcher });
    await restart.upload(ref);
    assert.equal(puts, 1);
    const additional = await Promise.all(
      ["tile", "screen"].map(async (size) => ({
        ref: { ...ref, size },
        file: await m.source({ ...ref, size }),
      })),
    );
    await Promise.all(additional.map((item) => m.upload(item.ref, item.file)));
    assert.equal(peak, 2);
    assert.equal(puts, 3);
    await f.json("/auth/logout", "POST");
    assert.equal(m.authorized(ticket, key), false);
    f.store.put("photo", { ...p, deleted: true });
    assert.equal(m.authorized(ticket, key), false);
    await m.drain();
    assert.equal(deletes, 3);
    assert.equal(m.record(ref).state, "deleted");
    // The R2 queue never touches the original file.
    assert.ok(
      (await readFile(path.join(f.root, "originals", p.id + ".jpg"))).length,
    );
    assert.equal(readR2Config(f.root), null);
    await writeFile(path.join(f.root, "r2.json"), JSON.stringify(config));
    assert.deepEqual(readR2Config(f.root), config);
    await writeFile(
      path.join(f.root, "r2.json"),
      JSON.stringify({ ...config, url: "http://bad.test" }),
    );
    assert.equal(readR2Config(f.root), null);
  } finally {
    await f.close();
  }
});
test("R2 share grants enforce snapshot, password session, expiry and immediate revocation", async () => {
  const f = await fixture(),
    m = new R2Media(f.store, config);
  f.app.locals.r2 = m;
  try {
    const s = {
      id: "share",
      state: "active",
      password: "encoded",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      photos: [{ id: "in" }],
      creations: [],
    };
    f.store.put("share", s);
    const ref = { kind: "share", shareId: s.id, id: "in", size: "mobile" },
      key = "object";
    f.store.put("r2Object", {
      id: m.logical(ref),
      ref,
      key,
      url: config.url,
      state: "ready",
    });
    const token = "visitor-secret";
    f.store.put("shareSession", {
      id: digest(token),
      shareId: s.id,
      expiresAt: Date.now() + 60000,
    });
    const ticket = m.ticket(
      { headers: { cookie: `share_${s.id}=${token}` } },
      ref,
      key,
    );
    assert.equal(m.authorized(ticket, key), true);
    assert.equal(m.valid({ ...ref, id: "outside" }), false);
    f.store.put("share", { ...s, state: "revoked" });
    assert.equal(m.authorized(ticket, key), false);
    f.store.put("share", { ...s, expiresAt: new Date(0).toISOString() });
    assert.equal(m.authorized(ticket, key), false);
    f.store.put("share", s);
    f.store.remove("shareSession", digest(token));
    assert.equal(m.authorized(ticket, key), false);
  } finally {
    await f.close();
  }
});
test("edge authorizes before cached reads, strips metadata, accepts only hashed uploads and restricts CORS", async () => {
  const f = await fixture(),
    m = new R2Media(f.store, config);
  f.app.locals.r2 = m;
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  const objects = new Map(),
    cache = new Map();
  let authCalls = 0;
  try {
    const p = await addPhoto(f),
      ref = { kind: "photo", id: p.id, size: "mobile" },
      bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "red" },
      })
        .webp()
        .toBuffer(),
      key = `instance/photo/private/${p.id}/mobile/${digest(bytes)}.webp`;
    const env = {
      APP_ORIGIN: "https://photos.example.com",
      MEDIA_SECRET: config.secret,
      PHOTOS: {
        put: async (k, b) => objects.set(k, b),
        delete: async (k) => objects.delete(k),
        get: async (k) =>
          objects.has(k) ? { body: objects.get(k), httpEtag: '"test"' } : null,
      },
    };
    const context = { waitUntil: (p) => p };
    let request = new Request(config.url + "/" + key, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    });
    assert.equal((await worker.fetch(request, env, context)).status, 200);
    f.store.put("r2Object", {
      id: m.logical(ref),
      ref,
      key,
      url: config.url,
      state: "ready",
    });
    const ticket = m.ticket({ headers: { cookie: f.cookie } }, ref, key),
      url = config.url + "/" + key + "?ticket=" + ticket;
    globalThis.caches = {
      default: {
        match: async (r) => cache.get(r.url)?.clone(),
        put: async (r, v) => cache.set(r.url, v),
      },
    };
    globalThis.fetch = async (u, o) => {
      assert.equal(u, env.APP_ORIGIN + "/api/media-edge/authorize");
      assert.equal(o.redirect, "manual");
      authCalls++;
      const b = JSON.parse(o.body);
      return Response.json({ allowed: m.authorized(b.ticket, b.key) });
    };
    for (let i = 0; i < 2; i++) {
      const r = await worker.fetch(
        new Request(url, { headers: { Origin: "null" } }),
        env,
        context,
      );
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("access-control-allow-origin"), "null");
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
    }
    assert.equal(authCalls, 2);
    assert.equal(cache.size, 1);
    f.store.put("photo", { ...p, deleted: true });
    assert.equal(
      (await worker.fetch(new Request(url), env, context)).status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(
          new Request(url, { headers: { Origin: "https://evil.test" } }),
          env,
          context,
        )
      ).status,
      403,
    );
    assert.equal(
      (await worker.fetch(new Request(config.url + "/" + key), env, context))
        .status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(
          new Request(config.url + "/" + key, { method: "DELETE" }),
          env,
          context,
        )
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    await f.close();
  }
});
test("failed R2 verification retains local fallback; callback rejects unauthenticated requests", async () => {
  const f = await fixture((app, store) => registerR2(app, store, null));
  try {
    assert.equal(
      (
        await fetch(f.base + "/api/media-edge/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    const p = await addPhoto(f),
      m = new R2Media(f.store, config, {
        fetcher: async () => Response.json({ size: 0, hash: "wrong" }),
      });
    f.app.locals.r2 = m;
    const ref = { kind: "photo", id: p.id, size: "mobile" };
    await m.upload(ref);
    assert.equal(m.record(ref).state, "error");
    assert.equal(
      (await f.request(`/photos/${p.id}/display/mobile`)).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("R2 deletion failures remain durable and retry without reopening access", async () => {
  const f = await fixture();
  let attempts = 0;
  const media = new R2Media(f.store, config, {
    fetcher: async () => {
      if (++attempts === 1) throw new Error("temporary network outage");
      return new Response("ok");
    },
  });
  f.app.locals.r2 = media;
  try {
    const ref = { kind: "photo", id: "gone", size: "tile" };
    f.store.put("photo", { id: "gone", deleted: true });
    f.store.put("r2Object", {
      id: media.logical(ref),
      ref,
      key: "owned/fixture.webp",
      state: "ready",
      url: config.url,
    });
    await media.drain();
    assert.equal(media.record(ref).state, "delete-error");
    assert.equal(media.valid(ref), false);
    await media.drain();
    assert.equal(media.record(ref).state, "deleted");
    assert.equal(attempts, 2);
  } finally {
    await f.close();
  }
});
