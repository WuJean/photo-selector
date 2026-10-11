import { mkdir, writeFile, link } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { Store } from "../server/database.mjs";
const root = path.resolve(".local/mobile-benchmarks", String(Date.now()));
await mkdir(root, { recursive: true });
const store = new Store(root);
store.put("project", { id: "library", name: "Synthetic benchmark" });
const original = path.join(root, "fixture.jpg");
await sharp(
  Buffer.from(
    '<svg width="600" height="800"><rect width="600" height="800" fill="#465e53"/><circle cx="440" cy="180" r="65" fill="#dfc2a2"/><path d="M0 800L220 290L600 800" fill="#a3ad95"/></svg>',
  ),
)
  .jpeg()
  .toFile(original);
const ids = Array.from(
  { length: 3000 },
  (_, i) => "benchmark-" + String(i).padStart(4, "0"),
);
for (const id of ids)
  for (const folder of ["originals", "previews", "thumbs"])
    await link(original, path.join(root, folder, id + ".jpg"));
store.transaction(() => {
  for (const id of ids)
    store.put("photo", {
      id,
      projectId: "library",
      name: id + ".jpg",
      storage: "server",
      width: 600,
      height: 800,
      status: "keep",
      finalStatus: "keep",
      analysisStatus: "done",
      ai: { tags: ["风景", "远景"], description: "合成山景测试图片" },
      takenAt: "2025-01-01T00:00:00Z",
    });
  store.put("collection", {
    id: "benchmark",
    projectId: "library",
    name: "3000 张合成照片",
    photoIds: ids,
    date: "2025-01-01",
    location: "合成测试",
    description: "非个人照片",
  });
});
store.close();
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const password = randomUUID();
const server = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    PHOTO_SELECTOR_DATA_DIR: root,
    PHOTO_SELECTOR_ADMIN_PASSWORD: password,
    PHOTO_SELECTOR_PUBLIC_URL: "",
  },
  stdio: "ignore",
});
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await context.request.post(base + "/api/auth/login", { data: { password } });
  await context.request.put(base + "/api/auth/password", {
    data: { password: password + "changed" },
  });
  await context.request.post(base + "/api/auth/login", {
    data: { password: password + "changed" },
  });
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  let assetCalls = 0,
    pages = 0,
    maxHeap = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/assets") assetCalls++;
    if (r.url().includes("/photos?limit")) pages++;
  });
  const started = performance.now();
  await page.goto(base + "/#album/benchmark");
  await page.locator(".album-photo").nth(39).waitFor();
  const firstPageMs = performance.now() - started;
  await page
    .locator(".album-photo img")
    .first()
    .evaluate((img) => img.decode());
  await page.screenshot({ path: path.join(root, "phone-first.png") });
  for (let n = 80; n <= 3000; n += 40) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.waitForFunction(
      (n) => document.querySelectorAll(".album-photo").length >= n,
      n,
    );
    const metrics = await session.send("Performance.getMetrics");
    maxHeap = Math.max(
      maxHeap,
      metrics.metrics.find((m) => m.name === "JSHeapUsedSize").value,
    );
  }
  const scrollMs = performance.now() - started;
  await page.screenshot({ path: path.join(root, "phone-last.png") });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(root, "tablet.png") });
  const report = {
    count: 3000,
    device: os.type() + " " + os.release() + " " + os.arch(),
    cpu: os.cpus()[0]?.model,
    browser: browser.version(),
    firstPageMs: Math.round(firstPageMs),
    scrollAllMs: Math.round(scrollMs),
    pages,
    allAssetsCalls: assetCalls,
    peakJsHeapMiB: Math.round(maxHeap / 1048576),
    note: "Desktop Chromium touch emulation; heap excludes image/GPU/native memory; no physical device measurement",
  };
  await writeFile(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, report: path.join(root, "report.json") },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
