import { randomUUID } from "node:crypto";
import {
  focalCategory,
  inInitial,
  decisionField,
  tagsOf,
} from "../shared/domain.mjs";
const allowed = ["status", "favorite", "manualTags"];
export class History {
  constructor(store) {
    this.store = store;
  }
  apply(projectId, changes, label) {
    return this.store.transaction(() => {
      const before = changes.map(({ kind, value, fields }) => {
        const old = this.store.get(kind, value.id);
        return { kind, id: value.id, fields, value: old };
      });
      for (const { kind, value } of changes) this.store.put(kind, value);
      const log = this.store.get("history", projectId) || {
        id: projectId,
        entries: [],
      };
      log.entries.push({ before, label });
      log.entries = log.entries.slice(-30);
      this.store.put("history", log);
      return changes.map((c) => c.value);
    });
  }
  undo(projectId) {
    return this.store.transaction(() => {
      const log = this.store.get("history", projectId);
      const entry = log?.entries.pop();
      if (!entry) return { ok: false };
      for (const old of entry.before) {
        if (!old.value) this.store.remove(old.kind, old.id);
        else if (old.fields) {
          const current = this.store.get(old.kind, old.id);
          for (const field of old.fields)
            current[field] = old.value[field] ?? null;
          this.store.put(old.kind, current);
        } else this.store.put(old.kind, old.value);
      }
      this.store.put("history", log);
      return { ok: true, label: entry.label };
    });
  }
}
export function registerCuration(app, store) {
  const history = new History(store);
  app.locals.history = history;
  const photos = (projectId, ids) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000)
      throw new Error("请选择照片");
    return ids.map((id) => {
      const p = store.get("photo", id);
      if (!p || p.projectId !== projectId)
        throw new Error("照片不属于当前项目");
      return p;
    });
  };
  app.post("/api/projects/:id/undo", (req, res) =>
    res.json(history.undo(req.params.id)),
  );
  app.patch("/api/projects/:id", (req, res) => {
    const project = store.get("project", req.params.id);
    if (!project) throw new Error("项目不存在");
    const factor =
      req.body.cropFactor == null ? null : Number(req.body.cropFactor);
    if (
      factor !== null &&
      (!Number.isFinite(factor) || factor <= 0 || factor > 5)
    )
      throw new Error("画幅系数应在 0–5 之间");
    const value = {
      ...project,
      name: String(req.body.name || project.name).slice(0, 120),
      cropFactor: factor,
    };
    const changes = [{ kind: "project", value }];
    for (const p of store.photos(project.id))
      changes.push({
        kind: "photo",
        fields: ["focalCategory"],
        value: {
          ...p,
          focalCategory: focalCategory(p.equivalent, p.focal, factor),
        },
      });
    history.apply(project.id, changes, "修改项目");
    res.json(value);
  });
  app.patch("/api/projects/:id/photos", (req, res) => {
    const selected = photos(req.params.id, req.body.ids);
    const patch = {};
    for (const key of allowed)
      if (key in (req.body.patch || {})) patch[key] = req.body.patch[key];
    if (
      "status" in patch &&
      !["unseen", "maybe", "keep", "reject"].includes(patch.status)
    )
      throw new Error("筛选状态无效");
    const round = req.body.round || "initial";
    if (!["initial", "final"].includes(round)) throw new Error("筛选轮次无效");
    if ("status" in patch && round === "final") {
      if (patch.status === "maybe") throw new Error("精筛只支持保留或不要");
      if (selected.some((p) => !inInitial(p))) throw new Error("请先完成粗筛");
      patch[decisionField(round)] = patch.status;
      delete patch.status;
    }
    if ("favorite" in patch && typeof patch.favorite !== "boolean")
      throw new Error("收藏状态无效");
    if ("manualTags" in patch) {
      if (selected.some((p) => !inInitial(p)))
        throw new Error("只能为初筛入选照片分类");
      if (!Array.isArray(patch.manualTags)) throw new Error("标签格式无效");
      patch.manualTags = [
        ...new Set(
          patch.manualTags
            .map((v) => String(v).trim().slice(0, 40))
            .filter(Boolean),
        ),
      ].slice(0, 30);
    }
    history.apply(
      req.params.id,
      selected.map((p) => {
        const changes = { ...patch };
        if ("manualTags" in patch)
          changes.excludedTags = [
            ...new Set([
              ...(p.excludedTags || []),
              ...tagsOf(p).filter((t) => !patch.manualTags.includes(t)),
            ]),
          ].filter((t) => !patch.manualTags.includes(t));
        return {
          kind: "photo",
          fields: Object.keys(changes),
          value: { ...p, ...changes },
        };
      }),
      `${round === "final" ? "精筛" : "初筛"}决定`,
    );
    res.json({ ok: true });
  });
  app.get("/api/projects/:id/groups", (req, res) =>
    res.json(store.all("group").filter((g) => g.projectId === req.params.id)),
  );
  app.post("/api/projects/:id/groups", (req, res) => {
    const selected = photos(req.params.id, req.body.ids);
    const type = req.body.type === "scene" ? "scene" : "similar";
    const field = type === "scene" ? "sceneId" : "similarId",
      manual = type === "scene" ? "sceneManual" : "groupManual";
    const split = req.body.action === "split";
    const id = type + "-" + randomUUID();
    const changes = selected.map((p) => ({
      kind: "photo",
      fields: [field, manual],
      value: {
        ...p,
        [field]: split ? type + "-" + randomUUID() : id,
        [manual]: true,
      },
    }));
    if (!split)
      changes.push({
        kind: "group",
        value: {
          id,
          projectId: req.params.id,
          type,
          name: String(req.body.name || "自定义分组").slice(0, 80),
          representative: req.body.representative || selected[0].id,
        },
      });
    history.apply(req.params.id, changes, split ? "拆分照片组" : "合并照片组");
    res.json({ ok: true, id });
  });
  app.put("/api/projects/:id/groups/:groupId", (req, res) => {
    const members = store
      .photos(req.params.id)
      .filter(
        (p) =>
          p.similarId === req.params.groupId ||
          p.sceneId === req.params.groupId,
      );
    if (!members.length) throw new Error("分组不存在");
    if (
      req.body.representative &&
      !members.some((p) => p.id === req.body.representative)
    )
      throw new Error("代表图必须属于分组");
    const old = store.get("group", req.params.groupId) || {
      id: req.params.groupId,
      projectId: req.params.id,
    };
    const value = {
      ...old,
      name: String(req.body.name || old.name || "场景").slice(0, 80),
      representative: req.body.representative || old.representative,
    };
    history.apply(req.params.id, [{ kind: "group", value }], "修改照片组");
    res.json(value);
  });
  app.get("/api/projects/:id/collections", (req, res) =>
    res.json(
      store.all("collection").filter((c) => c.projectId === req.params.id),
    ),
  );
  app.post("/api/projects/:id/collections", (req, res) => {
    const ids = req.body.photoIds || [];
    if (ids.length) photos(req.params.id, ids);
    const value = {
      id: randomUUID(),
      projectId: req.params.id,
      name: String(req.body.name || "新的作品集").slice(0, 80),
      photoIds: [...new Set(ids)],
      lockedIds: [],
    };
    history.apply(req.params.id, [{ kind: "collection", value }], "创建作品集");
    res.status(201).json(value);
  });
  app.put("/api/projects/:id/collections/:collectionId", (req, res) => {
    const old = store.get("collection", req.params.collectionId);
    if (!old || old.projectId !== req.params.id)
      throw new Error("作品集不存在");
    const ids = req.body.photoIds || old.photoIds;
    if (ids.length) photos(req.params.id, ids);
    const locks = req.body.lockedIds || old.lockedIds;
    const value = {
      ...old,
      name: String(req.body.name || old.name).slice(0, 80),
      photoIds: [...new Set(ids)],
      lockedIds: [...new Set(locks)].filter((id) => ids.includes(id)),
    };
    history.apply(req.params.id, [{ kind: "collection", value }], "编辑作品集");
    res.json(value);
  });
}
