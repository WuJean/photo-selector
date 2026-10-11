import { test, expect } from "@playwright/test";
import { login, jpeg, folderFixture } from "./helpers";
test("share a local portfolio to an independent visitor and revoke all access", async ({
  page,
  browser,
}) => {
  await login(page);
  await folderFixture(page, [
    { name: "share-local.jpg", bytes: [...(await jpeg("#99babc"))] },
  ]);
  await page.getByRole("button", { name: "导入照片", exact: true }).click();
  await page.getByLabel("已经选好，直接进入待归集").check();
  await page
    .getByRole("button", { name: "连接电脑文件夹", exact: true })
    .click();
  const card = page
    .locator(".wall-card")
    .filter({ hasText: "share-local.jpg" });
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "新建作品集", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("独立分享");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: "待归集", exact: true }).click();
  await page.getByLabel("选择 share-local.jpg").check();
  await page
    .getByLabel("加入作品集", { exact: true })
    .selectOption({ label: "独立分享" });
  await page.getByRole("button", { name: /独立分享/ }).click();
  await page.getByRole("button", { name: "分享作品集", exact: true }).click();
  await page.getByLabel("访问密码（可选）").fill("visitor-pass");
  await page.getByRole("button", { name: "创建分享", exact: true }).click();
  await expect(page.getByLabel("分享链接")).toBeVisible();
  const url = await page.getByLabel("分享链接").inputValue();
  const visitor = await browser.newContext();
  const other = await visitor.newPage();
  await other.goto(url);
  await other.getByLabel("访问密码", { exact: true }).fill("visitor-pass");
  await other.getByRole("button", { name: "查看作品集", exact: true }).click();
  await expect(other.getByRole("heading", { name: "独立分享" })).toBeVisible();
  await other.locator(".wall-photo img").evaluate((el) => el.decode());
  const downloads = other.waitForEvent("download");
  await other.getByRole("link", { name: "下载整组" }).click();
  expect((await downloads).suggestedFilename()).toContain(".zip");
  expect((await other.request.get("/api/assets")).status()).toBe(401);
  await page.getByRole("button", { name: "撤销分享", exact: true }).click();
  await other.reload();
  await expect(other.getByRole("alert")).toContainText("已失效");
  await visitor.close();
});
