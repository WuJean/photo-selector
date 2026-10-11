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

test("guest collage is scoped, tagged, saved separately, downloadable and denied after revoke or expiry", async () => {
  const f = await fixture(registerShares);
  try {
    const { p, c } = await seed(f);
    f.store.put("photo", { ...p, ai: { tags: ["风景", "远景"] } });
    const s = await f.json(`/collections/${c.id}/shares`, "POST", {
      password: "guest-password",
      download: "display",
    });
    await f.json(`/shares/${s.id}/assets/${p.id}/server`, "POST", {});
    await f.json(`/shares/${s.id}/publish`, "POST", {});
    const base = f.base + "/api/public/shares/" + s.token;
    const { newDraft } = await import("../shared/layout.mjs");
    const draft = newDraft("arbitrary-private-project", [p, p, p]);
    draft.longEdge = 600;
    const post = (body, action = "save", cookie = "") =>
      fetch(base + "/collages/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    assert.equal((await post(draft)).status, 401);
    const unlock = await fetch(base + "/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "guest-password" }),
    });
    const cookie = unlock.headers.get("set-cookie").split(";")[0];
    const publicShare = await (
      await fetch(base, { headers: { cookie } })
    ).json();
    assert.deepEqual(publicShare.photos[0].tags, ["风景", "远景"]);
    const { randomPairing } = await import("../shared/pairing.mjs");
    const tagged = publicShare.photos.map((v) => ({
      ...v,
      ai: { tags: v.tags },
    }));
    assert.throws(
      () =>
        randomPairing(tagged, {
          name: "景观",
          template: "rows",
          roles: [
            { subject: ["人像"], shot: [] },
            { subject: [], shot: [] },
            { subject: [], shot: [] },
          ],
        }),
      /缺少人像/,
    );
    assert.equal((await post(draft, "save", cookie)).status, 201);
    f.store.put("share", {
      ...f.store.get("share", s.id),
      expiresAt: new Date(0).toISOString(),
    });
    assert.equal((await post(draft, "save", cookie)).status, 404);
  } finally {
    await f.close();
  }
});

test("guest saved collage survives share revocation, only writes fixed portfolio, and rejects foreign photos", async () => {
  const f = await fixture(registerShares);
  try {
    const { p, c } = await seed(f);
    const s = await f.json(`/collections/${c.id}/shares`, "POST", {
      download: "display",
    });
    await f.json(`/shares/${s.id}/assets/${p.id}/server`, "POST", {});
    await f.json(`/shares/${s.id}/publish`, "POST", {});
    const base = f.base + "/api/public/shares/" + s.token;
    const { newDraft } = await import("../shared/layout.mjs");
    const draft = {
      ...newDraft("foreign", [p, p, p]),
      longEdge: 600,
      collectionId: "foreign",
      watermark: { assetId: "private-logo" },
    };
    const post = (body, action = "save") =>
      fetch(base + "/collages/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post({ ...draft, slots: [{ photoId: "private-photo" }] })).status,
      400,
    );
    assert.equal((await post({ ...draft, slots: [] })).status, 400);
    let r = await post(draft, "render");
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.height, 600);
    assert.equal(meta.exif, undefined);
    r = await post(draft);
    assert.equal(r.status, 201);
    const saved = await r.json(),
      record = f.store.get("creation", saved.id);
    assert.equal(record.collectionId, c.id);
    assert.equal(record.origin, "guest");
    assert.equal(record.draft.watermark.assetId, null);
    assert.deepEqual(record.sourceIds, [p.id, p.id, p.id]);
    const downloaded = await fetch(
      base + `/photos/${saved.id}/display?download=1`,
    );
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    assert.equal(f.store.all("photo").length, 1);
    await f.request(`/shares/${s.id}`, "DELETE");
    assert.equal((await post(draft)).status, 404);
    assert.equal(
      (await fetch(base + `/photos/${saved.id}/display`)).status,
      404,
    );
    assert.ok(f.store.get("creation", saved.id));
    const { access } = await import("node:fs/promises");
    const path = await import("node:path");
    await access(path.join(f.root, "creations", record.file));
    for (const option of [
      { download: "none" },
      { download: "display", allowCollage: false },
    ]) {
      const limited = await f.json(
        `/collections/${c.id}/shares`,
        "POST",
        option,
      );
      await f.json(`/shares/${limited.id}/assets/${p.id}/server`, "POST", {});
      await f.json(`/shares/${limited.id}/publish`, "POST", {});
      const r = await fetch(
        f.base + "/api/public/shares/" + limited.token + "/collages/save",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      assert.equal(r.status, 403);
    }
  } finally {
    await f.close();
  }
});
