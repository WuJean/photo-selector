import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, errors } from "../server/app.mjs";
import { registerCuration } from "../server/curation.mjs";
import { Store } from "../server/database.mjs";
import { inInitial, inFinal } from "../shared/domain.mjs";
test("two review rounds preserve initial choices, gate final decisions, and undo independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reviews-"));
  const { app, store } = createApp({ root });
  registerCuration(app, store);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const p = store.project("test");
    store.put("photo", {
      id: "p",
      projectId: p.id,
      status: "unseen",
      finalStatus: "unseen",
    });
    const edit = async (round, status) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/api/projects/${p.id}/photos`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ["p"], round, patch: { status } }),
        },
      );
    assert.equal((await edit("final", "keep")).status, 400);
    assert.equal((await edit("initial", "maybe")).status, 200);
    assert.equal(inInitial(store.get("photo", "p")), true);
    assert.equal(inFinal(store.get("photo", "p")), false);
    await edit("final", "maybe");
    assert.equal(inFinal(store.get("photo", "p")), true);
    await edit("final", "reject");
    assert.equal(inInitial(store.get("photo", "p")), true);
    assert.equal(inFinal(store.get("photo", "p")), false);
    app.locals.history.undo(p.id);
    assert.equal(inFinal(store.get("photo", "p")), true);
    await edit("initial", "reject");
    assert.equal(inFinal(store.get("photo", "p")), false);
    assert.equal(store.get("photo", "p").finalStatus, "maybe");
    app.locals.history.undo(p.id);
    assert.equal(inFinal(store.get("photo", "p")), true);
    assert.equal((await edit("invalid", "keep")).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy migration backs up the database, retains manual collections, and never infers a final decision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-migrate-"));
  let store = new Store(root);
  try {
    store.remove("migration", "two-rounds");
    store.put("photo", {
      id: "p",
      projectId: "project",
      status: "keep",
      manualTags: ["山"],
    });
    store.put("collection", { id: "c", projectId: "project", photoIds: ["p"] });
    store.close();
    store = new Store(root);
    assert.equal(store.get("photo", "p").finalStatus, "unseen");
    assert.equal(inFinal(store.get("photo", "p")), false);
    assert.deepEqual(store.get("collection", "c").photoIds, ["p"]);
    assert.equal((await readdir(path.join(root, "backups"))).length, 1);
    store.close();
    store = new Store(root);
    assert.equal((await readdir(path.join(root, "backups"))).length, 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuilding a legacy draft archives it and only final photos can enter rendered drafts", async () => {
  const { registerExports } = await import("../server/exports.mjs");
  const { newDraft } = await import("../shared/layout.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "draft-migrate-"));
  const { app, store, upload } = createApp({ root });
  registerCuration(app, store);
  registerExports(app, store, upload);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const project = store.project("legacy");
    const initial = {
        id: "a",
        projectId: project.id,
        status: "keep",
        finalStatus: "unseen",
        width: 100,
        height: 100,
      },
      final = { ...initial, id: "b", finalStatus: "maybe" };
    store.put("photo", initial);
    store.put("photo", final);
    const old = newDraft(project.id, [initial]);
    store.put("draft", old);
    const put = (value) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
      );
    assert.equal((await put(old)).status, 400);
    assert.equal(store.get("draft", old.id).slots[0].photoId, "a");
    assert.equal((await put(newDraft(project.id, [final]))).status, 200);
    assert.equal(store.get("draft", old.id).slots[0].photoId, "b");
    assert.equal(store.all("draftArchive")[0].slots[0].photoId, "a");
    app.locals.history.undo(project.id);
    assert.equal(store.get("draft", old.id).slots[0].photoId, "a");
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
