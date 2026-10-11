import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("independent portfolio cover, rename, drag order and reuse remain after refresh", async ({
  page,
}) => {
  await login(page);
  const batch = await (
      await page.request.post("/api/batches", {
        data: { name: "portfolio ordering", source: "upload", direct: true },
      })
    ).json(),
    ids = [];
  for (let i = 0; i < 3; i++) {
    const result = await (
      await page.request.post(`/api/batches/${batch.id}/import`, {
        multipart: {
          photos: {
            name: `order-${i}.jpg`,
            mimeType: "image/jpeg",
            buffer: await jpeg(["#739588", "#738295", "#978675"][i]),
          },
        },
      })
    ).json();
    expect(result, JSON.stringify(result)).toHaveProperty("results");
    ids.push(result.results[0].photo.id);
  }
  const first = await (
      await page.request.post("/api/collections", {
        data: { name: "排序验收" },
      })
    ).json(),
    second = await (
      await page.request.post("/api/collections", {
        data: { name: "复用验收" },
      })
    ).json();
  await page.request.put(`/api/collections/${first.id}`, {
    data: { photoIds: ids },
  });
  await page.request.put(`/api/collections/${second.id}`, {
    data: { photoIds: [ids[0]] },
  });
  await page.reload();
  await page.getByRole("link", { name: "作品集", exact: true }).click();
  await page.getByRole("button", { name: "排序验收 3", exact: true }).click();
  const card = (name) => page.locator(".wall-card").filter({ hasText: name });
  await card("order-0.jpg").dragTo(card("order-2.jpg"));
  await expect
    .poll(async () => {
      const list = await (await page.request.get("/api/collections")).json();
      return list.find((c) => c.id === first.id).photoIds;
    })
    .toEqual([ids[1], ids[0], ids[2]]);
  await page.getByLabel("选择 order-2.jpg").check();
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  await page.getByRole("button", { name: "设为封面", exact: true }).click();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("新的旅行");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.reload();
  await page.getByRole("link", { name: "作品集", exact: true }).click();
  await page.getByRole("button", { name: "新的旅行 3", exact: true }).click();
  await expect(page.locator(".wall-card").first()).toContainText("order-2.jpg");
  const collections = await (await page.request.get("/api/collections")).json();
  expect(collections.find((c) => c.id === first.id).coverId).toBe(ids[2]);
  await page.getByLabel("选择 order-0.jpg").check();
  await page.getByRole("button", { name: "移出", exact: true }).click();
  await expect(card("order-0.jpg")).toHaveCount(0);
  await page.getByRole("button", { name: "复用验收 1", exact: true }).click();
  await card("order-0.jpg")
    .locator("img")
    .evaluate((img) => img.decode());
  await page.screenshot({ path: "test-results/portfolio.png" });
});
