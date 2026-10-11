import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("external browser decodes both local addresses and recovers a failed image request", async ({
  browser,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", { data: { name: "图片兼容性" } })
  ).json();
  const image = await sharp({
    create: { width: 150, height: 100, channels: 3, background: "#adc5b3" },
  })
    .jpeg()
    .toBuffer();
  await request.post(`/api/projects/${project.id}/import`, {
    multipart: {
      photos: { name: "browser.jpg", mimeType: "image/jpeg", buffer: image },
    },
  });
  for (const host of ["127.0.0.1", "localhost"]) {
    const context = await browser.newContext();
    await context.addInitScript(
      (id) => localStorage.setItem("photo-project", id),
      project.id,
    );
    const page = await context.newPage();
    await page.goto(`http://${host}:4174`);
    const img = page.locator(".photo-card img").first();
    await expect
      .poll(() => img.evaluate((el) => el.naturalWidth))
      .toBeGreaterThan(0);
    await page.reload();
    await expect
      .poll(() => img.evaluate((el) => el.naturalWidth))
      .toBeGreaterThan(0);
    await page.route("**/api/photos/*/thumb", (r) =>
      r.fulfill({ status: 503, body: "unavailable" }),
    );
    await page.reload();
    await expect(page.locator(".image-error").filter({hasText:"图片请求失败"})).toBeVisible();
    await page.unroute("**/api/photos/*/thumb");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect
      .poll(() => img.evaluate((el) => el.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.locator(".image-error").filter({hasText:"图片请求失败"})).toHaveCount(
      0,
    );
    await context.close();
  }
});
