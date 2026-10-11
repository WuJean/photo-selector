export const TAG_CATEGORIES = ["主体", "景别", "环境", "风格", "其他"];
export const DEFAULT_TAGS = Object.entries({
  主体: ["人像", "多人合照", "宠物", "风景", "建筑", "美食", "其他"],
  景别: ["特写", "近景", "中景", "远景", "全景", "不确定"],
  环境: ["雪山", "森林", "海边", "城市", "室内", "夜景"],
  风格: ["清冷", "暖调", "自然", "纪实", "极简"],
}).flatMap(([category, names]) =>
  names.map((name) => ({ name, category, description: name })),
);
export function normalizeTags(input) {
  if (!Array.isArray(input) || input.length > 100)
    throw new Error("标签库最多 100 项");
  const seen = new Set();
  return input
    .map((t) => {
      const name = String(typeof t === "string" ? t : t?.name || "")
        .normalize("NFKC")
        .trim();
      if (!name || name.length > 40) throw new Error("标签名称应为 1–40 个字");
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        name,
        category: TAG_CATEGORIES.includes(t.category) ? t.category : "其他",
        description: String(t.description || name).slice(0, 160),
      };
    })
    .filter(Boolean);
}
export function samplePhotos(photos) {
  const unique = [
    ...new Map(photos.map((p) => [p.hash || p.id, p])).values(),
  ].sort(
    (a, b) =>
      (a.takenAt || "~").localeCompare(b.takenAt || "~") ||
      a.id.localeCompare(b.id),
  );
  const count = Math.min(
    unique.length,
    60,
    Math.max(12, Math.ceil(unique.length * 0.1)),
  );
  if (count === unique.length) return unique.map((p) => p.id);
  const valid = unique.filter((p) => Number.isFinite(Date.parse(p.takenAt))),
    times = valid.map((p) => Date.parse(p.takenAt));
  const min = Math.min(...times),
    max = Math.max(...times);
  const strata = new Map();
  for (const p of unique) {
    const time = Date.parse(p.takenAt);
    const key = !Number.isFinite(time)
      ? "missing"
      : Math.min(9, Math.floor(((time - min) / Math.max(1, max - min)) * 10));
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(p);
  }
  const layers = [...strata.values()],
    quotas = layers.map(() => 1);
  let remaining = count - layers.length;
  // Allocate remaining slots by proportional deficit, with deterministic ties and capacity limits.
  while (remaining-- > 0) {
    let best = -1;
    for (let i = 0; i < layers.length; i++) {
      if (quotas[i] >= layers[i].length) continue;
      if (
        best < 0 ||
        (layers[i].length * count) / unique.length - quotas[i] >
          (layers[best].length * count) / unique.length - quotas[best]
      )
        best = i;
    }
    if (best < 0) break;
    quotas[best]++;
  }
  return layers.flatMap((layer, i) =>
    Array.from(
      { length: quotas[i] },
      (_, j) => layer[Math.floor(((j + 0.5) * layer.length) / quotas[i])].id,
    ),
  );
}

export const CORE_TAGS = DEFAULT_TAGS.filter((t) =>
  ["主体", "景别"].includes(t.category),
);
export const structuredTags = (tags) =>
  normalizeTags(
    [
      ...CORE_TAGS,
      ...tags.filter((t) => !["主体", "景别"].includes(t.category)),
    ].slice(0, 100),
  );
export function tagCategory(name, tags = DEFAULT_TAGS) {
  return (
    CORE_TAGS.find((t) => t.name === name)?.category ||
    tags.find((t) => t.name === name)?.category ||
    "其他"
  );
}
