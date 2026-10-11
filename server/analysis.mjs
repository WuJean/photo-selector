import sharp from "sharp";
import path from "node:path";
export function hamming(a, b) {
  if (!a || !b) return 64;
  let n = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++;
  return n;
}
export function distance(a, b) {
  if (!a?.length || a.length !== b?.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
export async function cvFeatures(file) {
  const { data } = await sharp(file)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let phash = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      phash += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  const { data: gray, info } = await sharp(file)
    .rotate()
    .resize(256, 256, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0,
    sq = 0,
    n = 0,
    dark = 0,
    light = 0;
  for (let y = 1; y < info.height - 1; y++)
    for (let x = 1; x < info.width - 1; x++) {
      const i = y * info.width + x;
      const v =
        gray[i - 1] +
        gray[i + 1] +
        gray[i - info.width] +
        gray[i + info.width] -
        4 * gray[i];
      sum += v;
      sq += v * v;
      n++;
      if (gray[i] < 10) dark++;
      if (gray[i] > 245) light++;
    }
  const sharpness = n ? sq / n - (sum / n) ** 2 : 0;
  const issues = [];
  if (sharpness < 35) issues.push("清晰度较低，请检查");
  if (dark / Math.max(1, n) > 0.55) issues.push("暗部较多");
  if (light / Math.max(1, n) > 0.55) issues.push("亮部较多");
  return { phash, sharpness: Math.round(sharpness), issues };
}
export function groupPhotos(photos, level = "standard") {
  const threshold = { strict: 0.2, standard: 0.32, loose: 0.46 }[level] ?? 0.32;
  const hashes = { strict: 3, standard: 7, loose: 12 }[level] ?? 7;
  const sorted = [...photos].sort((a, b) =>
    (a.takenAt || a.importedAt || "").localeCompare(
      b.takenAt || b.importedAt || "",
    ),
  );
  const representatives = [],
    groups = new Map(),
    exact = new Map();
  for (const p of sorted) {
    let rep = exact.get(p.hash);
    if (!rep)
      for (const r of representatives.slice(-300)) {
        const delta =
          p.takenAt && r.takenAt
            ? Math.abs(Date.parse(p.takenAt) - Date.parse(r.takenAt))
            : 0;
        if (delta > 30 * 60 * 1000) continue;
        const visual = distance(p.embedding, r.embedding);
        if (
          visual < threshold ||
          (visual === Infinity && hamming(p.phash, r.phash) <= hashes)
        ) {
          rep = r;
          break;
        }
      }
    if (!rep) {
      rep = p;
      representatives.push(p);
    }
    exact.set(p.hash || p.id, rep);
    groups.set(p.id, "similar-" + rep.id);
  }
  let scene = null,
    last = null;
  const scenes = new Map();
  for (const p of sorted) {
    const gap =
      last && p.takenAt && last.takenAt
        ? Math.abs(Date.parse(p.takenAt) - Date.parse(last.takenAt))
        : 0;
    if (
      !scene ||
      gap > 30 * 60 * 1000 ||
      (gap > 5 * 60 * 1000 && distance(p.embedding, last?.embedding) > 0.85)
    )
      scene = "scene-" + p.id;
    scenes.set(p.id, scene);
    last = p;
  }
  return photos.map((p) => ({
    ...p,
    similarId: p.groupManual ? p.similarId : groups.get(p.id),
    sceneId: p.sceneManual ? p.sceneId : scenes.get(p.id),
  }));
}
export class LocalQueue {
  constructor(store, native) {
    this.store = store;
    this.native = native;
    this.running = false;
    this.paused = !!store.get("settings", "local-queue")?.paused;
    this.stopped = false;
    this.queue = [];
    this.current = null;
    for (const p of store.all("photo"))
      if (["pending", "running"].includes(p.analysisStatus))
        this.queue.push(p.id);
  }
  state() {
    return {
      running: this.running,
      paused: this.paused,
      pending: this.queue.length,
      current: this.current,
      model: this.native.available
        ? "Apple Vision · 本地模型"
        : "传统 CV · 感知哈希",
    };
  }
  enqueue(id) {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.drain();
  }
  async drain() {
    if (this.running || this.paused || this.stopped) return;
    this.running = true;
    const projects = new Set();
    while (this.queue.length && !this.paused && !this.stopped) {
      const id = this.queue.shift();
      this.current = id;
      const p = this.store.get("photo", id);
      if (!p) continue;
      this.store.put("photo", { ...p, analysisStatus: "running" });
      try {
        const file = path.join(this.store.root, "previews", id + ".jpg");
        const cv = await cvFeatures(file);
        let feature = {};
        if (this.native.available)
          feature = await this.native.request({ op: "feature", path: file });
        const current = this.store.get("photo", id);
        this.store.put("photo", {
          ...current,
          ...cv,
          embedding: feature.embedding,
          faces: feature.faces || [],
          localModel: feature.model || "感知哈希",
          analysisStatus: "done",
          analysisError: null,
        });
      } catch (e) {
        this.store.put("photo", {
          ...this.store.get("photo", id),
          analysisStatus: "error",
          analysisError: e.message,
        });
      }
      projects.add(p.projectId);
      if (this.queue.length % 50 === 0)
        for (const projectId of projects) this.regroup(projectId);
    }
    for (const id of projects) this.regroup(id);
    this.current = null;
    this.running = false;
  }
  regroup(projectId, level) {
    if (level && !["strict", "standard", "loose"].includes(level))
      throw new Error("相似度档位无效");
    const project = this.store.get("project", projectId);
    if (!project) return;
    const selected = level || project.similarity || "standard";
    if (level) this.store.put("project", { ...project, similarity: level });
    this.store.transaction(() => {
      const photos = this.store.photos(projectId);
      const prior = new Map(photos.map((p) => [p.id, p]));
      for (const p of groupPhotos(photos, selected)) {
        const old = prior.get(p.id);
        if (old.similarId !== p.similarId || old.sceneId !== p.sceneId)
          this.store.put("photo", p);
      }
    });
  }
  pause() {
    this.paused = true;
    this.store.put("settings", { id: "local-queue", paused: true });
  }
  resume() {
    this.paused = false;
    this.store.put("settings", { id: "local-queue", paused: false });
    void this.drain();
  }
}
