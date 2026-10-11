import { test, expect } from "@playwright/test";
import { login, jpeg, folderFixture } from "./helpers";
test("folder files are read in a worker, registered without original upload, and reconnect after reload", async ({
  page,
}) => {
  await login(page);
  const image = await jpeg("#bc88ad");
  await folderFixture(page, [{ name: "local.jpg", bytes: [...image] }]);
  const uploads = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/import"))
      uploads.push(r.url());
  });
  await page.getByRole("button", { name: "导入照片", exact: true }).click();
  await page
    .getByRole("button", { name: "连接电脑文件夹", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已读取 1 张，失败 0 张" }),
  ).toBeVisible();
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.locator(".wall-photo img").evaluate((image) => image.decode());
  const photos = await (await page.request.get("/api/assets")).json(),
    photo = photos.find((p) => p.name === "local.jpg");
  expect(photo.storage).toBe("local");
  expect(photo.analysisStatus).toBe("done");
  expect(uploads).toEqual([]);
  expect(
    (await page.request.get(`/api/photos/${photo.id}/original`)).status(),
  ).toBe(404);
  await page.keyboard.press("x");
  await page.getByRole("button", { name: "精筛", exact: true }).click();
  await page.keyboard.press("z");
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator(".immersive")).toBeVisible();
  await page.keyboard.press("x");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await expect(
    page.locator(".wall-card").filter({ hasText: "local.jpg" }),
  ).toHaveCount(1);
  await page.goto("/#wall");
  await page.getByRole("link", { name: "作品集", exact: true }).click();
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".wall-card")
        .filter({ hasText: "local.jpg" })
        .locator("img")
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "重新连接文件夹", exact: true }),
  ).toBeVisible();
});
