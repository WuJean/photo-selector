import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("mobile browsing is separate, paged, and touch selection has large decisions", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const imageRequests = [];
  page.on("request", (request) => {
    if (/\/api\/photos\//.test(request.url()))
      imageRequests.push(request.url());
  });
  await login(page);
  await page.locator("input[type=file]").setInputFiles(
    await Promise.all(
      [0, 1, 2].map(async (i) => ({
        name: `touch-${i}.jpg`,
        mimeType: "image/jpeg",
        buffer: await jpeg(["#334488", "#668822", "#993344"][i]),
      })),
    ),
  );
  await expect(page.locator(".wall-card").first()).toBeVisible();
  await page.locator(".wall-card img").first().tap();
  const modal = page.getByRole("dialog", { name: "沉浸选片", exact: true });
  await expect(modal).toBeVisible();
  await expect(modal.locator(".immersive-frame.focused img")).toHaveAttribute(
    "src",
    /\/display\/mobile/,
  );
  expect(imageRequests.some((url) => /\/display\/tile/.test(url))).toBeTruthy();
  expect(
    imageRequests.some((url) => /\/(original|render)(\?|$)/.test(url)),
  ).toBeFalsy();
  expect(
    (await modal.locator(".decision").first().boundingBox()).height,
  ).toBeGreaterThanOrEqual(56);
  const swipe = async (dx, dy = 0) => {
    const frame = modal.locator(".immersive-frame.focused");
    const box = await frame.boundingBox();
    const session = await context.newCDPSession(page);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + dx, y: y + dy }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  };
  const before = await modal
    .locator(".immersive-frame.focused")
    .getAttribute("data-photo-id");
  await swipe(-90);
  await expect(modal.locator(".immersive-frame.focused")).not.toHaveAttribute(
    "data-photo-id",
    before,
  );
  const current = await modal
    .locator(".immersive-frame.focused")
    .getAttribute("data-photo-id");
  await swipe(5, 90);
  await expect(modal.locator(".immersive-frame.focused")).toHaveAttribute(
    "data-photo-id",
    current,
  );
  const frame = modal.locator(".immersive-frame.focused"),
    box = await frame.boundingBox(),
    cdp = await context.newCDPSession(page);
  const y = box.y + box.height / 2,
    x = box.x + box.width / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 25, y, id: 1 },
      { x: x + 25, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 65, y, id: 1 },
      { x: x + 65, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(Number(await frame.getAttribute("data-zoom"))).toBeGreaterThan(1);
  await swipe(-90);
  await expect(frame).toHaveAttribute("data-photo-id", current);
  await modal.getByRole("button", { name: "重置缩放" }).click();
  await expect(frame).toHaveAttribute("data-zoom", "1.00");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(modal.locator(".decision").first()).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 820 });
  expect(await modal.locator(".immersive-frame").count()).toBeLessThanOrEqual(
    3,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await cdp.detach();
  await modal.getByRole("button", { name: "保留", exact: true }).click();
  await expect(modal.locator(".decision").first()).toBeEnabled();
  await page.screenshot({ path: "test-results/mobile-immersive.png" });
  await modal.getByRole("button", { name: "关闭沉浸选片" }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.locator(".wall-card img").first().tap();
  await expect(page.locator(".selection-toolbar")).toContainText("已选 1 张");
  await context.close();
});
