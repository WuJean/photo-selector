import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { inspectImage } from "../cloud/media.mjs";
test("cloud processing preserves originals, handles rotated JPEG, emits EXIF-free bounded previews and rejects corrupt data", async () => {
  const bytes = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: "#678999" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer(),
    copy = Buffer.from(bytes),
    uploads = [];
  const cloud = {
    downloadFile: async () => ({ fileContent: bytes }),
    uploadFile: async (v) => {
      uploads.push(v);
      return { fileID: "cloud://env.bucket/" + v.cloudPath };
    },
  };
  const p = await inspectImage(
    cloud,
    "cloud://env.bucket/users/u/p/originals/a.jpg",
  );
  assert.equal(p.width, 1200);
  assert.equal(p.height, 1800);
  assert.equal(p.takenAt, null);
  assert.equal(p.focalCategory, "未知");
  assert.equal(uploads.length, 2);
  for (const u of uploads) {
    const meta = await sharp(u.fileContent).metadata();
    assert(Math.max(meta.width, meta.height) <= 1536);
    assert.equal(meta.exif, undefined);
    assert(u.cloudPath.startsWith("users/u/p/derived/"));
  }
  assert.deepEqual(bytes, copy);
  await assert.rejects(
    inspectImage(
      {
        ...cloud,
        downloadFile: async () => ({ fileContent: Buffer.from("damaged") }),
      },
      "cloud://env.bucket/users/u/p/originals/b.jpg",
    ),
  );
});
