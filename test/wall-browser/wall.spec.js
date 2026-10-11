import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("login, upload, two decisions, independent portfolio and photo-wall download", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("input[type=file]")
    .setInputFiles([
      { name: "test.jpg", mimeType: "image/jpeg", buffer: await jpeg() },
    ]);
  await expect(
    page.locator(".wall-card").filter({ hasText: "test.jpg" }),
  ).toHaveCount(1);
  await page.keyboard.press("x");
  await expect(
    page.locator(".wall-card").filter({ hasText: "test.jpg" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "精筛", exact: true }).click();
  await expect(
    page.locator(".wall-card").filter({ hasText: "test.jpg" }),
  ).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator(".immersive")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".immersive")).toHaveCount(0);
  await page.keyboard.press("x");
  await expect(
    page.locator(".wall-card").filter({ hasText: "test.jpg" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await expect(
    page.locator(".wall-card").filter({ hasText: "test.jpg" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "新建作品集", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("旅途");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "待归集", exact: true }).click();
  await page.getByLabel("选择 test.jpg").check();
  await page
    .getByLabel("加入作品集", { exact: true })
    .selectOption({ label: "旅途" });
  await page.getByRole("button", { name: "时间线", exact: true }).click();
  const photo = page.getByRole("link", {
    name: "查看作品集 旅途",
    exact: true,
  });
  await expect(photo).toHaveCount(1);
  await expect(
    page.locator(".wall-toolbar,.selection-toolbar,.task-row,.tag-chips"),
  ).toHaveCount(0);
  await photo.locator("img").evaluate((el) => el.decode());
  await photo.click();
  await page.locator(".wall-card").filter({ hasText: "test.jpg" }).dblclick();
  await expect(page.getByRole("dialog", { name: "查看照片" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "下载", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("test.jpg");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(photo).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator(".timeline-entry").filter({ hasText: "旅途" }),
  ).toHaveCount(1);
  await page.screenshot({ path: "test-results/wall-home.png" });
});
