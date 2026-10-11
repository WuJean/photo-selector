import { registerAuth } from "./auth.mjs";
import { accessPolicy } from "./access.mjs";
import express from "express";
import multer from "multer";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { Store } from "./database.mjs";
import { importPhoto, imageFile } from "./images.mjs";

export function createApp({
  root = path.resolve(".local"),
  onImport = () => {},
  publicURL = "",
  authentication = false,
  password,
} = {}) {
  const app = express();
  const store = new Store(root);
  app.locals.store = store;
  app.disable("x-powered-by");
  app.use(accessPolicy(publicURL));
  app.use(express.json({ limit: "2mb" }));
  app.locals.publicURL = publicURL;
  if (authentication) registerAuth(app, store, { password });
  const upload = multer({
    dest: path.join(root, "temp"),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });
  app.get("/api/health", (req, res) =>
    res.json({ ok: true, service: "选片助手", version: "0.1.0" }),
  );
  app.get("/api/projects", (req, res) =>
    res.json(
      store
        .all("project")
        .map((p) => ({ ...p, count: store.photoCount(p.id) })),
    ),
  );
  app.post("/api/projects", (req, res) =>
    res
      .status(201)
      .json(store.project(String(req.body.name || "新的旅行").slice(0, 120))),
  );
  app.get("/api/projects/:id/photos", (req, res) =>
    res.json(store.publicPhotos(req.params.id)),
  );
  app.post(
    "/api/projects/:id/import",
    upload.array("photos", 20),
    async (req, res, next) => {
      try {
        if (!store.get("project", req.params.id)) throw new Error("项目不存在");
        const results = [];
        let names = [],
          modified = [];
        try {
          names = JSON.parse(req.body.names || "[]");
          modified = JSON.parse(req.body.modified || "[]");
        } catch {}
        for (const [i, file] of (req.files || []).entries()) {
          try {
            const photo = await importPhoto(
              store,
              req.params.id,
              file.path,
              names[i] || file.originalname,
              modified[i],
            );
            results.push({ photo: store.publicPhoto(photo) });
            onImport(photo);
          } catch (error) {
            results.push({
              name: names[i] || file.originalname,
              error: error.message,
            });
          } finally {
            await unlink(file.path).catch(() => {});
          }
        }
        res.json({ results });
      } catch (e) {
        for (const f of req.files || []) await unlink(f.path).catch(() => {});
        next(e);
      }
    },
  );
  app.get("/api/photos/:id/:variant", async (req, res, next) => {
    if (!["thumb", "preview", "original"].includes(req.params.variant))
      return next();
    const photo = store.get("photo", req.params.id);
    if (!photo) return res.status(404).json({ error: "照片不存在" });
    if (req.params.variant === "original" && req.query.download === "1")
      res.attachment(photo.name);
    res.set("Cache-Control", "private, max-age=86400");
    res.sendFile(await imageFile(store, photo.id, req.params.variant), {
      dotfiles: "allow",
    });
  });
  return { app, store, upload };
}
export function errors(app) {
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.status || 400)
      .json({ error: error.message || "操作失败" });
  });
}
