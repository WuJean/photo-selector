import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("mobile edit, generation and collage open separately, preserve drafts and keep filters in settings", async ({
  page,
}) => {
  await login(page);
  const b = await (
    await page.request.post("/api/batches", {
      data: { source: "upload", direct: true },
    })
  ).json();
  const imported = await (
    await page.request.post(`/api/batches/${b.id}/import`, {
      multipart: {
        photos: {
          name: "dialog.jpg",
          mimeType: "image/jpeg",
          buffer: await jpeg(),
        },
      },
    })
  ).json();
  const c = await (
    await page.request.post("/api/collections", { data: { name: "弹窗旅行" } })
  ).json();
  await page.request.put(`/api/collections/${c.id}`, {
    data: { photoIds: [imported.results[0].photo.id] },
  });
  await page.reload();
  await page.getByRole("button", { name: "弹窗旅行 1", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "AI 分类", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "编辑作品集", exact: true }).click();
  await page.getByLabel("作品集地点", { exact: true }).fill("海边");
  await page.getByLabel("作品集时间", { exact: true }).fill("2025-08-01");
  await page.getByLabel("作品集一句诗", { exact: true }).fill("海上生明月");
  await page
    .getByRole("button", { name: "保存作品集信息", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑作品集", exact: true }).click();
  await page.getByLabel("作品集地点", { exact: true }).fill("未保存");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.getByText("有未保存的修改")).toBeVisible();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("button", { name: "生成创意图", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "生成创意图", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("创意图画幅")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-creative.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "拼图", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "拼图工作室" })).toBeVisible();
  await page.getByRole("button", { name: "选照片", exact: true }).click();
  await expect(page.locator(".studio-source")).toBeVisible();
  await expect(page.locator(".studio-style")).not.toBeVisible();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.getByLabel("作品名称").fill("手机草稿");
  await page.getByRole("button", { name: "返回照片库" }).click();
  await page.getByRole("button", { name: "拼图", exact: true }).click();
  await expect(page.getByLabel("作品名称")).toHaveValue("手机草稿");
  await page
    .locator(".story-slot img")
    .first()
    .evaluate((img) => img.decode());
  await page.screenshot({ path: "test-results/mobile-collage.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "返回照片库" }).click();
  const imageConfig = await (
    await page.request.get("/api/settings/image-generation")
  ).json();
  try {
    await page.request.put("/api/settings/image-generation", {
      data: { ...imageConfig, enabled: false },
    });
    await expect(
      page.getByRole("button", { name: "生成创意图", exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "拼图", exact: true }),
    ).toBeVisible();
    const denied = await page.request.post(
      `/api/projects/${b.id}/collections/${c.id}/create`,
      { data: { kind: "cover" } },
    );
    expect(denied.status()).toBe(400);
    expect((await denied.json()).error).toContain("生图服务已关闭");
    const testDenied = await page.request.post(
      "/api/settings/image-generation/test",
      { data: { ...imageConfig, enabled: true } },
    );
    expect(testDenied.status()).toBe(400);
  } finally {
    await page.request.put("/api/settings/image-generation", {
      data: imageConfig,
    });
  }
});
