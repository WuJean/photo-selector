import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("password-protected visitor collage: random, crop, scoped save, download, draft recovery and revoke", async ({
  page,
  browser,
}) => {
  await login(page);
  const batch = await (
    await page.request.post("/api/batches", {
      data: { name: "guest test", source: "upload", direct: true },
    })
  ).json();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const imported = await (
      await page.request.post(`/api/batches/${batch.id}/import`, {
        multipart: {
          photos: {
            name: `guest-${i}.jpg`,
            mimeType: "image/jpeg",
            buffer: await jpeg(["#aa8899", "#6688aa", "#339988", "#aa9944"][i]),
          },
        },
      })
    ).json();
    ids.push(imported.results[0].photo.id);
  }
  const c = await (
    await page.request.post("/api/collections", { data: { name: "访客旅行" } })
  ).json();
  await page.request.put(`/api/collections/${c.id}`, {
    data: { photoIds: ids },
  });
  const share = await (
    await page.request.post(`/api/collections/${c.id}/shares`, {
      data: { password: "guest-access", days: 1, download: "display" },
    })
  ).json();
  for (const id of ids)
    expect(
      (
        await page.request.post(`/api/shares/${share.id}/assets/${id}/server`, {
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/shares/${share.id}/publish`, { data: {} })
    ).ok(),
  ).toBeTruthy();
  const context = await browser.newContext({ acceptDownloads: true }),
    visitor = await context.newPage();
  await visitor.goto("/s/" + share.token);
  await expect(
    visitor.getByRole("button", { name: "制作拼图", exact: true }),
  ).toHaveCount(0);
  await visitor.getByLabel("访问密码", { exact: true }).fill("guest-access");
  await visitor.getByRole("button", { name: "查看作品集" }).click();
  await visitor.getByRole("button", { name: "制作拼图", exact: true }).click();
  await visitor.getByRole("button", { name: "随机组合" }).click();
  await expect(visitor.getByRole("status")).toContainText("缺少");
  await visitor.getByLabel("快捷搭配").selectOption("random_three");
  await visitor.getByRole("button", { name: "随机组合" }).click();
  await expect(visitor.locator(".story-slot")).toHaveCount(3);
  await visitor.getByLabel("拼图名称").fill("朋友的旅行三拼");
  await visitor.getByLabel("缩放", { exact: true }).fill("1.5");
  await visitor.getByLabel("画幅", { exact: true }).selectOption("1:1");
  for (const img of await visitor.locator(".story-slot img").all())
    await img.evaluate((e) => e.decode());
  await visitor.screenshot({ path: "test-results/guest-collage.png" });
  await visitor
    .getByRole("button", { name: "保存到此作品集", exact: true })
    .click();
  await expect(visitor.getByRole("status")).toContainText("已保存到此作品集");
  const creations = await (
    await page.request.get(
      `/api/projects/library/creations?collectionId=${c.id}`,
    )
  ).json();
  const creation = creations.find((c) => c.title === "朋友的旅行三拼");
  expect(creation.origin).toBe("guest");
  expect(creation.sourceIds.every((id) => ids.includes(id))).toBeTruthy();
  const download = visitor.waitForEvent("download");
  await visitor.getByRole("button", { name: "下载拼图", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("朋友的旅行三拼.jpg");
  await visitor.reload();
  await visitor.getByRole("button", { name: "制作拼图", exact: true }).click();
  await expect(visitor.getByLabel("拼图名称")).toHaveValue("朋友的旅行三拼");
  await expect(visitor.getByLabel("缩放", { exact: true })).toHaveValue("1.5");
  expect((await visitor.request.get("/api/assets")).status()).toBe(401);
  await page.request.delete(`/api/shares/${share.id}`);
  await visitor.getByRole("button", { name: "保存到此作品集" }).click();
  await expect(visitor.getByRole("status")).toContainText("已失效");
  await context.close();
});
