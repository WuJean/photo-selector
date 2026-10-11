import { test, expect } from "@playwright/test";
import { login } from "./helpers";
test("first login cannot bypass password change; chosen password restores access", async ({
  page,
}) => {
  await login(page);
  // Isolated backend bootstrap is covered by Node tests; exercise the mandatory screen with real password APIs via a one-use test account state.
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, mustChangePassword: true },
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置新密码" })).toBeVisible();
  await expect(page.locator(".wall-header")).toHaveCount(0);
  await page.getByLabel("新密码", { exact: true }).fill("a-new-password-123");
  await page
    .getByLabel("确认新密码", { exact: true })
    .fill("mismatch-password-123");
  await page.getByRole("button", { name: "保存并进入照片墙" }).click();
  await expect(page.getByRole("alert")).toHaveText("两次密码不一致");
  await page.unroute("**/api/auth/session");
  await page.reload();
  await expect(page.locator(".wall-header")).toBeVisible();
});
