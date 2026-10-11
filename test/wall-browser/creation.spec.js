import { test, expect } from "@playwright/test";
import { login, jpeg, folderFixture } from "./helpers";
test("local collage exports without uploading originals, persists as creation, and AI prepares stripped previews only", async ({
  page,
}) => {
  await login(page);
  await folderFixture(page, [
    { name: "creation-local.jpg", bytes: [...(await jpeg("#556699"))] },
  ]);
  await page.getByRole("button", { name: "导入照片", exact: true }).click();
  await page
    .getByRole("button", { name: "连接电脑文件夹", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已读取 1 张，失败 0 张" }),
  ).toBeVisible();
  await expect(
    page.locator(".wall-card").filter({ hasText: "creation-local.jpg" }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/decisions") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    ),
    page.keyboard.press("x"),
  ]);
  await expect(
    page.locator(".wall-card").filter({ hasText: "creation-local.jpg" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "精筛", exact: true }).click();
  await expect(
    page.locator(".wall-card").filter({ hasText: "creation-local.jpg" }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/decisions") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    ),
    page.keyboard.press("x"),
  ]);
  // Exercise the production renderer and media adapter with real FileSystem handles.
  const values = await page.evaluate(async () => {
    const { api, json } = await import("/src/api.js"),
      { renderLocal } = await import("/src/render-local.js");
    const photos = await api("/assets"),
      p = photos.find((p) => p.name === "creation-local.jpg");
    const draft = {
      projectId: "library",
      template: "single",
      ratio: "3:4",
      title: "本地创作",
      longEdge: 3000,
      frame: "white",
      watermark: { text: "旅行", position: "br" },
      slots: [{ photoId: p.id, fit: "contain", cx: 0.5, cy: 0.5, zoom: 1 }],
    };
    const blob = await renderLocal(draft, photos),
      bitmap = await createImageBitmap(blob),
      dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    const c = await api("/collections", json("POST", { name: "本地创作测试" }));
    await api(`/collections/${c.id}`, json("PUT", { photoIds: [p.id] }));
    const form = new FormData();
    form.append("photo", blob, "collage.jpg");
    form.append("draft", JSON.stringify(draft));
    const item = await api(`/collections/${c.id}/collage-upload`, {
      method: "POST",
      body: form,
    });
    return { dimensions, item, photoId: p.id };
  });
  expect(Math.max(...values.dimensions)).toBeLessThanOrEqual(800);
  expect(values.item.kind).toBe("collage");
  expect(
    (await page.request.get(`/api/photos/${values.photoId}/original`)).status(),
  ).toBe(404);
  await page.request.put("/api/settings", {
    data: { baseURL: "https://example.com/v1", model: "fixture", apiKey: "" },
  });
  await page.route("**/api/projects/library/analyze", (route) =>
    route.fulfill({ json: { state: "done" } }),
  );
  const uploads = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/analysis-preview")) uploads.push(r.url());
  });
  await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory(),
      dir = await root.getDirectoryHandle("旅行");
    await dir.removeEntry("creation-local.jpg");
    const { api, json } = await import("/src/api.js");
    try {
      await api("/projects/library/analyze", json("POST", { ids: [id] }));
    } catch (e) {
      if (!e.message.includes("重新连接")) throw e;
    }
  }, values.photoId);
  await expect(
    page.getByText("等待连接电脑文件夹", { exact: false }),
  ).toBeVisible();
  await folderFixture(page, [
    { name: "creation-local.jpg", bytes: [...(await jpeg("#556699"))] },
  ]);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("photo-files-reconnected")),
  );
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads).toHaveLength(1);
  expect(
    (await page.request.get(`/api/photos/${values.photoId}/original`)).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "作品集", exact: true }).click();
  await page
    .getByRole("button", { name: "本地创作测试 1", exact: true })
    .click();
  await page.getByRole("tab", { name: "创作", exact: true }).click();
  await expect(page.locator(".creation-card")).toHaveCount(1);
  await page.screenshot({ path: "test-results/creation.png" });
});
