import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, errors } from "../server/app.mjs";
import { Store } from "../server/database.mjs";
import { registerPairingPresets } from "../server/pairing-presets.mjs";
import { validatePairingPreset, randomPairing } from "../shared/pairing.mjs";
const definition = () => ({
  name: "旅行三拼",
  template: "columns",
  roles: [
    { subject: ["人像"], shot: ["近景"] },
    { subject: ["风景"], shot: ["远景"] },
    { subject: ["人像"], shot: ["远景"] },
  ],
});
test("custom pairing definitions validate exact subjects, shots and layout counts", () => {
  const p = validatePairingPreset(definition());
  assert.equal(p.roles[0].label, "人像近景");
  for (const bad of [
    null,
    { ...p, name: " " },
    { ...p, template: "__proto__" },
    { ...p, template: "grid" },
    { ...p, roles: [{}, ...p.roles.slice(1)] },
    { ...p, roles: [{ subject: ["雪山"], shot: [] }, ...p.roles.slice(1)] },
    {
      ...p,
      roles: [{ subject: [], shot: ["近景", "远景"] }, ...p.roles.slice(1)],
    },
  ])
    assert.throws(() => validatePairingPreset(bad));
  assert.equal(
    validatePairingPreset({
      ...p,
      roles: p.roles.map(() => ({ subject: [], shot: [] })),
    }).roles[0].label,
    "任意照片",
  );
});
test("custom random pairing rerolls exact matches while retaining locked positions and source restrictions", () => {
  const p = definition();
  const photos = p.roles.flatMap((r, i) =>
    [0, 1].map((n) => ({
      id: `${i}-${n}`,
      ai: { tags: [...r.subject, ...r.shot] },
    })),
  );
  const first = randomPairing(photos, p);
  const slots = first.photoIds.map((photoId, i) => ({
    photoId,
    locked: i === 0,
  }));
  const second = randomPairing(photos, p, { slots });
  assert.equal(second.template, "columns");
  assert.equal(second.photoIds[0], first.photoIds[0]);
  assert.notDeepEqual(second.photoIds, first.photoIds);
  assert.equal(new Set(second.photoIds).size, 3);
  assert(second.photoIds.every((id, i) => id.startsWith(`${i}-`)));
  assert.throws(
    () =>
      randomPairing(
        photos.filter((p) => !p.id.startsWith("1-")),
        p,
      ),
    /风景远景/,
  );
  const grid = {
    ...p,
    template: "grid",
    roles: [...p.roles, { subject: [], shot: [] }],
  };
  assert.equal(randomPairing(photos, grid).photoIds.length, 4);
});
test("custom presets persist across database reopen, support updates and deletion, and reject stale edits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pairing-presets-"));
  const { app, store } = createApp({ root });
  registerPairingPresets(app, store);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const call = (url = "", method = "GET", body) =>
    fetch(
      `http://127.0.0.1:${server.address().port}/api/pairing-presets${url}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
  try {
    store.put("photo", { id: "original", status: "keep" });
    const response = await call("", "POST", {
      ...definition(),
      id: "portrait_triptych",
      revision: 99,
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.notEqual(created.id, "portrait_triptych");
    assert.equal(created.revision, 1);
    const reopened = new Store(root);
    assert.deepEqual(reopened.get("pairingPreset", created.id), created);
    reopened.close();
    const updated = await (
      await call(`/${created.id}`, "PUT", { ...created, name: "改名模板" })
    ).json();
    assert.equal(updated.name, "改名模板");
    assert.equal(updated.revision, 2);
    assert.equal((await call(`/${created.id}`, "PUT", created)).status, 409);
    assert.equal((await call(`/${created.id}`, "DELETE", created)).status, 409);
    assert.equal(
      (await call("/portrait_triptych", "DELETE", { revision: 1 })).status,
      404,
    );
    assert.equal(
      (await call("", "POST", { ...definition(), roles: [] })).status,
      400,
    );
    assert.equal((await (await call()).json()).length, 1);
    assert.equal((await call(`/${created.id}`, "DELETE", updated)).status, 200);
    assert.deepEqual(await (await call()).json(), []);
    assert.equal(store.get("photo", "original").status, "keep");
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
