import {
  validateDraft,
  canvasSize,
  layoutRects,
  imagePlacement,
  TEMPLATES,
} from "../../shared/layout.mjs";
import { photoBlob } from "./local-media";
export async function renderLocal(
  input,
  photos,
  { preview = false, preserveOriginal = false } = {},
) {
  const draft = validateDraft(input, photos);
  if (draft.slots.length !== TEMPLATES[draft.template].count)
    throw new Error(`请放入 ${TEMPLATES[draft.template].count} 张照片`);
  const source = photos.find((p) => p.id === draft.slots[0].photoId);
  const sizing = (edge) =>
    preserveOriginal && draft.template === "single"
      ? source.width >= source.height
        ? {
            width: edge,
            height: Math.round((edge * source.height) / source.width),
          }
        : {
            height: edge,
            width: Math.round((edge * source.width) / source.height),
          }
      : canvasSize(draft.ratio, edge);
  let edge = preview ? 1000 : draft.longEdge;
  if (draft.template === "single") {
    edge = Math.min(edge, Math.max(source.width, source.height));
    const size = sizing(edge),
      rect = layoutRects(
        "single",
        size.width,
        size.height,
        draft.gap,
        draft.frame,
      )[0],
      p = imagePlacement(source, rect, draft.slots[0]);
    if (p.scale > 1) edge = Math.max(1, Math.floor(edge / p.scale));
  }
  const { width, height } = sizing(edge),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = draft.background;
  ctx.fillRect(0, 0, width, height);
  const rects = layoutRects(
    draft.template,
    width,
    height,
    draft.gap,
    draft.frame,
  );
  for (const [i, slot] of draft.slots.entries()) {
    const bitmap = await createImageBitmap(
      await photoBlob(
        slot.photoId,
        photos.find((p) => p.id === slot.photoId)?.originalExtension === "heic"
          ? "render"
          : "original",
      ),
    );
    try {
      const rect = rects[i],
        p = imagePlacement(bitmap, rect, slot);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.drawImage(bitmap, rect.x + p.left, rect.y + p.top, p.width, p.height);
      ctx.restore();
    } finally {
      bitmap.close();
    }
  }
  if (draft.frame === "caption") {
    const label =
      draft.template === "single"
        ? [
            source.camera,
            source.focal ? `${source.focal}mm` : null,
            source.aperture ? `f/${source.aperture}` : null,
            source.shutter
              ? `${source.shutter >= 1 ? source.shutter : "1/" + Math.round(1 / source.shutter)}s`
              : null,
            source.iso ? `ISO ${source.iso}` : null,
          ]
            .filter(Boolean)
            .join("  ·  ")
        : draft.title;
    ctx.font = `${Math.max(10, Math.round(width * 0.017))}px Arial, sans-serif`;
    ctx.fillStyle = "#3f433c";
    ctx.fillText(label, Math.round(width * 0.04), Math.round(height * 0.957));
  }
  const wm = draft.watermark,
    right = wm.position.endsWith("r"),
    bottom = wm.position.startsWith("b"),
    margin = Math.round(Math.min(width, height) * wm.margin);
  ctx.globalAlpha = wm.opacity;
  if (wm.text) {
    const font = Math.max(10, Math.round(width * wm.size));
    ctx.font = `${font}px Arial, sans-serif`;
    ctx.textAlign = right ? "right" : "left";
    ctx.fillStyle = wm.color;
    ctx.fillText(
      wm.text,
      right ? width - margin : margin,
      bottom ? height - margin : margin + font,
    );
  }
  if (wm.assetId) {
    const response = await fetch(`/api/assets/${wm.assetId}`);
    if (!response.ok) throw new Error("水印图片不可用");
    const logo = await createImageBitmap(await response.blob());
    try {
      const scale = Math.min(
          Math.round(width * Math.min(0.3, wm.size * 5)) / logo.width,
          Math.round(height * 0.15) / logo.height,
        ),
        w = Math.round(logo.width * scale),
        h = Math.round(logo.height * scale);
      ctx.drawImage(
        logo,
        right ? width - margin - w : margin,
        bottom ? height - margin - h : margin,
        w,
        h,
      );
    } finally {
      logo.close();
    }
  }
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("拼图渲染失败"))),
      "image/jpeg",
      (preview ? 85 : draft.quality) / 100,
    ),
  );
  canvas.width = canvas.height = 1;
  return blob;
}
