import { syncRetention } from "./retention.mjs";
import { collectionTimeline, collectionDetails } from "../shared/collections.mjs";
import { hamming } from "./analysis.mjs";
import { focalCategory } from "../shared/domain.mjs";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { importPhoto, digest } from "./images.mjs";
import { inInitial, inFinal } from "../shared/domain.mjs";
export const LIBRARY = "library";
export const timestamp = () => new Date().toISOString();
export function requireItem(store, kind, id) {
  const item = store.get(kind, id);
  if (!item) throw Object.assign(new Error("内容不存在"), { status: 404 });
  return item;
}
export function entries(store, batchId) {
  return store.all("entry").filter((e) => e.batchId === batchId);
}
export function reconcileMany(store, ids) {
  const decisions = new Map();
  for (const e of store.all("entry")) {
    if (e.cleaned) continue;
    const value = decisions.get(e.assetId) || { initial: false, final: false };
    value.initial ||= inInitial(e);
    value.final ||= inFinal(e);
    decisions.set(e.assetId, value);
  }
  const collected = new Set(store.all("collection").flatMap((c) => c.photoIds));
  return [...new Set(ids)].map((id) => {
    const p = requireItem(store, "photo", id),
      choice = decisions.get(id),
      final = collected.has(id) || p.direct || choice?.final;
    return store.put("photo", {
      ...p,
      status: final || choice?.initial ? "keep" : "unseen",
      finalStatus: final ? "keep" : "unseen",
    });
  });
}
export function reconcile(store, id) {
  return reconcileMany(store, [id])[0];
}
export function publicAsset(store, p) {
  return { ...store.publicPhoto(p), hash: p.hash };
}
export function addEntry(store, batchId, assetId, direct = false) {
  const asset = requireItem(store, "photo", assetId);
  if (asset.deleted || asset.deleting)
    throw new Error("照片正在清理，请重新导入");
  const old = entries(store, batchId).find((e) => e.assetId === assetId);
  if (old) return old;
  const value = store.put("entry", {
    id: randomUUID(),
    batchId,
    assetId,
    status: direct ? "keep" : "unseen",
    finalStatus: direct ? "keep" : "unseen",
    cleaned: false,
  });
  reconcile(store, assetId);
  return value;
}
export function registerLibrary(
  app,
  store,
  upload,
  { onImport = () => {} } = {},
) {
  if (!store.get("project", LIBRARY))
    store.put("project", {
      id: LIBRARY,
      name: "照片库",
      createdAt: timestamp(),
    });
  app.get("/api/timeline", (req, res) => {
    const items = collectionTimeline(store.all("collection").filter(c => c.projectId === LIBRARY), store.photos(LIBRARY));
    res.json(items.map(({ collection, cover, date }) => ({
      collection: { id: collection.id, name: collection.name, location: collection.location, poem: collection.poem, description: collection.description, date: collection.date },
      cover: cover ? publicAsset(store, cover) : null, date,
    })));
  });
  app.get("/api/collections/:id/photos", (req, res) => {
    const c = requireItem(store, "collection", req.params.id);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const ids = c.photoIds.filter(id => { const p = store.get("photo", id); return p && !p.deleted && !p.deleting; });
    const after = String(req.query.cursor || "");
    if (after && !ids.includes(after)) return res.status(409).json({ error: "作品集已更新，请重新打开" });
    const start = after ? ids.indexOf(after) + 1 : 0;
    const slice = ids.slice(start, start + limit);
    res.json({ collection: { id: c.id, name: c.name, location: c.location, date: c.date, poem: c.poem, description: c.description }, items: slice.map(id => publicAsset(store, store.get("photo", id))), total: ids.length, nextCursor: start + slice.length < ids.length ? slice.at(-1) : null });
  });
  app.get("/api/assets", (req, res) =>
    res.json(
      store
        .photos(LIBRARY)
        .filter((p) => !p.deleted)
        .map((p) => publicAsset(store, p)),
    ),
  );
  app.get("/api/batches", (req, res) =>
    res.json(
      store
        .all("batch")
        .map((b) => ({ ...b, count: entries(store, b.id).length })),
    ),
  );
  app.post("/api/batches", (req, res) => {
    if (!["folder", "upload", "network"].includes(req.body.source))
      throw new Error("导入来源无效");
    res.status(201).json(
      store.put("batch", {
        id: randomUUID(),
        name: String(req.body.name || "新的导入").slice(0, 120),
        source: req.body.source,
        state: "initial",
        direct: !!req.body.direct,
        createdAt: timestamp(),
      }),
    );
  });
  app.post("/api/batches/:id/local", (req, res) => {
    const b = requireItem(store, "batch", req.params.id),
      m = req.body;
    if (b.state !== "initial") throw new Error("此批次已结束导入");
    if (
      !/^[a-f0-9]{64}$/.test(m.hash) ||
      !Number.isFinite(m.size) ||
      m.size < 1 ||
      m.size > 100 * 1024 * 1024 ||
      !Number.isInteger(m.width) ||
      !Number.isInteger(m.height) ||
      m.width < 1 ||
      m.height < 1 ||
      m.width * m.height > 120000000 ||
      !/^[01]{64}$/.test(m.phash)
    )
      throw new Error("照片资料无效");
    let p = store
      .photos(LIBRARY)
      .find((p) => p.hash === m.hash && !p.deleted && !p.deleting);
    if (!p) {
      p = {
        id: randomUUID(),
        projectId: LIBRARY,
        storage: "local",
        direct: b.direct,
        name: String(m.name || "照片.jpg").slice(0, 240),
        hash: m.hash,
        size: m.size,
        width: m.width,
        height: m.height,
        phash: m.phash,
        takenAt:
          typeof m.takenAt === "string" && !isNaN(Date.parse(m.takenAt))
            ? new Date(m.takenAt).toISOString()
            : null,
        importedAt: timestamp(),
        status: "unseen",
        finalStatus: "unseen",
        analysisStatus: "done",
        aiStatus: "idle",
        faces: [],
        manualTags: [],
        issues: Array.isArray(m.issues)
          ? m.issues.filter((v) => typeof v === "string").slice(0, 4)
          : [],
      };
      for (const key of ["camera", "lens"])
        p[key] = String(m[key] || "").slice(0, 150);
      for (const key of [
        "focal",
        "equivalent",
        "aperture",
        "shutter",
        "iso",
        "sharpness",
      ])
        p[key] = Number.isFinite(m[key]) ? m[key] : null;
      p.focalCategory = focalCategory(p.equivalent, p.focal);
      store.put("photo", p);
    }
    addEntry(store, b.id, p.id, b.direct);
    const own = new Set(entries(store, b.id).map((e) => e.assetId));
    const current = store.get("photo", p.id);
    const previous = store
      .photos(LIBRARY)
      .filter((v) => own.has(v.id) && v.id !== p.id);
    const representative = previous
      .filter((v) => v.similarId === "similar-" + v.id)
      .slice(-300)
      .find(
        (v) =>
          (!v.takenAt ||
            !current.takenAt ||
            Math.abs(Date.parse(v.takenAt) - Date.parse(current.takenAt)) <=
              1800000) &&
          hamming(v.phash, current.phash) <= 7,
      );
    const last = previous.at(-1);
    store.put("photo", {
      ...current,
      similarId:
        current.similarId || representative?.similarId || "similar-" + p.id,
      sceneId:
        current.sceneId ||
        (last &&
        last.takenAt &&
        current.takenAt &&
        Math.abs(Date.parse(last.takenAt) - Date.parse(current.takenAt)) <
          1800000
          ? last.sceneId
          : "scene-" + p.id),
    });
    res.status(201).json(publicAsset(store, store.get("photo", p.id)));
  });
  app.get("/api/batches/:id/photos", (req, res) => {
    requireItem(store, "batch", req.params.id);
    res.json(
      entries(store, req.params.id).map((e) => ({
        ...publicAsset(store, requireItem(store, "photo", e.assetId)),
        status: e.status,
        finalStatus: e.finalStatus,
        entryId: e.id,
        cleaned: e.cleaned,
        cleanupAt: e.cleanupAt,
      })),
    );
  });
  const uploads = new Map();
  app.post(
    "/api/batches/:id/import",
    upload.array("photos", 20),
    async (req, res) => {
      try {
        const batch = requireItem(store, "batch", req.params.id);
        if (batch.state !== "initial") throw new Error("此批次已结束导入");
        const results = [];
        for (const f of req.files || []) {
          try {
            const uploadId = String(req.body.uploadId || "");
            if (uploadId && (!/^[a-zA-Z0-9-]{8,100}$/.test(uploadId) || req.files.length !== 1)) throw new Error("上传标识无效");
            const key = uploadId ? batch.id+":"+uploadId : "";
            const hash = uploadId ? await digest(f.path) : null;
            const perform = async () => {
              const old = key && store.get("uploadReceipt",key);
              if (old) {
                if (old.hash !== hash) throw new Error("同一上传标识不能用于不同文件");
                const p = requireItem(store,"photo",old.assetId);
                if (p.deleted || p.deleting) throw new Error("照片已清理，请重新导入");
                return {photo:publicAsset(store,p)};
              }
              const p = await importPhoto(store, LIBRARY, f.path, Buffer.from(f.originalname, "latin1").toString("utf8"),req.body.lastModified);
              store.transaction(()=>{
                store.put("photo", { ...p, storage: "server", direct: batch.direct });
                addEntry(store, batch.id, p.id, batch.direct);
                if(key) store.put("uploadReceipt",{id:key,assetId:p.id,hash,createdAt:timestamp()});
              });
              onImport(p);
              return { photo: publicAsset(store, store.get("photo", p.id)) };
            };
            if (key && uploads.has(key)) await uploads.get(key);
            const task=perform(); if(key) uploads.set(key,task);
            try { results.push(await task); } finally { if(key) uploads.delete(key); }

          } catch (error) {
            results.push({ error: error.message });
          }
        }
        res.json({ results });
      } finally {
        for (const f of req.files || []) await unlink(f.path).catch(() => {});
      }
    },
  );
  app.patch("/api/batches/:id/decisions", (req, res) => {
    const batch = requireItem(store, "batch", req.params.id),
      { round, status, ids } = req.body;
    if (
      !["initial", "final"].includes(round) ||
      !["unseen", "maybe", "keep", "reject"].includes(status) ||
      (round === "final" && status === "maybe")
    )
      throw new Error("筛选决定无效");
    if (!Array.isArray(ids) || !ids.length) throw new Error("请选择照片");
    const own = new Map(entries(store, batch.id).map((e) => [e.assetId, e]));
    const selected = [...new Set(ids)].map((id) => own.get(id));
    if (
      selected.some(
        (e) => !e || e.cleaned || store.get("photo",e.assetId)?.deleting || store.get("photo",e.assetId)?.deleted || (round === "final" && !inInitial(e)),
      )
    )
      throw new Error("照片不在当前筛选范围");
    store.transaction(() => {
      store.put("batchUndo", {
        id: randomUUID(),
        batchId: batch.id,
        entries: selected,
        createdAt: timestamp(),
      });
      for (const e of selected) {
        const updated = store.put("entry", { ...e, [round === "final" ? "finalStatus" : "status"]: status });
        if(round === "initial") syncRetention(store,updated,e);
      }
      if(batch.state==="completed" && round==="initial" && status!=="reject") store.put("batch",{...batch,state:status==="unseen"?"initial":"refining"});
      if(round==="initial" && status==="unseen") store.put("batch",{...batch,state:"initial"});
      reconcileMany(store, selected.map((e) => e.assetId));
    });
    res.json({ ok: true });
  });
  app.post("/api/batches/:id/undo", (req, res) => {
    const b = requireItem(store, "batch", req.params.id);
    const last = store
      .all("batchUndo")
      .filter((h) => h.batchId === b.id)
      .at(-1);
    if (!last || last.entries.some((e) => store.get("entry", e.id)?.cleaned || store.get("photo",e.assetId)?.deleting || store.get("photo",e.assetId)?.deleted))
      return res.json({ ok: false });
    store.transaction(() => {
      for (const e of last.entries) {
        const current=store.get("entry",e.id);
        store.put("entry", e);
        syncRetention(store,e,current);
      }
      reconcileMany(
        store,
        last.entries.map((e) => e.assetId),
      );
      store.remove("batchUndo", last.id);
      store.put("batch",{...b,state:last.entries.some(e=>e.status==="unseen")?"initial":"refining"});
    });
    res.json({ ok: true, ids: last.entries.map((e) => e.assetId) });
  });
  app.get("/api/collections", (req, res) =>
    res.json(store.all("collection").filter((c) => c.projectId === LIBRARY)),
  );
  app.post("/api/collections", (req, res) =>
    res.status(201).json(
      store.put("collection", {
        id: randomUUID(),
        projectId: LIBRARY,
        name: String(req.body.name || "未命名作品集").slice(0, 120),
        ...collectionDetails(req.body),
        photoIds: [],
        lockedIds: [],
        createdAt: timestamp(),
      }),
    ),
  );
  app.put("/api/collections/:id", (req, res) => {
    const old = requireItem(store, "collection", req.params.id);
    const ids = [...new Set(req.body.photoIds || old.photoIds)];
    if (
      ids.some((id) => {
        const p = requireItem(store, "photo", id);
        return p.deleted || p.deleting || !inFinal(p);
      })
    )
      throw new Error("请先完成精筛");
    const value = {
      ...old,
      name: String(req.body.name ?? old.name).slice(0, 120),
      ...collectionDetails(req.body, old),
      photoIds: ids,
      coverId: ids.includes(req.body.coverId)
        ? req.body.coverId
        : ids.includes(old.coverId)
          ? old.coverId
          : ids[0] || null,
    };
    store.transaction(() => {
      store.put("collection", value);
      reconcileMany(store, [...old.photoIds, ...ids]);
    });
    res.json(value);
  });
}
