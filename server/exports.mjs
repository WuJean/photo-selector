import archiver from "archiver";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { validateDraft, newDraft } from "../shared/layout.mjs";
import { renderDraft } from "./render.mjs";
import { uniqueName, inFinal } from "../shared/domain.mjs";
import { originalPath } from "./images.mjs";
export function registerExports(app, store, upload) {
  const draft = (projectId, input) =>
    validateDraft(
      { ...input, projectId },
      store.photos(projectId).filter(inFinal),
    );
  app.get("/api/projects/:id/draft", (req, res) =>
    res.json(store.get("draft", "draft-" + req.params.id)),
  );
  app.put("/api/projects/:id/draft", (req, res) => {
    const value = draft(req.params.id, req.body);
    const old = store.get("draft", "draft-" + req.params.id);
    const invalid = old?.slots.some(
      (slot) => !inFinal(store.get("photo", slot.photoId) || {}),
    );
    const changes = [{ kind: "draft", value }];
    if (invalid)
      changes.unshift({
        kind: "draftArchive",
        value: {
          ...old,
          id: randomUUID(),
          archivedAt: new Date().toISOString(),
        },
      });
    app.locals.history.apply(req.params.id, changes, "编辑拼图");
    res.json(value);
  });
  app.post("/api/projects/:id/render", async (req, res) => {
    const value = draft(req.params.id, req.body);
    const data = await renderDraft(store, value, {
      preview: !!req.query.preview,
    });
    res.type("image/jpeg");
    if (!req.query.preview) res.attachment("photo-story.jpg");
    res.send(data);
  });
  app.get("/api/presets", (req, res) => res.json(store.all("preset")));
  app.post("/api/presets", (req, res) => {
    const value = {
      id: randomUUID(),
      name: String(req.body.name || "我的预设").slice(0, 80),
      settings: {
        frame: req.body.settings?.frame,
        background: req.body.settings?.background,
        gap: req.body.settings?.gap,
        watermark: req.body.settings?.watermark,
        longEdge: req.body.settings?.longEdge,
        quality: req.body.settings?.quality,
      },
    };
    store.put("preset", value);
    res.status(201).json(value);
  });
  app.post(
    "/api/assets/watermark",
    upload.single("watermark"),
    async (req, res) => {
      if (!req.file) throw new Error("请选择 PNG 水印");
      try {
        const metadata = await sharp(req.file.path).metadata();
        if (metadata.format !== "png") throw new Error("水印需要 PNG 格式");
        const id = randomUUID();
        await sharp(req.file.path)
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .png()
          .toFile(path.join(store.root, "assets", id + ".png"));
        const value = { id, name: String(req.body.name || "水印") };
        store.put("asset", value);
        res.json(value);
      } finally {
        await unlink(req.file.path).catch(() => {});
      }
    },
  );
  app.get("/api/assets/:id", (req, res) => {
    const asset = store.get("asset", req.params.id);
    if (!asset) return res.status(404).json({ error: "水印不存在" });
    res.sendFile(path.join(store.root, "assets", asset.id + ".png"), {
      dotfiles: "allow",
    });
  });
  app.post("/api/projects/:id/export", async (req, res, next) => {
    const ids = [...new Set(req.body.ids || [])];
    if (!ids.length) throw new Error("请选择照片");
    const photos = ids.map((id) => store.get("photo", id));
    if (photos.some((p) => !p || p.projectId !== req.params.id))
      throw new Error("照片不属于当前项目");
    const rendered = req.body.mode === "rendered";
    res.attachment(
      rendered ? "selected-photos.jpg.zip" : "selected-originals.zip",
    );
    const archive = archiver("zip", { zlib: { level: 0 } });
    archive.on("error", next);
    archive.pipe(res);
    const names = new Set();
    try {
      for (const p of photos) {
        if (res.destroyed) break;
        const name = uniqueName(p.name, names);
        if (rendered) {
          const value = draft(req.params.id, {
            ...newDraft(req.params.id, [p]),
            ...(req.body.settings || {}),
            template: "single",
            slots: newDraft(req.params.id, [p]).slots.map((s) => ({
              ...s,
              fit: "contain",
            })),
          });
          archive.append(
            await renderDraft(store, value, { preserveOriginal: true }),
            { name },
          );
        } else archive.file(originalPath(store, p.id), { name });
      }
      await archive.finalize();
    } catch (e) {
      archive.abort();
      if (!res.headersSent) next(e);
      else res.destroy(e);
    }
  });
}
