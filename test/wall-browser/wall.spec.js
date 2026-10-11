import { test, expect } from "@playwright/test";
import sharp from "sharp";
export const password = "fixture-password-123";
export async function login(page) {
  await page.goto("/");
  await page.getByLabel("管理员密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "每一张，值得留下" }),
  ).toBeVisible();
}
export async function jpeg() {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: "#93a989" },
  })
    .jpeg()
    .toBuffer();
}
test("login, upload, two decisions, independent portfolio and photo-wall download", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("input[type=file]")
    .setInputFiles([
      { name: "test.jpg", mimeType: "image/jpeg", buffer: await jpeg() },
    ]);
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.keyboard.press("x");
  await expect(page.locator(".wall-card")).toHaveCount(0);
  await page.getByRole("button", { name: "精筛", exact: true }).click();
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator(".immersive")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".immersive")).toHaveCount(0);
  await page.keyboard.press("x");
  await expect(page.locator(".wall-card")).toHaveCount(0);
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.getByRole("button", { name: "新建作品集", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("旅途");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "待归集", exact: true }).click();
  await page.getByLabel("选择 test.jpg").check();
  await page
    .getByLabel("加入作品集", { exact: true })
    .selectOption({ label: "旅途" });
  await page.getByRole("button", { name: "照片墙", exact: true }).click();
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.locator(".wall-photo img").evaluate((el) => el.decode());
  await page.locator(".wall-card").dblclick();
  await expect(page.getByRole("dialog", { name: "查看照片" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "下载", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("test.jpg");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".wall-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/wall-home.png" });
});
