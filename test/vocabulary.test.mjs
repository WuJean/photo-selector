import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp, errors } from "../server/app.mjs";
import { registerCuration } from "../server/curation.mjs";
import { registerTags, tagLibrary } from "../server/tags.mjs";
import {
  registerAI,
  AIQueue,
  validateAnalysis,
  signature,
} from "../server/ai.mjs";
import { registerVocabulary, VocabularyQueue } from "../server/vocabulary.mjs";
import { importPhoto } from "../server/images.mjs";
import { tagsOf } from "../shared/domain.mjs";
const wait = async (fn) => {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job timeout");
};
test("confirmed vocabulary validates model tags and changes cache identity", () => {
  const v = {
    version: 2,
    tags: [{ name: "雪山", description: "积雪山峰", category: "环境" }],
  };
  assert.equal(
    validateAnalysis({ description: "山", tags: ["雪山"] }, v)
      .vocabularyVersion,
    2,
  );
  assert.throws(
    () => validateAnalysis({ description: "山", tags: ["海边"] }, v),
    /标签库/,
  );
  const config = { baseURL: "http://localhost", model: "model" };
  assert.notEqual(
    signature(config, v),
    signature(config, { ...v, version: 3 }),
  );
});
test("sampling requires initial acceptance; confirmation gates full classification and freezes vocabulary/config", async () => {
  let mode = "normal",
    analysisCount = 0,
    sampleCount = 0,
    release;
  const requests = [];
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    requests.push(body);
    if (mode === "auth") {
      res.writeHead(401);
      res.end();
      return;
    }
    const discover = body.messages[0].content.includes("最多建议 8 项");
    if (discover) sampleCount++;
    else analysisCount++;
    if (!discover && mode === "hold")
      await new Promise((r) => {
        release = r;
      });
    if (mode === "slow") await new Promise((r) => setTimeout(r, 120));
    const content = discover
      ? {
          tags: [
            { name: "雪山", category: "环境", description: "积雪覆盖山峰" },
          ],
        }
      : {
          description: "山峰",
          tags: ["雪山"],
          scene: "未知山脉",
          shot: "远景",
        };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const root = await mkdtemp(path.join(os.tmpdir(), "vocabulary-"));
  const { app, store } = createApp({ root });
  registerCuration(app, store);
  registerTags(app, store);
  const ai = registerAI(app, store, { available: false });
  registerVocabulary(app, store);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const call = async (url, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    store.put("settings", {
      id: "ai",
      baseURL: `http://127.0.0.1:${fixture.address().port}/v1`,
      model: "fixture",
      jsonMode: true,
    });
    const p = store.project("vocabulary");
    const photos = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(root, `source-${i}.jpg`);
      await sharp({
        create: {
          width: 100,
          height: 70,
          channels: 3,
          background: `rgb(${90 + i * 20},140,180)`,
        },
      })
        .jpeg()
        .toFile(file);
      photos.push(await importPhoto(store, p.id, file, `image-${i}.jpg`));
    }
    const ids = photos.map((p) => p.id),
      base = `/projects/${p.id}`;
    assert.equal((await call(base + "/vocabulary", { ids })).status, 400);
    for (const photo of photos)
      store.put("photo", { ...photo, status: "maybe" });
    assert.equal((await call(base + "/analyze", { ids })).status, 400);
    assert.equal((await call(base + "/vocabulary", { ids })).status, 200);
    const q = app.locals.vocabularyQueue;
    await wait(() => q.get(p.id)?.state === "review");
    assert.equal(sampleCount, 3);
    assert.equal(analysisCount, 0);
    assert.equal(store.get("photo", ids[0]).ai, undefined);
    assert(requests[0].messages[1].content[0].text.includes("人像"));
    await call(base + "/tags/assign", {
      ids: [ids[0]],
      name: "雪山",
      enabled: false,
    });
    store.put("photo", { ...store.get("photo", ids[0]), manualTags: ["人像"] });
    mode = "hold";
    const response = await call(base + "/vocabulary/confirm", {
      tags: [{ name: "雪山", category: "环境", description: "积雪覆盖山峰" }],
    });
    assert.equal(response.status, 200);
    await wait(() => !!release);
    const snapshot = structuredClone(ai.job.vocabulary);
    const lib = tagLibrary(store, p.id);
    store.put("tagLibrary", {
      ...lib,
      version: lib.version + 1,
      tags: [{ name: "海边", category: "环境" }],
    });
    const originalConfig = store.get("settings", "ai");
    store.put("settings", { ...originalConfig, model: "new-model" });
    mode = "normal";
    release();
    await wait(() => !ai.running && !ai.job.photoIds.length);
    assert.equal(ai.job.done, 3);
    assert.equal(analysisCount, 3);
    assert.equal(
      store.get("photo", ids[0]).ai.vocabularyVersion,
      snapshot.version,
    );
    assert.deepEqual(tagsOf(store.get("photo", ids[0])), ["人像"]);
    assert(!ai.job.vocabulary.tags.some((t) => t.name === "人像"));
    for (const body of requests.filter(
      (b) => !b.messages[0].content.includes("最多建议 8 项"),
    )) {
      assert(body.messages[0].content.includes("积雪覆盖山峰"));
      assert(!body.messages[0].content.includes("海边"));
      assert.equal(body.model, "fixture");
    }
    // A resumed job retains its immutable prompt and service snapshot, even after settings change.
    store.put("job", { ...ai.job, photoIds: [ids[1]], paused: false, done: 0 });
    const restored = new AIQueue(store, app.locals.aiVault);
    assert(restored.job.paused);
    assert.deepEqual(restored.job.vocabulary, snapshot);
    restored.resume();
    await wait(() => !restored.running);
    assert.equal(restored.job.done, 1);
    mode = "auth";
    store.put("settings", originalConfig);
    await call(base + "/vocabulary", { ids });
    await wait(() => q.get(p.id)?.state === "paused");
    assert.match(q.get(p.id).error, /认证/);
    const originalSample = q.get(p.id).sampleIds;
    mode = "normal";
    q.action(p.id, "resume");
    await wait(() => q.get(p.id).state === "review");
    assert.deepEqual(q.get(p.id).sampleIds, originalSample);
    // Restart preserves sample IDs and progress, but does not upload until explicitly resumed.
    store.put("vocabularyJob", {
      ...q.get(p.id),
      state: "sampling",
      completedIds: [],
      results: {},
    });
    const restoredSamples = new VocabularyQueue(store, app.locals.aiVault);
    assert.equal(restoredSamples.get(p.id).state, "paused");
    assert.deepEqual(restoredSamples.get(p.id).sampleIds, originalSample);
    mode = "slow";
    restoredSamples.action(p.id, "resume");
    restoredSamples.action(p.id, "cancel");
    await wait(() => !restoredSamples.running.size);
    assert.equal(restoredSamples.get(p.id).state, "cancelled");
  } finally {
    release?.();
    ai.cancel();
    app.locals.vocabularyQueue.running.forEach((c) => c.abort());
    await wait(() => !ai.running);
    await new Promise((r) => server.close(r));
    await new Promise((r) => fixture.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
