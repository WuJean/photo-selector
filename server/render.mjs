import sharp from "sharp";
import path from "node:path";
import {
  canvasSize,
  layoutRects,
  imagePlacement,
  TEMPLATES,
} from "../shared/layout.mjs";
import { originalPath } from "./images.mjs";
export const escapeXML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
function parameters(photo) {
  return [
    photo.camera,
    photo.focal ? `${photo.focal}mm` : null,
    photo.aperture ? `f/${photo.aperture}` : null,
    photo.shutter
      ? `${photo.shutter >= 1 ? photo.shutter : "1/" + Math.round(1 / photo.shutter)}s`
      : null,
    photo.iso ? `ISO ${photo.iso}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}
export async function renderDraft(
  store,
  draft,
  {
    preview = false,
    preserveOriginal = false,
    sourcePath = (id) => originalPath(store, id),
  } = {},
) {
  if (draft.slots.length !== TEMPLATES[draft.template].count)
    throw new Error(`请为模板放入 ${TEMPLATES[draft.template].count} 张照片`);
  let edge = preview ? 1000 : draft.longEdge;
  const source = store.get("photo", draft.slots[0].photoId);
  const sizing = (longEdge) => {
    if (preserveOriginal && draft.template === "single") {
      const ratio = source.width / source.height;
      return ratio >= 1
        ? { width: longEdge, height: Math.round(longEdge / ratio) }
        : { width: Math.round(longEdge * ratio), height: longEdge };
    }
    return canvasSize(draft.ratio, longEdge);
  };
  if (draft.template === "single") {
    const photo = store.get("photo", draft.slots[0].photoId);
    edge = Math.min(edge, Math.max(photo.width, photo.height));
    const tentative = sizing(edge);
    const region = layoutRects(
      "single",
      tentative.width,
      tentative.height,
      draft.gap,
      draft.frame,
    )[0];
    const placement = imagePlacement(photo, region, draft.slots[0]);
    if (placement.scale > 1)
      edge = Math.max(1, Math.floor(edge / placement.scale));
  }
  const { width, height } = sizing(edge);
  const rects = layoutRects(
    draft.template,
    width,
    height,
    draft.gap,
    draft.frame,
  );
  const composites = [];
  for (const [i, slot] of draft.slots.entries()) {
    const photo = store.get("photo", slot.photoId);
    if (!photo || photo.projectId !== draft.projectId)
      throw new Error("拼图照片不存在");
    const rect = rects[i],
      p = imagePlacement(photo, rect, slot);
    const left = Math.max(0, Math.round(p.left)),
      top = Math.max(0, Math.round(p.top));
    const visibleWidth = Math.min(rect.width - left, Math.round(p.width)),
      visibleHeight = Math.min(rect.height - top, Math.round(p.height));
    const sourceX = Math.max(0, Math.floor(-p.left / p.scale)),
      sourceY = Math.max(0, Math.floor(-p.top / p.scale));
    const sourceWidth = Math.min(
        photo.width - sourceX,
        Math.max(1, Math.ceil(visibleWidth / p.scale)),
      ),
      sourceHeight = Math.min(
        photo.height - sourceY,
        Math.max(1, Math.ceil(visibleHeight / p.scale)),
      );
    const input = await sharp(sourcePath(photo.id))
      .rotate()
      .extract({
        left: sourceX,
        top: sourceY,
        width: sourceWidth,
        height: sourceHeight,
      })
      .resize(Math.max(1, visibleWidth), Math.max(1, visibleHeight), {
        fit: "fill",
      })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    composites.push({ input, left: rect.x + left, top: rect.y + top });
  }
  if (draft.frame === "caption") {
    const p = store.get("photo", draft.slots[0].photoId);
    const label = draft.template === "single" ? parameters(p) : draft.title;
    const text = escapeXML(label);
    const size = Math.max(10, Math.round(width * 0.017));
    composites.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}"><text x="${Math.round(width * 0.04)}" y="${Math.round(height * 0.957)}" font-family="Arial, sans-serif" font-size="${size}" fill="#3f433c">${text}</text></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }
  const wm = draft.watermark;
  const right = wm.position.endsWith("r"),
    bottom = wm.position.startsWith("b"),
    margin = Math.round(Math.min(width, height) * wm.margin);
  if (wm.text) {
    const font = Math.max(10, Math.round(width * wm.size));
    const x = right ? width - margin : margin,
      y = bottom ? height - margin : margin + font;
    composites.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}"><text x="${x}" y="${y}" text-anchor="${right ? "end" : "start"}" font-size="${font}" font-family="Arial, sans-serif" fill="${wm.color}" opacity="${wm.opacity}">${escapeXML(wm.text)}</text></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }
  if (wm.assetId) {
    const asset = store.get("asset", wm.assetId);
    if (!asset) throw new Error("水印图片不存在");
    const logo = await sharp(path.join(store.root, "assets", asset.id + ".png"))
      .resize({
        width: Math.round(width * Math.min(0.3, wm.size * 5)),
        height: Math.round(height * 0.15),
        fit: "inside",
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const x = right ? width - margin - logo.info.width : margin,
      y = bottom ? height - margin - logo.info.height : margin;
    composites.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,${logo.data.toString("base64")}" x="${x}" y="${y}" width="${logo.info.width}" height="${logo.info.height}" opacity="${wm.opacity}"/></svg>`,
      ),
      left: 0,
      top: 0,
    });
  }
  return sharp({
    create: { width, height, channels: 3, background: draft.background },
  })
    .composite(composites)
    .toColourspace("srgb")
    .jpeg({ quality: preview ? 85 : draft.quality })
    .toBuffer();
}
