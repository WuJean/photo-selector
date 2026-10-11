import { test, expect } from "@playwright/test";
import { login, jpeg } from "./helpers";
test("collage keyword and domain filters preserve canvas and scoped draft; random respects matches", async ({
  page,
}) => {
  await login(page);
  const b = await (
    await page.request.post("/api/batches", {
      data: { source: "upload", direct: true },
    })
  ).json();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const result = await (
      await page.request.post(`/api/batches/${b.id}/import`, {
        multipart: {
          photos: {
            name: `search-${i}.jpg`,
            mimeType: "image/jpeg",
            buffer: await jpeg(["#a44b22", "#33a456", "#324faa", "#aa9843"][i]),
          },
        },
      })
    ).json();
    ids.push(result.results[0].photo.id);
  }
  const c = await (
    await page.request.post("/api/collections", { data: { name: "检索验收" } })
  ).json();
  await page.request.put(`/api/collections/${c.id}`, {
    data: { photoIds: ids },
  });
  // Fixed understanding fixture, no paid AI. Backend filtering is covered independently.
  await page.route("**/api/assets", async (route) => {
    const r = await route.fetch();
    const photos = await r.json();
    await route.fulfill({
      response: r,
      json: photos.map((p) =>
        ids.includes(p.id)
          ? {
              ...p,
              description: p.id === ids[3] ? "林间近景" : "雪山冷色远景",
              ai: {
                tags: p.id === ids[3] ? ["人像", "近景"] : ["风景", "远景"],
              },
            }
          : p,
      ),
    });
  });
  await page.reload();
  await page.getByRole("link", { name: "作品集", exact: true }).click();
  await page.getByRole("button", { name: "检索验收 4", exact: true }).click();
  await page.getByRole("button", { name: "拼图与创作", exact: true }).click();
  await page.getByLabel("搜索拼图候选").fill("雪山 冷色");
  await expect(page.locator(".source-grid button")).toHaveCount(3);
  await page
    .locator(".candidate-domains summary")
    .filter({ hasText: "主体" })
    .click();
  await page
    .locator(".candidate-domains")
    .getByRole("button", { name: "风景", exact: true })
    .click();
  await expect(page.locator(".source-grid button")).toHaveCount(3);
  await page
    .locator(".candidate-domains")
    .getByRole("button", { name: "人像", exact: true })
    .click();
  await expect(page.locator(".source-grid button")).toHaveCount(0);
  await page.getByLabel("拼图标签匹配").selectOption("any");
  await expect(page.locator(".source-grid button")).toHaveCount(3);
  await expect
    .poll(async () => {
      const r = await page.request.get(
        `/api/projects/library/draft?scopeId=${c.id}`,
      );
      return (await r.json())?.candidateFilter?.query;
    })
    .toBe("雪山 冷色");
  await expect(page.locator(".story-slot img")).toHaveCount(4);
  await page.screenshot({ path: "test-results/collage-search.png" });
});
