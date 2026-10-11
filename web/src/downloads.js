import { Zip, ZipPassThrough } from "fflate";
import { photoBlob } from "./local-media";
import { uniqueName } from "../../shared/domain.mjs";
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function downloadPhotos(
  photos,
  progress = () => {},
  blobFor = (p) => photoBlob(p.id),
) {
  if (!photos.length) return;
  if (photos.length === 1) {
    saveBlob(await blobFor(photos[0]), photos[0].name);
    return;
  }
  let output;
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: "作品集.zip",
      types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
    });
    output = await handle.createWritable();
  }
  const chunks = [];
  let total = 0,
    writing = Promise.resolve(),
    error;
  const names = new Set();
  const zip = new Zip((err, chunk) => {
    if (err) {
      error = err;
      return;
    }
    if (output) writing = writing.then(() => output.write(chunk));
    else {
      total += chunk.length;
      if (total > 128 * 1024 * 1024) {
        error = new Error(
          "批量下载超过 128 MB，请使用桌面 Chrome 或 Edge 直接保存到文件",
        );
        return;
      }
      chunks.push(chunk);
    }
  });
  try {
    for (let i = 0; i < photos.length; i++) {
      progress(`下载 ${i + 1}/${photos.length}`);
      const p = photos[i],
        blob = await blobFor(p),
        entry = new ZipPassThrough(uniqueName(p.name, names));
      zip.add(entry);
      const reader = blob.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.push(value);
        await writing;
        if (error) throw error;
      }
      entry.push(new Uint8Array(), true);
      await writing;
      if (error) throw error;
    }
    zip.end();
    await writing;
    if (error) throw error;
    if (output) await output.close();
    else saveBlob(new Blob(chunks, { type: "application/zip" }), "作品集.zip");
  } catch (e) {
    zip.terminate();
    await output?.abort().catch(() => {});
    throw e;
  }
}
