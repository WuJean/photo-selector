import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, errors } from "../../server/app.mjs";
import { registerLibrary } from "../../server/library.mjs";
export async function fixture(register = () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wall-test-"));
  const { app, store, upload } = createApp({
    root,
    authentication: true,
    password: "fixture-password-123",
  });
  registerLibrary(app, store, upload);
  register(app, store, upload);
  errors(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "fixture-password-123" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = (url, method = "GET", body) =>
    fetch(base + "/api" + url, {
      method,
      headers: {
        cookie,
        Origin: base,
        ...(!(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
  const json = async (...args) => {
    const r = await request(...args);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  return {
    root,
    app,
    store,
    base,
    cookie,
    request,
    json,
    async close() {
      await new Promise((r) => server.close(r));
      app.locals.cleanupQueue?.close();
      app.locals.closeShares?.();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
