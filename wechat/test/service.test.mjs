import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../core/store.mjs";
import { createService } from "../core/service.mjs";
const env = "test-env";
const setup = () => {
  const store = new MemoryStore();
  return {
    store,
    api: createService({
      store,
      env,
      media: { inspect: async () => ({ width: 100, height: 80, hash: "abc" }) },
      files: { urls: async (ids) => ids },
    }),
  };
};
test("cloud projects and file access isolate users, imports finalize idempotently", async () => {
  const { store, api } = setup();
  const p = await api("projects.create", { name: "旅行" });
  const t = await api("upload.prepare", {
    projectId: p.id,
    size: 100,
    name: "a.jpg",
  });
  const fileID = `cloud://${env}.bucket/${t.cloudPath}`;
  await assert.rejects(
    api("upload.finish", {
      id: t.id,
      fileID: "cloud://other.bucket/" + t.cloudPath,
    }),
  );
  const photo = await api("upload.finish", { id: t.id, fileID });
  assert.equal(photo.status, "unseen");
  assert.equal((await api("upload.finish", { id: t.id, fileID })).id, photo.id);
  assert.equal((await api("photos.list", { projectId: p.id })).length, 1);
  const other = createService({
    store: new MemoryStore("other", store.data),
    env,
  });
  assert.deepEqual(await other("projects.list"), []);
  await assert.rejects(other("photos.list", { projectId: p.id }));
  await assert.rejects(other("files.urls", { ids: [photo.id] }));
  await assert.rejects(other("upload.finish", { id: t.id, fileID }));
});
test("upload size checks and database transactions roll back failures", async () => {
  const { api, store } = setup();
  const p = await api("projects.create", {});
  await assert.rejects(
    api("upload.prepare", { projectId: p.id, size: 60 * 1024 * 1024 }),
  );
  await assert.rejects(
    store.transaction(async (tx) => {
      await tx.put("project", { id: "bad" });
      throw Error("failed");
    }),
  );
  assert.equal(await store.get("project", "bad"), null);
});
test("two rounds enforce eligibility, conflict detection, idempotency and independent undo", async () => {
  const { api, store } = setup();
  const p = await api("projects.create", {});
  await store.put("photo", {
    id: "photo",
    projectId: p.id,
    status: "unseen",
    finalStatus: "unseen",
    revision: 1,
  });
  const args = {
    projectId: p.id,
    id: "photo",
    revision: 1,
    round: "final",
    value: "keep",
    operationId: "operation-1",
  };
  await assert.rejects(api("photos.decide", args), /粗筛/);
  const first = await api("photos.decide", {
    ...args,
    round: "initial",
    value: "maybe",
  });
  assert.equal(first.photo.finalStatus, "unseen");
  assert.equal(
    (await api("photos.query", { projectId: p.id, stage: "refine" })).total,
    1,
  );
  await assert.rejects(
    api("photos.decide", {
      ...args,
      revision: 2,
      value: "maybe",
      operationId: "operation-2",
    }),
  );
  const final = await api("photos.decide", {
    ...args,
    revision: 2,
    operationId: "operation-2",
  });
  assert.equal(
    (await api("photos.query", { projectId: p.id, stage: "portfolio" })).total,
    1,
  );
  await api("photos.decide", {
    ...args,
    revision: 2,
    operationId: "operation-2",
  });
  assert.equal((await store.get("photo", "photo")).revision, 3);
  await assert.rejects(
    api("photos.decide", { ...args, operationId: "operation-3" }),
    /修改/,
  );
  await api("photos.undo", { projectId: p.id, historyId: final.historyId });
  assert.equal((await store.get("photo", "photo")).status, "maybe");
  assert.equal((await store.get("photo", "photo")).finalStatus, "unseen");
});

test("multiple undo restores the decision chain on one photo without undoing AI results", async () => {
  const store = new MemoryStore(),
    s = createService({ store });
  await store.put("project", { id: "p" });
  await store.put("photo", {
    id: "x",
    projectId: "p",
    status: "unseen",
    finalStatus: "unseen",
    revision: 1,
  });
  const a = await s("photos.decide", {
    projectId: "p",
    id: "x",
    round: "initial",
    value: "keep",
    revision: 1,
    operationId: "operation-1",
  });
  const b = await s("photos.decide", {
    projectId: "p",
    id: "x",
    round: "final",
    value: "keep",
    revision: 2,
    operationId: "operation-2",
  });
  await store.put("photo", { ...b.photo, ai: { tags: ["风景", "远景"] } });
  await s("photos.undo", { projectId: "p", historyId: b.historyId });
  const restored = await s("photos.undo", {
    projectId: "p",
    historyId: a.historyId,
  });
  assert.equal(restored.photo.status, "unseen");
  assert.equal(restored.photo.finalStatus, "unseen");
  assert.deepEqual(restored.photo.ai.tags, ["风景", "远景"]);
});
