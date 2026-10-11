export const FOCAL_LABELS = [
  "超广角",
  "广角",
  "标准 / 50mm",
  "中焦 / 85mm",
  "长焦",
  "未知",
];
export function focalCategory(equivalent, actual, cropFactor) {
  const value =
    Number(equivalent) ||
    (Number(actual) > 0 && Number(cropFactor) > 0
      ? Number(actual) * Number(cropFactor)
      : 0);
  if (!value || !Number.isFinite(value)) return "未知";
  return value < 24
    ? "超广角"
    : value < 35
      ? "广角"
      : value < 70
        ? "标准 / 50mm"
        : value < 135
          ? "中焦 / 85mm"
          : "长焦";
}
export const STATUS_LABELS = {
  unseen: "未筛选",
  maybe: "待定",
  keep: "保留",
  reject: "不要",
};
export const isAccepted = (value) => value === "keep" || value === "maybe";
export const inInitial = (photo) => isAccepted(photo.status);
export const inFinal = (photo) =>
  inInitial(photo) && isAccepted(photo.finalStatus);
export const decisionField = (round) =>
  round === "final" ? "finalStatus" : "status";
export const decisionKeys = { z: "maybe", x: "keep", c: "reject" };
export function isTyping(target) {
  return !!target?.closest?.(
    'input, textarea, select, [contenteditable="true"]',
  );
}

export function uniqueName(name, existing) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name,
    i = 2;
  while (existing.has(candidate)) candidate = `${base} (${i++})${ext}`;
  existing.add(candidate);
  return candidate;
}
export function tagsOf(p) {
  return [
    ...new Set(
      [
        ...(p.manualTags || []),
        ...(p.ai?.tags || []),
        p.ai?.scene,
        p.ai?.shot,
        p.ai?.style,
      ].filter(Boolean),
    ),
  ];
}
export function filterPhotos(photos, filter = {}) {
  return photos.filter((p) => {
    if (filter.status && filter.status !== "all" && p.status !== filter.status)
      return false;
    if (filter.favorite && !p.favorite) return false;
    if (
      filter.orientation &&
      filter.orientation !== "all" &&
      (p.width >= p.height ? "landscape" : "portrait") !== filter.orientation
    )
      return false;
    if (
      filter.focal &&
      filter.focal !== "all" &&
      p.focalCategory !== filter.focal
    )
      return false;
    if (filter.scene && p.sceneId !== filter.scene) return false;
    if (filter.from && (p.takenAt || "").slice(0, 10) < filter.from)
      return false;
    if (filter.to && (p.takenAt || "").slice(0, 10) > filter.to) return false;
    if (filter.query) {
      const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
      const hay = [p.name, p.ai?.description, ...tagsOf(p)]
        .join(" ")
        .toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}
export function rankCandidates(photos, query, lockedIds = []) {
  const terms = query.split(/[\s，、。]+/).filter(Boolean);
  return photos
    .filter((p) => p.status !== "reject" || lockedIds.includes(p.id))
    .map((p) => ({
      p,
      score:
        (p.status === "keep" ? 4 : 0) +
        (p.favorite ? 3 : 0) +
        (lockedIds.includes(p.id) ? 100 : 0) +
        tagsOf(p).filter((tag) => tag.length > 1 && query.includes(tag))
          .length *
          12 +
        terms.reduce(
          (s, t) =>
            s +
            ([p.ai?.description, ...tagsOf(p)].join(" ").includes(t) ? 2 : 0),
          0,
        ),
    }))
    .sort((a, b) => b.score - a.score)
    .map((v) => v.p);
}
