import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "./support/library.mjs";
import { registerShares } from "../server/shares.mjs";
async function seed(f) {
  const bytes = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "blue" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  const b = await f.json("/batches", "POST", {
    source: "upload",
    direct: true,
  });
  const form = new FormData();
  form.append("photos", new Blob([bytes]), "share.jpg");
  const p = (await f.json(`/batches/${b.id}/import`, "POST", form)).results[0]
    .photo;
  const c = await f.json("/collections", "POST", { name: "分享测试" });
  await f.json(`/collections/${c.id}`, "PUT", { photoIds: [p.id] });
  return { p, c, bytes };
}
test("share publish gates completeness, password protects every image, original permissions and revocation are enforced", async () => {
  const f = await fixture(registerShares);
  try {
    const { p, c, bytes } = await seed(f);
    const s = await f.json(`/collections/${c.id}/shares`, "POST", {
      download: "display",
      password: "test-access",
      days: 1,
    });
    const base = f.base + "/api/public/shares/" + s.token;
    assert.equal((await fetch(base)).status, 404);
    assert.equal(
      (await f.request(`/shares/${s.id}/publish`, "POST", {})).status,
      400,
    );
    await f.json(`/shares/${s.id}/assets/${p.id}/server`, "POST", {});
    await f.json(`/shares/${s.id}/publish`, "POST", {});
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base + `/photos/${p.id}/display`)).status, 401);
    const unlock = await fetch(base + "/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-access" }),
    });
    const cookie = unlock.headers.get("set-cookie").split(";")[0];
    const headers = { cookie };
    assert.equal((await fetch(base, { headers })).status, 200);
    assert.equal(
      (await fetch(base + `/photos/${p.id}/original`, { headers })).status,
      404,
    );
    assert.equal(
      (await fetch(base + "/photos/foreign/display", { headers })).status,
      404,
    );
    const image = Buffer.from(
      await (
        await fetch(base + `/photos/${p.id}/display`, { headers })
      ).arrayBuffer(),
    );
    assert.equal((await sharp(image).metadata()).exif, undefined);
    await f.request(`/shares/${s.id}`, "DELETE");
    assert.equal((await fetch(base, { headers })).status, 404);
    assert.equal(
      (await fetch(base + `/photos/${p.id}/display`, { headers })).status,
      404,
    );
    const original = await f.json(`/collections/${c.id}/shares`, "POST", {
      download: "original",
      days: 1,
    });
    await f.json(`/shares/${original.id}/assets/${p.id}/server`, "POST", {});
    await f.json(`/shares/${original.id}/publish`, "POST", {});
    assert.deepEqual(
      Buffer.from(
        await (
          await fetch(
            f.base +
              `/api/public/shares/${original.token}/photos/${p.id}/original?download=1`,
          )
        ).arrayBuffer(),
      ),
      bytes,
    );
    const zip = await fetch(
      f.base + `/api/public/shares/${original.token}/download`,
    );
    assert.equal(zip.status, 200);
    assert.equal(
      Buffer.from(await zip.arrayBuffer())
        .subarray(0, 2)
        .toString(),
      "PK",
    );
    f.store.put("share", {
      ...f.store.get("share", original.id),
      expiresAt: new Date(0).toISOString(),
    });
    assert.equal(
      (await fetch(f.base + `/api/public/shares/${original.token}`)).status,
      404,
    );
  } finally {
    await f.close();
  }
});
test("view-only shares deny attachment and archive downloads; wrong original cannot be published", async () => {
  const f = await fixture(registerShares);
  try {
    const { p, c } = await seed(f);
    const s = await f.json(`/collections/${c.id}/shares`, "POST", {
      download: "none",
    });
    await f.json(`/shares/${s.id}/assets/${p.id}/server`, "POST", {});
    await f.json(`/shares/${s.id}/publish`, "POST", {});
    const base = f.base + "/api/public/shares/" + s.token;
    assert.equal((await fetch(base + "/download")).status, 403);
    assert.equal(
      (await fetch(base + `/photos/${p.id}/display?download=1`)).status,
      403,
    );
    assert.equal((await fetch(base + `/photos/${p.id}/display`)).status, 200);
    const o = await f.json(`/collections/${c.id}/shares`, "POST", {
      download: "original",
    });
    const form = new FormData();
    form.append(
      "photo",
      new Blob([
        await sharp({
          create: { width: 40, height: 40, channels: 3, background: "red" },
        })
          .jpeg()
          .toBuffer(),
      ]),
      "wrong.jpg",
    );
    assert.equal(
      (await f.request(`/shares/${o.id}/assets/${p.id}/original`, "POST", form))
        .status,
      400,
    );
  } finally {
    await f.close();
  }
});
