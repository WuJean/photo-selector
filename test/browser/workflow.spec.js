import { test, expect } from "@playwright/test";
import sharp from "sharp";
const jpeg = async (color = "#99b7bc", i = 0) =>
  sharp(
    Buffer.from(
      `<svg width="900" height="650"><rect width="900" height="650" fill="${color}"/><circle cx="${140 + i * 23}" cy="160" r="70" fill="#efdcad"/><path d="M0 650L330 220L620 650Z" fill="#526b64"/><path d="M240 340L330 220L415 340Z" fill="#f3f2e7"/></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
async function seed(
  request,
  n = 4,
  { group = true, initial = false, final = false } = {},
) {
  const p = await (
    await request.post("/api/projects", {
      data: { name: "交互验收 " + Date.now() },
    })
  ).json();
  const form = new FormData();
  for (let i = 0; i < n; i++)
    form.append(
      "photos",
      new Blob([await jpeg(i % 2 ? "#adb6a1" : "#91b0b5", i)], {
        type: "image/jpeg",
      }),
      `photo-${i}.jpg`,
    );
  const result = await (
    await fetch(`http://127.0.0.1:4174/api/projects/${p.id}/import`, {
      method: "POST",
      body: form,
    })
  ).json();
  const ids = result.results.map((r) => r.photo.id);
  await request.post(`/api/projects/${p.id}/groups`, {
    data: { ids, type: "similar", action: group ? "merge" : "split" },
  });
  if (initial || final)
    await request.patch(`/api/projects/${p.id}/photos`, {
      data: { ids, round: "initial", patch: { status: "maybe" } },
    });
  if (final)
    await request.patch(`/api/projects/${p.id}/photos`, {
      data: { ids, round: "final", patch: { status: "maybe" } },
    });
  return { ...p, ids };
}
async function open(page, project) {
  await page.addInitScript(
    (id) => localStorage.setItem("photo-project", id),
    project.id,
  );
  await page.goto("/");
}
async function saved(request, p) {
  return (await request.get(`/api/projects/${p.id}/photos`)).json();
}

test("create before import, JPEG decoding, metadata filters and folding back", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("首次使用");
  await page.route("**/api/projects", async (r) => {
    if (r.request().method() === "POST")
      await new Promise((res) => setTimeout(res, 250));
    await r.continue();
  });
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles([
    { name: "first.jpg", mimeType: "image/jpeg", buffer: await jpeg() },
    { name: "second.jpg", mimeType: "image/jpeg", buffer: await jpeg() },
  ]);
  await expect(page.getByRole("status")).toContainText("已导入 2 张");
  await expect
    .poll(() =>
      page
        .locator(".photo-card img")
        .first()
        .evaluate((el) => el.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByLabel("焦段筛选")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AI 分类", exact: true }),
  ).toHaveCount(0);
  const project = (await (await request.get("/api/projects")).json()).find(
    (p) => p.name === "首次使用",
  );
  const photos = await saved(request, project);
  await request.post(`/api/projects/${project.id}/groups`, {
    data: { ids: photos.map((p) => p.id), type: "similar", action: "merge" },
  });
  await expect(
    page.getByRole("button", { name: "展开相似组", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "展开相似组", exact: true }).click();
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "收起本组", exact: true })
    .first()
    .click();
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page.getByRole("button", { name: "全部叠放", exact: true }).click();
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/library.png" });
});

test("list decisions and two immersive rounds advance, undo and preserve both spaces", async ({
  page,
  request,
}) => {
  const p = await seed(request, 4, { group: false });
  await open(page, p);
  await page.locator(".photo-card").first().click();
  await page.keyboard.press("z");
  await expect
    .poll(async () => (await saved(request, p))[0].status)
    .toBe("maybe");
  await expect(page.locator(".photo-card")).toHaveCount(3);
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".photo-card")).toHaveCount(4);
  await page.keyboard.press("Space");
  let modal = page.getByRole("dialog", { name: "沉浸选片", exact: true });
  await expect(modal).toBeVisible();
  await page.keyboard.press("Space");
  await expect(modal).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(modal).toBeVisible();
  await page.keyboard.press("z");
  await expect
    .poll(async () => (await saved(request, p))[0].status)
    .toBe("maybe");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[1]);
  await page.keyboard.press("x");
  await expect
    .poll(async () => (await saved(request, p))[1].status)
    .toBe("keep");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[2]);
  await page.keyboard.press("c");
  await expect
    .poll(async () => (await saved(request, p))[2].status)
    .toBe("reject");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[3]);
  await page.keyboard.press("x");
  await expect(modal.getByText("本轮已完成")).toBeVisible();
  await modal.getByRole("button", { name: "查看初筛结果" }).click();
  await expect(page.getByRole("tab", { name: /初筛/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".photo-card")).toHaveCount(3);
  await page.getByRole("button", { name: /^作品集/ }).click();
  await expect(page.getByRole("tab", { name: /最终作品/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "暂无最终作品" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "开始精筛", exact: true })
    .first()
    .click();
  modal = page.getByRole("dialog", { name: "沉浸式精筛" });
  await expect(modal).toBeVisible();
  await page.keyboard.press("z");
  await expect
    .poll(async () => (await saved(request, p))[0].finalStatus)
    .toBe("maybe");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[1]);
  await page.keyboard.press("c");
  await expect
    .poll(async () => (await saved(request, p))[1].finalStatus)
    .toBe("reject");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[3]);
  await page.keyboard.press("x");
  await expect(modal.getByText("本轮已完成")).toBeVisible();
  await modal.getByRole("button", { name: "查看最终作品" }).click();
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page.getByRole("tab", { name: /初筛/ }).click();
  await expect(page.locator(".photo-card")).toHaveCount(3);
  const result = await saved(request, p);
  expect(result[1].status).toBe("keep");
  await page.reload();
  await page.getByRole("button", { name: /^作品集/ }).click();
  await expect(page.getByRole("tab", { name: /最终作品/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".photo-card")).toHaveCount(2);
});

test("similar carousel caps three clear photos, advances sequentially and ignores hover for decisions", async ({
  page,
  request,
}) => {
  for (const count of [1, 2, 3, 4, 10]) {
    const p = await seed(request, count);
    await open(page, p);
    await page.getByRole("button", { name: "开始初筛", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "沉浸选片", exact: true });
    if (count > 1) {
      await expect(modal.locator(".similar-slot")).toHaveCount(2);
      await modal.locator(".similar-slot").last().hover();
      expect(
        await modal.locator(".focused").getAttribute("data-photo-id"),
      ).toBe(p.ids[0]);
    }
    for (let i = 0; i < count; i++) {
      await expect
        .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
        .toBe(p.ids[i]);
      expect(await modal.locator(".similar-slot").count()).toBeLessThanOrEqual(
        3,
      );
      if (count === 4 && i === 1) {
        await page.screenshot({ path: "test-results/immersive-similar.png" });
        await modal.locator(".focused").hover();
        await page.mouse.wheel(0, -300);
        await expect
          .poll(() => modal.locator(".focused").getAttribute("data-zoom"))
          .not.toBe("1.00");
        await modal.getByRole("button", { name: "重置缩放" }).click();
      }
      await page.keyboard.press(i % 2 ? "x" : "z");
      await expect
        .poll(async () => (await saved(request, p))[i].status)
        .toBe(i % 2 ? "keep" : "maybe");
    }
    await expect(modal.getByText("本轮已完成")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  }
});

test("failed save never advances, input shortcuts are inert, fullscreen and undo return correctly", async ({
  page,
  request,
}) => {
  const p = await seed(request, 3, { group: false });
  await open(page, p);
  await page.getByLabel("搜索照片").fill("zxc");
  expect((await saved(request, p)).every((p) => p.status === "unseen")).toBe(
    true,
  );
  await page.getByLabel("搜索照片").fill("");
  await page.getByRole("button", { name: "开始初筛", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "沉浸选片", exact: true });
  await page.route("**/api/projects/*/photos", (r) =>
    r.request().method() === "PATCH"
      ? r.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "保存失败测试" }),
        })
      : r.continue(),
  );
  await page.keyboard.press("x");
  await expect(page.getByRole("status")).toContainText("保存失败测试");
  expect(await modal.locator(".focused").getAttribute("data-photo-id")).toBe(
    p.ids[0],
  );
  await page.unroute("**/api/projects/*/photos");
  await page.keyboard.press("x");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[1]);
  await page.keyboard.press("Meta+z");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[0]);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => modal.locator(".focused").getAttribute("data-photo-id"))
    .toBe(p.ids[1]);
  expect(
    await modal
      .locator(".neighbor img")
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
  ).toContain("blur");
  await modal.getByRole("button", { name: "原尺寸查看" }).click();
  await expect
    .poll(() => modal.locator(".focused img").evaluate((el) => el.naturalWidth))
    .toBe(900);
  await page.screenshot({ path: "test-results/immersive-single.png" });
  await modal.getByRole("button", { name: "切换全屏" }).click();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
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

test("studio defaults to final maybe photos and exports an actual JPEG without AI", async ({
  page,
  request,
}) => {
  const p = await seed(request, 4, { group: false, final: true });
  await open(page, p);
  await page.getByRole("button", { name: /^作品集/ }).click();
  await page.getByRole("button", { name: "拼图与导出", exact: true }).click();
  const studio = page.getByRole("dialog", { name: "拼图工作室" });
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
  await expect(studio.locator(".story-slot")).toHaveCount(3);
  await studio.getByLabel("水印文字").fill("旅行 2026");
  const download = page.waitForEvent("download");
  await studio.getByRole("button", { name: "导出拼图", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.jpg$/);
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(await file.path());
  expect(bytes[0]).toBe(255);
  expect(bytes[1]).toBe(216);
  await page.screenshot({ path: "test-results/studio.png" });
});

test("manual tag chips classify initial photos, filter by multiple tags and persist exclusions", async ({
  page,
  request,
}) => {
  const p = await seed(request, 3, { group: false, initial: true });
  await open(page, p);
  await page.getByRole("button", { name: /^作品集/ }).click();
  await page.getByRole("tab", { name: /初筛/ }).click();
  await page.locator(".photo-card").first().click();
  await page.getByRole("button", { name: "人工标签", exact: true }).click();
  const panel = page.getByLabel("人工标签", { exact: true });
  await panel.getByRole("button", { name: "人像", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "人像", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "雪山", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "雪山", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByLabel("自定义标签").fill("登顶");
  await panel.getByRole("button", { name: "创建标签", exact: true }).click();
  await panel.getByRole("button", { name: "登顶", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "登顶", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".photo-card").nth(1).click();
  await panel.getByRole("button", { name: "人像", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "人像", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "关闭标签" }).click();
  await page
    .locator(".tag-filter")
    .getByRole("button", { name: "人像", exact: true })
    .click();
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page
    .locator(".tag-filter")
    .getByRole("button", { name: "雪山", exact: true })
    .click();
  await expect(page.locator(".photo-card")).toHaveCount(1);
  await page.getByLabel("多标签匹配").selectOption("any");
  await expect(page.locator(".photo-card")).toHaveCount(2);
  await page.locator(".photo-card").first().click();
  await page.getByRole("button", { name: "人工标签", exact: true }).click();
  await panel.getByRole("button", { name: "雪山", exact: true }).click();
  await expect
    .poll(async () =>
      ((await saved(request, p))[0].excludedTags || []).includes("雪山"),
    )
    .toBe(true);
  await panel.getByRole("button", { name: "管理", exact: true }).click();
  await panel.getByRole("button", { name: "登顶", exact: true }).click();
  await panel.getByLabel("新标签名称").fill("登山");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "登山", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/manual-tags.png" });
});
