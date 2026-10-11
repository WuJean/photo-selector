import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("timeline shows one cover per collection in ascending order and edits location date poem and description", async ({
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
  await page.reload();
  const early = page.getByRole("link", { name: "查看作品集 早年的山" }),
    late = page.getByRole("link", { name: "查看作品集 后来的海" });
  await expect(early.locator("img")).toHaveCount(1);
  await early.locator("img").evaluate((img) => img.decode());
  await expect(early).toContainText("山色有无中");
  expect((await early.boundingBox()).y).toBeLessThan(
    (await late.boundingBox()).y,
  );
  await late.click();
  await expect(
    page.locator(".wall-card").filter({ hasText: "timeline.jpg" }),
  ).toHaveCount(1);
  await page.getByText("编辑作品集信息", { exact: true }).click();
  await page.getByLabel("作品集地点").fill("青岛");
  await page.getByLabel("作品集时间").fill("2018-06-01");
  await page.getByLabel("作品集一句诗").fill("海上生明月");
  await page.getByLabel("作品集描述").fill("一段留在海边的记忆");
  await page
    .getByRole("button", { name: "保存作品集信息", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/collections")).json()).find(
          (c) => c.id === later.id,
        ).date,
    )
    .toBe("2018-06-01");
  await page.getByRole("button", { name: "时间线", exact: true }).click();
  await expect(late).toContainText("青岛");
  await expect(late).toContainText("海上生明月");
  await expect(late).toContainText("一段留在海边的记忆");
  expect((await late.boundingBox()).y).toBeLessThan(
    (await early.boundingBox()).y,
  );
  await page.reload();
  await expect(late).toContainText("海上生明月");
  await page.screenshot({ path: "test-results/collection-timeline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(late).toBeVisible();
  await page.screenshot({
    path: "test-results/collection-timeline-mobile.png",
  });
});
