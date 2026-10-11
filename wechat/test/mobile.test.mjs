import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { visibleCards, FOCAL_LABELS } from "../core/mobile.mjs";
async function page(file, { call, context } = {}) {
  let config;
  const wx = {
    getStorageSync: () => [],
    setStorageSync() {},
    showToast() {},
    navigateBack() {},
  };
  vm.runInNewContext(
    await readFile("wechat/miniprogram/pages/" + file + "/index.js", "utf8"),
    {
      Page: (p) => (config = p),
      wx,
      getApp: () => ({ globalData: { review: context } }),
      require: () => ({
        call,
        visibleCards,
        FOCAL_LABELS,
        toast() {},
        hydrate: async (p) => p,
        tagsOf: (p) => p.ai?.tags || [],
      }),
      console,
    },
  );
  config.data = structuredClone(config.data);
  config.setData = function (v) {
    Object.assign(this.data, v);
  };
  return config;
}
test("similar groups fold and unfold without dropping members for 1,2,3,4,10 images", () => {
  for (const n of [1, 2, 3, 4, 10]) {
    const photos = Array.from({ length: n }, (_, i) => ({
      id: String(i),
      similarId: "group",
    }));
    assert.equal(visibleCards(photos).length, 1);
    assert.equal(visibleCards(photos, ["group"]).length, n);
    assert.equal(visibleCards(photos, ["group"])[0].count, n);
  }
});
test("mobile immersion failure stays on the photo, success advances, undo restores cursor", async () => {
  const photos = [
    { id: "a", revision: 1 },
    { id: "b", revision: 1 },
  ];
  let fail = true;
  const p = await page("review", {
    context: {
      projectId: "p",
      photos,
      ids: ["a", "b"],
      startId: "a",
      stage: "refine",
      total: 2,
    },
    call: async (action) => {
      if (action === "photos.decide") {
        if (fail) throw Error("network");
        return { photo: { id: "a", revision: 2 }, historyId: "h" };
      }
      return { photo: photos[0] };
    },
  });
  p.onLoad();
  await new Promise((r) => setImmediate(r));
  p.imageLoaded({ currentTarget: { dataset: { id: "a" } } });
  await p.decide({ currentTarget: { dataset: { value: "keep" } } });
  assert.equal(p.data.index, 0);
  fail = false;
  await p.decide({ currentTarget: { dataset: { value: "keep" } } });
  assert.equal(p.data.index, 1);
  await p.undo();
  assert.equal(p.data.index, 0);
  assert.equal(p.data.stage, "refine");
});
test("immutable review IDs fetch next page despite prior decisions leaving the query", async () => {
  let ids;
  const photos = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
  const p = await page("review", {
    context: {
      projectId: "p",
      photos,
      ids: photos.map((p) => p.id).concat("60"),
      startId: "59",
      stage: "rough",
      total: 61,
    },
    call: async (action, input) => {
      assert.equal(action, "photos.get");
      ids = input.ids;
      return [{ id: "60" }];
    },
  });
  p.onLoad();
  await new Promise((r) => setImmediate(r));
  await p.show(60);
  assert.deepEqual([...ids], ["60"]);
  assert.equal(p.data.current.id, "60");
  assert(p.data.neighbors.length <= 3);
});
test("changing stage during a pending grid load fetches latest scope and never paints stale photos", async () => {
  let release;
  const calls = [],
    snapshots = [];
  const p = await page("library", {
    call: async (action, input) => {
      calls.push(input.stage);
      if (input.stage === "rough")
        await new Promise((r) => {
          release = r;
        });
      return {
        photos: [{ id: input.stage }],
        ids: [input.stage],
        total: 1,
        counts: {},
      };
    },
  });
  p.projectId = "p";
  const setData = p.setData.bind(p);
  p.setData = (v) => {
    if (v.photos) snapshots.push(v.photos.map((p) => p.id).join(","));
    setData(v);
  };
  const initial = p.load(true);
  p.stage({ currentTarget: { dataset: { stage: "refine" } } });
  release();
  await initial;
  while (p.data.loading) await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["rough", "refine"]);
  assert.deepEqual(snapshots, ["refine"]);
});
test("review does not decide an image before it has decoded or from a stale load event", async () => {
  let calls = 0;
  const p = await page("review", {
    context: {
      projectId: "p",
      photos: [{ id: "a" }, { id: "b" }],
      ids: ["a", "b"],
      startId: "a",
      stage: "rough",
      total: 2,
    },
    call: async () => {
      calls++;
      return { photo: { id: "b" }, historyId: "h" };
    },
  });
  p.onLoad();
  await new Promise((r) => setImmediate(r));
  await p.show(1);
  p.imageLoaded({ currentTarget: { dataset: { id: "a" } } });
  await p.decide({ currentTarget: { dataset: { value: "keep" } } });
  assert.equal(calls, 0);
  p.imageLoaded({ currentTarget: { dataset: { id: "b" } } });
  await p.decide({ currentTarget: { dataset: { value: "keep" } } });
  assert.equal(calls, 1);
});
test("3000-photo grid keeps only one page in rendered state and immersion retains global neighbors", async () => {
  const photos = Array.from({ length: 3000 }, (_, i) => ({
    id: String(i),
    revision: 1,
    ai: { tags: ["风景", "远景"] },
  }));
  const grid = await page("library", {
    call: async (a, q) => ({
      photos: photos.slice(q.offset, q.offset + 60),
      total: 3000,
      ids: photos.map((p) => p.id),
      counts: {},
    }),
  });
  grid.projectId = "p";
  for (let offset = 0; offset < 3000; offset += 60) {
    await grid.load(false, offset);
    assert.equal(grid.data.photos.length, 60);
    assert.equal(grid.data.cards.length, 60);
    assert.equal(grid.data.pageCount, 50);
    assert(JSON.stringify(grid.data).length < 50000);
  }
  const review = await page("review", {
    context: {
      projectId: "p",
      ids: photos.map((p) => p.id),
      photos: photos.slice(120, 180),
      startId: "120",
      stage: "refine",
      total: 3000,
    },
    call: async (a, q) => q.ids.map((id) => photos[Number(id)]),
  });
  review.onLoad();
  await new Promise((r) => setImmediate(r));
  assert.equal(review.data.index, 120);
  assert.deepEqual(
    [...review.data.neighbors.map((p) => p.id)],
    ["119", "120", "121"],
  );
  await review.show(119);
  assert.equal(review.data.current.id, "119");
  await review.show(2999);
  assert.equal(review.data.current.id, "2999");
  assert(review.data.neighbors.length <= 3);
});
