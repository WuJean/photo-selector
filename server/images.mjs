import sharp from "sharp";
import exifr from "exifr";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, unlink, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { focalCategory } from "../shared/domain.mjs";

sharp.cache({ memory: 96, files: 32, items: 64 });
sharp.concurrency(2);
export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function importPhoto(store, projectId, file, name, lastModified) {
  const project = store.get("project", projectId);
  if (!project) throw new Error("项目不存在");
  const info = await sharp(file, { limitInputPixels: 120_000_000 }).metadata();
  if (info.format !== "jpeg") throw new Error("首版支持 JPEG 照片");
  const id = randomUUID();
  const hash = await digest(file);
  let exif = {};
  try {
    exif = (await exifr.parse(file)) || {};
  } catch {}
  const rotation = [5, 6, 7, 8].includes(info.orientation);
  const width = rotation ? info.height : info.width,
    height = rotation ? info.width : info.height;
  const source = path.join(store.root, "originals", id + ".jpg");
  await copyFile(file, source);
  try {
    await sharp(source)
      .rotate()
      .resize(520, 520, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(store.root, "thumbs", id + ".jpg"));
    await sharp(source)
      .rotate()
      .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .jpeg({ quality: 85 })
      .toFile(path.join(store.root, "previews", id + ".jpg"));
  } catch (e) {
    await unlink(source).catch(() => {});
    throw e;
  }
  const date = exif.DateTimeOriginal || exif.CreateDate;
  const fallback =
    Number(lastModified) > 0 ? new Date(Number(lastModified)) : null;
  const takenAt =
    date instanceof Date && !isNaN(date)
      ? date.toISOString()
      : fallback && !isNaN(fallback)
        ? fallback.toISOString()
        : null;
  const photo = {
    id,
    projectId,
    name: path.basename(name || "照片.jpg"),
    width,
    height,
    hash,
    originalPath: source,
    size: info.size || 0,
    takenAt,
    importedAt: new Date().toISOString(),
    camera: [exif.Make, exif.Model].filter(Boolean).join(" "),
    lens: exif.LensModel || "",
    focal: exif.FocalLength || null,
    equivalent:
      exif.FocalLengthIn35mmFormat || exif.FocalLengthIn35mmFilm || null,
    aperture: exif.FNumber || null,
    shutter: exif.ExposureTime || null,
    iso: exif.ISO || null,
    status: "unseen",
    finalStatus: "unseen",
    favorite: false,
    manualTags: [],
    analysisStatus: "pending",
    aiStatus: "idle",
    faces: [],
    issues: [],
  };
  photo.focalCategory = focalCategory(
    photo.equivalent,
    photo.focal,
    project.cropFactor,
  );
  return store.put("photo", photo);
}
export function originalPath(store, id) {
  const p = store.get("photo", id);
  if (!p) throw new Error("照片不存在");
  return path.join(store.root, "originals", id + ".jpg");
}
export async function previewData(store, id, maxEdge = 1536) {
  return sharp(originalPath(store, id))
    .rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: 82 })
    .toBuffer();
}

const repairs = new Map();
export async function imageFile(store, id, variant) {
  const source = originalPath(store, id);
  const target = path.join(
    store.root,
    { thumb: "thumbs", preview: "previews", original: "originals" }[variant],
    id + ".jpg",
  );
  try {
    await access(target);
    return target;
  } catch {}
  try {
    await access(source);
  } catch {
    throw Object.assign(new Error("原片不存在"), { status: 404 });
  }
  if (variant === "original") return source;
  if (!repairs.has(target))
    repairs.set(
      target,
      (async () => {
        const temporary = target + "." + randomUUID() + ".tmp";
        try {
          await sharp(source)
            .rotate()
            .resize(
              variant === "thumb" ? 520 : 1536,
              variant === "thumb" ? 520 : 1536,
              { fit: "inside", withoutEnlargement: true },
            )
            .toColourspace("srgb")
            .jpeg({ quality: variant === "thumb" ? 78 : 85 })
            .toFile(temporary);
          await rename(temporary, target);
        } finally {
          await unlink(temporary).catch(() => {});
        }
      })().finally(() => repairs.delete(target)),
    );
  await repairs.get(target);
  return target;
}
