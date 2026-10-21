import { localPreviewSource } from "./images.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { access } from "node:fs/promises";
import { inInitial } from "../shared/domain.mjs";
import { structuredTags, tagCategory } from "../shared/tags.mjs";
import { tagLibrary } from "./tags.mjs";
import { descriptionRecord, saveDescription } from "./descriptions.mjs";
import { previewData } from "./images.mjs";
import { scheduler, concurrency, workers } from "./scheduler.mjs";
const eligible = (p) => p && inInitial(p) && !p.deleted && !p.deleting;
const hasTags = (p) => {
  const tags = p?.ai?.tags;
  return (
    Array.isArray(tags) &&
    tags.length <= 7 &&
    tags.filter((t) => tagCategory(t) === "主体").length === 1 &&
    tags.filter((t) => tagCategory(t) === "景别").length === 1
  );
};
const complete = (store, p) => hasTags(p) && !!descriptionRecord(store, p);
const terminal = new Set(["done", "cancelled", "skipped"]);
export class AutomaticAI {
  constructor(store, vault, clientFactory, { clock = () => Date.now() } = {}) {
    this.store = store;
    this.vault = vault;
    this.clientFactory = clientFactory;
    this.clock = clock;
    this.running = false;
    this.closed = false;
    this.control = store.get("settings", "automatic-ai") || {
      id: "automatic-ai",
      paused: false,
    };
    this.controllers = new Map();
    for (const task of store.all("analysisTask"))
      if (task.state === "running")
        store.put("analysisTask", { ...task, state: "pending" });
  }
  capture(p, force = false) {
    const old = this.store.get("analysisTask", p.id);
    if (!eligible(p)) {
      if (old && !terminal.has(old.state)) {
        this.store.put("analysisTask", { ...old, state: "skipped" });
        this.controllers.get(p.id)?.abort();
      }
      return;
    }
    const legacy = this.store.get("job", "ai");
    if (
      !force &&
      (complete(this.store, p) ||
        (old && old.state !== "skipped") ||
        legacy?.photoIds?.includes(p.id) ||
        legacy?.runningIds?.includes(p.id))
    )
      return;
    this.controllers.get(p.id)?.abort();
    const config = this.store.get("settings", "ai");
    const library = tagLibrary(this.store, p.projectId);
    this.store.put("analysisTask", {
      id: p.id,
      generation: randomUUID(),
      projectId: p.projectId,
      state: config ? "pending" : "waiting-config",
      force,
      photoHash: p.hash,
      config: config ? structuredClone(config) : null,
      vocabulary: {
        version: library.version,
        schemaVersion: 2,
        tags: structuredTags(library.tags),
      },
      createdAt: new Date(this.clock()).toISOString(),
    });
    if (
      this.ready &&
      config &&
      (p.storage !== "local" || p.displayReady) &&
      !this.ready.includes(p.id)
    )
      this.ready.push(p.id);
  }
  captureMany(ids, force = false) {
    for (const id of new Set(ids)) {
      const p = this.store.get("photo", id);
      if (p) this.capture(p, force);
    }
  }
  async drain() {
    if (this.running || this.closed || this.control.paused) return;
    this.running = true;
    try {
      const ready = [];
      this.ready = ready;
      for (let task of this.store.all("analysisTask")) {
        if (
          !["pending", "waiting-config", "waiting-media"].includes(task.state)
        )
          continue;
        const p = this.store.get("photo", task.id);
        if (!eligible(p)) {
          this.store.put("analysisTask", { ...task, state: "skipped" });
          continue;
        }
        if (!task.force && complete(this.store, p)) {
          this.store.put("analysisTask", { ...task, state: "done" });
          continue;
        }
        if (!task.config) {
          const config = this.store.get("settings", "ai");
          if (!config) continue;
          task = { ...task, config: structuredClone(config), state: "pending" };
          this.store.put("analysisTask", task);
        }
        if (p.storage === "local") {
          try {
            await localPreviewSource(this.store, p.id);
          } catch {
            this.store.put("analysisTask", { ...task, state: "waiting-media" });
            continue;
          }
        }
        ready.push(task.id);
      }
      let index = 0;
      await workers(
        concurrency(this.store.get("settings", "ai")?.analysisConcurrency, 8),
        () => (!this.control.paused && !this.closed ? ready[index++] : null),
        async (id) => {
          let task = this.store.get("analysisTask", id);
          if (
            !task ||
            !["pending", "waiting-media", "waiting-config"].includes(task.state)
          )
            return;
          const before = this.store.get("photo", id);
          if (!eligible(before)) return;
          const controller = new AbortController();
          this.controllers.set(id, controller);
          this.store.put("analysisTask", {
            ...task,
            state: "running",
            error: null,
          });
          this.store.put("photo", {
            ...before,
            aiStatus: "running",
            aiError: null,
          });
          let client;
          try {
            await scheduler.run(
              `description:${this.store.root}:${id}`,
              1,
              controller.signal,
              async () => {
                if (
                  !task.force &&
                  complete(this.store, this.store.get("photo", id))
                ) {
                  this.store.put("analysisTask", {
                    ...this.store.get("analysisTask", id),
                    state: "done",
                  });
                  return;
                }
                client = this.clientFactory(
                  task.config,
                  await this.vault.get(task.config),
                );
                const image = await previewData(this.store, id);
                if (controller.signal.aborted) return;
                const result = await client.analyze(image, {
                  signal: controller.signal,
                  vocabulary: task.vocabulary,
                });
                if (controller.signal.aborted || this.closed) return;
                const current = this.store.get("photo", id),
                  latest = this.store.get("analysisTask", id);
                if (
                  !eligible(current) ||
                  current.hash !== task.photoHash ||
                  latest?.state !== "running" ||
                  latest.generation !== task.generation
                ) {
                  if (latest?.generation === task.generation)
                    this.store.put("analysisTask", {
                      ...latest,
                      state: "skipped",
                    });
                  return;
                }
                this.store.transaction(() => {
                  const description = descriptionRecord(this.store, current);
                  const ai =
                    !task.force && hasTags(current)
                      ? {
                          ...current.ai,
                          description: description?.text || result.description,
                        }
                      : {
                          ...result,
                          description: description?.text || result.description,
                        };
                  this.store.put("photo", {
                    ...current,
                    ai,
                    aiStatus: "done",
                    aiError: null,
                  });
                  if (!description)
                    saveDescription(this.store, current, result, task.config);
                  this.store.put("analysisTask", {
                    ...latest,
                    state: "done",
                    completedAt: new Date(this.clock()).toISOString(),
                    usage: client.usage,
                  });
                });
              },
            );
          } catch (e) {
            if (controller.signal.aborted || this.closed) return;
            const current = this.store.get("photo", id);
            this.store.put("analysisTask", {
              ...this.store.get("analysisTask", id),
              state: "error",
              error: e.message,
            });
            if (current)
              this.store.put("photo", {
                ...current,
                aiStatus: "error",
                aiError: e.message,
              });
            if (e.auth) {
              this.control = {
                ...this.control,
                paused: true,
                error: e.message,
              };
              this.store.put("settings", this.control);
            }
          } finally {
            this.controllers.delete(id);
            const current = this.store.get("photo", id);
            if (
              current?.aiStatus === "running" &&
              this.store.get("analysisTask", id)?.state !== "running"
            )
              this.store.put("photo", {
                ...current,
                aiStatus: current.ai ? "done" : "idle",
              });
          }
        },
      );
    } finally {
      this.running = false;
      this.ready = null;
    }
  }
  state() {
    const tasks = this.store
      .all("analysisTask")
      .filter((t) => !["skipped", "cancelled"].includes(t.state));
    const pending = tasks.filter((t) => !["done", "error"].includes(t.state));
    return {
      projectId: "library",
      total: tasks.length,
      done: tasks.filter((t) => t.state === "done").length,
      errors: tasks.filter((t) => t.state === "error").length,
      photoIds: pending.map((t) => t.id),
      runningIds: [...this.controllers.keys()],
      paused: this.control.paused,
      error:
        this.control.error ||
        (pending.some((t) => t.state === "waiting-config")
          ? "等待配置 AI 服务"
          : pending.some((t) => t.state === "waiting-media")
            ? "等待在原电脑连接文件夹"
            : ""),
      waitingMedia: pending
        .filter((t) => t.state === "waiting-media")
        .map((t) => t.id),
    };
  }
  action(action) {
    if (action === "pause") this.control = { ...this.control, paused: true };
    else if (action === "resume" || action === "retry") {
      this.control = { ...this.control, paused: false, error: null };
      if (action === "retry")
        for (const task of this.store.all("analysisTask"))
          if (task.state === "error")
            this.store.put("analysisTask", {
              ...task,
              state: "pending",
              error: null,
            });
    } else if (action === "cancel") {
      for (const task of this.store.all("analysisTask"))
        if (!terminal.has(task.state))
          this.store.put("analysisTask", { ...task, state: "cancelled" });
      for (const controller of this.controllers.values()) controller.abort();
    } else throw new Error("未知操作");
    this.store.put("settings", this.control);
    void this.drain();
    return this.state();
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.controllers.values()) c.abort();
  }
}
export function registerAutomaticAI(app, store, vault, clientFactory) {
  const queue = new AutomaticAI(store, vault, clientFactory);
  app.locals.automaticAI = queue;
  store.onEligibilityChange = (ids) => {
    queue.captureMany(ids);
    queueMicrotask(() => {
      if (!queue.closed) void queue.drain();
    });
  };
  store.transaction(() =>
    queue.captureMany(store.photos("library").map((p) => p.id)),
  );
  queue.timer = setInterval(() => void queue.drain(), 1000);
  queue.timer.unref();
  void queue.drain();
  app.post("/api/automatic-ai/:action", (req, res) =>
    res.json(queue.action(req.params.action)),
  );
  app.get("/api/automatic-ai", (_req, res) => res.json(queue.state()));
  app.post("/api/settings/classification/reanalyze", (req, res) => {
    if (queue.running || queue.state().photoIds.length)
      throw new Error("请先完成或取消当前分类任务");
    const photos = store.photos("library").filter(eligible);
    if (!photos.length) throw new Error("没有入选照片");
    store.transaction(() =>
      queue.captureMany(
        photos.map((p) => p.id),
        true,
      ),
    );
    queue.action("resume");
    res.json(queue.state());
  });
  return queue;
}
