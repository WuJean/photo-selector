import { candidatePhotos } from "../shared/candidates.mjs";
import { visualCandidates } from "../shared/pairing.mjs";
import { inFinal } from "../shared/domain.mjs";
import { validateDraft } from "../shared/layout.mjs";
export function collectionFor(store, projectId, id) {
  const c = store.get("collection", id);
  if (!c || c.projectId !== projectId)
    throw new Error("作品集不存在或不属于当前项目");
  return c;
}
export function sourcePhotos(store, projectId, scope = {}) {
  let photos = store.photos(projectId).filter(inFinal);
  if (scope.collectionId) {
    const c = collectionFor(store, projectId, scope.collectionId);
    photos = c.photoIds
      .map((id) => photos.find((p) => p.id === id))
      .filter(Boolean);
  }
  if (scope.sourceIds) {
    if (!Array.isArray(scope.sourceIds) || scope.sourceIds.length > 5000)
      throw new Error("照片范围无效");
    if (scope.sourceIds.some((id) => !photos.some((p) => p.id === id)))
      throw new Error("照片超出精筛或作品集范围");
    photos = scope.sourceIds.map((id) => photos.find((p) => p.id === id));
  }
  return photos.map((p) => ({
    ...p,
    description: store.publicPhoto(p).description,
  }));
}
export function draftId(projectId, scopeId = "") {
  if (!/^[a-zA-Z0-9-]{0,100}$/.test(scopeId)) throw new Error("草稿标识无效");
  return `draft-${projectId}${scopeId ? "-" + scopeId : ""}`;
}
export function scopedDraft(store, projectId, input) {
  return {
    ...validateDraft(
      { ...input, projectId },
      sourcePhotos(store, projectId, input),
    ),
    id: draftId(projectId, input.scopeId),
    scopeId: input.scopeId || "",
    collectionId: input.collectionId || null,
    sourceIds: input.sourceIds || null,
  };
}

export function recommendationScope(store, projectId, body = {}) {
  const source = sourcePhotos(store, projectId, body),
    collection = body.collectionId
      ? collectionFor(store, projectId, body.collectionId)
      : null;
  const locked = [
    ...new Set([...(body.lockedIds || []), ...(collection?.lockedIds || [])]),
  ];
  const photos = candidatePhotos(source, body.candidateFilter);
  if (!locked.every((id) => photos.some((p) => p.id === id)))
    throw new Error("锁定照片不符合当前筛选，请调整条件或解锁");
  const current = body.current;
  if (
    current?.photoIds &&
    (!Array.isArray(current.photoIds) ||
      current.photoIds.length > 4 ||
      current.photoIds.some((id) => !source.some((p) => p.id === id)))
  )
    throw new Error("当前画布照片超出来源范围");
  const candidates = visualCandidates(photos, String(body.prompt || ""), {
    lockedIds: locked,
    currentIds: current?.photoIds || [],
  });
  return { all: photos, locked, current, candidates };
}
