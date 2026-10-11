import { tagsOf, rankCandidates } from "./domain.mjs";
const role = (label, subject = [], shot = []) => ({ label, subject, shot });
export const QUICK_PAIRINGS = {
  portrait_triptych: {
    name: "三拼 · 人像近景 / 风景远景 / 人像远景",
    template: "rows",
    roles: [
      role("人像近景", ["人像"], ["近景", "特写"]),
      role("风景远景", ["风景"], ["远景", "全景"]),
      role("人像远景", ["人像"], ["远景", "全景"]),
    ],
  },
  travel_grid: {
    name: "四拼 · 人像近景 / 风景远景 / 人像远景 / 细节",
    template: "grid",
    roles: [
      role("人像近景", ["人像"], ["近景", "特写"]),
      role("风景远景", ["风景"], ["远景", "全景"]),
      role("人像远景", ["人像"], ["远景", "全景"]),
      role("细节", [], ["特写", "近景"]),
    ],
  },
  random_three: {
    name: "自由三拼",
    template: "rows",
    roles: Array.from({ length: 3 }, () => role("任意照片")),
  },
  random_four: {
    name: "自由四拼",
    template: "grid",
    roles: Array.from({ length: 4 }, () => role("任意照片")),
  },
};
export function matchesRole(photo, role) {
  const tags = tagsOf(photo);
  return (
    (!role.subject.length || role.subject.some((t) => tags.includes(t))) &&
    (!role.shot.length || role.shot.some((t) => tags.includes(t)))
  );
}
const shuffle = (values, random) => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export function randomPairing(
  photos,
  presetId,
  { slots = [], requiredIds = [], random = Math.random } = {},
) {
  const preset = QUICK_PAIRINGS[presetId];
  if (!preset) throw new Error("请选择快捷搭配模板");
  const byId = new Map(photos.map((p) => [p.id, p])),
    fixed = new Map();
  slots.forEach((s, i) => {
    if (s.locked || requiredIds.includes(s.photoId)) fixed.set(i, s.photoId);
  });
  if ([...fixed].some(([i, id]) => i >= preset.roles.length || !byId.has(id)))
    throw new Error("锁定位置超出模板或照片范围，请先解锁");
  if (new Set(fixed.values()).size !== fixed.size)
    throw new Error("锁定照片重复");
  for (const [i, id] of fixed)
    if (!matchesRole(byId.get(id), preset.roles[i]))
      throw new Error(
        `锁定照片不符合${preset.roles[i].label}，请更换模板或解锁`,
      );
  const required = [...new Set([...requiredIds, ...fixed.values()])];
  if (
    required.length > preset.roles.length ||
    required.some((id) => !byId.has(id))
  )
    throw new Error("必选照片超出模板或当前范围");
  const pools = preset.roles.map((r) =>
    shuffle(
      photos.filter((p) => matchesRole(p, r)).map((p) => p.id),
      random,
    ),
  );
  const missing = pools.flatMap((p, i) =>
    p.length ? [] : [preset.roles[i].label],
  );
  if (missing.length)
    throw new Error(`缺少${missing.join("、")}照片，请先 AI 分类或更换模板`);
  // At most four required photos: place them, then use augmenting paths to fill distinct slots.
  const solve = (forbidden = () => false) => {
    const placeRequired = (index, fixedMap) => {
      if (index < required.length) {
        const id = required[index];
        if ([...fixedMap.values()].includes(id))
          return placeRequired(index + 1, fixedMap);
        for (const i of shuffle(
          pools.map((_, i) => i),
          random,
        ))
          if (!fixedMap.has(i) && pools[i].includes(id) && !forbidden(i, id)) {
            const value = placeRequired(
              index + 1,
              new Map([...fixedMap, [i, id]]),
            );
            if (value) return value;
          }
        return null;
      }
      const occupied = new Map([...fixedMap].map(([i, id]) => [id, i]));
      const assign = (i, seen) => {
        for (const id of pools[i]) {
          if (seen.has(id) || forbidden(i, id)) continue;
          seen.add(id);
          const prev = occupied.get(id);
          if (
            prev === undefined ||
            (!fixedMap.has(prev) && assign(prev, seen))
          ) {
            occupied.set(id, i);
            return true;
          }
        }
        return false;
      };
      for (let i = 0; i < pools.length; i++)
        if (!fixedMap.has(i) && !assign(i, new Set())) return null;
      const result = Array(pools.length);
      for (const [id, i] of occupied) result[i] = id;
      return result;
    };
    return placeRequired(0, fixed);
  };
  const previous = new Set(slots.map((s) => s.photoId)),
    protectedIds = new Set(required);
  let ids = solve((i, id) => previous.has(id) && !protectedIds.has(id));
  if (!ids)
    for (const i of shuffle(
      pools.map((_, i) => i).filter((i) => !fixed.has(i)),
      random,
    )) {
      if (!slots[i]) continue;
      ids = solve((slot, id) => slot === i && id === slots[i].photoId);
      if (ids) break;
    }
  ids ||= solve();
  if (!ids) throw new Error("当前范围无法组成不重复且符合模板的照片组合");
  return {
    photoIds: ids,
    template: preset.template,
    unchanged:
      ids.length === slots.length &&
      ids.every((id, i) => slots[i].photoId === id),
  };
}

export function visualCandidates(
  photos,
  query,
  { lockedIds = [], currentIds = [], limit = 12 } = {},
) {
  const ranked = rankCandidates(photos, query, lockedIds),
    byId = new Map(ranked.map((p) => [p.id, p]));
  const matching = ranked.filter((p) =>
    tagsOf(p).some((t) => t.length > 1 && query.includes(t)),
  );
  const pool = matching.length >= 3 ? matching : ranked;
  const result = [],
    seen = new Set(),
    groups = new Set();
  const add = (p) => {
    if (p && !seen.has(p.id) && result.length < limit) {
      result.push(p);
      seen.add(p.id);
      if (p.similarId) groups.add(p.similarId);
    }
  };
  [...lockedIds, ...currentIds].forEach((id) => add(byId.get(id)));
  const buckets = new Map();
  for (const p of pool) {
    const tags = tagsOf(p),
      subject =
        ["人像", "多人合照", "风景", "宠物", "建筑", "美食"].find((t) =>
          tags.includes(t),
        ) || "其他",
      shot =
        ["特写", "近景", "中景", "远景", "全景"].find((t) =>
          tags.includes(t),
        ) || "未知";
    const key = subject + shot;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  // Round-robin across subject/shot groups prevents abundant landscapes crowding out portraits.
  const ordered = [];
  while ([...buckets.values()].some((b) => b.length))
    for (const bucket of buckets.values())
      if (bucket.length) ordered.push(bucket.shift());
  for (const p of ordered) if (!p.similarId || !groups.has(p.similarId)) add(p);
  for (const p of ordered) add(p);
  return result;
}
