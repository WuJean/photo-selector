import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  groupPhotos,
  cvFeatures,
  distance,
  hamming,
} from "../server/analysis.mjs";
import { NativeBridge } from "../server/native.mjs";
const photo = (id, vector, time = "2026-10-11T10:00:00Z") => ({
  id,
  hash: id,
  embedding: vector,
  takenAt: time,
});
test("grouping constrains members to representatives; exact duplicates cross time; manual groups preserved", () => {
  const result = groupPhotos([
    photo("a", [0, 0]),
    photo("b", [0.25, 0]),
    photo("c", [0.5, 0]),
    { ...photo("copy", [9, 9], "2026-10-12T10:00:00Z"), hash: "a" },
    { ...photo("manual", [0, 0]), groupManual: true, similarId: "custom" },
  ]);
  assert.equal(result[0].similarId, result[1].similarId);
  assert.notEqual(result[0].similarId, result[2].similarId);
  assert.equal(result[3].similarId, result[0].similarId);
  assert.equal(result[4].similarId, "custom");
  assert.notEqual(result[0].sceneId, result[3].sceneId);
  assert.equal(hamming("0".repeat(64), "1".repeat(64)), 64);
  assert.equal(distance([0, 0], [3, 4]), 5);
});
test("local CV computes stable hash, brightness warning and native Vision features", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vision-"));
  const bridge = new NativeBridge();
  try {
    const file = path.join(root, "sample.jpg");
    await sharp({
      create: { width: 256, height: 192, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toFile(file);
    const cv = await cvFeatures(file);
    assert.equal(cv.phash.length, 64);
    assert.ok(cv.issues.includes("亮部较多"));
    if (bridge.available) {
      const result = await bridge.request({ op: "feature", path: file });
      assert.ok(result.embedding.length > 100);
      assert.ok(result.embedding.every(Number.isFinite));
      assert.ok(Array.isArray(result.faces));
    } else t.diagnostic("Vision binary unavailable; CV fallback tested");
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS keychain round trip uses an isolated disposable test item", async (t) => {
  const bridge = new NativeBridge();
  if (!bridge.available) {
    t.skip("Native helper unavailable");
    return;
  }
  const account = "test-" + crypto.randomUUID();
  try {
    await bridge.request({
      op: "key-set",
      account,
      key: "fixture-not-a-real-api-key",
    });
    assert.equal(
      (await bridge.request({ op: "key-get", account })).key,
      "fixture-not-a-real-api-key",
    );
    await bridge.request({ op: "key-delete", account });
    assert.equal((await bridge.request({ op: "key-get", account })).key, null);
  } finally {
    await bridge.request({ op: "key-delete", account }).catch(() => {});
    bridge.close();
  }
});

test("paused local work resumes from persisted pending photo records after restart", async () => {
  const { Store } = await import("../server/database.mjs");
  const { LocalQueue } = await import("../server/analysis.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "queue-"));
  const store = new Store(root);
  try {
    store.put("photo", {
      id: "pending",
      projectId: "p",
      analysisStatus: "running",
    });
    const queue = new LocalQueue(store, { available: false });
    queue.pause();
    const restarted = new LocalQueue(store, { available: false });
    assert.equal(restarted.paused, true);
    assert.deepEqual(restarted.queue, ["pending"]);
    await restarted.drain();
    assert.equal(restarted.running, false);
    assert.throws(() => restarted.regroup("p", "invalid"));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
