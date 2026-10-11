// Explicit opt-in integration check; uses synthetic images and an isolated library.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../server/database.mjs";
import { NativeBridge } from "../server/native.mjs";
import { Vault, AIClient } from "../server/ai.mjs";
import { structuredTags, DEFAULT_TAGS } from "../shared/tags.mjs";
import { importPhoto, previewData } from "../server/images.mjs";
import { CreationQueue } from "../server/creations.mjs";
import {
  generateImage,
  normalizeImageConfig,
} from "../server/image-generation.mjs";
if (process.env.LIVE_AI_TEST !== "1")
  throw new Error(
    "Set LIVE_AI_TEST=1 to call the configured real service with synthetic fixtures.",
  );
const config = await (await fetch("http://127.0.0.1:4173/api/settings")).json();
const root = path.resolve(".local/qa/live-" + Date.now());
await mkdir(root, { recursive: true });
const store = new Store(root),
  native = new NativeBridge(),
  vault = new Vault(native);
let queue;
const report = { root, model: config.model, steps: [] };
try {
  const key = await vault.get(config);
  if (!key) throw new Error("No saved key");
  store.put("settings", { ...config, id: "ai" });
  const generation = normalizeImageConfig({ model: "wan2.7-image" }, config);
  store.put("settings", generation);
  const project = store.project("真实服务合成素材验收"),
    photos = [];
  for (let i = 0; i < 3; i++) {
    const source = path.join(root, `sample-${i}.jpg`);
    await sharp(
      Buffer.from(
        `<svg width="900" height="650"><rect width="900" height="650" fill="#93b2c5"/><circle cx="${120 + i * 120}" cy="110" r="50" fill="#eee0a0"/><path d="M0 650L400 180L850 650Z" fill="#567268"/><path d="M305 310L400 180L500 315Z" fill="white"/></svg>`,
      ),
    )
      .jpeg()
      .toFile(source);
    const p = await importPhoto(store, project.id, source, `sample-${i}.jpg`);
    photos.push(p);
  }
  const start = Date.now();
  await Promise.all(
    photos.map(async (p) => {
      const client = new AIClient(config, key);
      const ai = await client.analyze(await previewData(store, p.id), {
        vocabulary: {
          version: 1,
          schemaVersion: 2,
          tags: structuredTags(DEFAULT_TAGS),
        },
      });
      store.put("photo", { ...p, status: "keep", finalStatus: "keep", ai });
    }),
  );
  report.steps.push({
    phase: "parallel-labels",
    count: 3,
    seconds: (Date.now() - start) / 1000,
    passed: true,
  });
  console.log(JSON.stringify(report.steps.at(-1)));
  const c = store.put("collection", {
    id: "live-collection",
    projectId: project.id,
    name: "山峰插画",
    description: "基于三张山峰插画，做一张清冷自然风格的旅行封面，不要文字。",
    photoIds: photos.map((p) => p.id),
  });
  queue = new CreationQueue(store, vault, async (job, signal) =>
    generateImage(job.imageConfig, key, {
      prompt: job.plan.prompt,
      ratio: job.ratio,
      images: await Promise.all(
        job.plan.referenceIds.map((id) => previewData(store, id)),
      ),
      signal,
    }),
  );
  for (const kind of ["copy", "cover"]) {
    const started = Date.now(),
      j = queue.start(project.id, c.id, kind);
    let last = "";
    while (queue.running.has(j.id)) {
      const current = queue.get(j.id);
      if (current.stage !== last) {
        console.log(JSON.stringify({ phase: kind, stage: current.stage }));
        last = current.stage;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const result = queue.get(j.id);
    if (result.state !== "done") throw new Error(result.error || result.state);
    const item = store.get("creation", result.creationId);
    report.steps.push({
      phase: kind,
      seconds: (Date.now() - started) / 1000,
      passed: true,
      file: item.file ? path.join(root, "creations", item.file) : null,
    });
    console.log(JSON.stringify(report.steps.at(-1)));
  }
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
  console.log(JSON.stringify({ error: e.message }));
} finally {
  await writeFile(
    ".local/qa/live-integration.json",
    JSON.stringify(report, null, 2),
  );
  native.close();
  store.close();
}
