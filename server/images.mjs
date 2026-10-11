import sharp from "sharp";
import { decodeHeif } from "./heif.mjs";
import exifr from "exifr";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, unlink, copyFile, access, stat, open } from "node:fs/promises";
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
  const handle = await open(file, "r");
  const head = Buffer.alloc(64); try { await handle.read(head,0,64,0); } finally { await handle.close(); }
  const isHeif = head.toString("ascii",4,8) === "ftyp" && /heic|heix|hevc|hevx|mif1/.test(head.toString("ascii",8));
  const decoded = isHeif ? path.join(store.root,"temp", randomUUID()+".jpg") : file;
  if (isHeif) await decodeHeif(file,decoded);
  let info;
  try { info = await sharp(decoded, { limitInputPixels: 120_000_000 }).metadata(); }
  catch(e) { if(isHeif) await unlink(decoded).catch(()=>{}); throw e; }
  if (!["jpeg","png"].includes(info.format)) throw new Error("支持 JPEG、PNG、HEIC/HEIF 静态照片");
  const originalExtension = isHeif ? "heic" : info.format === "png" ? "png" : "jpg";
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
  const rawSource = originalExtension === "jpg" ? source : path.join(store.root,"source-files",id+"."+originalExtension);
  await copyFile(file, rawSource);
  try {
    if (rawSource !== source) await sharp(decoded).rotate().flatten({background:"#fff"}).jpeg({quality:95}).toFile(source);
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
    for (const target of [source, rawSource, path.join(store.root,"thumbs",id+".jpg"),path.join(store.root,"previews",id+".jpg")]) await unlink(target).catch(()=>{});
    throw e;
  } finally { if(isHeif) await unlink(decoded).catch(()=>{}); }
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
    originalPath: rawSource,
    originalExtension,
    originalMime: isHeif ? "image/heic" : "image/"+info.format,
    size: (await stat(rawSource)).size,
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
  return p.originalExtension && p.originalExtension !== "jpg" ? path.join(store.root,"source-files",id+"."+p.originalExtension) : path.join(store.root, "originals", id + ".jpg");
}
export function renderPath(store,id) { return path.join(store.root,"originals",id+".jpg"); }
export async function previewData(store, id, maxEdge = 1536) {
  const photo = store.get("photo", id);
  let source = renderPath(store, id);
  if (photo?.storage === "local") {
    source = path.join(store.root, "analysis-previews", id + ".jpg");
    try {
      await access(source);
    } catch {
      throw new Error("等待连接电脑文件夹并准备 AI 预览");
    }
  }
  const buffer = await sharp(source)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: 82 })
    .toBuffer();
  const media = store.get("analysisMedia", id);
  if (media) store.put("analysisMedia", { ...media, used: true });
  return buffer;
}

const repairs = new Map();
export async function imageFile(store, id, variant) {
  if (["original","render"].includes(variant)) {
    const file=variant === "original" ? originalPath(store,id) : renderPath(store,id);
    try { await access(file); } catch { throw Object.assign(new Error("原片不存在"),{status:404}); }
    return file;
  }
  const source = renderPath(store, id);
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
