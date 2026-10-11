import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support/library.mjs";
import { candidatePhotos } from "../shared/candidates.mjs";
import { recommendationScope, scopedDraft } from "../server/sources.mjs";
import { requiredMedia } from "../server/media.mjs";
import { newDraft } from "../shared/layout.mjs";
import { randomPairing } from "../shared/pairing.mjs";
test("full candidate search, domain intersection and any, locked constraints and preview scope agree", async () => {
  const f = await fixture();
  try {
    const photos = Array.from({ length: 305 }, (_, i) => ({
      id: "p" + i,
      projectId: "library",
      name: "旅行" + i,
      status: "keep",
      finalStatus: "keep",
      storage: "local",
      ai: {
        description: i >= 300 ? "夕阳逆光 海边" : "雪山",
        tags: i >= 300 ? ["人像", "近景"] : ["风景", "远景"],
      },
    }));
    photos.forEach((p) => f.store.put("photo", p));
    const filter = { query: "夕阳 海边", tags: ["人像", "近景"] };
    assert.equal(candidatePhotos(photos, filter).length, 5);
    assert.equal(candidatePhotos(photos, { tags: ["人像", "风景"] }).length, 0);
    assert.equal(
      candidatePhotos(photos, { tags: ["人像", "风景"], tagMode: "any" })
        .length,
      305,
    );
    const request = {
      candidateFilter: filter,
      prompt: "旅行搭配",
      current: { photoIds: ["p0", "p1", "p2"] },
    };
    const scope = recommendationScope(f.store, "library", request);
    assert.equal(scope.candidates.length, 5);
    assert.ok(scope.candidates.every((p) => Number(p.id.slice(1)) >= 300));
    assert.deepEqual(
      requiredMedia(f.store, "/projects/library/recommend", request),
      scope.candidates.map((p) => p.id),
    );
    assert.throws(
      () =>
        recommendationScope(f.store, "library", {
          ...request,
          lockedIds: ["p0"],
        }),
      /锁定照片/,
    );
    assert.throws(
      () =>
        recommendationScope(f.store, "library", {
          ...request,
          sourceIds: ["foreign"],
        }),
      /超出/,
    );
    assert.deepEqual(
      scopedDraft(f.store, "library", {
        ...newDraft("library", photos.slice(0, 3)),
        candidateFilter: filter,
      }).candidateFilter,
      { ...filter, tagMode: "all" },
    );
    assert.equal(randomPairing(scope.all, "random_three").photoIds.length, 3);
    assert.throws(
      () =>
        randomPairing(
          candidatePhotos(photos, { query: "不存在" }),
          "random_three",
        ),
      /缺少/,
    );
  } finally {
    await f.close();
  }
});
