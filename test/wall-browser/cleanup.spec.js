import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("failed save stays put, completing the whole initial batch cleans rejected bytes and clears undo", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("input[type=file]")
    .setInputFiles([
      { name: "discard-me.jpg", mimeType: "image/jpeg", buffer: await jpeg() },
    ]);
  const card = page.locator(".wall-card").filter({ hasText: "discard-me.jpg" });
  await expect(card).toBeVisible();
  const batches = await (await page.request.get("/api/batches")).json(),
    batch = batches.at(-1);
  const photo = (
    await (await page.request.get(`/api/batches/${batch.id}/photos`)).json()
  )[0];
  await page.getByRole("button", { name: /^完成初筛$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "还有未处理照片" }),
  ).toBeVisible();
  await page.route("**/api/batches/*/decisions", (r) =>
    r.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试保存失败" }),
    }),
  );
  await card.getByRole("button", { name: "不要 C", exact: true }).click();
  await expect(card).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "测试保存失败" }),
  ).toBeVisible();
  await page.unroute("**/api/batches/*/decisions");
  await card.getByRole("button", { name: "不要 C", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page
    .getByRole("button", { name: "完成初筛", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/photos/${photo.id}/original`)).status(),
      { timeout: 12000 },
    )
    .toBe(200);
  const undo = await (
    await page.request.post(`/api/batches/${batch.id}/undo`, { data: {} })
  ).json();
  expect(undo.ok).toBe(true);
});
