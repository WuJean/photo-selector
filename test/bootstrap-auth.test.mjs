import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, errors } from "../server/app.mjs";
import { hashPassword } from "../server/auth.mjs";
import { Store } from "../server/database.mjs";
for (const legacy of [false, true])
  test(`bootstrap password requires change and survives restart (legacy=${legacy})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bootstrap-"));
    if (legacy) {
      const s = new Store(root);
      s.put("account", {
        id: "admin",
        password: hashPassword("legacy-random"),
      });
      s.close();
      await writeFile(
        path.join(root, "admin-initial-password"),
        "legacy-random\n",
      );
    }
    let running;
    const start = async () => {
      const { app, store } = createApp({ root, authentication: true });
      app.get("/api/private", (_, r) => r.json({ ok: true }));
      errors(app);
      const server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      running = { store, server };
      return `http://127.0.0.1:${server.address().port}`;
    };
    const stop = async () => {
      await new Promise((r) => running.server.close(r));
      running.store.close();
    };
    try {
      let base = await start(),
        cookie = "";
      const req = (url, method = "GET", body) =>
        fetch(base + "/api" + url, {
          method,
          headers: { cookie, "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
      let r = await req("/auth/login", "POST", { password: "passwd" });
      assert.equal((await r.json()).mustChangePassword, true);
      cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal((await req("/private")).status, 403);
      assert.equal(
        (await (await req("/auth/session")).json()).mustChangePassword,
        true,
      );
      assert.equal(
        (await req("/auth/password", "PUT", { password: "short" })).ok,
        false,
      );
      assert.equal(
        (
          await req("/auth/password", "PUT", {
            password: "my-personal-password",
          })
        ).status,
        200,
      );
      assert.equal((await req("/private")).status, 401);
      await stop();
      base = await start();
      assert.equal(
        (await req("/auth/login", "POST", { password: "passwd" })).status,
        401,
      );
      r = await req("/auth/login", "POST", {
        password: "my-personal-password",
      });
      assert.equal((await r.json()).mustChangePassword, false);
      cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal((await req("/private")).status, 200);
    } finally {
      await stop();
      await rm(root, { recursive: true, force: true });
    }
  });
