import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("timeline shows one cover per collection in ascending order and opens independent album browsing", async ({
  page,
}) => {
  await login(page);
  const b = await (
    await page.request.post("/api/batches", {
      data: { source: "upload", direct: true },
    })
  ).json();
  const result = await (
    await page.request.post(`/api/batches/${b.id}/import`, {
      multipart: {
        photos: {
          name: "timeline.jpg",
          mimeType: "image/jpeg",
          buffer: await jpeg(),
        },
      },
    })
  ).json();
  const id = result.results[0].photo.id;
  const old = await (
    await page.request.post("/api/collections", {
      data: {
        name: "早年的山",
        date: "2020-08-12",
        location: "川西",
        poem: "山色有无中",
        description: "第一次山行",
      },
    })
  ).json();
  const later = await (
    await page.request.post("/api/collections", {
      data: { name: "后来的海", date: "2025-05-01" },
    })
  ).json();
  for (const c of [old, later])
    await page.request.put(`/api/collections/${c.id}`, {
      data: { photoIds: [id] },
    });
  await page.goto("/#wall");
  const early = page.getByRole("link", { name: "查看作品集 早年的山" }),
    late = page.getByRole("link", { name: "查看作品集 后来的海" });
  await expect(early.locator("img")).toHaveCount(1);
  await early.locator("img").evaluate((img) => img.decode());
  await expect(early).toContainText("山色有无中");
  expect((await early.boundingBox()).y).toBeLessThan(
    (await late.boundingBox()).y,
  );
  await late.click();
  await expect(page.locator(".album-photo")).toHaveCount(1);
  await expect(page.getByText("编辑作品集信息", { exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.locator(".album-photo")).toHaveCount(1);
  await page.getByRole("link", { name: "← 时间线" }).click();
  await expect(late).toBeVisible();
  await page.screenshot({ path: "test-results/collection-timeline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(late).toBeVisible();
  await page.screenshot({
    path: "test-results/collection-timeline-mobile.png",
  });
  await late.click();
  await page.locator(".album-photo").click();
  const viewer = page.getByRole("dialog", { name: "查看照片" });
  await expect(viewer.locator(".viewer-image img")).toHaveAttribute(
    "src",
    /\/display\/mobile/,
  );
  await viewer.locator(".viewer-image img").evaluate((img) => img.decode());
  await viewer.getByRole("button", { name: "查看原图", exact: true }).click();
  await expect(viewer.locator(".viewer-image img")).toHaveAttribute(
    "src",
    /\/original$/,
  );
  await viewer.getByRole("button", { name: "压缩预览", exact: true }).click();
  await expect(viewer.locator(".viewer-image img")).toHaveAttribute(
    "src",
    /\/display\/mobile/,
  );
});
