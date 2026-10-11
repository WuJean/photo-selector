import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../server/database.mjs";
import { importPhoto, digest } from "../server/images.mjs";
import { focalCategory, uniqueName } from "../shared/domain.mjs";

test("JPEG import preserves original, normalizes orientation and persists across restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "photo-import-"));
  let store;
  try {
    store = new Store(path.join(dir, "data"));
    const project = store.project("雪山旅行");
    const source = path.join(dir, "source.jpg");
    await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#e8d2ad" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD2: { FocalLength: "85/1", FocalLengthIn35mmFilm: "85" } })
      .toFile(source);
    const before = await digest(source);
    const p = await importPhoto(store, project.id, source, "旅行.jpg");
    assert.equal(p.width, 80);
    assert.equal(p.height, 120);
    assert.equal(await digest(source), before);
    assert.equal(await digest(p.originalPath), before);
    const preview = await sharp(
      path.join(store.root, "previews", p.id + ".jpg"),
    ).metadata();
    assert.equal(preview.width, 80);
    assert.equal(preview.exif, undefined);
    assert.equal(store.publicPhoto(p).originalPath, undefined);
    store.close();
    store = new Store(path.join(dir, "data"));
    assert.equal(store.photos(project.id)[0].name, "旅行.jpg");
    await writeFile(path.join(dir, "broken.jpg"), "broken");
    await assert.rejects(() =>
      importPhoto(
        store,
        project.id,
        path.join(dir, "broken.jpg"),
        "broken.jpg",
      ),
    );
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("focal boundaries and collision-safe export names", () => {
  assert.deepEqual(
    [23, 24, 35, 50, 70, 85, 135].map((x) => focalCategory(x)),
    [
      "超广角",
      "广角",
      "标准 / 50mm",
      "标准 / 50mm",
      "中焦 / 85mm",
      "中焦 / 85mm",
      "长焦",
    ],
  );
  assert.equal(focalCategory(null, 50, null), "未知");
  assert.equal(focalCategory(null, 50, 1.5), "中焦 / 85mm");
  const existing = new Set(["照片.jpg"]);
  assert.equal(uniqueName("照片.jpg", existing), "照片 (2).jpg");
  assert.equal(uniqueName("照片.jpg", existing), "照片 (3).jpg");
});

test("public photo listing isolates projects and omits private paths and model vectors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "photo-index-"));
  const store = new Store(dir);
  try {
    store.put("photo", {
      id: "a",
      projectId: "p",
      name: "a.jpg",
      embedding: [1, 2],
      hash: "hash",
      originalPath: "/private/a",
    });
    store.put("photo", { id: "b", projectId: "elsewhere" });
    assert.equal(store.photoCount("p"), 1);
    assert.deepEqual(store.publicPhotos("p"), [
      { id: "a", projectId: "p", name: "a.jpg" },
    ]);
    assert.equal(store.photos("p")[0].embedding.length, 2);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
