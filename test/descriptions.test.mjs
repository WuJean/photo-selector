import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support/library.mjs";
import { descriptionRecord, saveDescription } from "../server/descriptions.mjs";
import { requiredMedia } from "../server/media.mjs";
import { filterPhotos } from "../shared/domain.mjs";
test("canonical descriptions reuse legacy caches across model changes, search and request only missing media", async () => {
  const f = await fixture();
  try {
    const photos = [
      { id: "a", hash: "aaa", ai: { description: "海边近景人像，蓝色天空" } },
      { id: "b", hash: "bbb" },
      { id: "c", hash: "ccc" },
    ].map((p) => ({
      ...p,
      projectId: "library",
      status: "keep",
      finalStatus: "keep",
      storage: "local",
      name: p.id + ".jpg",
    }));
    photos.forEach((p) => f.store.put("photo", p));
    f.store.put("description", {
      id: "b",
      text: "雪山远景，冷色调",
      signature: "old-provider",
    });
    const c = await f.json("/collections", "POST", { name: "描述测试" });
    await f.json("/collections/" + c.id, "PUT", { photoIds: ["a", "b", "c"] });
    assert.deepEqual(
      requiredMedia(f.store, `/projects/library/collections/${c.id}/create`, {
        kind: "cover",
      }),
      ["c"],
    );
    saveDescription(
      f.store,
      photos[2],
      { description: "蓝色海边的近景人像", tone: "蓝" },
      { model: "new-model" },
    );
    assert.deepEqual(
      requiredMedia(f.store, `/projects/library/collections/${c.id}/create`, {
        kind: "copy",
      }),
      [],
    );
    f.store.put("settings", {
      id: "ai",
      model: "another-model",
      baseURL: "http://localhost:1234",
    });
    assert.deepEqual(
      requiredMedia(f.store, `/projects/library/collections/${c.id}/create`, {
        kind: "cover",
      }),
      [],
    );
    const assets = await f.json("/assets");
    assert.equal(filterPhotos(assets, { query: "海边 近景" }).length, 2);
    assert.equal(descriptionRecord(f.store, photos[2]).model, "new-model");
    assert.equal(
      descriptionRecord(f.store, { ...photos[2], hash: "changed" }),
      null,
    );
    f.store.put("creationJob", {
      id: "job",
      kind: "cover",
      photoIds: ["a", "b", "c"],
      descriptions: {},
    });
    assert.deepEqual(requiredMedia(f.store, "/creation-jobs/job/resume"), []);
    assert.equal(f.store.get("photo", "c").ai, undefined);
  } finally {
    await f.close();
  }
});

test("concurrent creations share one missing-description request", async () => {
  const { ensureDescription } = await import("../server/descriptions.mjs");
  const f = await fixture();
  try {
    const p = { id: "once", hash: "same", projectId: "library" };
    f.store.put("photo", p);
    let calls = 0;
    const analyze = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { description: "蓝色山峦" };
    };
    const values = await Promise.all([
      ensureDescription(f.store, p, { model: "one" }, null, analyze),
      ensureDescription(f.store, p, { model: "two" }, null, analyze),
    ]);
    assert.deepEqual(values, ["蓝色山峦", "蓝色山峦"]);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
