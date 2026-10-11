import { test, expect } from "@playwright/test";
import { login, jpeg, folderFixture } from "./helpers";
for (const count of [1, 2, 3, 4, 10])
  test(`similar group of ${count}: at most three, every photo visited, fold and undo`, async ({
    page,
  }) => {
    await login(page);
    const base = await jpeg("#677688"),
      files = Array.from({ length: count }, (_, i) => ({
        name: `group-${count}-${i}.jpg`,
        bytes: [...Buffer.concat([base, Buffer.from(`unique-${count}-${i}`)])],
      }));
    await folderFixture(page, files);
    await page.getByRole("button", { name: "导入照片", exact: true }).click();
    await page
      .getByRole("button", { name: "连接电脑文件夹", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `已读取 ${count} 张，失败 0 张` }),
    ).toBeVisible();
    await expect(page.locator(".wall-card")).toHaveCount(1);
    if (count > 1) {
      await page
        .getByRole("button", { name: `${count} 张相似`, exact: true })
        .click();
      await expect(page.locator(".wall-card")).toHaveCount(count);
      await page
        .getByRole("button", { name: "收起本组", exact: true })
        .first()
        .click();
      await expect(page.locator(".wall-card")).toHaveCount(1);
    }
    await page.getByRole("button", { name: "全部展开", exact: true }).click();
    await expect(page.locator(".wall-card")).toHaveCount(count);
    await page.getByRole("button", { name: "全部叠放", exact: true }).click();
    await page.keyboard.press("Space");
    await expect(page.locator(".immersive")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".immersive-frame img")
          .evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((i) => i.complete && i.naturalWidth > 0),
          ),
      )
      .toBe(true);
    if (count === 10)
      await page.screenshot({ path: "test-results/similar-immersive.png" });
    for (let i = 0; i < count; i++) {
      expect(await page.locator(".similar-slot").count()).toBeLessThanOrEqual(
        3,
      );
      await page.keyboard.press("x");
      if (i < count - 1)
        await expect(page.locator(".immersive header")).toContainText(
          `${i + 2}/${count}`,
        );
    }
    await expect(
      page.getByRole("heading", { name: "本轮已完成" }),
    ).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(page.getByRole("heading", { name: "本轮已完成" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    const batches = await (await page.request.get("/api/batches")).json(),
      p = await (
        await page.request.get(`/api/batches/${batches.at(-1).id}/photos`)
      ).json();
    expect(p.filter((v) => v.status === "keep")).toHaveLength(count - 1);
    await page.getByRole("button", { name: "精筛", exact: true }).click();
    await expect(page.locator(".wall-card")).toHaveCount(count - 1);
  });
