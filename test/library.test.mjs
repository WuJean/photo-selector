import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support/library.mjs";
import { addEntry } from "../server/library.mjs";
import { verifyPassword } from "../server/auth.mjs";
test("administrator sessions protect all private APIs and survive reopen; password change invalidates sessions", async () => {
  const f = await fixture();
  try {
    for (const url of [
      "/api/assets",
      "/api/photos/unknown/original",
      "/api/settings",
      "/api/projects",
    ])
      assert.equal((await fetch(f.base + url)).status, 401);
    assert.equal((await f.json("/auth/session")).authenticated, true);
    assert.ok(
      verifyPassword(
        "fixture-password-123",
        f.store.get("account", "admin").password,
      ),
    );
    assert.equal(
      (
        await f.request("/auth/password", "PUT", {
          current: "wrong",
          password: "new-password-123",
        })
      ).status,
      403,
    );
    await f.json("/auth/password", "PUT", {
      current: "fixture-password-123",
      password: "new-password-123",
    });
    assert.equal((await f.request("/assets")).status, 401);
  } finally {
    await f.close();
  }
});
test("independent batch decisions do not remove an asset reused by another batch or collection", async () => {
  const f = await fixture();
  try {
    const a = await f.json("/batches", "POST", { source: "upload", name: "a" }),
      b = await f.json("/batches", "POST", { source: "upload", name: "b" });
    f.store.put("photo", {
      id: "p",
      projectId: "library",
      status: "unseen",
      finalStatus: "unseen",
      storage: "server",
    });
    addEntry(f.store, a.id, "p");
    addEntry(f.store, b.id, "p");
    await f.json(`/batches/${a.id}/decisions`, "PATCH", {
      round: "initial",
      status: "keep",
      ids: ["p"],
    });
    await f.json(`/batches/${a.id}/decisions`, "PATCH", {
      round: "final",
      status: "keep",
      ids: ["p"],
    });
    const c = await f.json("/collections", "POST", { name: "作品" });
    await f.json(`/collections/${c.id}`, "PUT", { photoIds: ["p"] });
    await f.json(`/batches/${b.id}/decisions`, "PATCH", {
      round: "initial",
      status: "reject",
      ids: ["p"],
    });
    assert.equal(f.store.get("photo", "p").finalStatus, "keep");
    assert.equal((await f.json(`/batches/${a.id}/photos`))[0].status, "keep");
    assert.equal((await f.json(`/batches/${b.id}/photos`))[0].status, "reject");
    assert.equal((await f.json(`/batches/${b.id}/undo`, "POST", {})).ok, true);
    assert.equal((await f.json(`/batches/${b.id}/photos`))[0].status, "unseen");
    assert.equal(
      (
        await f.request(`/batches/${b.id}/decisions`, "PATCH", {
          round: "final",
          status: "keep",
          ids: ["p"],
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("local registration stores only validated metadata, deduplicates assets across batches and rejects forged fields", async () => {
  const f = await fixture();
  try {
    const a = await f.json("/batches", "POST", { source: "folder" }),
      b = await f.json("/batches", "POST", { source: "folder" });
    const input = {
      name: "local.jpg",
      hash: "a".repeat(64),
      size: 200,
      width: 800,
      height: 600,
      phash: "0".repeat(64),
      originalPath: "/private/secret",
      ai: { tags: ["bad"] },
    };
    const one = await f.json(`/batches/${a.id}/local`, "POST", input),
      two = await f.json(`/batches/${b.id}/local`, "POST", input);
    assert.equal(one.id, two.id);
    assert.equal(f.store.get("photo", one.id).originalPath, undefined);
    assert.equal(f.store.get("photo", one.id).ai, undefined);
    assert.equal((await f.request(`/photos/${one.id}/original`)).status, 404);
    assert.equal(
      (
        await f.request(`/batches/${a.id}/local`, "POST", {
          ...input,
          width: 999999,
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
