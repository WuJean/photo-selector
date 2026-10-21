import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fixture } from "./support/library.mjs";
import { digest } from "../server/images.mjs";

test("remote culling uses bounded, EXIF-free WebP without altering originals; local folders sync only previews", async () => {
  const f = await fixture();
  try {
    const batch = await f.json("/batches", "POST", { source: "upload" });
    const bytes = await sharp({
      create: { width: 2600, height: 1800, channels: 3, background: "#aabbcc" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const form = new FormData();
    form.append("photos", new Blob([bytes]), "phone.jpg");
    const result = await f.json(`/batches/${batch.id}/import`, "POST", form);
    const photo = f.store.all("photo")[0];
    assert.ok(photo, JSON.stringify(result));
    const before = await digest(photo.originalPath);
    for (const [size, edge] of [
      ["tile", 480],
      ["mobile", 1080],
      ["screen", 1600],
    ]) {
      const r = await f.request(`/photos/${photo.id}/display/${size}`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get("content-type"), /image\/webp/);
      const data = Buffer.from(await r.arrayBuffer()),
        meta = await sharp(data).metadata();
      assert.equal(Math.max(meta.width, meta.height), edge);
      assert.ok(meta.height > meta.width);
      assert.equal(meta.exif, undefined);
      assert.ok(data.length < bytes.length);
    }
    assert.equal(await digest(photo.originalPath), before);
    assert.deepEqual(
      Buffer.from(
        await (await f.request(`/photos/${photo.id}/original`)).arrayBuffer(),
      ),
      bytes,
    );
    assert.equal(
      (await fetch(f.base + `/api/photos/${photo.id}/display/mobile`)).status,
      401,
    );
    const b = await f.json("/batches", "POST", { source: "folder" });
    const p = await f.json(`/batches/${b.id}/local`, "POST", {
      name: "local.jpg",
      phash: "0".repeat(64),
      hash: "b".repeat(64),
      size: 300,
      width: 2600,
      height: 1800,
    });
    const body = new FormData();
    body.append(
      "photo",
      new Blob([
        await sharp(bytes)
          .rotate()
          .resize(1600, 1600, { fit: "inside" })
          .jpeg()
          .toBuffer(),
      ]),
      "preview.jpg",
    );
    await f.json(`/assets/${p.id}/display`, "POST", body);
    assert.equal(f.store.get("photo", p.id).displayReady, true);
    assert.equal(
      (await f.request(`/photos/${p.id}/display/mobile`)).status,
      200,
    );
    await assert.rejects(access(path.join(f.root, "originals", p.id + ".jpg")));
    f.store.put("photo", { ...f.store.get("photo", p.id), deleted: true });
    assert.equal(
      (await f.request(`/photos/${p.id}/display/mobile`)).status,
      404,
    );
  } finally {
    await f.close();
  }
});
