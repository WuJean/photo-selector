import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, errors } from "../server/app.mjs";
import { registerCuration } from "../server/curation.mjs";
import { registerTags, tagLibrary } from "../server/tags.mjs";
import { tagsOf, filterPhotos } from "../shared/domain.mjs";
import { samplePhotos } from "../shared/tags.mjs";
test("manual tags override fresh AI results; compound filters use AND or OR", () => {
  const p = {
    id: "a",
    manualTags: ["人像"],
    excludedTags: ["雪山"],
    ai: { tags: ["雪山", "远景"], scene: "雪山" },
  };
  assert.deepEqual(tagsOf(p), ["人像", "远景"]);
  assert.equal(filterPhotos([p], { tags: ["人像", "雪山"] }).length, 0);
  assert.equal(
    filterPhotos([p], { tags: ["人像", "雪山"], tagMode: "any" }).length,
    1,
  );
  p.ai = { tags: ["雪山", "人像"], scene: "雪山" };
  assert.deepEqual(tagsOf(p), ["人像"]);
});
test("photo tags can only be assigned by AI; library definitions and reusable defaults remain editable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tags-"));
  const { app, store } = createApp({ root });
  registerCuration(app, store);
  registerTags(app, store);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const call = async (url, method, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const p = store.project("tags"),
      other = store.project("other"),
      base = `/projects/${p.id}/tags`;
    store.put("photo", {
      id: "a",
      projectId: p.id,
      status: "maybe",
      ai: { tags: ["雪山", "风景"] },
    });
    store.put("photo", { id: "b", projectId: p.id, status: "unseen" });
    store.put("photo", { id: "c", projectId: other.id, status: "keep" });
    const lib = tagLibrary(store, p.id);
    assert(lib.tags.some((t) => t.name === "人像"));
    for (const route of ["assign", "clear", "rename"]) {
      const response = await call(base + "/" + route, "POST", {
        ids: ["a"],
        name: "人像",
        enabled: true,
      });
      assert.equal(response.status, 403);
    }
    const response = await call(`/projects/${p.id}/photos`, "PATCH", {
      ids: ["a"],
      patch: { manualTags: ["人像"] },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(tagsOf(store.get("photo", "a")), ["雪山", "风景"]);
    const current = tagLibrary(store, p.id);
    await call(base, "PUT", {
      version: current.version,
      tags: [...current.tags, { name: "旅途", category: "其他" }],
    });
    await call(base + "/common", "POST", { names: ["旅途"] });
    const future = store.project("future");
    assert(tagLibrary(store, future.id).tags.some((t) => t.name === "旅途"));
    assert.equal(
      (await call(base, "PUT", { version: 0, tags: [] })).status,
      409,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("sampling is deterministic, deduplicated, capped, covers time and missing-time strata proportionally", () => {
  const photos = Array.from({ length: 1000 }, (_, i) => ({
    id: `p${String(i).padStart(4, "0")}`,
    hash: `h${i}`,
    takenAt: i < 990 ? new Date(1700000000000 + i * 60000).toISOString() : null,
  }));
  const result = samplePhotos(photos);
  assert.equal(result.length, 60);
  assert.equal(new Set(result).size, 60);
  assert.deepEqual(result, samplePhotos(photos));
  assert(result.some((id) => Number(id.slice(1)) >= 990));
  for (let part = 0; part < 10; part++)
    assert(
      result.some(
        (id) =>
          Math.min(9, Math.floor((Number(id.slice(1)) / 989) * 10)) === part,
      ),
    );
  const dup = Array.from({ length: 100 }, (_, i) => ({
    id: `d${i}`,
    hash: "same",
  }));
  assert.equal(samplePhotos(dup).length, 1);
  assert.equal(samplePhotos(photos.slice(0, 5)).length, 5);
  assert.equal(samplePhotos(photos.slice(0, 100)).length, 12);
  assert.deepEqual(samplePhotos([]), []);
});

test("structured AI tags enforce one subject one shot and at most five extras; cleared tags remain empty", async () => {
  const { validateAnalysis } = await import("../server/ai.mjs");
  const { structuredTags, DEFAULT_TAGS } = await import("../shared/tags.mjs");
  const library = {
    version: 1,
    schemaVersion: 2,
    tags: structuredTags(DEFAULT_TAGS),
  };
  const valid = validateAnalysis(
    { description: "雪山中的游客", tags: ["人像", "远景", "雪山"] },
    library,
  );
  assert.equal(valid.subject, "人像");
  assert.equal(valid.shot, "远景");
  for (const tags of [
    [],
    ["人像"],
    ["人像", "风景", "远景"],
    ["人像", "远景", "雪山", "森林", "海边", "城市", "室内", "夜景"],
  ])
    assert.throws(() => validateAnalysis({ description: "图", tags }, library));
  assert.deepEqual(tagsOf({ ai: valid, tagsCleared: true }), []);
});
