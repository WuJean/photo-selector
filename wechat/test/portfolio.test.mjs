import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../core/store.mjs";
import { createService } from "../core/service.mjs";
import { newDraft } from "../../shared/layout.mjs";
async function setup() {
  const store = new MemoryStore(),
    service = createService({
      store,
      files: { urls: async (ids) => ids.map((url) => ({ url })) },
    });
  await store.put("project", { id: "p" });
  await store.put("project", { id: "other" });
  for (let i = 0; i < 6; i++)
    await store.put("photo", {
      id: "p" + i,
      projectId: "p",
      status: "keep",
      finalStatus: i === 5 ? "unseen" : "keep",
      width: 100,
      height: 100,
      createdAt: i,
    });
  return { store, service };
}
test("collections preserve originals, multi-membership, candidates and eligibility", async () => {
  const { store, service: s } = await setup(),
    c = await s("collections.create", { projectId: "p", name: "雪山" }),
    d = await s("collections.create", { projectId: "p", name: "旅行" });
  await s("members.add", {
    projectId: "p",
    collectionId: c.id,
    ids: ["p0", "p1"],
  });
  await s("members.add", { projectId: "p", collectionId: d.id, ids: ["p0"] });
  assert.equal((await s("collections.photos", { projectId: "p" })).total, 3);
  assert.equal(
    (await s("collections.photos", { projectId: "p", unassigned: false }))
      .total,
    5,
  );
  assert.equal(
    (await s("collections.list", { projectId: "p" })).find((v) => v.id === c.id)
      .count,
    2,
  );
  await assert.rejects(
    s("members.add", { projectId: "p", collectionId: c.id, ids: ["p5"] }),
  );
  await assert.rejects(
    s("collections.photos", { projectId: "other", collectionId: c.id }),
  );
  await s("members.remove", {
    projectId: "p",
    collectionId: c.id,
    ids: ["p0"],
  });
  assert.equal(
    (await s("collections.photos", { projectId: "p", collectionId: d.id }))
      .total,
    1,
  );
  assert.equal((await store.get("photo", "p0")).status, "keep");
  await store.put("photo", {
    ...(await store.get("photo", "p0")),
    finalStatus: "reject",
  });
  assert.equal(
    (await s("collections.photos", { projectId: "p", collectionId: d.id }))
      .total,
    0,
  );
});
test("drafts and custom templates stay scoped, random pairing respects locks", async () => {
  const { store, service: s } = await setup(),
    c = await s("collections.create", { projectId: "p" });
  await s("members.add", {
    projectId: "p",
    collectionId: c.id,
    ids: ["p0", "p1", "p2"],
  });
  const photos = await store.all("photo", { projectId: "p" });
  const draft = newDraft("p", photos.slice(0, 3));
  await s("drafts.save", { projectId: "p", collectionId: c.id, draft });
  assert.equal((await s("drafts.get", { projectId: "p" })).slots.length, 0);
  await assert.rejects(
    s("drafts.save", {
      projectId: "p",
      collectionId: c.id,
      draft: { ...draft, slots: [{ photoId: "p4" }] },
    }),
  );
  const preset = await s("presets.save", {
    projectId: "p",
    preset: {
      name: "自由三拼",
      template: "rows",
      roles: Array.from({ length: 3 }, () => ({ subject: [], shot: [] })),
    },
  });
  const result = await s("pairings.random", {
    projectId: "p",
    collectionId: c.id,
    presetId: preset.id,
    slots: [{ photoId: "p0", locked: true }],
  });
  assert.equal(result.photoIds[0], "p0");
  assert.deepEqual(new Set(result.photoIds), new Set(["p0", "p1", "p2"]));
  await assert.rejects(
    s("pairings.random", { projectId: "other", presetId: preset.id }),
  );
});
test("copy editing saves a version and exposes only owned creation URLs", async () => {
  const { store, service: s } = await setup(),
    c = await s("collections.create", { projectId: "p" });
  await store.put("creation", {
    id: "copy",
    projectId: "p",
    collectionId: c.id,
    type: "copy",
    body: "原文",
    title: "标题",
    createdAt: 1,
  });
  const next = await s("creations.edit", {
    projectId: "p",
    id: "copy",
    body: "新文",
  });
  assert.notEqual(next.id, "copy");
  assert.equal((await store.get("creation", "copy")).body, "原文");
  assert.equal(
    (await s("creations.list", { projectId: "p", collectionId: c.id })).length,
    2,
  );
});
