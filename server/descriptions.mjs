import { scheduler } from "./scheduler.mjs";
// One durable visual understanding per asset; provider changes do not invalidate facts.
export function descriptionRecord(store, photo) {
  if (!photo) return null;
  const cached = store.get("description", photo.id);
  if (cached?.photoHash && photo.hash && cached.photoHash !== photo.hash)
    return null;
  if (typeof cached?.text === "string" && cached.text.trim()) return cached;
  if (typeof photo.ai?.description === "string" && photo.ai.description.trim())
    return {
      id: photo.id,
      text: photo.ai.description,
      photoHash: photo.hash,
      model: photo.ai.model || null,
      analyzedAt: photo.ai.analyzedAt || null,
    };
  return null;
}
export function saveDescription(store, photo, result, config = {}) {
  if (typeof result.description !== "string" || !result.description.trim())
    throw new Error("缺少照片描述");
  return store.put("description", {
    id: photo.id,
    text: result.description.trim().slice(0, 2000),
    photoHash: photo.hash || null,
    model: config.model || null,
    analyzedAt: new Date().toISOString(),
    version: 1,
    tone: result.tone || "",
    composition: result.composition || "",
  });
}

export async function ensureDescription(store, photo, config, signal, analyze) {
  return scheduler.run(
    `description:${store.root}:${photo.id}`,
    1,
    signal,
    async () => {
      const current = store.get("photo", photo.id) || photo;
      const cached = descriptionRecord(store, current);
      if (cached) return cached.text;
      const result = await analyze();
      if (signal?.aborted) throw new Error("任务已取消");
      const latest = store.get("photo", photo.id);
      if (!latest || latest.deleted || latest.hash !== photo.hash)
        throw new Error("照片已改变");
      return (
        descriptionRecord(store, latest) ||
        saveDescription(store, latest, result, config)
      ).text;
    },
  );
}
