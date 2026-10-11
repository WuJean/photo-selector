import { Store } from "../server/database.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
const count = Number(process.env.BENCH_COUNT || 3000),
  root = await mkdtemp(path.join(os.tmpdir(), "photo-wall-bench-")),
  port = 4175;
const child = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    PHOTO_SELECTOR_DATA_DIR: root,
    PHOTO_SELECTOR_ADMIN_PASSWORD: "benchmark-only-password",
  },
  stdio: "ignore",
});
let browser;
let peakRSS = 0,
  peakHeap = 0;
const monitor = setInterval(() => {
  try {
    peakRSS = Math.max(
      peakRSS,
      Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
          encoding: "utf8",
        }).trim(),
      ) / 1024,
    );
  } catch {}
}, 1000);
try {
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : "chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel("管理员密码").fill("benchmark-only-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".wall-header").waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapTimer = setInterval(async () => {
    try {
      const { metrics } = await cdp.send("Performance.getMetrics");
      peakHeap = Math.max(
        peakHeap,
        metrics.find((m) => m.name === "JSHeapUsedSize").value / 1024 ** 2,
      );
    } catch {}
  }, 1000);
  await page.exposeFunction("benchProgress", (value) =>
    console.log(JSON.stringify(value)),
  );
  const result = await page.evaluate(async (count) => {
    const root = await navigator.storage.getDirectory(),
      dir = await root.getDirectoryHandle("3000 JPEG", { create: true }),
      canvas = new OffscreenCanvas(1800, 1200),
      ctx = canvas.getContext("2d");
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `hsl(${i % 360} 24% 50%)`;
      ctx.fillRect(0, 0, 1800, 1200);
      ctx.fillStyle = "#e4d8ac";
      ctx.beginPath();
      ctx.arc(170 + (i % 9) * 155, 230, 110, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#344c49";
      ctx.beginPath();
      ctx.moveTo(0, 1200);
      ctx.lineTo(800, 280 + (i % 7) * 35);
      ctx.lineTo(1800, 1200);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = "70px sans-serif";
      ctx.fillText(`旅行 ${String(i).padStart(4, "0")}`, 80, 1090);
      const blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality: 0.82,
        }),
        h = await dir.getFileHandle(`photo-${String(i).padStart(4, "0")}.jpg`, {
          create: true,
        }),
        w = await h.createWritable();
      await w.write(blob);
      await w.close();
    }
    const { importFolder } = await import("/src/local-media.js");
    let firstMs = 0,
      lastCount = 0;
    const start = performance.now();
    const imported = await importFolder(dir, {
      direct: true,
      onProgress: (s) => {
        const n = Number(s.match(/已读取 (\d+)/)?.[1]);
        if (n && !firstMs) firstMs = performance.now() - start;
        if (n % 250 === 0 && n !== lastCount) {
          lastCount = n;
          window.benchProgress({
            imported: n,
            seconds: Math.round((performance.now() - start) / 1000),
          });
        }
      },
    });
    const { api, json } = await import("/src/api.js"),
      photos = await api("/assets"),
      collection = await api(
        "/collections",
        json("POST", { name: "3000 张性能作品集" }),
      );
    await api(
      `/collections/${collection.id}`,
      json("PUT", { photoIds: photos.map((p) => p.id) }),
    );
    return {
      count: photos.length,
      failures: imported.failed,
      firstPhotoMs: Math.round(firstMs),
      importSeconds: +((performance.now() - start) / 1000).toFixed(2),
    };
  }, count);
  const start = performance.now();
  await page.reload();
  await page.locator(".wall-card img").first().waitFor();
  await page
    .locator(".wall-card img")
    .first()
    .evaluate((img) => img.decode());
  result.refreshFirstImageMs = Math.round(performance.now() - start);
  result.initialDOMCards = await page.locator(".wall-card").count();
  const scrollStart = performance.now();
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(250);
  if (count > 100) await page.getByRole("button", { name: /加载更多/ }).click();
  result.expandedDOMCards = await page.locator(".wall-card").count();
  result.scrollLoadMs = Math.round(performance.now() - scrollStart);
  await mkdir(".local/wall-benchmark", { recursive: true });
  await page.screenshot({
    path: `.local/wall-benchmark/${count}-wall.png`,
    fullPage: false,
  });
  const response = await page.request.get(
    `http://127.0.0.1:${port}/api/assets`,
  );
  result.restoredRecords = (await response.json()).length;
  result.originalUploads = await page.evaluate(async () => {
    const ps = await (await fetch("/api/assets")).json();
    return ps.filter((p) => p.storage !== "local").length;
  });
  clearInterval(heapTimer);
  result.nodePeakRSSMB = Math.round(peakRSS);
  result.browserPeakJSHeapMB = Math.round(peakHeap);
  result.machine = {
    cpu: os.cpus()[0].model,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
  };
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  const reopened = new Store(root);
  result.reopenedRecords = reopened.all("photo").length;
  reopened.close();
  result.fixture = `${count} distinct synthetic 1800×1200 JPEG, OPFS directory, real browser worker import`;
  result.browser = await browser.version();
  await writeFile(
    ".local/wall-benchmark/benchmark.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearInterval(monitor);
  await browser?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  await rm(root, { recursive: true, force: true });
}
