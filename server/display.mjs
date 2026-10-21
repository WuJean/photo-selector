import sharp from "sharp";
import path from "node:path";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { imageFile } from "./images.mjs";

export const displaySizes = { tile: 480, mobile: 1080, screen: 1600 };
const pending = new Map();
let active = 0;
const waiters = [];
async function limited(task) {
  if (active >= 2) await new Promise((resolve) => waiters.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiters.shift()?.();
  }
}
export function displayPath(store, id, size) {
  if (!Object.hasOwn(displaySizes, size) || !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error("展示图参数无效");
  return path.join(store.root, "display", `${id}-${size}.webp`);
}
export async function compressedFile(store, id, size, source) {
  const target = displayPath(store, id, size);
  try {
    await access(target);
    return target;
  } catch {}
  if (!pending.has(target))
    pending.set(
      target,
      limited(async () => {
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = target + "." + randomUUID() + ".tmp";
        try {
          await sharp(source, { limitInputPixels: 120_000_000 })
            .rotate()
            .resize(displaySizes[size], displaySizes[size], {
              fit: "inside",
              withoutEnlargement: true,
            })
            .toColourspace("srgb")
            .webp({ quality: size === "tile" ? 72 : 80, effort: 3 })
            .toFile(temporary);
          await rename(temporary, target);
        } finally {
          await unlink(temporary).catch(() => {});
        }
      }).finally(() => pending.delete(target)),
    );
  await pending.get(target);
  return target;
}
export async function photoDisplay(store, id, size) {
  const p = store.get("photo", id);
  if (!p || p.deleted || p.deleting)
    throw Object.assign(new Error("照片不存在"), { status: 404 });
  const target = displayPath(store, id, size);
  try {
    await access(target);
    return target;
  } catch {}
  const source =
    p.storage === "local"
      ? displayPath(store, id, "screen")
      : await imageFile(store, id, "render");
  try {
    await access(source);
  } catch {
    throw Object.assign(new Error("请在电脑上重新连接文件夹，上传压缩展示图"), {
      status: 404,
    });
  }
  return compressedFile(store, id, size, source);
}
export function registerDisplay(app, store, upload) {
  app.get("/api/photos/:id/display/:size", async (req, res) => {
    const file = await photoDisplay(store, req.params.id, req.params.size);
    if (
      await app.locals.r2?.serve(
        req,
        res,
        { kind: "photo", id: req.params.id, size: req.params.size },
        file,
      )
    )
      return;
    res
      .set("Cache-Control", "private, no-store")
      .type("webp")
      .sendFile(file, { dotfiles: "allow" });
  });
  app.post(
    "/api/assets/:id/display",
    upload.single("photo"),
    async (req, res) => {
      try {
        const p = store.get("photo", req.params.id);
        if (!p || p.storage !== "local" || p.deleted || p.deleting || !req.file)
          throw new Error("本地照片不可用");
        if (p.displayReady) return res.json({ ok: true });
        const info = await sharp(req.file.path, {
          limitInputPixels: 4_000_000,
        }).metadata();
        if (
          !["jpeg", "webp"].includes(info.format) ||
          Math.max(info.width, info.height) > 1600 ||
          req.file.size > 4 * 1024 * 1024
        )
          throw new Error("请上传长边不超过 1600 像素的压缩展示图");
        await compressedFile(store, p.id, "screen", req.file.path);
        for (const size of ["tile", "mobile"])
          await photoDisplay(store, p.id, size);
        const latest = store.get("photo", p.id);
        if (!latest || latest.deleted || latest.deleting)
          throw new Error("照片已清理");
        store.put("photo", { ...latest, displayReady: true });
        res.json({ ok: true });
      } finally {
        if (req.file) await unlink(req.file.path).catch(() => {});
      }
    },
  );
}
