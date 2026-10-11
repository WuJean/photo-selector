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

test("cancelled cover ignores a late generated image; paused cover retains completed work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cover-cancel-"));
  const store = new Store(root);
  try {
    const p = store.project("cover");
    store.put("photo", {
      id: "p",
      projectId: p.id,
      status: "keep",
      finalStatus: "keep",
    });
    store.put("collection", { id: "c", projectId: p.id, photoIds: ["p"] });
    let finish;
    const queue = new CreationQueue(
      store,
      { get: async () => null },
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const base = {
      projectId: p.id,
      collectionId: "c",
      kind: "cover",
      pipelineVersion: 2,
      config: { baseURL: "http://localhost", model: "mock" },
      imageConfig: { model: "wan2.7-image" },
      photoIds: ["p"],
      descriptions: { p: { id: "p", description: "风景" } },
      summaries: { 0: { summary: "山", photoIds: ["p"] } },
      plan: { title: "山", text: "山间", prompt: "山", referenceIds: ["p"] },
      state: "paused",
      total: 4,
    };
    store.put("creationJob", { ...base, id: "cancel" });
    queue.action("cancel", "resume");
    await wait(() => finish);
    queue.action("cancel", "cancel");
    finish(Buffer.from("late response"));
    await wait(() => !queue.running.size);
    assert.equal(queue.get("cancel").state, "cancelled");
    assert.equal(store.all("creation").length, 0);
    finish = null;
    store.put("creationJob", { ...base, id: "pause" });
    queue.action("pause", "resume");
    await wait(() => finish);
    queue.action("pause", "pause");
    const sharp = (await import("sharp")).default;
    finish(
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: "green" },
      })
        .png()
        .toBuffer(),
    );
    await wait(() => !queue.running.size);
    assert.equal(queue.get("pause").state, "done");
    assert.equal(store.all("creation").length, 1);
    const visible = queue.public({
      ...queue.get("pause"),
      generatedURL: "data:image/png;base64,test",
      reductions: { data: "private summary" },
    });
    assert.equal(visible.generatedURL, undefined);
    assert.equal(visible.reductions, undefined);
    assert.equal(visible.imageConfig, undefined);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("abstract creation uses all cached descriptions while local photos are offline and preserves concept provenance", async () => {
  const { fixture } = await import("./support/library.mjs");
  const f = await fixture();
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    assert.ok(body.messages.every((m) => typeof m.content === "string"));
    const input = JSON.parse(body.messages.at(-1).content);
    let result;
    if (Array.isArray(input)) {
      seen.push(...input.map((p) => p.id));
      result = { summary: "蓝色山川与同行者的宁静" };
    } else {
      assert.match(body.messages[0].content, /视觉隐喻/);
      result = {
        title: "山的回声",
        text: "宁静与同行",
        concept: "以一道回环的山脊象征同行记忆，冷蓝色调",
        prompt: "冷蓝色山脊形成一个回环，单一视觉中心",
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
  try {
    const ids = Array.from({ length: 15 }, (_, i) => "abstract-" + i);
    for (const id of ids)
      f.store.put("photo", {
        id,
        projectId: "library",
        status: "keep",
        finalStatus: "keep",
        storage: "local",
        ai: { description: "蓝色山间远景 " + id, tags: ["风景", "远景"] },
      });
    f.store.put("collection", {
      id: "abstract",
      projectId: "library",
      photoIds: ids,
    });
    f.store.put("settings", {
      id: "ai",
      baseURL: `http://127.0.0.1:${server.address().port}`,
      model: "test",
    });
    const image = await (
      await import("sharp")
    )
      .default({
        create: { width: 100, height: 100, channels: 3, background: "blue" },
      })
      .png()
      .toBuffer();
    let generation;
    const q = new CreationQueue(
      f.store,
      { get: async () => null },
      async (j) => {
        generation = j;
        return image;
      },
    );
    const j = q.start("library", "abstract", "cover");
    await wait(() => !q.running.size);
    assert.equal(q.get(j.id).state, "done", q.get(j.id).error);
    assert.deepEqual(new Set(seen), new Set(ids));
    assert.deepEqual(generation.plan.referenceIds, []);
    assert.equal(generation.pipelineVersion, 2);
    const creation = f.store.get("creation", j.id);
    assert.match(creation.concept, /回环/);
    assert.equal(Object.keys(creation.descriptionSnapshot).length, 15);
    assert.equal(creation.creationMode, "abstract");
    f.store.put("creationJob", {
      ...q.get(j.id),
      id: "legacy",
      state: "paused",
      pipelineVersion: undefined,
      creationId: null,
      plan: { prompt: "old collage" },
    });
    const recovered = new CreationQueue(
      f.store,
      { get: async () => null },
      async () => image,
    );
    assert.match(recovered.get("legacy").error, /抽象/);
    recovered.action("legacy", "resume");
    await wait(() => !recovered.running.size);
    assert.equal(recovered.get("legacy").state, "done");
    assert.match(recovered.get("legacy").plan.prompt, /冷蓝/);
  } finally {
    await new Promise((r) => server.close(r));
    await f.close();
  }
});
