import path from "node:path";
import { unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { entries, requireItem, reconcile, timestamp } from "./library.mjs";
import { inInitial } from "../shared/domain.mjs";
export function activeReference(store, id) {
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
    store
      .all("share")
      .some((s) => s.state === "active" && s.assetIds.includes(id)) ||
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
  constructor(store) {
    this.store = store;
    this.running = false;
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (const task of this.store.all("cleanup")) {
        if (task.state === "done") continue;
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
            state: "done",
            protected: true,
          });
          continue;
        }
        this.store.put("photo", { ...p, deleting: true });
        try {
          let bytes = task.bytes || 0;
          for (const folder of [
            "originals",
            "previews",
            "thumbs",
            "analysis-previews",
          ]) {
            const file = path.join(this.store.root, folder, p.id + ".jpg");
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
            ...task,
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
  const queue = new CleanupQueue(store);
  app.locals.cleanupQueue = queue;
  void queue.drain();
  const timer = setInterval(() => void queue.drain(), 5000);
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
      for (const e of relevant.filter(
        (e) => e[round === "initial" ? "status" : "finalStatus"] === "reject",
      )) {
        store.put("entry", { ...e, cleaned: true });
        store.put("cleanup", {
          id: randomUUID(),
          kind: "discard",
          assetId: e.assetId,
          batchId: b.id,
          state: "pending",
          bytes: 0,
          createdAt: timestamp(),
        });
      }
      for (const h of store.all("batchUndo").filter((h) => h.batchId === b.id))
        store.remove("batchUndo", h.id);
      store.put("batch", {
        ...b,
        state: round === "initial" ? "refining" : "completed",
      });
      for (const e of relevant) reconcile(store, e.assetId);
    });
    void queue.drain();
    res.json({ ok: true });
  });
  app.post("/api/assets/:id/local-receipt", (req, res) => {
    const p = requireItem(store, "photo", req.params.id);
    if (
      !p.network ||
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
