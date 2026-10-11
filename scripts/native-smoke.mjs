import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { privateAddresses } from "./deploy-config.mjs";
import assert from "node:assert/strict";
if (process.platform !== "darwin") {
  console.log("Native smoke requires macOS");
  process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), "photo-native-smoke-"));
const reserve = net.createServer();
await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
const port = reserve.address().port;
await new Promise((r) => reserve.close(r));
const env = {
  ...process.env,
  PHOTO_SELECTOR_PORT: String(port),
  PHOTO_SELECTOR_BIND: "0.0.0.0",
  PHOTO_SELECTOR_PUBLIC_URL: `http://localhost:${port}`,
  PHOTO_SELECTOR_DATA_DIR: path.join(root, "data"),
  PHOTO_SELECTOR_RUN_DIR: path.join(root, "run"),
};
delete env.PORT;
delete env.HOST;
delete env.PHOTO_SELECTOR_ADMIN_PASSWORD;
async function run(args = [], ok = true) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["deploy.sh", "--native", ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (ok && code) reject(new Error(out));
      else resolve({ code, out });
    });
  });
}
const request = (url, method = "GET", body, cookie) =>
  fetch(`http://127.0.0.1:${port}/api${url}`, {
    method,
    headers: {
      Origin: `http://127.0.0.1:${port}`,
      ...(cookie ? { cookie } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
try {
  console.log("Build and first native deployment");
  await run();
  assert.equal((await request("/health")).status, 200);
  const address = privateAddresses()[0];
  if (address) {
    const response = await fetch(`http://${address}:${port}/api/health`, {
      headers: { Origin: `http://${address}:${port}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
  }
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Origin: "https://unrelated.example" },
      })
    ).status,
    403,
  );
  assert.equal((await request("/collections")).status, 401);
  const login = await request("/auth/login", "POST", { password: "passwd" });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await request("/collections", "GET", null, cookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/auth/password",
        "PUT",
        { password: "native-smoke-personal-password" },
        cookie,
      )
    ).status,
    200,
  );
  const signed = await request("/auth/login", "POST", {
    password: "native-smoke-personal-password",
  });
  const session = signed.headers.get("set-cookie").split(";")[0];
  const c = await (
    await request(
      "/collections",
      "POST",
      { name: "重启保留", date: "2025-05-01" },
      session,
    )
  ).json();
  assert.ok(c.id);
  const first = JSON.parse(
    await readFile(path.join(root, "run/native.json"), "utf8"),
  );
  assert.match((await run(["status"])).out, /运行中/);
  await run(["start"]);
  assert.equal(
    JSON.parse(await readFile(path.join(root, "run/native.json"), "utf8")).pid,
    first.pid,
  );
  // Repeat the full deploy: build first, then replace only the managed process.
  console.log("Repeated build/deployment and data preservation");
  await run();
  assert.notEqual(
    JSON.parse(await readFile(path.join(root, "run/native.json"), "utf8")).pid,
    first.pid,
  );
  assert.equal(
    (await request("/auth/login", "POST", { password: "passwd" })).status,
    401,
  );
  const again = await request("/auth/login", "POST", {
    password: "native-smoke-personal-password",
  });
  const restored = again.headers.get("set-cookie").split(";")[0];
  assert.ok(
    (await (await request("/collections", "GET", null, restored)).json()).some(
      (v) => v.id === c.id,
    ),
  );
  await run(["restart"]);
  await run(["stop"]);
  assert.match((await run(["status"])).out, /未运行/);
  // A stale PID referring to another process must never be killed.
  await writeFile(
    path.join(root, "run/native.json"),
    JSON.stringify({
      pid: process.pid,
      marker: "not-managed",
      root: process.cwd(),
    }),
  );
  await run(["stop"]);
  assert.ok(process.pid);
  const busy = net.createServer();
  await new Promise((r) => busy.listen(port, "0.0.0.0", r));
  const conflict = await run(["start"], false);
  assert.notEqual(conflict.code, 0);
  assert.match(conflict.out, /已被占用/);
  assert.ok(busy.listening);
  await new Promise((r) => busy.close(r));
  console.log(
    "Native smoke PASS: production build, default password/change, managed lifecycle, repeated deploy, persistence, unknown PID protection, port conflict.",
  );
} finally {
  await run(["stop"], false).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
