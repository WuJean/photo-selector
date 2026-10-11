import { uid } from "./store.mjs";
import { owned, fail, title } from "./service.mjs";
import { inFinal, filterPhotos } from "../../shared/domain.mjs";
import { newDraft, validateDraft } from "../../shared/layout.mjs";
import {
  validatePairingPreset,
  QUICK_PAIRINGS,
  randomPairing,
} from "../../shared/pairing.mjs";
export async function sourcePhotos(store, input) {
  await owned(store, "project", input.projectId);
  let photos = (
    await store.all("photo", { projectId: input.projectId })
  ).filter(inFinal);
  if (input.collectionId) {
    const c = await owned(store, "collection", input.collectionId);
    if (c.projectId !== input.projectId) fail("作品集不属于当前项目");
    const ids = new Set(
      (await store.all("member", { collectionId: c.id })).map((m) => m.photoId),
    );
    photos = photos.filter((p) => ids.has(p.id));
  }
  if (input.ids) {
    if (
      !Array.isArray(input.ids) ||
      input.ids.some((id) => !photos.some((p) => p.id === id))
    )
      fail("照片不属于当前作品范围");
    photos = photos.filter((p) => input.ids.includes(p.id));
  }
  return photos;
}
export async function portfolio(store, action, input, { files } = {}) {
  if (
    !/^(collections|members|creations|drafts|presets|pairings)\./.test(action)
  )
    return;
  await owned(store, "project", input.projectId);
  const collection = async () => {
    const c = await owned(store, "collection", input.collectionId);
    if (c.projectId !== input.projectId) fail("作品集不属于当前项目");
    return c;
  };
  if (action === "collections.list") {
    const photos = await sourcePhotos(store, input),
      ids = new Set(photos.map((p) => p.id)),
      members = await store.all("member", { projectId: input.projectId });
    return (await store.all("collection", { projectId: input.projectId })).map(
      (c) => ({
        ...c,
        count: members.filter(
          (m) => m.collectionId === c.id && ids.has(m.photoId),
        ).length,
      }),
    );
  }
  if (action === "collections.create")
    return store.put("collection", {
      id: uid(),
      projectId: input.projectId,
      name: title(input.name, "新作品集"),
      description: String(input.description || "").slice(0, 5000),
      createdAt: Date.now(),
    });
  if (action === "collections.update") {
    const c = await collection();
    return store.put("collection", {
      ...c,
      name: title(input.name, c.name),
      description: String(input.description ?? c.description).slice(0, 5000),
    });
  }
  if (action === "collections.photos") {
    let photos = await sourcePhotos(store, { ...input, ids: undefined });
    const members = await store.all("member", { projectId: input.projectId });
    if (!input.collectionId && input.unassigned !== false) {
      const assigned = new Set(members.map((m) => m.photoId));
      photos = photos.filter((p) => !assigned.has(p.id));
    }
    const byId = new Map(
      members
        .filter((m) => m.collectionId === input.collectionId)
        .map((m) => [m.photoId, m]),
    );
    photos = filterPhotos(photos, input.filter || {})
      .map((p) => ({
        ...p,
        locked: !!byId.get(p.id)?.locked,
        order: byId.get(p.id)?.order || 0,
      }))
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    const offset = Math.max(0, Number(input.offset) || 0);
    return {
      photos: photos.slice(offset, offset + 60),
      total: photos.length,
      ids: photos.map((p) => p.id),
    };
  }
  if (action === "members.add" || action === "members.remove") {
    const c = await collection();
    if (
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 100
    )
      fail("请选择 1–100 张照片");
    if (action === "members.add")
      await sourcePhotos(store, { ...input, collectionId: undefined });
    for (const id of new Set(input.ids)) {
      const key = c.id + "-" + id;
      if (action === "members.remove") await store.remove("member", key);
      else if (!(await store.get("member", key)))
        await store.put("member", {
          id: key,
          projectId: c.projectId,
          collectionId: c.id,
          photoId: id,
          order: Date.now(),
          locked: false,
        });
    }
    return { ok: true };
  }
  if (action === "members.update") {
    const c = await collection(),
      m = await owned(store, "member", c.id + "-" + input.photoId);
    return store.put("member", {
      ...m,
      locked: input.locked === undefined ? m.locked : !!input.locked,
      order: Number.isFinite(input.order) ? input.order : m.order,
    });
  }
  if (action === "creations.list") {
    const c = await collection();
    const rows = (await store.all("creation", { collectionId: c.id })).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
      imageRows = rows.filter((v) => v.fileID);
    for (let i = 0; i < imageRows.length; i += 50) {
      const batch = imageRows.slice(i, i + 50),
        urls = await files.urls(batch.map((v) => v.fileID));
      batch.forEach((v, j) => (v.url = urls[j]?.url || ""));
    }
    return rows;
  }
  if (action === "creations.edit") {
    const c = await owned(store, "creation", input.id);
    if (c.projectId !== input.projectId || c.type !== "copy")
      fail("只能编辑当前项目文案");
    // Editing creates a new version so the generated original remains available.
    return store.put("creation", {
      ...c,
      id: uid(),
      parentId: c.id,
      title: title(input.title, c.title),
      body: String(input.body || "").slice(0, 10000),
      createdAt: Date.now(),
    });
  }
  if (action === "presets.list")
    return [
      ...Object.entries(QUICK_PAIRINGS).map(([id, p]) => ({
        ...p,
        id,
        builtin: true,
      })),
      ...(await store.all("preset", { projectId: input.projectId })),
    ];
  if (action === "presets.save") {
    const p = validatePairingPreset(input.preset);
    if (input.id) {
      const previous = await owned(store, "preset", input.id);
      if (previous.projectId !== input.projectId) fail("模板不属于当前项目");
    }
    return store.put("preset", {
      ...p,
      id: input.id || uid(),
      projectId: input.projectId,
    });
  }
  if (action === "presets.delete") {
    const p = await owned(store, "preset", input.id);
    if (p.projectId !== input.projectId) fail("模板不属于当前项目");
    await store.remove("preset", p.id);
    return { ok: true };
  }
  if (action === "pairings.random") {
    const photos = await sourcePhotos(store, input);
    let preset = input.presetId;
    if (!Object.hasOwn(QUICK_PAIRINGS, preset)) {
      preset = await owned(store, "preset", preset);
      if (preset.projectId !== input.projectId) fail("模板不属于当前项目");
    }
    return randomPairing(photos, preset, {
      slots: input.slots || [],
      requiredIds: input.requiredIds || [],
    });
  }
  if (action === "drafts.get" || action === "drafts.save") {
    const photos = await sourcePhotos(store, { ...input, ids: undefined }),
      id = input.projectId + "-" + (input.collectionId || "independent");
    if (action === "drafts.get") {
      const draft = await store.get("draft", id);
      return draft
        ? {
            ...draft,
            slots: draft.slots.filter((s) =>
              photos.some((p) => p.id === s.photoId),
            ),
          }
        : {
            ...newDraft(input.projectId),
            id,
            collectionId: input.collectionId || null,
          };
    }
    const draft = validateDraft(
      { ...input.draft, projectId: input.projectId },
      photos,
    );
    if (draft.watermark.assetId) {
      const asset = await owned(store, "asset", draft.watermark.assetId);
      if (asset.projectId !== input.projectId) fail("水印不属于项目");
    }
    return store.put("draft", {
      ...draft,
      id,
      collectionId: input.collectionId || null,
    });
  }
  fail("未知作品集操作");
}
