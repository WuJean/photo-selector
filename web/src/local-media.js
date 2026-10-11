import { api, json } from "./api";
const assets = new Map();
let database;
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("photo-wall-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function storage(key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      "files",
      value === undefined ? "readonly" : "readwrite",
    );
    const request =
      value === undefined
        ? tx.objectStore("files").get(key)
        : tx.objectStore("files").put(value, key);
    let result;
    request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}
const tasks = [];
let active = 0;
const pool = [];
export function processPhoto(file, options = {}) {
  return new Promise((resolve, reject) => {
    tasks.push({ file, options, resolve, reject });
    drain();
  });
}
function drain() {
  while (active < 2 && tasks.length) {
    active++;
    const task = tasks.shift(),
      worker =
        pool.pop() ||
        new Worker(new URL("./photo-worker.js", import.meta.url), {
          type: "module",
        });
    worker.onmessage = ({ data }) => {
      active--;
      pool.push(worker);
      data.error
        ? task.reject(new Error(data.error))
        : task.resolve(data.result);
      drain();
    };
    worker.onerror = (e) => {
      active--;
      worker.terminate();
      task.reject(new Error(e.message));
      drain();
    };
    worker.postMessage({
      id: crypto.randomUUID(),
      file: task.file,
      ...task.options,
    });
  }
}
export function registerAssets(list) {
  for (const p of list) assets.set(p.id, p);
}
export function asset(id) {
  return assets.get(id);
}
export const isLocal = (id) => assets.get(id)?.storage === "local";
export function mediaAddress(id, variant) {
  return isLocal(id) ? `local-photo://${id}/${variant}` : null;
}
async function fileAt(directory, relativePath) {
  const parts = relativePath.split("/");
  let current = directory;
  for (const part of parts.slice(0, -1))
    current = await current.getDirectoryHandle(part);
  return (await current.getFileHandle(parts.at(-1))).getFile();
}
export async function localFile(id) {
  const binding = await storage("asset:" + id);
  if (!binding) throw new Error("照片在其他电脑，请重新连接文件夹");
  const folder = await storage("folder:" + binding.folderId);
  if (!folder || (await folder.queryPermission({ mode: "read" })) !== "granted")
    throw new Error("需要重新连接文件夹");
  try {
    const file = await fileAt(folder, binding.path);
    if (file.size !== binding.size || file.lastModified !== binding.modified) {
      const value = await processPhoto(file);
      if (value.hash !== binding.hash)
        throw new Error("原文件已改变，请重新导入");
    }
    return file;
  } catch (e) {
    throw new Error(
      e.message === "原文件已改变，请重新导入"
        ? e.message
        : "文件不可访问，请重新连接文件夹",
    );
  }
}
export async function photoBlob(id, variant = "original") {
  if (!isLocal(id)) {
    const r = await fetch(`/api/photos/${id}/${variant}`);
    if (!r.ok) throw new Error("图片不可访问");
    return r.blob();
  }
  if (variant === "thumb") {
    const cached = await storage("thumb:" + id);
    if (cached) return cached;
  }
  const file = await localFile(id);
  return variant === "original"
    ? file
    : processPhoto(file, {
        mode: "preview",
        edge: variant === "thumb" ? 520 : 1536,
      });
}
export async function resolveMedia(url) {
  const [, id, variant] = url.match(/^local-photo:\/\/([^/]+)\/(\w+)/) || [];
  if (!id) return { url, revoke: () => {} };
  const result = URL.createObjectURL(await photoBlob(id, variant));
  return { url: result, revoke: () => URL.revokeObjectURL(result) };
}
async function* walk(directory, prefix = "") {
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") yield* walk(handle, prefix + name + "/");
    else if (/\.jpe?g$/i.test(name)) yield { path: prefix + name, handle };
  }
}
export async function importFolder(
  directory,
  { direct = false, onProgress = () => {}, reconnect = false } = {},
) {
  const folderId = crypto.randomUUID();
  await storage("folder:" + folderId, directory);
  const batch = reconnect
    ? null
    : await api(
        "/batches",
        json("POST", { name: directory.name, source: "folder", direct }),
      );
  const known = reconnect ? await api("/assets") : [];
  let done = 0,
    matched = 0,
    failed = 0;
  for await (const item of walk(directory)) {
    try {
      const file = await item.handle.getFile(),
        analysis = await processPhoto(file),
        { thumbnail, ...metadata } = analysis;
      let p;
      if (reconnect) {
        p = known.find((p) => p.hash === metadata.hash);
        if (!p) continue;
        matched++;
      } else {
        p = await api(`/batches/${batch.id}/local`, json("POST", metadata));
      }
      await storage("asset:" + p.id, {
        folderId,
        path: item.path,
        hash: metadata.hash,
        size: file.size,
        modified: file.lastModified,
      });
      await storage("thumb:" + p.id, thumbnail);
      assets.set(p.id, p);
    } catch (e) {
      failed++;
      onProgress(`跳过：${e.message}`);
    }
    done++;
    onProgress(`已读取 ${done} 张${failed ? `，失败 ${failed} 张` : ""}`);
  }
  if (direct && batch && done > failed) {
    await api(
      `/batches/${batch.id}/finish`,
      json("POST", { round: "initial" }),
    );
    await api(`/batches/${batch.id}/finish`, json("POST", { round: "final" }));
  }
  window.dispatchEvent(new Event("photo-files-reconnected"));
  return { batch, done, failed, matched };
}
export async function chooseFolder(mode = "read") {
  if (!window.showDirectoryPicker)
    throw new Error("请使用桌面 Chrome 或 Edge 连接文件夹，也可以使用上传照片");
  return window.showDirectoryPicker({ mode });
}
export async function bindSaved(id, directory, path, file, hash) {
  const folderId = crypto.randomUUID();
  await storage("folder:" + folderId, directory);
  await storage("asset:" + id, {
    folderId,
    path,
    hash,
    size: file.size,
    modified: file.lastModified,
  });
  const thumbnail = await processPhoto(file, { mode: "preview", edge: 520 });
  await storage("thumb:" + id, thumbnail);
}
export async function saveNetworkPhotos(
  directory,
  photos,
  onProgress = () => {},
) {
  let done = 0;
  for (const p of photos) {
    const response = await fetch(`/api/photos/${p.id}/original`);
    if (!response.ok) throw new Error("服务器原片不可访问");
    let name = p.name.replace(/[\\/:*?"<>|]/g, "_"),
      number = 1;
    const base = name.replace(/\.jpe?g$/i, "");
    while (true) {
      try {
        await directory.getFileHandle(name);
        name = `${base} (${++number}).jpg`;
      } catch (e) {
        if (e.name === "NotFoundError") break;
        throw e;
      }
    }
    const handle = await directory.getFileHandle(name, { create: true }),
      writer = await handle.createWritable();
    try {
      await response.body.pipeTo(writer);
    } catch (e) {
      throw new Error(`保存 ${name} 失败，服务器副本已保留`);
    }
    const file = await handle.getFile(),
      metadata = await processPhoto(file);
    if (file.size !== p.size || metadata.hash !== p.hash)
      throw new Error("保存后的图片校验失败，服务器副本已保留");
    await bindSaved(p.id, directory, name, file, metadata.hash);
    await api(
      `/assets/${p.id}/local-receipt`,
      json("POST", { hash: metadata.hash, size: file.size }),
    );
    assets.set(p.id, { ...p, storage: "local" });
    onProgress(`已保存 ${++done}/${photos.length}`);
  }
  window.dispatchEvent(new Event("photo-files-reconnected"));
}
