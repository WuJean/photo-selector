import { test, expect } from "@playwright/test";
import sharp from "sharp";
const jpeg = async (color, index = 0) =>
  sharp(
    Buffer.from(
      `<svg width="800" height="600"><rect width="800" height="600" fill="${color}"/><circle cx="${150 + index * 120}" cy="140" r="60" fill="#f2deb7"/><path d="M0 600 L270 160 L500 600 M300 600 L620 280 L800 600" fill="#536b64"/><path d="M210 260 L270 160 L330 260 Z" fill="#f1f4eb"/></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
test("first import retains chosen files while automatic project creation is delayed", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "把旅途带进来" }),
  ).toBeVisible();
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((r) => setTimeout(r, 250));
    await route.continue();
  });
  await page
    .locator("input[type=file]:not([webkitdirectory])")
    .setInputFiles([
      {
        name: "first-trip.jpg",
        mimeType: "image/jpeg",
        buffer: await jpeg("#a5bec4"),
      },
    ]);
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".photo-card img").evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("status")).toContainText("已导入 1 张");
  const projects = await (await request.get("/api/projects")).json();
  expect(projects).toHaveLength(1);
  expect(projects[0].count).toBe(1);
});
test("real photo import, favorite, cull, undo, compare, collection and reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新建旅行", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("界面验收 " + Date.now());
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "把旅途带进来" }),
  ).toBeVisible();
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    {
      name: "雪山近景.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#a6bcc0"),
    },
    {
      name: "雪山远景.jpg",
      mimeType: "image/jpeg",
      buffer: await jpeg("#b6bfa8", 1),
    },
  ]);
  await expect(page.locator(".photo-card").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".photo-card img")
        .first()
        .evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("status")).toContainText("已导入 2 张");
  await page.getByTitle("显示全部照片").click();
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page.locator(".photo-card").first().click();
  await page.keyboard.press("f");
  await expect(page.locator(".photo-heart").first()).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator(".keep-badge").first()).toBeVisible();
  await page.getByTitle("撤销 ⌘Z").click();
  await expect(page.locator(".keep-badge")).toHaveCount(0);
  await expect(page.locator(".photo-heart")).toHaveCount(1);
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "沉浸对比", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "沉浸选片" })).toBeVisible();
  await page.getByRole("button", { name: "关闭沉浸选片", exact: true }).click();
  await page.getByRole("button", { name: "加入新作品集", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("朋友圈精选");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator(".collection-tray")).toBeVisible();
  await page.reload();
  await expect(page.locator(".photo-card").first()).toBeVisible();
  await expect(page.locator(".photo-heart").first()).toBeVisible();
  await page.screenshot({ path: "test-results/library.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("model settings persist endpoint and test actual HTTP image request against fixture service", async ({
  page,
}) => {
  const { createServer } = await import("node:http");
  let images = 0;
  const fixture = createServer(async (req, res) => {
    let data = "";
    for await (const part of req) data += part;
    const body = JSON.parse(data);
    if (
      body.messages.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((c) => c.type === "image_url"),
      )
    )
      images++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ color: "red" }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "模型与服务设置" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("API Base URL")
      .fill(`http://127.0.0.1:${fixture.address().port}/v1`);
    await dialog.getByLabel("模型名称").fill("fixture-vision");
    await dialog.getByRole("button", { name: "测试图片理解" }).click();
    await expect(dialog.getByRole("status")).toContainText("图片理解测试通过");
    expect(images).toBe(1);
    await dialog.getByRole("button", { name: "保存配置" }).click();
    await expect(dialog.getByRole("status")).toContainText("配置已保存");
    await page.reload();
    await page.getByRole("button", { name: "模型与服务设置" }).click();
    await expect(page.getByLabel("模型名称")).toHaveValue("fixture-vision");
  } finally {
    await new Promise((r) => fixture.close(r));
  }
});

test("immersive similar hover zoom and blurred neighbor decisions persist", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: { name: "沉浸交互验收 " + Date.now() },
    })
  ).json();
  const form = new FormData();
  for (let i = 0; i < 4; i++)
    form.append(
      "photos",
      new Blob(
        [await jpeg(["#a5bcbf", "#91abae", "#b0b291", "#b4a59a"][i], i)],
        { type: "image/jpeg" },
      ),
      `moment-${i}.jpg`,
    );
  const imported = await (
    await fetch(`http://127.0.0.1:4174/api/projects/${project.id}/import`, {
      method: "POST",
      body: form,
    })
  ).json();
  const ids = imported.results.map((r) => r.photo.id);
  await request.post(`/api/projects/${project.id}/groups`, {
    data: { ids: ids.slice(0, 2), type: "similar", action: "merge" },
  });
  await request.post(`/api/projects/${project.id}/groups`, {
    data: { ids: ids.slice(2), type: "similar", action: "split" },
  });
  await page.addInitScript(
    (id) => localStorage.setItem("photo-project", id),
    project.id,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "沉浸选片", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "沉浸选片" });
  await expect(modal.locator(".similar-slot")).toHaveCount(2);
  await expect
    .poll(() =>
      modal
        .locator(".immersive-frame>img")
        .first()
        .evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  const frames = modal.locator(".immersive-frame");
  await frames.nth(1).hover();
  await expect(frames.nth(1)).toHaveClass(/focused/);
  await page.waitForTimeout(400);
  expect(
    (await modal.locator(".similar-slot").nth(1).boundingBox()).width,
  ).toBeGreaterThan(
    (await modal.locator(".similar-slot").nth(0).boundingBox()).width,
  );
  await page.mouse.wheel(0, -300);
  await expect
    .poll(() => frames.nth(1).getAttribute("data-zoom"))
    .not.toBe("1.00");
  await modal.getByRole("button", { name: "重置缩放" }).click();
  await expect(frames.nth(1)).toHaveAttribute("data-zoom", "1.00");
  await modal.getByRole("button", { name: "保留" }).click();
  await expect(frames.nth(1).locator(".decision-badge")).toContainText("保留");
  await page.screenshot({
    path: "test-results/immersive-similar.png",
    fullPage: true,
  });
  await modal.getByRole("button", { name: "下一组", exact: true }).click();
  await expect(modal.locator(".single-focus")).toBeVisible();
  await expect(modal.getByAltText("前一张照片（虚化）")).toBeVisible();
  await expect
    .poll(() =>
      modal.locator(".single-focus img").evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(
    await modal
      .getByAltText("前一张照片（虚化）")
      .evaluate((el) => getComputedStyle(el).filter),
  ).toContain("blur");
  await modal.getByRole("button", { name: "不要" }).click();
  await expect(modal.locator(".single-focus .decision-badge")).toContainText(
    "不要",
  );
  await modal.getByRole("button", { name: "待定" }).click();
  await expect(modal.locator(".single-focus .decision-badge")).toContainText(
    "待定",
  );
  await page.screenshot({
    path: "test-results/immersive-single.png",
    fullPage: true,
  });
  await modal.getByRole("button", { name: "关闭沉浸选片" }).click();
  const saved = await (
    await request.get(`/api/projects/${project.id}/photos`)
  ).json();
  expect(saved.find((p) => p.id === ids[1]).status).toBe("keep");
  expect(saved.find((p) => p.id === ids[2]).status).toBe("maybe");
});

test("analyze through fixture model, chat-compose, crop, watermark, render and export", async ({
  page,
  request,
}) => {
  const { createServer } = await import("node:http");
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      last = body.messages.at(-1);
    let value;
    if (Array.isArray(last.content))
      value = {
        description: "雪山环境中的旅行照片",
        tags: ["雪山", "旅行"],
        scene: "雪山",
        shot: "远景",
        style: "清冷",
        people: 0,
      };
    else {
      const data = JSON.parse(last.content);
      value = {
        template: "rows",
        photoIds: data.current.photoIds.slice(0, 3),
        reason: "近远景和环境互补，保留你锁定的照片。",
        title: "雪山旅行",
        missing: "",
      };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  try {
    const project = await (
      await request.post("/api/projects", {
        data: { name: "拼图验收 " + Date.now() },
      })
    ).json();
    const form = new FormData();
    for (let i = 0; i < 4; i++)
      form.append(
        "photos",
        new Blob([await jpeg("#9db7bc", i)], { type: "image/jpeg" }),
        `story-${i}.jpg`,
      );
    const imported = await (
      await fetch(`http://127.0.0.1:4174/api/projects/${project.id}/import`, {
        method: "POST",
        body: form,
      })
    ).json();
    const ids = imported.results.map((r) => r.photo.id);
    await request.patch(`/api/projects/${project.id}/photos`, {
      data: { ids, patch: { status: "keep" } },
    });
    await request.put("/api/settings", {
      data: {
        baseURL: `http://127.0.0.1:${fixture.address().port}/v1`,
        model: "fixture",
        jsonMode: true,
      },
    });
    const started = await request.post(`/api/projects/${project.id}/analyze`, {
      data: { ids },
    });
    expect(started.ok()).toBeTruthy();
    await expect
      .poll(async () => (await (await request.get("/api/jobs")).json()).ai.done)
      .toBe(4);
    await page.addInitScript(
      (id) => localStorage.setItem("photo-project", id),
      project.id,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "打开拼图工作室" }).click();
    const studio = page.getByRole("dialog", { name: "拼图工作室" });
    await expect(studio).toBeVisible();
    await expect(studio.locator(".story-slot img")).toHaveCount(4);
    await expect
      .poll(() =>
        studio
          .locator(".story-slot img")
          .first()
          .evaluate((el) => el.naturalWidth),
      )
      .toBeGreaterThan(0);
    await studio.getByLabel("拼图模板").selectOption("rows");
    await studio.getByRole("button", { name: "锁定当前拼图照片" }).click();
    await studio.getByLabel("向 AI 描述拼图").fill("雪山风景三拼，保留第一张");
    await studio.getByRole("button", { name: "发送拼图要求" }).click();
    await expect(
      studio.getByRole("button", { name: "应用到画布" }),
    ).toBeVisible();
    await studio.getByRole("button", { name: "应用到画布" }).click();
    await expect(studio.locator(".slot-lock")).toHaveCount(1);
    await studio.getByLabel("相框样式").selectOption("white");
    await studio.getByLabel("水印文字", { exact: true }).fill("TRAVEL · 2026");
    await studio.getByLabel("拼图照片缩放").focus();
    await page.keyboard.press("ArrowRight");
    await studio.getByRole("button", { name: "保存当前样式" }).click();
    await studio.getByRole("button", { name: "成品预览", exact: true }).click();
    await expect(page.getByAltText("实际渲染成品预览")).toBeVisible();
    await expect
      .poll(() =>
        page.getByAltText("实际渲染成品预览").evaluate((el) => el.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "关闭成品预览" }).click();
    await page.screenshot({ path: "test-results/studio.png", fullPage: true });
    const pending = page.waitForEvent("download");
    await studio.getByRole("button", { name: "导出拼图", exact: true }).click();
    const download = await pending;
    const metadata = await sharp(await download.path()).metadata();
    expect(metadata.height).toBe(3000);
    expect(metadata.exif).toBeUndefined();
    const originalDownload = page.waitForEvent("download");
    await studio.getByRole("button", { name: "拷贝入选原片 ZIP" }).click();
    const original = await originalDownload;
    const { readFile } = await import("node:fs/promises");
    expect(
      (await readFile(await original.path())).subarray(0, 2).toString(),
    ).toBe("PK");
    await studio.getByRole("button", { name: "返回照片库" }).click();
    await page.getByRole("button", { name: "打开拼图工作室" }).click();
    await expect(page.getByLabel("水印文字", { exact: true })).toHaveValue(
      "TRAVEL · 2026",
    );
  } finally {
    await new Promise((r) => fixture.close(r));
  }
});

test("immersive keeps current image after filtered decisions and never advances on save failure", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: { name: "沉浸状态保护 " + Date.now() },
    })
  ).json();
  const body = new FormData();
  for (let i = 0; i < 2; i++)
    body.append(
      "photos",
      new Blob([await jpeg("#9eb3bc", i)], { type: "image/jpeg" }),
      `stable-${i}.jpg`,
    );
  const results = await (
    await fetch(`http://127.0.0.1:4174/api/projects/${project.id}/import`, {
      method: "POST",
      body,
    })
  ).json();
  const ids = results.results.map((r) => r.photo.id);
  await request.patch(`/api/projects/${project.id}/photos`, {
    data: { ids, patch: { status: "keep" } },
  });
  await request.post(`/api/projects/${project.id}/groups`, {
    data: { ids, type: "similar", action: "split" },
  });
  await page.addInitScript(
    (id) => localStorage.setItem("photo-project", id),
    project.id,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "初筛保留 2" }).click();
  await page.getByRole("button", { name: "沉浸选片", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "沉浸选片" });
  await modal.getByRole("button", { name: "不要" }).click();
  await expect(modal.locator(".immersive-frame")).toHaveAttribute(
    "data-photo-id",
    ids[0],
  );
  await expect(modal.locator(".decision-badge")).toContainText("不要");
  await modal.getByLabel("选择后自动下一张").check();
  await page.route(`**/api/projects/${project.id}/photos`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟保存失败" }),
      });
    else await route.continue();
  });
  await modal.getByRole("button", { name: "保留" }).click();
  await expect(page.getByRole("status")).toContainText("模拟保存失败");
  await expect(modal.locator(".immersive-frame")).toHaveAttribute(
    "data-photo-id",
    ids[0],
  );
  await page.unroute(`**/api/projects/${project.id}/photos`);
  await modal.getByRole("button", { name: "保留" }).click();
  await expect(modal.locator(".immersive-frame")).toHaveAttribute(
    "data-photo-id",
    ids[1],
  );
});
