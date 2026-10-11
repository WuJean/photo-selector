// Explicit opt-in: verifies configured multimodal service with synthetic photos only.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../server/database.mjs";
import { NativeBridge } from "../server/native.mjs";
import { Vault, AIClient, validateRecommendation } from "../server/ai.mjs";
import { importPhoto } from "../server/images.mjs";
import { visualCandidates } from "../shared/pairing.mjs";
import { visualRecommendationMessages } from "../server/recommendation.mjs";
if (process.env.LIVE_AI_TEST !== "1")
  throw Error(
    "Set LIVE_AI_TEST=1 to test the configured model with synthetic photos.",
  );
const root = path.resolve(".local/qa/pairing-" + Date.now());
await mkdir(root, { recursive: true });
const store = new Store(root),
  native = new NativeBridge(),
  vault = new Vault(native);
const report = { root, passed: false };
try {
  const config = await (
      await fetch("http://127.0.0.1:4173/api/settings")
    ).json(),
    key = await vault.get(config);
  if (!key) throw Error("No configured key");
  const project = store.project("合成素材看图搭配验证"),
    photos = [];
  for (let i = 0; i < 12; i++) {
    const portrait = i % 3 !== 1,
      color = ["#9DB4B7", "#B8C5B4", "#99AEBD"][i % 3],
      left = i % 3 === 2;
    const shape = portrait
      ? `<circle cx="${left ? 390 : 210}" cy="210" r="70" fill="#E5BE97"/><path d="${left ? "M335 185L295 212L340 225" : "M265 185L305 212L260 225"}" fill="#E5BE97"/><path d="${left ? "M270 750Q240 320 390 320Q530 320 540 750" : "M60 750Q60 320 210 320Q360 320 340 750"}" fill="#516F70"/>`
      : '<path d="M0 700L200 230L380 650L500 380L600 800Z" fill="#516F70"/><path d="M157 330L200 230L243 330Z" fill="#F1F0DF"/>';
    const file = path.join(root, `source-${i}.jpg`);
    await sharp(
      Buffer.from(
        `<svg width="600" height="800"><rect width="600" height="800" fill="${color}"/><circle cx="500" cy="100" r="40" fill="#EEDFAD"/>${shape}</svg>`,
      ),
    )
      .jpeg()
      .toFile(file);
    const photo = await importPhoto(store, project.id, file, `sample-${i}.jpg`);
    photos.push(
      store.put("photo", {
        ...photo,
        status: "keep",
        finalStatus: "keep",
        ai: {
          description: "合成旅行图案",
          tags: portrait ? ["人像", left ? "远景" : "近景"] : ["风景", "远景"],
        },
      }),
    );
  }
  const query =
    "用人像近景、风景远景、人像远景做一张三拼，观察实际图片的色彩、构图和人物朝向，解释搭配原因。";
  const candidates = visualCandidates(photos, query),
    messages = await visualRecommendationMessages(store, candidates, {
      query,
      locked: [],
      current: null,
      ratio: "3:4",
    });
  const started = Date.now(),
    client = new AIClient(config, key);
  const result = await client.complete(
    messages,
    (v) => validateRecommendation(v, candidates),
    { timeoutMs: 180_000 },
  );
  Object.assign(report, {
    passed: true,
    model: config.model,
    viewedCount: candidates.length,
    seconds: (Date.now() - started) / 1000,
    result,
    usage: client.usage,
  });
  console.log(
    JSON.stringify({
      passed: true,
      model: config.model,
      viewedCount: candidates.length,
      seconds: report.seconds,
      template: result.template,
      reason: result.reason,
    }),
  );
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
  console.log(JSON.stringify({ error: e.message }));
} finally {
  await writeFile(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2),
  );
  native.close();
  store.close();
}
