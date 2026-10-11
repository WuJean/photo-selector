import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("three management stages support modifiers, batch decisions, failure retention, undo and filter reset", async ({
  page,
}) => {
  await login(page);
  const files = [];
  for (let i = 0; i < 4; i++)
    files.push({
      name: `multi-${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await jpeg(["#aa5577", "#44aa99", "#5577bb", "#aabb55"][i]),
    });
  await page.locator("input[type=file]").setInputFiles(files);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const cards = page.locator(".wall-card").filter({ hasText: /multi-/ });
  await expect(cards).toHaveCount(4);
  const click = async (i, modifiers = []) =>
    cards.nth(i).locator("img").click({ modifiers });
  await click(0);
  await click(2, ["Meta"]);
  await expect(
    cards.filter({ has: page.locator("input:checked") }),
  ).toHaveCount(2);
  await click(0, ["Meta"]);
  await expect(
    cards.filter({ has: page.locator("input:checked") }),
  ).toHaveCount(1);
  await click(0);
  await click(2, ["Shift"]);
  await expect(page.locator(".selection-toolbar")).toContainText("已选 3 张");
  await page.keyboard.press("x");
  await expect(cards).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  await expect(cards).toHaveCount(4);
  await expect(page.locator(".selection-toolbar")).toContainText("已选 3 张");
  await click(3, ["Meta"]);
  await page.keyboard.press("x");
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "精筛", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await click(0);
  await click(2, ["Shift"]);
  await page.keyboard.press("z");
  await expect(cards).toHaveCount(4);
  await page.route("**/api/batches/*/decisions", (r) =>
    r.fulfill({ status: 500, json: { error: "批量保存失败" } }),
  );
  await page.keyboard.press("c");
  await expect(
    page.getByRole("status").filter({ hasText: "批量保存失败" }),
  ).toBeVisible();
  await expect(page.locator(".selection-toolbar")).toContainText("已选 3 张");
  await expect(cards).toHaveCount(4);
  await page.unroute("**/api/batches/*/decisions");
  await page.keyboard.press("c");
  await expect(cards).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  await expect(cards).toHaveCount(4);
  await click(0);
  await click(3, ["Shift"]);
  await page.keyboard.press("x");
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await click(0);
  await click(2, [process.platform === "darwin" ? "Meta" : "Control"]);
  await expect(page.locator(".selection-toolbar")).toContainText("已选 2 张");
  await click(3, ["Meta", "Shift"]);
  await expect(page.locator(".selection-toolbar")).toContainText("已选 3 张");
  await page.getByLabel("搜索照片", { exact: true }).fill("multi-3");
  await expect(cards).toHaveCount(1);
  await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  await page.screenshot({ path: "test-results/multiselect.png" });
});
