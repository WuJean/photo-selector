import { test, expect } from "@playwright/test";
import { password } from "./helpers";
test("first login cannot bypass password change; chosen password restores access", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("管理员密码").fill("fixture-bootstrap-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  expect((await page.request.get("/api/assets")).status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await expect(page.locator(".wall-header")).toHaveCount(0);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("mismatch-password-123");
  await page.getByRole("button", { name: "保存并进入作品集" }).click();
  await expect(page.getByRole("alert")).toHaveText("两次密码不一致");
  await page.getByLabel("确认新密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "保存并进入作品集" }).click();
  await expect(page.locator(".wall-header")).toBeVisible();
  await page.reload();
  await expect(page.locator(".wall-header")).toBeVisible();
  expect(
    (
      await page.request.post("/api/auth/login", {
        data: { password: "fixture-bootstrap-123" },
      })
    ).status(),
  ).toBe(401);
});
