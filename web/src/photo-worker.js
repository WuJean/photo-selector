import exifr from "exifr";
import { focalCategory } from "../../shared/domain.mjs";
self.onmessage = async ({
  data: { id, file, mode = "analyze", edge = 1536 },
}) => {
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("照片超过 100 MB");
    const magic = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (magic[0] !== 255 || magic[1] !== 216)
      throw new Error("首版支持 JPEG 照片");
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 120000000)
        throw new Error("照片像素过大");
      const canvas = (w, h) => {
        const c = new OffscreenCanvas(w, h);
        c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        return c;
      };
      const resize = async (max) => {
        const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        return canvas(
          Math.round(bitmap.width * k),
          Math.round(bitmap.height * k),
        ).convertToBlob({ type: "image/jpeg", quality: 0.85 });
      };
      if (mode === "preview") {
        self.postMessage({ id, result: await resize(edge) });
        return;
      }
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      let exif = {};
      try {
        exif = (await exifr.parse(file)) || {};
      } catch {}
      const small = canvas(9, 8).getContext("2d").getImageData(0, 0, 9, 8).data;
      const gray = (i) =>
        small[i] * 0.299 + small[i + 1] * 0.587 + small[i + 2] * 0.114;
      let phash = "";
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const i = (y * 9 + x) * 4;
          phash += gray(i) > gray(i + 4) ? "1" : "0";
        }
      const q = canvas(128, 128)
        .getContext("2d")
        .getImageData(0, 0, 128, 128).data;
      const values = Array.from(
        { length: 128 * 128 },
        (_, i) => (q[i * 4] + q[i * 4 + 1] + q[i * 4 + 2]) / 3,
      );
      let sum = 0,
        sq = 0,
        dark = 0,
        light = 0,
        n = 0;
      for (let y = 1; y < 127; y++)
        for (let x = 1; x < 127; x++) {
          const i = y * 128 + x,
            v =
              values[i - 1] +
              values[i + 1] +
              values[i - 128] +
              values[i + 128] -
              4 * values[i];
          sum += v;
          sq += v * v;
          n++;
          dark += values[i] < 10;
          light += values[i] > 245;
        }
      const sharpness = Math.round(sq / n - (sum / n) ** 2),
        issues = [];
      if (sharpness < 35) issues.push("清晰度较低，请检查");
      if (dark / n > 0.55) issues.push("暗部较多");
      if (light / n > 0.55) issues.push("亮部较多");
      const date = exif.DateTimeOriginal || exif.CreateDate;
      const focal = exif.FocalLength || null,
        equivalent =
          exif.FocalLengthIn35mmFormat || exif.FocalLengthIn35mmFilm || null;
      self.postMessage({
        id,
        result: {
          hash,
          name: file.name,
          size: file.size,
          width: bitmap.width,
          height: bitmap.height,
          takenAt:
            date instanceof Date && !isNaN(date)
              ? date.toISOString()
              : file.lastModified
                ? new Date(file.lastModified).toISOString()
                : null,
          camera: [exif.Make, exif.Model].filter(Boolean).join(" "),
          lens: exif.LensModel || "",
          focal,
          equivalent,
          focalCategory: focalCategory(equivalent, focal),
          aperture: exif.FNumber || null,
          shutter: exif.ExposureTime || null,
          iso: exif.ISO || null,
          phash,
          sharpness,
          issues,
          thumbnail: await resize(520),
        },
      });
    } finally {
      bitmap.close();
    }
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
