import path from "node:path";
import { createApp, errors } from "./app.mjs";
import { NativeBridge } from "./native.mjs";
import { LocalQueue } from "./analysis.mjs";
import { registerCuration } from "./curation.mjs";
import { registerAI } from "./ai.mjs";
import { registerVocabulary } from "./vocabulary.mjs";
import { registerTags } from "./tags.mjs";
import { registerExports } from "./exports.mjs";
const root = path.resolve(process.env.PHOTO_SELECTOR_DATA_DIR || ".local");
const native = new NativeBridge();
let local;
const { app, store, upload } = createApp({
  root,
  onImport: (photo) => local.enqueue(photo.id),
});
local = new LocalQueue(store, native);
void local.drain();
registerCuration(app, store);
registerTags(app, store);
const aiQueue = registerAI(app, store, native);
registerVocabulary(app, store);
registerExports(app, store, upload);
app.get("/api/jobs", (req, res) =>
  res.json({ local: local.state(), ai: aiQueue.state() }),
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
app.listen(port, "127.0.0.1", () =>
  console.log(`选片助手 http://127.0.0.1:${port}`),
);
