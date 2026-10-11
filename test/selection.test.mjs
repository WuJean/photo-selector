import test from "node:test";
import assert from "node:assert/strict";
import { selectPhoto, nextAfterDecision } from "../shared/selection.mjs";
test("modifier selection toggles, reverse ranges, unions and ignores hidden group members", () => {
  const visible = ["a", "b", "c", "d", "e"];
  let s = { selected: [], anchor: null };
  s = selectPhoto(s, "d", visible);
  s = selectPhoto(s, "b", visible, { shift: true });
  assert.deepEqual(s.selected, ["b", "c", "d"]);
  assert.equal(s.anchor, "d");
  s = selectPhoto(s, "b", visible, { toggle: true });
  assert.deepEqual(s.selected, ["c", "d"]);
  s = selectPhoto(s, "e", visible, { toggle: true });
  s = selectPhoto(s, "a", visible, { append: true, shift: true });
  assert.equal(s.selected.length, 5);
  assert.deepEqual(selectPhoto(s, "d", ["a", "d"], { shift: true }).selected, [
    "d",
  ]);
  assert.deepEqual(
    selectPhoto({ selected: [], anchor: null }, "c", visible, { shift: true })
      .selected,
    ["c"],
  );
  assert.equal(nextAfterDecision(visible, ["a", "c"]), "d");
  assert.equal(nextAfterDecision(visible, ["d", "e"]), "c");
  assert.equal(nextAfterDecision(visible, visible), "");
});

test("batch decision validates whole scope before transactional save and undoes the whole batch", async () => {
  const { fixture } = await import("./support/library.mjs");
  const { addEntry } = await import("../server/library.mjs");
  const f = await fixture();
  try {
    const b = await f.json("/batches", "POST", { source: "upload" });
    for (const id of ["a", "b"]) {
      f.store.put("photo", {
        id,
        projectId: "library",
        status: "unseen",
        finalStatus: "unseen",
      });
      addEntry(f.store, b.id, id);
    }
    assert.equal(
      (
        await f.request(`/batches/${b.id}/decisions`, "PATCH", {
          round: "initial",
          status: "keep",
          ids: ["a", "foreign"],
        })
      ).status,
      400,
    );
    assert.ok(f.store.all("entry").every((e) => e.status === "unseen"));
    assert.equal(f.store.all("batchUndo").length, 0);
    await f.json(`/batches/${b.id}/decisions`, "PATCH", {
      round: "initial",
      status: "keep",
      ids: ["a", "b"],
    });
    assert.ok(f.store.all("entry").every((e) => e.status === "keep"));
    await f.json(`/batches/${b.id}/undo`, "POST", {});
    assert.ok(f.store.all("entry").every((e) => e.status === "unseen"));
  } finally {
    await f.close();
  }
});
