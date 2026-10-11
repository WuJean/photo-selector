import path from "node:path";
import { mkdir, unlink, access, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { requireItem, timestamp } from "./library.mjs";
import { activeReference } from "./cleanup.mjs";
import { signature } from "./ai.mjs";
import { tagLibrary } from "./tags.mjs";
import { structuredTags, samplePhotos } from "../shared/tags.mjs";
import { inInitial } from "../shared/domain.mjs";
import { sourcePhotos, scopedDraft } from "./sources.mjs";
import { visualCandidates } from "../shared/pairing.mjs";
import { saveCreation } from "./creations.mjs";
export function requiredMedia(store, url, body = {}) {
  let ids = [];
  const valid = (values) => {
    if (!Array.isArray(values) || values.length > 5000)
      throw new Error("照片范围无效");
    const photos = [...new Set(values)].map((id) =>
      requireItem(store, "photo", id),
    );
    if (photos.some((p) => !inInitial(p) || p.deleted))
      throw new Error("只能分析初筛入选照片");
    return photos;
  };
  if (url === "/projects/library/analyze") {
    const config = requireItem(store, "settings", "ai"),
      library = tagLibrary(store, "library");
    const key = signature(config, {
      version: library.version,
      schemaVersion: 2,
      tags: structuredTags(library.tags),
    });
    ids = valid(body.ids)
      .filter(
        (p) => body.force || p.aiStatus !== "done" || p.aiSignature !== key,
      )
      .map((p) => p.id);
  } else if (url === "/projects/library/vocabulary")
    ids = samplePhotos(valid(body.ids));
  else if (url === "/projects/library/vocabulary/confirm")
    ids = requireItem(store, "vocabularyJob", "library").photoIds;
  else if (/^\/ai\/(resume|retry)$/.test(url)) {
    const j = requireItem(store, "job", "ai");
    ids = url.endsWith("retry") ? j.failedIds : j.photoIds;
  } else if (/^\/projects\/library\/vocabulary\/(resume|retry)$/.test(url)) {
    const j = requireItem(store, "vocabularyJob", "library");
    ids = j.sampleIds.filter((id) => !j.completedIds.includes(id));
  } else if (url === "/projects/library/recommend") {
    const collection = body.collectionId
      ? requireItem(store, "collection", body.collectionId)
      : null;
    ids = visualCandidates(
      sourcePhotos(store, "library", body),
      String(body.prompt || ""),
      {
        lockedIds: [
          ...new Set([
            ...(body.lockedIds || []),
            ...(collection?.lockedIds || []),
          ]),
        ],
        currentIds: body.current?.photoIds || [],
      },
    ).map((p) => p.id);
  } else if (/^\/projects\/library\/collections\/[^/]+\/create$/.test(url)) {
    const collection = requireItem(store, "collection", url.split("/")[4]);
    ids = sourcePhotos(store, "library", { collectionId: collection.id })
      .filter((p) => body.kind === "cover" || !p.ai?.description)
      .map((p) => p.id);
  } else if (/^\/creation-jobs\/[^/]+\/(resume|retry)$/.test(url)) {
    const job = requireItem(store, "creationJob", url.split("/")[2]);
    ids = job.photoIds.filter(
      (id) => job.kind === "cover" || !job.descriptions[id],
    );
  }
  return valid(ids || [])
    .filter((p) => p.storage === "local")
    .map((p) => p.id);
}
export function registerMedia(app, store, upload) {
  const dir = path.join(store.root, "analysis-previews");
  app.post("/api/media/requirements", async (req, res) => {
    const ids = requiredMedia(store, req.body.url, req.body.body);
    const missing = [];
    for (const id of ids) {
      try {
        await access(path.join(dir, id + ".jpg"));
      } catch {
        missing.push(id);
      }
    }
    res.json({ ids: missing });
  });
  app.post(
    "/api/assets/:id/analysis-preview",
    upload.single("photo"),
    async (req, res) => {
      try {
        const p = requireItem(store, "photo", req.params.id);
        if (
          p.storage !== "local" ||
          !inInitial(p) ||
          p.deleted ||
          p.deleting ||
          !req.file
        )
          throw new Error("只能为初筛入选的本地照片准备 AI 预览");
        await mkdir(dir, { recursive: true });
        const temporary = path.join(dir, p.id + "." + randomUUID() + ".tmp");
        try {
          await sharp(req.file.path, { limitInputPixels: 120000000 })
            .rotate()
            .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
            .toColourspace("srgb")
            .jpeg({ quality: 82 })
            .toFile(temporary);
          await rename(temporary, path.join(dir, p.id + ".jpg"));
          store.put("analysisMedia", {
            id: p.id,
            uploadedAt: Date.now(),
            used: false,
          });
        } finally {
          await unlink(temporary).catch(() => {});
        }
        res.json({ ok: true });
      } finally {
        if (req.file) await unlink(req.file.path).catch(() => {});
      }
    },
  );
  app.post(
    "/api/collections/:id/collage-upload",
    upload.single("photo"),
    async (req, res) => {
      try {
        const collection = requireItem(store, "collection", req.params.id);
        if (!req.file) throw new Error("缺少拼图");
        let input;
        try {
          input = JSON.parse(req.body.draft);
        } catch {
          throw new Error("拼图参数无效");
        }
        const draft = scopedDraft(store, "library", input);
        if (!draft.slots.length) throw new Error("请选择照片");
        const info = await sharp(req.file.path, {
          limitInputPixels: 36000000,
        }).metadata();
        if (!["jpeg", "png"].includes(info.format))
          throw new Error("图片格式无效");
        const item = await saveCreation(
          store,
          {
            projectId: "library",
            collectionId: collection.id,
            kind: "collage",
            title: draft.title,
            sourceIds: draft.slots.map((s) => s.photoId),
            draft,
            model: "browser-canvas",
          },
          await sharp(req.file.path).rotate().png().toBuffer(),
        );
        res.status(201).json(item);
      } finally {
        if (req.file) await unlink(req.file.path).catch(() => {});
      }
    },
  );
  const sweep = async () => {
    for (const media of store.all("analysisMedia")) {
      if (activeReference(store, media.id)) continue;
      if (!media.used && Date.now() - media.uploadedAt < 3600000) continue;
      await unlink(path.join(dir, media.id + ".jpg")).catch(() => {});
      store.remove("analysisMedia", media.id);
    }
  };
  const timer = setInterval(() => void sweep(), 5000);
  timer.unref();
  app.locals.closeMedia = () => clearInterval(timer);
  app.locals.sweepMedia = sweep;
}
