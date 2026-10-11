import { uid } from "./store.mjs";
import { owned, fail, title } from "./service.mjs";
import {
  inInitial,
  inFinal,
  filterPhotos,
  decisionField,
} from "../../shared/domain.mjs";
import { groupPhotos } from "../../server/analysis.mjs";
export async function curation(store, action, input) {
  if (
    ![
      "photos.query",
      "photos.get",
      "photos.decide",
      "photos.favorite",
      "photos.undo",
      "photos.regroup",
      "photos.group",
    ].includes(action)
  )
    return;
  const project = await owned(store, "project", input.projectId);
  if (action === "photos.get") {
    if (!Array.isArray(input.ids) || input.ids.length > 60)
      fail("一次最多读取 60 张");
    return Promise.all(
      input.ids.map(async (id) => {
        const p = await owned(store, "photo", id);
        if (p.projectId !== project.id) fail("照片不属于项目");
        return p;
      }),
    );
  }
  if (action === "photos.query") {
    const all = await store.all("photo", { projectId: project.id });
    const stage = input.stage || "rough";
    const rows = all.filter((p) =>
      stage === "rough"
        ? input.processed
          ? p.status !== "unseen"
          : p.status === "unseen"
        : stage === "refine"
          ? inInitial(p) &&
            (input.processed
              ? p.finalStatus !== "unseen"
              : p.finalStatus === "unseen")
          : inFinal(p),
    );
    const filtered = filterPhotos(rows, input.filter || {});
    const grouped = [
      ...new Map(filtered.map((p) => [p.similarId || p.id, []])).keys(),
    ].flatMap((id) => filtered.filter((p) => (p.similarId || p.id) === id));
    const offset = Math.max(0, Number(input.offset) || 0);
    return {
      ids: grouped.map((p) => p.id),
      photos: grouped.slice(offset, offset + 60),
      total: grouped.length,
      counts: {
        rough: all.filter((p) => p.status === "unseen").length,
        refine: all.filter((p) => inInitial(p) && p.finalStatus === "unseen")
          .length,
        final: all.filter(inFinal).length,
      },
    };
  }
  if (action === "photos.regroup") {
    const photos = await store.all("photo", { projectId: project.id });
    for (const p of groupPhotos(photos, input.level || "standard")) {
      await store.transaction(async (tx) => {
        const current = await owned(tx, "photo", p.id);
        if (!current.groupManual)
          await tx.put("photo", {
            ...current,
            similarId: p.similarId,
            sceneId: p.sceneId,
          });
      });
    }
    return { ok: true };
  }
  if (action === "photos.group") {
    if (
      !Array.isArray(input.ids) ||
      !input.ids.length ||
      input.ids.length > 100
    )
      fail("请选择 1–100 张照片");
    const group = "manual-" + uid();
    for (const id of input.ids) {
      const p = await owned(store, "photo", id);
      if (p.projectId !== project.id) fail("照片不属于项目");
    }
    for (const id of input.ids)
      await store.transaction(async (tx) => {
        const p = await owned(tx, "photo", id);
        await tx.put("photo", {
          ...p,
          similarId: input.split ? "manual-" + p.id : group,
          groupManual: true,
        });
      });
    return { ok: true };
  }
  return store.transaction(async (tx) => {
    if (action === "photos.undo") {
      const h = await owned(tx, "history", input.historyId);
      if (h.projectId !== project.id || h.undone) fail("无法撤销此操作");
      const p = await owned(tx, "photo", h.photoId);
      if (
        p.lastHistoryId
          ? p.lastHistoryId !== h.id
          : p.revision !== h.afterRevision
      )
        fail("照片已被再次修改，请刷新后重选", "CONFLICT");
      const next = await tx.put("photo", {
        ...p,
        [h.field]: h.before,
        lastHistoryId: h.parentHistoryId || null,
        revision: p.revision + 1,
      });
      await tx.put("history", { ...h, undone: true });
      return { photo: next };
    }
    if (
      typeof input.operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,80}$/.test(input.operationId)
    )
      fail("操作编号无效");
    const existing = await tx.get("history", input.operationId);
    if (existing) {
      if (existing.projectId !== project.id || existing.photoId !== input.id)
        fail("操作编号冲突");
      return {
        photo: await owned(tx, "photo", existing.photoId),
        historyId: existing.id,
      };
    }
    const p = await owned(tx, "photo", input.id);
    if (p.projectId !== project.id) fail("照片不属于当前项目");
    if (p.revision !== input.revision)
      fail("照片已被修改，请刷新后重试", "CONFLICT");
    const field =
      action === "photos.favorite" ? "favorite" : decisionField(input.round);
    if (action === "photos.decide") {
      if (!["initial", "final"].includes(input.round)) fail("筛选轮次无效");
      if (
        !(
          input.round === "final"
            ? ["keep", "reject", "unseen"]
            : ["keep", "maybe", "reject", "unseen"]
        ).includes(input.value)
      )
        fail("筛选决定无效");
      if (input.round === "final" && !inInitial(p)) fail("照片尚未通过粗筛");
    }
    const value = action === "photos.favorite" ? !!input.value : input.value;
    const next = await tx.put("photo", {
      ...p,
      [field]: value,
      lastHistoryId: input.operationId,
      revision: p.revision + 1,
    });
    await tx.put("history", {
      id: input.operationId,
      projectId: project.id,
      photoId: p.id,
      field,
      before: p[field],
      parentHistoryId: p.lastHistoryId || null,
      afterRevision: next.revision,
      createdAt: Date.now(),
      undone: false,
    });
    return { photo: next, historyId: input.operationId };
  });
}
