import path from "node:path";
import { syncRetention } from "./retention.mjs";
import { unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { entries, requireItem, reconcileMany, timestamp } from "./library.mjs";
import { inInitial } from "../shared/domain.mjs";
export function activeReference(store, id) {
  const automatic = store.get("analysisTask", id);
  if (automatic?.state === "running") return true;
  const ai = store.get("job", "ai");
  if (ai && [...(ai.photoIds || []), ...(ai.runningIds || [])].includes(id))
    return true;
  for (const kind of ["vocabularyJob", "creationJob"])
    for (const j of store.all(kind))
      if (
        !["done", "confirmed", "cancelled"].includes(j.state) &&
        [...(j.photoIds || []), ...(j.sampleIds || [])].includes(id)
      )
        return true;
  return false;
}
export function keptReference(store, id, exceptBatch) {
  return (
    store.all("collection").some((c) => c.photoIds.includes(id)) ||
    store.all("creation").some((c) => (c.sourceIds || []).includes(id)) ||
    store
      .all("share")
      .some(
        (s) =>
          ["preparing", "active"].includes(s.state) &&
          (!s.expiresAt || Date.parse(s.expiresAt) > Date.now()) &&
          s.assetIds.includes(id),
      ) ||
    store
      .all("entry")
      .some(
        (e) =>
          e.assetId === id &&
          e.batchId !== exceptBatch &&
          !e.cleaned &&
          e.status !== "reject",
      )
  );
}
export class CleanupQueue {
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.running = false;
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (const task of this.store.all("cleanup")) {
        if (["done", "cancelled"].includes(task.state)) continue;
        if (task.dueAt && Date.parse(task.dueAt) > this.now()) continue;
        if (task.entryId) {
          const entry = this.store.get("entry", task.entryId);
          if (
            !entry ||
            entry.status !== "reject" ||
            entry.cleaned ||
            entry.cleanupAt !== task.dueAt
          ) {
            this.store.put("cleanup", { ...task, state: "cancelled" });
            continue;
          }
        }
        const p = this.store.get("photo", task.assetId);
        if (!p) {
          this.store.put("cleanup", { ...task, state: "done" });
          continue;
        }
        if (
          activeReference(this.store, p.id) ||
          p.analysisStatus === "running" ||
          p.analysisStatus === "pending"
        ) {
          this.store.put("cleanup", {
            ...task,
            state: "waiting",
            error: "等待分析任务结束",
          });
          continue;
        }
        if (
          task.kind === "discard" &&
          keptReference(this.store, p.id, task.batchId)
        ) {
          this.store.put("cleanup", {
            ...task,
            state: "waiting",
            protected: true,
            error: "照片仍被其他内容使用",
          });
          continue;
        }
        this.store.put("photo", { ...p, deleting: true });
        try {
          let bytes = task.bytes || 0;
          const files = [
            "originals",
            "previews",
            "thumbs",
            "analysis-previews",
          ].map((folder) => path.join(this.store.root, folder, p.id + ".jpg"));
          if (p.originalExtension && p.originalExtension !== "jpg")
            files.push(
              path.join(
                this.store.root,
                "source-files",
                p.id + "." + p.originalExtension,
              ),
            );
          for (const file of files) {
            try {
              const info = await stat(file);
              await unlink(file);
              bytes += info.size;
              this.store.put("cleanup", { ...task, state: "running", bytes });
            } catch (e) {
              if (e.code !== "ENOENT") throw e;
            }
          }
          this.store.transaction(() => {
            if (task.kind === "discard") {
              for (const e of this.store
                .all("entry")
                .filter((e) => e.assetId === p.id && e.status === "reject"))
                this.store.put("entry", { ...e, cleaned: true });
              for (const h of this.store.all("batchUndo"))
                if (h.entries.some((e) => e.assetId === p.id))
                  this.store.remove("batchUndo", h.id);
            }
            this.store.put("cleanup", {
              ...task,
              state: "done",
              bytes,
              completedAt: timestamp(),
            });
            this.store.put("photo", {
              ...this.store.get("photo", p.id),
              deleting: false,
              ...(task.kind === "discard" ? { deleted: true } : {}),
            });
          });
        } catch (e) {
          this.store.put("cleanup", {
            ...this.store.get("cleanup", task.id),
            state: "error",
            error: e.message,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
export function registerCleanup(app, store) {
  if (!store.get("migration", "three-hour-retention")) {
    if (store.all("entry").length)
      store.db
        .prepare("VACUUM INTO ?")
        .run(path.join(store.root, `before-retention-${Date.now()}.sqlite`));
    store.transaction(() => {
      for (const task of store.all("cleanup"))
        if (
          task.kind === "discard" &&
          task.state !== "done" &&
          !store.get("photo", task.assetId)?.deleting
        )
          store.put("cleanup", { ...task, state: "cancelled" });
      for (const e of store.all("entry")) {
        const p = store.get("photo", e.assetId);
        if (e.status === "reject" && p && !p.deleted && !p.deleting)
          syncRetention(store, { ...e, cleaned: false }, null);
      }
      store.put("migration", { id: "three-hour-retention", at: timestamp() });
    });
  }
  const queue = new CleanupQueue(store);
  app.locals.cleanupQueue = queue;
  void queue.drain();
  const timer = setInterval(() => void queue.drain(), 60000);
  timer.unref();
  queue.close = () => clearInterval(timer);
  app.get("/api/cleanup-jobs", (req, res) => res.json(store.all("cleanup")));
  app.post("/api/cleanup-jobs/retry", (req, res) => {
    void queue.drain();
    res.json({ ok: true });
  });
  app.post("/api/batches/:id/finish", (req, res) => {
    const b = requireItem(store, "batch", req.params.id),
      round = req.body.round,
      list = entries(store, b.id);
    if (!["initial", "final"].includes(round)) throw new Error("阶段无效");
    if (round === "final" && b.state === "initial")
      throw new Error("请先完成初筛，再完成精筛");
    if (
      b.state === "completed" ||
      (round === "initial" && b.state !== "initial")
    )
      throw new Error("该阶段已完成");
    if (
      store
        .all("networkJob")
        .some(
          (j) =>
            j.batchId === b.id &&
            ["running", "paused", "error"].includes(j.state),
        )
    )
      throw new Error("请先完成或取消网络导入");
    const relevant = round === "initial" ? list : list.filter(inInitial);
    if (
      !relevant.length ||
      relevant.some(
        (e) => e[round === "initial" ? "status" : "finalStatus"] === "unseen",
      )
    )
      throw new Error("还有未处理照片，不能完成筛选");
    if (
      round === "final" &&
      b.source === "network" &&
      relevant.some(
        (e) =>
          e.finalStatus === "keep" &&
          store.get("photo", e.assetId)?.storage !== "local",
      )
    )
      throw new Error("请先把入选照片保存到电脑文件夹");
    store.transaction(() => {
      store.put("batch", {
        ...b,
        state:
          round === "initial" && list.some(inInitial)
            ? "refining"
            : "completed",
      });
      reconcileMany(
        store,
        relevant.map((e) => e.assetId),
      );
    });
    void queue.drain();
    res.json({ ok: true });
  });
  app.post("/api/assets/:id/local-receipt", (req, res) => {
    const p = requireItem(store, "photo", req.params.id);
    if (
      !p.network ||
      !inInitial(p) ||
      p.deleting ||
      p.deleted ||
      req.body.hash !== p.hash ||
      req.body.size !== p.size
    )
      throw new Error("本地文件校验未通过");
    const { originalPath, ...rest } = p;
    store.put("photo", {
      ...rest,
      storage: "local",
      savedLocallyAt: timestamp(),
    });
    store.put("cleanup", {
      id: randomUUID(),
      kind: "handoff",
      assetId: p.id,
      state: "pending",
      bytes: 0,
      createdAt: timestamp(),
    });
    void queue.drain();
    res.json({ ok: true });
  });
  return queue;
}
