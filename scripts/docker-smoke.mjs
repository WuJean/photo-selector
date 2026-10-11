import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { newDraft } from "../shared/layout.mjs";

// A fresh project and volume on every run; never touch the user's deployment.
const name = `photo-smoke-${randomUUID().slice(0, 8)}`;
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PHOTO_SELECTOR_BIND: "127.0.0.1",
  PHOTO_SELECTOR_PORT: String(port),
  PHOTO_SELECTOR_PUBLIC_URL: `http://localhost:${port}`,
  PHOTO_SELECTOR_VOLUME: name + "-data",
};
const run = (args, { input, capture = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-p", name, ...args], {
      env,
      stdio: [
        input ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
        "inherit",
      ],
    });
    const chunks = [];
    if (capture) child.stdout.on("data", (chunk) => chunks.push(chunk));
    if (input) {
      child.stdin.on("error", reject);
      child.stdin.end(input);
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`Docker command failed (${code})`)),
    );
  });
let cookie = "";
const request = async (url, method = "GET", body) => {
  const response = await fetch(base + url, {
    method,
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(
    response.ok,
    `${method} ${url}: HTTP ${response.status} ${response.ok ? "" : await response.text()}`,
  );
  return response;
};
const json = async (...args) => (await request(...args)).json();
const fixtureKey = "docker-smoke-fixture-not-a-real-key";
const config = { baseURL: "http://127.0.0.1:4589/v1", model: "fixture-vision" };
const mock = async () => {
  await run([
    "exec",
    "-d",
    "web",
    "node",
    "-e",
    `require('node:http').createServer((req,res)=>{if(req.headers.authorization!==${JSON.stringify("Bearer " + fixtureKey)}){res.writeHead(401);return res.end()}let data='';req.on('data',b=>data+=b);req.on('end',()=>{const body=JSON.parse(data);if(!JSON.stringify(body).includes('data:image/jpeg;base64,')){res.writeHead(400);return res.end()}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({color:'red'})}}]}))})}).listen(4589,'127.0.0.1')`,
  ]);
  for (let i = 0; i < 20; i++) {
    try {
      await run([
        "exec",
        "-T",
        "web",
        "node",
        "-e",
        "fetch('http://127.0.0.1:4589').then(()=>{}).catch(()=>process.exit(1))",
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Mock service did not start");
};
let browser;
try {
  await run(["up", "-d", "--build", "--wait", "--wait-timeout", "120"]);
  assert.equal((await json("/api/health")).ok, true);
  assert.match((await request("/")).headers.get("content-type"), /text\/html/);
  assert.equal(
    (
      await fetch(base + "/api/projects", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/api/assets")).status, 401);
  const password = (
    await run(["exec", "-T", "web", "cat", "/data/admin-initial-password"], {
      capture: true,
    })
  )
    .toString()
    .trim();
  const auth = await request("/api/auth/login", "POST", { password });
  cookie = auth.headers.get("set-cookie").split(";")[0];
  const project = await json("/api/batches", "POST", {
    name: "Docker 验收",
    source: "upload",
  });
  const form = new FormData();
  const originals = [];
  for (const color of ["#729eae", "#638d72", "#dfb076"]) {
    const image = await sharp(
      Buffer.from(
        `<svg width="800" height="600"><rect width="800" height="600" fill="${color}"/><path d="M0 600L390 80L800 600" fill="#eef1ec"/></svg>`,
      ),
    )
      .jpeg()
      .withMetadata()
      .toBuffer();
    originals.push(image);
    form.append(
      "photos",
      new Blob([image], { type: "image/jpeg" }),
      `photo-${originals.length}.jpg`,
    );
  }
  const upload = await fetch(base + `/api/batches/${project.id}/import`, {
    method: "POST",
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.ok(upload.ok);
  const photos = (await upload.json()).results.map((r) => {
    assert.ok(r.photo, r.error);
    return r.photo;
  });
  assert.equal(photos.length, 3);
  for (let i = 0; i < photos.length; i++) {
    for (const variant of ["thumb", "preview", "original"]) {
      const image = Buffer.from(
        await (
          await request(`/api/photos/${photos[i].id}/${variant}`)
        ).arrayBuffer(),
      );
      assert.equal((await sharp(image).metadata()).format, "jpeg");
      if (variant === "original") assert.deepEqual(image, originals[i]);
    }
  }
  for (let i = 0; i < 50; i++) {
    const current = await json(`/api/batches/${project.id}/photos`);
    if (current.every((p) => p.analysisStatus === "done")) break;
    assert.ok(i < 49, "Local CV did not finish");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.match((await json("/api/jobs")).local.model, /传统 CV/);
  for (const round of ["initial", "final"])
    await json(`/api/batches/${project.id}/decisions`, "PATCH", {
      ids: photos.map((p) => p.id),
      round,
      status: "keep",
    });
  const draft = {
    ...newDraft("library", photos),
    longEdge: 800,
    frame: "caption",
  };
  draft.watermark.text = "旅行 · 选片助手";
  const image = Buffer.from(
    await (
      await request("/api/projects/library/render", "POST", draft)
    ).arrayBuffer(),
  );
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.height, 800);
  assert.equal(metadata.exif, undefined);
  await json("/api/projects/library/draft", "PUT", draft);
  const settings = await json("/api/settings", "PUT", {
    ...config,
    apiKey: fixtureKey,
  });
  assert.equal(settings.hasKey, true);
  assert.equal(settings.keyStorage, "本地加密凭据");
  assert.equal(JSON.stringify(settings).includes(fixtureKey), false);
  await mock();
  assert.equal((await json("/api/settings/test", "POST", config)).ok, true);
  await run([
    "up",
    "-d",
    "--force-recreate",
    "--no-build",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  assert.equal((await json("/api/settings")).hasKey, true);
  assert.ok(
    (await json(`/api/batches/${project.id}/photos`)).every(
      (p) => p.status === "keep" && p.finalStatus === "keep",
    ),
  );
  assert.equal(
    (await json("/api/projects/library/draft")).watermark.text,
    draft.watermark.text,
  );
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`/api/photos/${photos[0].id}/original`)
      ).arrayBuffer(),
    ),
    originals[0],
  );
  await mock();
  assert.equal((await json("/api/settings/test", "POST", config)).ok, true);
  const collection = await json("/api/collections", "POST", { name: "作品集" });
  await json(`/api/collections/${collection.id}`, "PUT", {
    photoIds: photos.map((p) => p.id),
  });
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : "chrome",
  });
  await mkdir("test-results/docker", { recursive: true });
  for (const host of ["127.0.0.1", "localhost"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    await context.addInitScript(
      (id) => localStorage.setItem("photo-project", id),
      project.id,
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://${host}:${port}`);
    await page.getByLabel("管理员密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    const card = page.locator(".wall-card img").first();
    await card.waitFor();
    await card.evaluate((image) => image.decode());
    assert.ok(await card.evaluate((image) => image.naturalWidth > 0));
    await page.reload();

    await card.waitFor();
    await card.evaluate((image) => image.decode());
    await page.screenshot({ path: `test-results/docker/${host}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Exercise the exact documented tar backup/restore flow, into a new volume.
  await run(["stop", "web"]);
  const archive = await run(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "web",
      "-C",
      "/data",
      "-czf",
      "-",
      ".",
    ],
    { capture: true },
  );
  assert.ok(archive.length > 1000);
  env.PHOTO_SELECTOR_VOLUME = name + "-restored";
  await run(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "tar",
      "web",
      "-C",
      "/data",
      "-xzf",
      "-",
    ],
    { input: archive },
  );
  await run([
    "up",
    "-d",
    "--force-recreate",
    "--no-build",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  assert.equal((await json("/api/settings")).hasKey, true);
  assert.equal(
    (await json("/api/projects/library/draft")).watermark.text,
    draft.watermark.text,
  );
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`/api/photos/${photos[0].id}/original`)
      ).arrayBuffer(),
    ),
    originals[0],
  );
  await mock();
  assert.equal((await json("/api/settings/test", "POST", config)).ok, true);
  await json("/api/settings/key", "DELETE");
  assert.equal((await json("/api/settings")).hasKey, false);
  console.log(
    "Docker smoke PASS: JPEG import/decode, local CV, two rounds, Chinese watermark, export, origin protection, encrypted keys, recreated-container persistence, mock multimodal service, browser refresh on both addresses, complete backup/restore.",
  );
} finally {
  await browser?.close();
  await run(["logs", "--tail", "40"]).catch(() => {});
  await run(["down", "--volumes", "--remove-orphans"]);
  if (env.PHOTO_SELECTOR_VOLUME !== name + "-data") {
    env.PHOTO_SELECTOR_VOLUME = name + "-data";
    await run(["down", "--volumes", "--remove-orphans"]);
  }
}
