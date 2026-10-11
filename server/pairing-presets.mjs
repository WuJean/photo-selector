import { randomUUID } from "node:crypto";
import { validatePairingPreset } from "../shared/pairing.mjs";

export function registerPairingPresets(app, store) {
  const kind = "pairingPreset";
  app.get("/api/pairing-presets", (req, res) => res.json(store.all(kind)));
  app.post("/api/pairing-presets", (req, res) => {
    const value = {
      ...validatePairingPreset(req.body),
      id: randomUUID(),
      revision: 1,
    };
    store.put(kind, value);
    res.status(201).json(value);
  });
  const current = (req) => {
    const value = store.get(kind, req.params.id);
    if (!value) throw Object.assign(new Error("模板已不存在"), { status: 404 });
    if (value.revision !== req.body?.revision)
      throw Object.assign(new Error("模板已在其他页面修改，请重新打开"), {
        status: 409,
      });
    return value;
  };
  app.put("/api/pairing-presets/:id", (req, res) => {
    const previous = current(req);
    const value = {
      ...validatePairingPreset(req.body),
      id: previous.id,
      revision: previous.revision + 1,
    };
    store.put(kind, value);
    res.json(value);
  });
  app.delete("/api/pairing-presets/:id", (req, res) => {
    current(req);
    store.remove(kind, req.params.id);
    res.json({ ok: true });
  });
}
