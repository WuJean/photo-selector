import test from "node:test";
import assert from "node:assert/strict";
import {
  collectionTimeline,
  collectionDetails,
} from "../shared/collections.mjs";
import { fixture } from "./support/library.mjs";

test("collection timeline orders earliest captures, manual overrides and import fallbacks with one valid cover per album", () => {
  const photos = [
    { id: "a", takenAt: "2024-05-01T00:00:00Z", importedAt: "2026-01-01" },
    { id: "b", takenAt: "2023-02-01T00:00:00Z" },
    { id: "c", importedAt: "2025-06-01" },
    { id: "deleted", takenAt: "2000-01-01", deleted: true },
  ];
  const result = collectionTimeline(
    [
      { id: "auto", photoIds: ["a", "b", "deleted"], coverId: "a" },
      { id: "manual", photoIds: ["a"], date: "2020-08-02" },
      { id: "import", photoIds: ["c"], coverId: "missing" },
      { id: "empty", photoIds: [] },
    ],
    photos,
  );
  assert.deepEqual(
    result.map((r) => r.collection.id),
    ["manual", "auto", "import", "empty"],
  );
  assert.equal(result[1].date, "2023-02-01");
  assert.equal(result[1].cover.id, "a");
  assert.equal(result[2].cover.id, "c");
  assert.equal(result[3].cover, null);
  assert.equal(result[3].time, null);
  assert.equal(
    collectionTimeline([{ id: "a", photoIds: ["a"], date: "" }], photos)[0]
      .date,
    "2024-05-01",
  );
  assert.throws(() => collectionDetails({ date: "2025-02-30" }), /有效日期/);
  assert.equal(collectionDetails({ date: "2024-02-29" }).date, "2024-02-29");
});

test("collection metadata is editable, partial updates preserve it and invalid dates do not write", async () => {
  const f = await fixture();
  try {
    const value = {
      name: "山行",
      date: "2022-08-12",
      location: "川西",
      poem: "山色有无中",
      description: "山间的一次旅行",
    };
    const c = await f.json("/collections", "POST", value);
    for (const key of Object.keys(value)) assert.equal(c[key], value[key]);
    await f.json("/collections/" + c.id, "PUT", { name: "在山间" });
    assert.equal(f.store.get("collection", c.id).poem, value.poem);
    const invalid = await f.request("/collections/" + c.id, "PUT", {
      date: "not a date",
      poem: "must not save",
    });
    assert.equal(invalid.ok, false);
    assert.equal(f.store.get("collection", c.id).poem, value.poem);
    const cleared = await f.json("/collections/" + c.id, "PUT", {
      date: "",
      location: "",
      poem: "",
      description: "",
    });
    assert.equal(cleared.date, "");
    assert.equal(cleared.location, "");
    assert.equal(cleared.poem, "");
    assert.equal(cleared.description, "");
  } finally {
    await f.close();
  }
});
