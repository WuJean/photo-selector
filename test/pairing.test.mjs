import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Store } from "../server/database.mjs";
import { importPhoto } from "../server/images.mjs";
import { visualRecommendationMessages } from "../server/recommendation.mjs";
import {
  randomPairing,
  visualCandidates,
  QUICK_PAIRINGS,
  matchesRole,
} from "../shared/pairing.mjs";
const photo = (id, tags, extra = {}) => ({
  id,
  status: "keep",
  finalStatus: "keep",
  ai: { tags },
  ...extra,
});
const choices = () => [
  photo("near-a", ["人像", "近景"]),
  photo("near-b", ["人像", "特写"]),
  photo("land-a", ["风景", "远景"]),
  photo("land-b", ["风景", "全景"]),
  photo("far-a", ["人像", "远景"]),
  photo("far-b", ["人像", "全景"]),
];
test("quick presets match roles without duplicates, replace prior choices, preserve locks and respect scope", () => {
  const photos = choices();
  let slots = [];
  for (let i = 0; i < 20; i++) {
    const value = randomPairing(photos, "portrait_triptych", { slots });
    assert.equal(new Set(value.photoIds).size, 3);
    assert(
      value.photoIds.every((id, i) =>
        matchesRole(
          photos.find((p) => p.id === id),
          QUICK_PAIRINGS.portrait_triptych.roles[i],
        ),
      ),
    );
    assert.notDeepEqual(
      value.photoIds,
      slots.map((s) => s.photoId),
    );
    slots = value.photoIds.map((photoId) => ({ photoId }));
  }
  slots[0].locked = true;
  const locked = randomPairing(photos, "portrait_triptych", {
    slots,
    requiredIds: ["land-b"],
  });
  assert.equal(locked.photoIds[0], slots[0].photoId);
  assert(locked.photoIds.includes("land-b"));
  const only = [photos[0], photos[2], photos[4]];
  assert.equal(
    randomPairing(only, "portrait_triptych", {
      slots: only.map((p) => ({ photoId: p.id })),
    }).unchanged,
    true,
  );
  assert.throws(
    () => randomPairing(only.slice(0, 2), "portrait_triptych"),
    /人像远景/,
  );
  assert.throws(
    () =>
      randomPairing(only, "portrait_triptych", {
        slots: [{ photoId: "land-a", locked: true }],
      }),
    /锁定照片不符合/,
  );
  assert.throws(
    () => randomPairing(only, "random_three", { requiredIds: ["foreign"] }),
    /当前范围/,
  );
  const untagged = Array.from({ length: 4 }, (_, i) => photo(String(i), []));
  assert.equal(randomPairing(untagged, "random_four").photoIds.length, 4);
  assert.throws(
    () => randomPairing(untagged.slice(0, 3), "random_four"),
    /不重复/,
  );
});
test("visual shortlist balances tags and shot sizes, caps image count and includes lower-ranked locked and current photos", () => {
  const photos = Array.from({ length: 100 }, (_, i) =>
    photo("land-" + i, ["风景", "远景"], { similarId: "burst" }),
  );
  photos.push(
    photo("close", ["人像", "近景"]),
    photo("far", ["人像", "远景"]),
    photo("locked", ["美食", "特写"]),
  );
  const result = visualCandidates(photos, "人像近景 风景远景 人像远景", {
    lockedIds: ["locked"],
    currentIds: ["land-99"],
  });
  assert.equal(result.length, 12);
  assert.equal(new Set(result.map((p) => p.id)).size, 12);
  for (const id of ["close", "far", "locked", "land-99"])
    assert(result.some((p) => p.id === id));
});
test("multimodal pairing sends each candidate image with its ID, strips metadata and bounds preview dimensions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-pairing-"));
  const store = new Store(root);
  try {
    const project = store.project("pairing");
    const candidates = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(root, `source-${i}.jpg`);
      await sharp({
        create: {
          width: 1800,
          height: 1200,
          channels: 3,
          background: ["red", "green", "blue"][i],
        },
      })
        .jpeg()
        .withMetadata()
        .toFile(file);
      const p = await importPhoto(store, project.id, file, `image-${i}.jpg`);
      candidates.push(p);
    }
    const messages = await visualRecommendationMessages(store, candidates, {
      query: "色彩协调，人物朝向内部",
      locked: [candidates[0].id],
      current: { photoIds: candidates.map((p) => p.id) },
      ratio: "3:4",
    });
    assert.match(messages[0].content, /色彩/);
    assert.match(messages[0].content, /人物视线与身体朝向/);
    const content = messages[1].content;
    assert.equal(content.filter((c) => c.type === "image_url").length, 3);
    assert.equal(JSON.parse(content[0].text).candidates.length, 3);
    for (let i = 0; i < 3; i++) {
      assert(content[i * 2 + 1].text.includes(candidates[i].id));
      const buffer = Buffer.from(
        content[i * 2 + 2].image_url.url.split(",")[1],
        "base64",
      );
      const metadata = await sharp(buffer).metadata();
      assert(metadata.width <= 1024);
      assert.equal(metadata.exif, undefined);
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
