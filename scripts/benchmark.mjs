import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Store } from "../server/database.mjs";
import { importPhoto } from "../server/images.mjs";
import { NativeBridge } from "../server/native.mjs";
import { LocalQueue } from "../server/analysis.mjs";
const count = Number(process.env.BENCH_COUNT || 3000);
const root = path.resolve(".local/benchmarks/" + Date.now());
await mkdir(root, { recursive: true });
const store = new Store(root),
  native = new NativeBridge(),
  queue = new LocalQueue(store, native);
const project = store.project(`性能验收 · ${count} 张合成 JPEG`);
const samples = [];
for (let i = 0; i < 30; i++) {
  const source = path.join(root, `sample-${i}.jpg`);
  const width = i % 3 === 0 ? 1200 : 1800,
    height = i % 3 === 0 ? 1800 : 1200;
  const svg = `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="hsl(${i * 11},20%,65%)"/><circle cx="${width * (0.15 + (i % 6) * 0.12)}" cy="${height * 0.2}" r="${height * 0.08}" fill="#f8e6bd"/><path d="M0 ${height} L${width * 0.3} ${height * 0.3} L${width * 0.7} ${height} M${width * 0.3} ${height} L${width * 0.8} ${height * 0.45} L${width} ${height}" fill="#456457"/><text x="50" y="${height * 0.9}" font-size="70" fill="#dbe6d0">Fixture ${i}</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(source);
  samples.push(source);
}
const start = performance.now();
let first = 0,
  maxRSS = 0;
const monitor = setInterval(
  () => (maxRSS = Math.max(maxRSS, process.memoryUsage().rss)),
  250,
);
try {
  for (let i = 0; i < count; i++) {
    const p = await importPhoto(
      store,
      project.id,
      samples[i % 30],
      `photo-${String(i + 1).padStart(4, "0")}.jpg`,
      Date.UTC(2026, 0, 1) + i * 1000,
    );
    queue.enqueue(p.id);
    if (!i) first = performance.now() - start;
    if ((i + 1) % 250 === 0)
      console.log(
        JSON.stringify({
          imported: i + 1,
          remainingAnalysis: queue.queue.length,
          elapsedSeconds: Math.round((performance.now() - start) / 1000),
        }),
      );
  }
  const importSeconds = (performance.now() - start) / 1000;
  while (queue.running || queue.queue.length)
    await new Promise((r) => setTimeout(r, 250));
  const elapsedSeconds = (performance.now() - start) / 1000;
  const photos = store.photos(project.id),
    done = photos.filter((p) => p.analysisStatus === "done").length;
  const nativeRSS = native.child
    ? Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(native.child.pid)], {
          encoding: "utf8",
        }).trim(),
      ) * 1024
    : 0;
  store.close();
  const reopened = new Store(root);
  const restored = reopened.photos(project.id).length;
  reopened.close();
  const report = {
    root,
    projectId: project.id,
    count,
    dimensions: "1800×1200 / 1200×1800 synthetic JPEG; 30 scenes repeated",
    model: native.available ? "Apple Vision revision 2" : "CV fallback",
    machine: {
      cpu: os.cpus()[0].model,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
    },
    firstPhotoMs: Math.round(first),
    importSeconds: +importSeconds.toFixed(2),
    completeSeconds: +elapsedSeconds.toFixed(2),
    nodePeakRSSMB: Math.round(maxRSS / 1024 ** 2),
    nativeRSSMB: Math.round(nativeRSS / 1024 ** 2),
    analysisDone: done,
    analysisErrors: photos.filter((p) => p.analysisStatus === "error").length,
    restored,
    groups: new Set(photos.map((p) => p.similarId)).size,
  };
  await mkdir(".local/qa", { recursive: true });
  await writeFile(".local/qa/benchmark.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (done !== count || restored !== count) process.exitCode = 1;
} finally {
  clearInterval(monitor);
  native.close();
}
