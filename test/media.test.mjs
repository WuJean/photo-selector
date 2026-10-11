import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fixture } from "./support/library.mjs";
import { registerMedia, requiredMedia } from "../server/media.mjs";
import { previewData } from "../server/images.mjs";
import { newDraft } from "../shared/layout.mjs";
test("local AI uploads only sanitized previews, rejects unselected photos and recycles completed media; browser collage remains a separate creation", async () => {
  const f = await fixture(registerMedia);
  try {
    const batch = await f.json("/batches", "POST", { source: "folder" });
    const photo = await f.json(`/batches/${batch.id}/local`, "POST", {
      name: "local.jpg",
      phash: "0".repeat(64),
      hash: "a".repeat(64),
      size: 200,
      width: 2000,
      height: 1600,
    });
    const bytes = await sharp({
      create: { width: 2000, height: 1600, channels: 3, background: "#336677" },
    })
      .withMetadata()
      .jpeg()
      .toBuffer();
    const form = () => {
      const body = new FormData();
      body.append("photo", new Blob([bytes]), "preview.jpg");
      return body;
    };
    assert.equal(
      (await f.request(`/assets/${photo.id}/analysis-preview`, "POST", form()))
        .status,
      400,
    );
    await f.json(`/batches/${batch.id}/decisions`, "PATCH", {
      round: "initial",
      status: "keep",
      ids: [photo.id],
    });
    f.store.put("settings", {
      id: "ai",
      baseURL: "https://example.com/v1",
      model: "fixture",
    });
    assert.deepEqual(
      requiredMedia(f.store, "/projects/library/analyze", { ids: [photo.id] }),
      [photo.id],
    );
    await assert.rejects(previewData(f.store, photo.id), /等待连接/);
    await f.json(`/assets/${photo.id}/analysis-preview`, "POST", form());
    const buffer = await previewData(f.store, photo.id),
      metadata = await sharp(buffer).metadata();
    assert.equal(metadata.width, 1536);
    assert.equal(metadata.exif, undefined);
    await assert.rejects(
      access(path.join(f.root, "originals", photo.id + ".jpg")),
    );
    f.store.put("job", { id: "ai", state: "running", photoIds: [photo.id] });
    await f.app.locals.sweepMedia();
    await access(path.join(f.root, "analysis-previews", photo.id + ".jpg"));
    f.store.put("job", { id: "ai", state: "done", photoIds: [] });
    await f.app.locals.sweepMedia();
    await assert.rejects(
      access(path.join(f.root, "analysis-previews", photo.id + ".jpg")),
    );
    await f.json(`/batches/${batch.id}/decisions`, "PATCH", {
      round: "final",
      status: "keep",
      ids: [photo.id],
    });
    const collection = await f.json("/collections", "POST", { name: "创作" }),
      body = form();
    body.append("draft", JSON.stringify(newDraft("library", [photo])));
    const saved = await f.json(
      `/collections/${collection.id}/collage-upload`,
      "POST",
      body,
    );
    assert.equal(saved.kind, "collage");
    assert.deepEqual(saved.sourceIds, [photo.id]);
    assert.equal(saved.model, "browser-canvas");
    assert.equal(f.store.all("photo").length, 1);
    assert.equal(f.store.all("creation").length, 1);
  } finally {
    await f.close();
  }
});
