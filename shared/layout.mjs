import { normalizeCandidateFilter } from "./candidates.mjs";
export const TEMPLATES = {
  rows: { label: "三张横图 · 上下排列", count: 3 },
  columns: { label: "三张竖图 · 左右排列", count: 3 },
  hero: { label: "一大两小 · 三拼", count: 3 },
  grid: { label: "四宫格 · 四拼", count: 4 },
  single: { label: "单张照片", count: 1 },
};
export const RATIOS = { "1:1": 1, "3:4": 0.75, "4:3": 4 / 3, "9:16": 9 / 16 };
export function canvasSize(ratio, longEdge = 3000) {
  const r = RATIOS[ratio] || 0.75;
  return r >= 1
    ? { width: longEdge, height: Math.round(longEdge / r) }
    : { width: Math.round(longEdge * r), height: longEdge };
}
export function layoutRects(
  template,
  width,
  height,
  gap = 0.014,
  frame = "none",
) {
  const edge = Math.round(Math.min(width, height));
  const inset = Math.round(
    edge * ({ none: 0, thin: 0.012, white: 0.055, caption: 0.04 }[frame] || 0),
  );
  const caption = frame === "caption" ? Math.round(height * 0.09) : 0;
  const x = inset,
    y = inset,
    w = width - inset * 2,
    h = height - inset * 2 - caption,
    g = Math.round(edge * gap);
  const rect = (left, top, width, height) => ({
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });
  if (template === "single") return [rect(x, y, w, h)];
  if (template === "rows") {
    const cell = (h - 2 * g) / 3;
    return [0, 1, 2].map((i) => rect(x, y + i * (cell + g), w, cell));
  }
  if (template === "columns") {
    const cell = (w - 2 * g) / 3;
    return [0, 1, 2].map((i) => rect(x + i * (cell + g), y, cell, h));
  }
  if (template === "hero") {
    const hero = (w - g) * 0.62,
      side = w - g - hero,
      half = (h - g) / 2;
    return [
      rect(x, y, hero, h),
      rect(x + hero + g, y, side, half),
      rect(x + hero + g, y + half + g, side, half),
    ];
  }
  const cw = (w - g) / 2,
    ch = (h - g) / 2;
  return [
    rect(x, y, cw, ch),
    rect(x + cw + g, y, cw, ch),
    rect(x, y + ch + g, cw, ch),
    rect(x + cw + g, y + ch + g, cw, ch),
  ];
}
export function imagePlacement(photo, rect, slot) {
  const zoom = Math.min(4, Math.max(1, Number(slot.zoom) || 1));
  const fit = slot.fit === "contain" ? "contain" : "cover";
  const base =
    fit === "contain"
      ? Math.min(rect.width / photo.width, rect.height / photo.height)
      : Math.max(rect.width / photo.width, rect.height / photo.height);
  const scale = base * zoom,
    width = photo.width * scale,
    height = photo.height * scale;
  const cx = Math.max(0, Math.min(1, Number(slot.cx) || 0)),
    cy = Math.max(0, Math.min(1, Number(slot.cy) || 0));
  return {
    width,
    height,
    left: (rect.width - width) * cx || 0,
    top: (rect.height - height) * cy || 0,
    scale,
  };
}
export function slotFor(photo) {
  const face = photo.faces?.[0];
  return {
    photoId: photo.id,
    zoom: 1,
    cx: face ? Math.max(0, Math.min(1, face.x + face.width / 2)) : 0.5,
    cy: face ? Math.max(0, Math.min(1, face.y + face.height / 2)) : 0.5,
    fit: "cover",
    locked: false,
  };
}
export function newDraft(projectId, photos = []) {
  const template =
    photos.length === 1 ? "single" : photos.length >= 4 ? "grid" : "rows";
  return {
    id: "draft-" + projectId,
    projectId,
    title: "我的旅行拼图",
    candidateFilter: normalizeCandidateFilter(),
    template,
    ratio: "3:4",
    gap: 0.014,
    background: "#f5f3ed",
    frame: "none",
    longEdge: 3000,
    quality: 90,
    watermark: {
      text: "",
      color: "#ffffff",
      size: 0.024,
      opacity: 0.8,
      position: "br",
      margin: 0.025,
      assetId: null,
    },
    slots: photos.slice(0, TEMPLATES[template].count).map(slotFor),
  };
}
export function validateDraft(input, photos) {
  if (!input || !TEMPLATES[input.template] || !RATIOS[input.ratio])
    throw new Error("拼图模板或画幅无效");
  const number = (n, min, max, fallback) =>
    Number.isFinite(Number(n))
      ? Math.max(min, Math.min(max, Number(n)))
      : fallback;
  const color = (s, fallback) =>
    /^#[0-9a-f]{6}$/i.test(s || "") ? s : fallback;
  const available = new Set(photos.map((p) => p.id));
  if (
    !Array.isArray(input.slots) ||
    input.slots.length > TEMPLATES[input.template].count
  )
    throw new Error("拼图照片数量无效");
  const slots = input.slots.map((s) => {
    if (!available.has(s.photoId)) throw new Error("照片不属于当前项目");
    return {
      photoId: s.photoId,
      zoom: number(s.zoom, 1, 4, 1),
      cx: number(s.cx, 0, 1, 0.5),
      cy: number(s.cy, 0, 1, 0.5),
      fit: s.fit === "contain" ? "contain" : "cover",
      locked: !!s.locked,
    };
  });
  const wm = input.watermark || {};
  return {
    ...newDraft(input.projectId),
    id: "draft-" + input.projectId,
    projectId: input.projectId,
    candidateFilter: normalizeCandidateFilter(input.candidateFilter),
    title: String(input.title || "我的旅行拼图").slice(0, 80),
    template: input.template,
    ratio: input.ratio,
    gap: number(input.gap, 0, 0.08, 0.014),
    background: color(input.background, "#f5f3ed"),
    frame: ["none", "thin", "white", "caption"].includes(input.frame)
      ? input.frame
      : "none",
    longEdge: Math.round(number(input.longEdge, 400, 6000, 3000)),
    quality: Math.round(number(input.quality, 40, 100, 90)),
    watermark: {
      text: String(wm.text || "").slice(0, 80),
      color: color(wm.color, "#ffffff"),
      size: number(wm.size, 0.01, 0.08, 0.024),
      opacity: number(wm.opacity, 0, 1, 0.8),
      position: ["tl", "tr", "bl", "br"].includes(wm.position)
        ? wm.position
        : "br",
      margin: number(wm.margin, 0, 0.2, 0.025),
      assetId: wm.assetId || null,
    },
    slots,
  };
}
