import { registerAutomaticAI } from "./automatic-ai.mjs";
import { registerMedia } from "./media.mjs";
import { registerShares } from "./shares.mjs";
import { registerNetwork } from "./network-import.mjs";
import { registerCleanup } from "./cleanup.mjs";
import { registerLibrary } from "./library.mjs";
import { registerImageGeneration, imageConfig } from "./image-generation.mjs";
import { registerCreations } from "./creations.mjs";
import path from "node:path";
import { createApp, errors } from "./app.mjs";
import { NativeBridge } from "./native.mjs";
import { LocalQueue } from "./analysis.mjs";
import { registerCuration } from "./curation.mjs";
import { registerAI, AIClient } from "./ai.mjs";
import { registerVocabulary } from "./vocabulary.mjs";
import { registerTags } from "./tags.mjs";
import { registerPairingPresets } from "./pairing-presets.mjs";
import { registerExports } from "./exports.mjs";
const root = path.resolve(process.env.PHOTO_SELECTOR_DATA_DIR || ".local");
const native = new NativeBridge();
let local;
const { app, store, upload } = createApp({
  root,
  authentication: true,
  publicURL: process.env.PHOTO_SELECTOR_PUBLIC_URL || "",
  allowedOrigins: process.env.PHOTO_SELECTOR_ALLOWED_ORIGINS || "",
  onImport: (photo) => local.enqueue(photo.id),
});
local = new LocalQueue(store, native);
void local.drain();
registerLibrary(app, store, upload, { onImport: (p) => local.enqueue(p.id) });
registerNetwork(app, store, (p) => local.enqueue(p.id));
registerCleanup(app, store);
registerShares(app, store, upload);
registerMedia(app, store, upload);
registerCuration(app, store);
registerTags(app, store);
const aiQueue = registerAI(app, store, native);
const automaticAI = registerAutomaticAI(
  app,
  store,
  app.locals.aiVault,
  (config, key) => new AIClient(config, key),
);
registerVocabulary(app, store);
registerExports(app, store, upload);
registerPairingPresets(app, store);
const generate = registerImageGeneration(app, store);
const creations = registerCreations(app, store, { generate });
app.get("/api/jobs", (req, res) =>
  res.json({
    imageGenerationEnabled: imageConfig(store).enabled,
    creations: store.all("creationJob").map((j) => creations.public(j)),
    local: local.state(),
    ai: aiQueue.state(),
    automatic: automaticAI.state(),
    vocabulary: store.all("vocabularyJob").map(({ config, ...job }) => job),
  }),
);
app.post("/api/local/:action", (req, res) => {
  if (req.params.action === "pause") local.pause();
  else if (req.params.action === "resume") local.resume();
  else if (req.params.action === "retry")
    for (const p of store
      .all("photo")
      .filter((p) => p.analysisStatus === "error"))
      local.enqueue(p.id);
  res.json(local.state());
});
app.post("/api/projects/:id/regroup", (req, res) => {
  local.regroup(req.params.id, req.body.level);
  res.json({ ok: true });
});
if (process.env.NODE_ENV === "production") {
  const { default: express } = await import("express");
  app.use(express.static(path.resolve("dist/web")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.resolve("dist/web/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      hmr: { port: Number(process.env.PORT || 4173) + 20000 },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
errors(app);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () =>
  console.log(
    `选片助手 ${process.env.PHOTO_SELECTOR_PUBLIC_URL || `http://${host}:${port}`}`,
  ),
);
