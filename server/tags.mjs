import { DEFAULT_TAGS, normalizeTags } from "../shared/tags.mjs";
import { inInitial, tagsOf } from "../shared/domain.mjs";
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
  app.post("/api/projects/:id/tags/assign", (req, res) => {
    const library = tagLibrary(store, req.params.id),
      name = String(req.body.name || "");
    if (!library.tags.some((t) => t.name === name))
      throw new Error("标签不在当前标签库");
    if (
      !Array.isArray(req.body.ids) ||
      !req.body.ids.length ||
      req.body.ids.length > 5000 ||
      typeof req.body.enabled !== "boolean"
    )
      throw new Error("请选择照片和标签");
    const photos = [...new Set(req.body.ids)].map((id) =>
      store.get("photo", id),
    );
    if (
      photos.some((p) => !p || p.projectId !== req.params.id || !inInitial(p))
    )
      throw new Error("只能为初筛入选照片分类");
    const enabled = req.body.enabled;
    apply(
      req.params.id,
      photos.map((p) => ({
        kind: "photo",
        fields: ["manualTags", "excludedTags"],
        value: {
          ...p,
          manualTags: enabled
            ? [...new Set([...(p.manualTags || []), name])]
            : (p.manualTags || []).filter((t) => t !== name),
          excludedTags: enabled
            ? (p.excludedTags || []).filter((t) => t !== name)
            : [...new Set([...(p.excludedTags || []), name])],
        },
      })),
      "人工分类",
    );
    res.json({ ok: true });
  });
  app.post("/api/projects/:id/tags/rename", (req, res) => {
    const library = tagLibrary(store, req.params.id);
    const from = String(req.body.from || ""),
      to = normalizeTags([req.body.to])[0].name;
    if (!library.tags.some((t) => t.name === from))
      throw new Error("标签不存在");
    const tags = normalizeTags(
      library.tags.map((t) =>
        t.name === from ? { ...t, name: to, description: to } : t,
      ),
    );
    const changes = [
      {
        kind: "tagLibrary",
        value: { ...library, version: library.version + 1, tags },
      },
    ];
    for (const p of store.photos(req.params.id)) {
      const aliases = { ...p.tagAliases };
      delete aliases[to];
      for (const key of Object.keys(aliases))
        if (aliases[key] === from) aliases[key] = to;
      if (from !== to) aliases[from] = to;
      const map = (values) => [
        ...new Set((values || []).map((t) => (t === from ? to : t))),
      ];
      changes.push({
        kind: "photo",
        fields: ["tagAliases", "manualTags", "excludedTags"],
        value: {
          ...p,
          tagAliases: aliases,
          manualTags: map(p.manualTags),
          excludedTags: map(p.excludedTags),
        },
      });
    }
    apply(req.params.id, changes, "重命名或合并标签");
    res.json(changes[0].value);
  });
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
