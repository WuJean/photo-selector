import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { Store } from "../server/database.mjs";
import { CreationQueue } from "../server/creations.mjs";
import { sourcePhotos, scopedDraft, draftId } from "../server/sources.mjs";
import { newDraft } from "../shared/layout.mjs";
const wait = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
};
test("collection copy traverses every photo, persists separate versions and resumes without repeating completed summaries", async () => {
  const seen = [];
  let calls = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw),
      input = JSON.parse(body.messages.at(-1).content);
    calls++;
    let result;
    if (Array.isArray(input)) {
      seen.push(...input.map((p) => p.id));
      result = { summary: "全部照片的山川和旅行故事" };
    } else {
      result = {
        title: "山行",
        text: "我们在山间记录一路风景。",
        prompt: "清冷旅行封面",
        referenceIds: input.batches[0].photoIds.slice(0, 4),
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = await mkdtemp(path.join(os.tmpdir(), "creations-"));
  const store = new Store(root);
  try {
    const p = store.project("test");
    const ids = Array.from({ length: 25 }, (_, i) => "photo-" + i);
    for (const id of ids)
      store.put("photo", {
        id,
        projectId: p.id,
        status: "keep",
        finalStatus: "keep",
        ai: { description: "山峰 " + id, tags: ["风景"] },
      });
    store.put("collection", {
      id: "c",
      projectId: p.id,
      photoIds: ids,
      description: "登山旅行",
      name: "山行",
    });
    store.put("settings", {
      id: "ai",
      baseURL: `http://127.0.0.1:${server.address().port}`,
      model: "mock",
    });
    const queue = new CreationQueue(store, { get: async () => null });
    const j = queue.start(p.id, "c", "copy");
    await wait(() => !queue.running.size);
    assert.equal(queue.get(j.id).state, "done");
    assert.deepEqual(new Set(seen), new Set(ids));
    assert.equal(calls, 4);
    const item = store.get("creation", j.id);
    assert.equal(item.kind, "copy");
    assert.equal(item.sourceIds.length, 25);
    assert.equal(store.all("photo").length, 25);
    const second = queue.start(p.id, "c", "copy");
    await wait(() => !queue.running.size);
    assert.equal(store.all("creation").length, 2);
    store.put("creationJob", {
      ...queue.get(second.id),
      id: "resume",
      state: "running",
      plan: null,
      creationId: null,
    });
    const recovered = new CreationQueue(store, { get: async () => null });
    assert.equal(recovered.get("resume").state, "paused");
    const before = calls;
    recovered.action("resume", "resume");
    await wait(() => !recovered.running.size);
    assert.equal(calls - before, 1);
    assert.equal(recovered.get("resume").state, "done");
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("collection and selected scopes reject foreign photos and isolate drafts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scope-"));
  const store = new Store(root);
  try {
    const p = store.project("p");
    const a = {
        id: "a",
        projectId: p.id,
        status: "maybe",
        finalStatus: "keep",
      },
      b = { ...a, id: "b" };
    store.put("photo", a);
    store.put("photo", b);
    store.put("collection", { id: "c", projectId: p.id, photoIds: ["a"] });
    assert.deepEqual(
      sourcePhotos(store, p.id, { collectionId: "c" }).map((p) => p.id),
      ["a"],
    );
    assert.throws(() =>
      sourcePhotos(store, p.id, { collectionId: "c", sourceIds: ["b"] }),
    );
    assert.throws(() =>
      scopedDraft(store, p.id, { ...newDraft(p.id, [b]), collectionId: "c" }),
    );
    const d = scopedDraft(store, p.id, {
      ...newDraft(p.id, [a]),
      collectionId: "c",
      scopeId: "c",
    });
    assert.notEqual(d.id, draftId(p.id));
    assert.equal(d.scopeId, "c");
    assert.throws(() => sourcePhotos(store, p.id, { collectionId: "missing" }));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
