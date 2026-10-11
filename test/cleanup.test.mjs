import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fixture } from "./support/library.mjs";
import { registerCleanup } from "../server/cleanup.mjs";
import {
  NetworkQueue,
  checkedURL,
  publicAddress,
  downloadPublic,
} from "../server/network-import.mjs";
import { addEntry } from "../server/library.mjs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
const jpeg = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
async function seed(f) {
  const b = await f.json("/batches", "POST", { source: "upload" });
  const form = new FormData();
  form.append("photos", new Blob([await jpeg()]), "x.jpg");
  const p = (await f.json(`/batches/${b.id}/import`, "POST", form)).results[0]
    .photo;
  f.store.put("photo", {
    ...f.store.get("photo", p.id),
    analysisStatus: "done",
  });
  return { b, p };
}
test("cleanup rejects incomplete batches, preserves shared assets, deletes real bytes and cannot undo a completed deletion", async () => {
  const f = await fixture(registerCleanup);
  try {
    const { b, p } = await seed(f);
    assert.equal(
      (await f.request(`/batches/${b.id}/finish`, "POST", { round: "initial" }))
        .status,
      400,
    );
    await f.json(`/batches/${b.id}/decisions`, "PATCH", {
      round: "initial",
      status: "reject",
      ids: [p.id],
    });
    await f.json(`/batches/${b.id}/finish`, "POST", { round: "initial" });
    while (f.app.locals.cleanupQueue.running)
      await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(access(path.join(f.root, "originals", p.id + ".jpg")));
    assert.equal(f.store.get("photo", p.id).deleted, true);
    assert.ok(f.store.all("cleanup")[0].bytes > 0);
    assert.equal((await f.json(`/batches/${b.id}/undo`, "POST", {})).ok, false);
    const second = await seed(f),
      other = await f.json("/batches", "POST", { source: "folder" });
    addEntry(f.store, other.id, second.p.id, true);
    await f.json(`/batches/${second.b.id}/decisions`, "PATCH", {
      round: "initial",
      status: "reject",
      ids: [second.p.id],
    });
    await f.json(`/batches/${second.b.id}/finish`, "POST", {
      round: "initial",
    });
    while (f.app.locals.cleanupQueue.running)
      await new Promise((r) => setTimeout(r, 5));
    await access(path.join(f.root, "originals", second.p.id + ".jpg"));
    assert.equal(f.store.get("photo", second.p.id).deleted, undefined);
  } finally {
    await f.close();
  }
});
test("network transfer requires matching size and digest, then removes only server bytes while preserving asset and local binding identity", async () => {
  const f = await fixture(registerCleanup);
  try {
    const { p } = await seed(f);
    const original = f.store.get("photo", p.id);
    f.store.put("photo", { ...original, network: true });
    assert.equal(
      (
        await f.request(`/assets/${p.id}/local-receipt`, "POST", {
          hash: "wrong",
          size: p.size,
        })
      ).status,
      400,
    );
    await access(path.join(f.root, "originals", p.id + ".jpg"));
    await f.json(`/assets/${p.id}/local-receipt`, "POST", {
      hash: original.hash,
      size: p.size,
    });
    while (f.app.locals.cleanupQueue.running)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(f.store.get("photo", p.id).storage, "local");
    assert.equal(f.store.get("photo", p.id).deleted, undefined);
    await assert.rejects(access(path.join(f.root, "originals", p.id + ".jpg")));
  } finally {
    await f.close();
  }
});
test("URL import blocks private, mapped and rebound addresses and rechecks redirects before any second request", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(
    checkedURL("https://a.test", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /内网/,
  );
  let calls = 0;
  const f = await fixture();
  try {
    await assert.rejects(
      downloadPublic(
        "https://public.test/image",
        path.join(f.root, "test.jpg"),
        {
          resolve: async () => [{ address: "8.8.8.8", family: 4 }],
          request: (url, options, callback) => {
            calls++;
            const req = new EventEmitter();
            req.setTimeout = () => {};
            req.end = () => {
              const response = Readable.from([]);
              response.statusCode = 302;
              response.headers = { location: "http://127.0.0.1/private" };
              callback(response);
            };
            return req;
          },
        },
      ),
      /内网/,
    );
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
test("network queue bounds concurrency, resumes failed items without repeating successes and ignores cancelled results", async () => {
  const f = await fixture();
  try {
    let active = 0,
      peak = 0,
      calls = 0;
    const b = await f.json("/batches", "POST", { source: "network" });
    const image = await jpeg();
    const queue = new NetworkQueue(
      f.store,
      () => {},
      async (url, file) => {
        active++;
        peak = Math.max(active, peak);
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        await writeFile(file, image);
        active--;
        return { name: "network.jpg" };
      },
    );
    const j = queue.start(
      b.id,
      Array.from({ length: 7 }, (_, i) => `https://example.com/${i}`),
    );
    while (queue.running.size) await new Promise((r) => setTimeout(r, 10));
    assert.equal(peak, 3);
    assert.equal(f.store.get("networkJob", j.id).state, "done");
    assert.equal(calls, 7);
    const cancel = queue.start(b.id, ["https://example.com/cancel"]);
    queue.action(cancel.id, "cancel");
    while (queue.running.size) await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      f.store.get("networkJob", cancel.id).items[0].state,
      "cancelled",
    );
    assert.equal(f.store.photos("library").length, 7);
  } finally {
    await f.close();
  }
});
