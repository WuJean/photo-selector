import { DEFAULT_TAGS, normalizeTags } from "../shared/tags.mjs";
import { tagsOf } from "../shared/domain.mjs";
export function tagLibrary(store, projectId) {
  if (!store.get("project", projectId)) throw new Error("项目不存在");
  const old = store.get("tagLibrary", projectId);
  if (old) return old;
  const tags = normalizeTags(
    [
      ...DEFAULT_TAGS,
      ...(store.get("settings", "common-tags")?.tags || []),
      ...store
        .photos(projectId)
        .flatMap(tagsOf)
        .filter((name) => !DEFAULT_TAGS.some((t) => t.name === name)),
    ].slice(0, 100),
  );
  return store.put("tagLibrary", {
    id: projectId,
    projectId,
    version: 1,
    tags,
  });
}
export function registerTags(app, store) {
  const apply = (projectId, changes, label) =>
    app.locals.history.apply(projectId, changes, label);
  app.get("/api/projects/:id/tags", (req, res) =>
    res.json(tagLibrary(store, req.params.id)),
  );
  app.put("/api/projects/:id/tags", (req, res) => {
    const old = tagLibrary(store, req.params.id);
    if (req.body.version !== old.version)
      throw Object.assign(new Error("标签库已更新，请重新打开"), {
        status: 409,
      });
    const tags = normalizeTags(req.body.tags);
    const value = { ...old, version: old.version + 1, tags };
    const names = new Set(tags.map((t) => t.name)),
      removed = old.tags.filter((t) => !names.has(t.name)).map((t) => t.name);
    const changes = [{ kind: "tagLibrary", value }];
    if (removed.length)
      for (const p of store.photos(req.params.id))
        changes.push({
          kind: "photo",
          fields: ["manualTags", "excludedTags"],
          value: {
            ...p,
            manualTags: (p.manualTags || []).filter(
              (t) => !removed.includes(t),
            ),
            excludedTags: [...new Set([...(p.excludedTags || []), ...removed])],
          },
        });
    apply(req.params.id, changes, "编辑标签库");
    res.json(value);
  });
  app.post(
    [
      "/api/projects/:id/tags/assign",
      "/api/projects/:id/tags/clear",
      "/api/projects/:id/tags/rename",
    ],
    (req, res) => {
      res.status(403).json({ error: "照片标签仅由 AI 分类生成" });
    },
  );
  app.post("/api/projects/:id/tags/common", (req, res) => {
    const library = tagLibrary(store, req.params.id);
    const selected = library.tags.filter((t) =>
      req.body.names?.includes(t.name),
    );
    const old = store.get("settings", "common-tags")?.tags || [];
    store.put("settings", {
      id: "common-tags",
      tags: normalizeTags([...old, ...selected].slice(0, 100)),
    });
    res.json({ ok: true });
  });
}
